import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

type ReceiveLine = {
  productId: string;
  receivedQuantity: number;
  unitCost: number;
  sellingPrice?: number;
};

const RECEIVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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
  try { await db.prepare('ALTER TABLE purchaseOrders ADD COLUMN receivedBy TEXT').run(); } catch {}
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !RECEIVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to receive purchase orders.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const purchaseOrderId = String(body?.purchaseOrderId || body?.id || '').trim();
    const invoiceNumber = trimText(body?.invoiceNumber, 80);
    const receivedBy = trimText(body?.receivedBy || auth.principal.userName || 'Staff', 120) || 'Staff';
    if (!businessId || !branchId || !purchaseOrderId) return json({ error: 'Business, branch and purchase order are required.' }, 400);
    if (!invoiceNumber) return json({ error: 'Supplier invoice number is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);

    const po = await env.DB.prepare(`
      SELECT *
      FROM purchaseOrders
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(purchaseOrderId, businessId, branchId).first<any>();
    if (!po) throw new PolicyError('Purchase order was not found.', 404);
    if (po.approvalStatus !== 'APPROVED') throw new PolicyError('Purchase order must be approved before receiving.', 409);
    if (po.status === 'RECEIVED') throw new PolicyError('Purchase order has already been received.', 409);

    const supplier = await env.DB.prepare(`
      SELECT id, name, company, balance, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(po.supplierId, businessId).first<any>();
    if (!supplier) throw new PolicyError('Supplier was not found.', 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError('Supplier belongs to another branch.', 403);

    const savedItems = parseItems(po.items);
    if (!savedItems.length) throw new PolicyError('Purchase order has no line items.', 400);

    const submittedLines = new Map<string, ReceiveLine>();
    if (!Array.isArray(body?.items)) throw new PolicyError('Received line items are required.', 400);
    for (const raw of body.items) {
      const productId = String(raw?.productId || '').trim();
      if (!productId) continue;
      const receivedQuantity = asNumber(raw?.receivedQuantity);
      const unitCost = roundMoney(asNumber(raw?.unitCost));
      const sellingPrice = raw?.sellingPrice === '' || raw?.sellingPrice === null || raw?.sellingPrice === undefined
        ? undefined
        : roundMoney(asNumber(raw?.sellingPrice));
      if (receivedQuantity < 0 || unitCost < 0 || (sellingPrice !== undefined && sellingPrice < 0)) {
        throw new PolicyError('Received quantities and prices cannot be negative.', 400);
      }
      submittedLines.set(productId, { productId, receivedQuantity, unitCost, sellingPrice });
    }

    const updatedItems = savedItems.map(item => {
      const productId = String(item?.productId || '').trim();
      const submitted = submittedLines.get(productId);
      return {
        ...item,
        receivedQuantity: submitted ? submitted.receivedQuantity : asNumber(item?.receivedQuantity),
        unitCost: submitted ? submitted.unitCost : roundMoney(asNumber(item?.unitCost)),
      };
    });

    const totalReceivedCost = roundMoney(
      updatedItems.reduce((sum, item) => sum + (asNumber(item.receivedQuantity) * asNumber(item.unitCost)), 0)
    );
    if (totalReceivedCost <= 0) throw new PolicyError('Receive at least one item before confirming arrival.', 400);

    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    for (const item of updatedItems) {
      const quantity = asNumber(item.receivedQuantity);
      if (quantity <= 0) continue;

      const productId = String(item.productId || '').trim();
      const product = await env.DB.prepare(`
        SELECT id, name, stockQuantity, sellingPrice, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(productId, businessId).first<any>();
      if (!product) throw new PolicyError(`Product "${item.name || productId}" was not found.`, 404);
      if (product.branchId && product.branchId !== branchId) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);

      const submitted = submittedLines.get(productId);
      const nextSellingPrice = submitted?.sellingPrice && submitted.sellingPrice > 0
        ? submitted.sellingPrice
        : asNumber(product.sellingPrice);

      statements.push(
        env.DB.prepare(`
          UPDATE products
          SET stockQuantity = COALESCE(stockQuantity, 0) + ?,
              costPrice = ?,
              sellingPrice = ?,
              updated_at = ?
          WHERE id = ? AND businessId = ?
        `).bind(quantity, roundMoney(asNumber(item.unitCost)), nextSellingPrice, now, productId, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          productId,
          'IN',
          quantity,
          now,
          `${po.poNumber || po.id} Inv:${invoiceNumber}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now,
        )
      );
    }

    statements.unshift(
      env.DB.prepare(`
        UPDATE purchaseOrders
        SET status = 'RECEIVED',
            paymentStatus = 'UNPAID',
            paidAmount = 0,
            items = ?,
            totalAmount = ?,
            receivedDate = ?,
            invoiceNumber = ?,
            receivedBy = ?,
            updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ?
      `).bind(
        JSON.stringify(updatedItems),
        totalReceivedCost,
        now,
        invoiceNumber,
        receivedBy,
        now,
        purchaseOrderId,
        businessId,
        branchId,
      )
    );

    statements.push(
      env.DB.prepare(`UPDATE suppliers SET balance = COALESCE(balance, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(totalReceivedCost, now, po.supplierId, businessId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'purchase.receive',
        'purchaseOrder',
        purchaseOrderId,
        'INFO',
        `Received ${po.poNumber || purchaseOrderId} for Ksh ${totalReceivedCost.toLocaleString()}.`,
        businessId,
        branchId,
        now,
      )
    );

    await env.DB.batch(statements);

    return json({
      success: true,
      purchaseOrderId,
      totalReceivedCost,
      receivedItemCount: updatedItems.filter(item => asNumber(item.receivedQuantity) > 0).length,
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not receive purchase order.' }, status);
  }
};
