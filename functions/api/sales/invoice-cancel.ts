import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { DEFAULT_SHOP_ID, ensureInventoryIntegritySchema } from '../inventoryIntegrity';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const INVOICE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Shop-ID',
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

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedShopId(value: unknown) {
  return trimText(value, 160) || DEFAULT_SHOP_ID;
}

function parseItems(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      businessId TEXT,
      shiftId TEXT,
      shopId TEXT,
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
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    'ALTER TABLE salesInvoices ADD COLUMN shiftId TEXT',
    'ALTER TABLE salesInvoices ADD COLUMN shopId TEXT',
    'ALTER TABLE customers ADD COLUMN shopId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shopId TEXT',
    `UPDATE customers SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_salesInvoices_business_number ON salesInvoices(businessId, invoiceNumber)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
  await ensureInventoryIntegritySchema(db);
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !INVOICE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to cancel sales invoices.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const invoiceId = String(body?.invoiceId || body?.id || '').trim();
    const shopId = normalizedShopId(request.headers.get('X-Shop-ID') || body?.shopId);
    if (!businessId || !invoiceId) return json({ error: 'Business and invoice are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const invoice = await env.DB.prepare(`
      SELECT *
      FROM salesInvoices
      WHERE id = ?
        AND businessId = ?
        AND COALESCE(NULLIF(shopId, ''), ?) = ?
      LIMIT 1
    `).bind(invoiceId, businessId, DEFAULT_SHOP_ID, shopId).first<any>();
    if (!invoice) throw new PolicyError('Sales invoice was not found.', 404);
    if (invoice.status === 'CANCELLED') return json({ success: true, invoice: { ...invoice, items: parseItems(invoice.items) }, idempotent: true });
    if (invoice.status === 'PAID' || asNumber(invoice.paidAmount) > 0) {
      throw new PolicyError('This invoice already has an amount cleared. Record an adjustment instead.', 409);
    }

    const now = Date.now();
    const items = parseItems(invoice.items);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`UPDATE salesInvoices SET status = 'CANCELLED', balance = 0, updated_at = ? WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?`)
        .bind(now, invoiceId, businessId, DEFAULT_SHOP_ID, shopId),
      env.DB.prepare(`
        UPDATE customers
        SET totalSpent = MAX(0, COALESCE(totalSpent, 0) - ?),
            balance = MAX(0, COALESCE(balance, 0) - ?),
            updated_at = ?
        WHERE id = ?
          AND businessId = ?
          AND COALESCE(NULLIF(shopId, ''), ?) = ?
      `).bind(asNumber(invoice.total), asNumber(invoice.balance), now, invoice.customerId, businessId, DEFAULT_SHOP_ID, shopId),
    ];

    for (const line of items) {
      if (line?.itemType !== 'PRODUCT' || !line?.itemId) continue;
      const quantity = asNumber(line.quantity);
      if (quantity <= 0) continue;
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?`)
          .bind(quantity, now, line.itemId, businessId, DEFAULT_SHOP_ID, shopId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, businessId, shiftId, shopId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          line.itemId,
          'RETURN',
          quantity,
          now,
          `Cancelled invoice ${invoice.invoiceNumber}`,
          businessId,
          body?.shiftId || null,
          shopId,
          now,
        )
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'sales.invoice.cancel',
        'salesInvoice',
        invoiceId,
        'WARN',
        `Cancelled ${invoice.invoiceNumber}.`,
        businessId, now,
      )
    );

    await env.DB.batch(statements);
    return json({
      success: true,
      invoice: {
        ...invoice,
        items,
        status: 'CANCELLED',
        balance: 0,
        updated_at: now,
      },
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not cancel sales invoice.' }, status);
  }
};
