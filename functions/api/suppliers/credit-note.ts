import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const SUPPLIER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function parseItems(value: unknown): Array<{ productId: string; quantity: number }> {
  const raw = typeof value === 'string' ? (() => {
    try { return JSON.parse(value); } catch { return []; }
  })() : value;
  if (!Array.isArray(raw)) return [];
  const items = new Map<string, number>();
  for (const item of raw) {
    const productId = trimText((item as any)?.productId, 160);
    const quantity = asNumber((item as any)?.quantity);
    if (!productId || quantity <= 0) continue;
    items.set(productId, roundMoney((items.get(productId) || 0) + quantity));
  }
  return Array.from(items.entries()).map(([productId, quantity]) => ({ productId, quantity }));
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS creditNotes (
      id TEXT PRIMARY KEY,
      supplierId TEXT NOT NULL,
      amount REAL NOT NULL,
      reference TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'PENDING',
      allocatedTo TEXT,
      items TEXT,
      productId TEXT,
      quantity REAL,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    'ALTER TABLE creditNotes ADD COLUMN status TEXT DEFAULT \'PENDING\'',
    'ALTER TABLE creditNotes ADD COLUMN allocatedTo TEXT',
    'ALTER TABLE creditNotes ADD COLUMN items TEXT',
    'ALTER TABLE creditNotes ADD COLUMN productId TEXT',
    'ALTER TABLE creditNotes ADD COLUMN quantity REAL',
    'ALTER TABLE creditNotes ADD COLUMN branchId TEXT',
    'ALTER TABLE creditNotes ADD COLUMN businessId TEXT',
    'ALTER TABLE creditNotes ADD COLUMN shiftId TEXT',
    'ALTER TABLE creditNotes ADD COLUMN updated_at INTEGER',
    'ALTER TABLE stockMovements ADD COLUMN shiftId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !SUPPLIER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to record supplier credit notes.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const supplierId = String(body?.supplierId || '').trim();
    if (!businessId || !branchId || !supplierId) return json({ error: 'Business, branch and supplier are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);

    const supplier = await env.DB.prepare(`
      SELECT id, name, company, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first<any>();
    if (!supplier) throw new PolicyError('Supplier was not found.', 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError('Supplier belongs to another branch.', 403);

    let itemInputs = parseItems(body?.items);
    const legacyProductId = trimText(body?.productId, 160);
    const legacyQuantity = asNumber(body?.quantity);
    if (itemInputs.length === 0 && legacyProductId) {
      itemInputs = [{ productId: legacyProductId, quantity: legacyQuantity }];
    }

    const returnItems: Array<{ productId: string; name: string; quantity: number; unitCost: number; amount: number; unit?: string }> = [];
    for (const item of itemInputs) {
      if (item.quantity <= 0) throw new PolicyError('Return quantity must be greater than zero.', 400);
      const product = await env.DB.prepare(`
        SELECT id, name, stockQuantity, costPrice, sellingPrice, unit, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(item.productId, businessId).first<any>();
      if (!product) throw new PolicyError('Selected product was not found.', 404);
      if (product.branchId && product.branchId !== branchId) throw new PolicyError('Selected product belongs to another branch.', 403);
      if (item.quantity > asNumber(product.stockQuantity) + 0.0001) {
        throw new PolicyError(`Cannot return more than available stock for ${product.name} (${asNumber(product.stockQuantity)}).`, 409);
      }
      const costPrice = asNumber(product.costPrice);
      const unitCost = roundMoney(costPrice > 0 ? costPrice : asNumber(product.sellingPrice));
      if (unitCost <= 0) throw new PolicyError(`Set a cost price for ${product.name} before making a credit note.`, 400);
      returnItems.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
        unitCost,
        amount: roundMoney(item.quantity * unitCost),
        unit: product.unit || 'pcs',
      });
    }

    const amount = returnItems.length > 0
      ? roundMoney(returnItems.reduce((sum, item) => sum + item.amount, 0))
      : roundMoney(asNumber(body?.amount));
    if (amount <= 0) throw new PolicyError('Credit note amount must be more than zero.', 400);

    const now = Date.now();
    const creditNoteId = trimText(body?.creditNoteId, 160) || crypto.randomUUID();
    const reference = trimText(body?.reference, 160) || creditNoteId.split('-')[0].toUpperCase();
    const primaryItem = returnItems[0] || null;
    const creditNote = {
      id: creditNoteId,
      supplierId,
      amount,
      reference,
      reason: trimText(body?.reason, 240) || null,
      status: 'PENDING',
      timestamp: now,
      items: returnItems,
      productId: returnItems.length === 1 ? primaryItem?.productId : null,
      quantity: returnItems.length === 1 ? primaryItem?.quantity : null,
      shiftId: body?.shiftId || null,
      branchId,
      businessId,
      updated_at: now,
    };

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO creditNotes (id, supplierId, amount, reference, timestamp, reason, status, allocatedTo, items, productId, quantity, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        creditNote.id,
        creditNote.supplierId,
        creditNote.amount,
        creditNote.reference,
        creditNote.timestamp,
        creditNote.reason,
        creditNote.status,
        null,
        returnItems.length ? JSON.stringify(returnItems) : null,
        creditNote.productId,
        creditNote.quantity,
        branchId,
        businessId,
        creditNote.shiftId,
        now,
      ),
    ];

    for (const item of returnItems) {
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = MAX(0, COALESCE(stockQuantity, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(item.quantity, now, item.productId, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          item.productId,
          'OUT',
          item.quantity,
          now,
          `Supplier Return: ${reference} - ${item.name}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now,
        )
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'supplier.creditNote.record',
        'creditNote',
        creditNote.id,
        'INFO',
        `Recorded supplier credit note of Ksh ${amount.toLocaleString()} for ${supplier.company || supplier.name}${returnItems.length ? ` (${returnItems.length} product line${returnItems.length === 1 ? '' : 's'})` : ''}.`,
        businessId,
        branchId,
        now,
      )
    );

    await env.DB.batch(statements);
    return json({ success: true, creditNote });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not record supplier credit note.' }, status);
  }
};
