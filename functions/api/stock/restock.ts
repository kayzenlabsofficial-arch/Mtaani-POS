import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const STOCK_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !STOCK_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to restock inventory.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const productId = String(body?.productId || '').trim();
    if (!businessId || !branchId || !productId) return json({ error: 'Business, branch and product are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    const quantity = asNumber(body?.quantity);
    if (quantity <= 0) throw new PolicyError('Enter a valid restock quantity.', 400);
    const hasCost = body?.costPrice !== undefined && body?.costPrice !== null && body?.costPrice !== '';
    const costPrice = hasCost ? roundMoney(asNumber(body.costPrice)) : null;
    if (costPrice !== null && costPrice < 0) throw new PolicyError('Cost price cannot be negative.', 400);

    await ensureSchema(env.DB);
    const product = await env.DB.prepare(`
      SELECT id, name, stockQuantity, costPrice, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first<any>();
    if (!product) throw new PolicyError('Product was not found.', 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError('Product belongs to another branch.', 403);

    const now = Date.now();
    const updateSql = costPrice !== null
      ? `UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) + ?, costPrice = ?, updated_at = ? WHERE id = ? AND businessId = ?`
      : `UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`;
    const updateProduct = costPrice !== null
      ? env.DB.prepare(updateSql).bind(quantity, costPrice, now, productId, businessId)
      : env.DB.prepare(updateSql).bind(quantity, now, productId, businessId);
    const nextStockQuantity = asNumber(product.stockQuantity) + quantity;

    await env.DB.batch([
      updateProduct,
      env.DB.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        'IN',
        quantity,
        now,
        trimText(body?.reference, 160) || 'Manual restock',
        branchId,
        businessId,
        body?.shiftId || null,
        now,
      ),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'stock.restock',
        'product',
        productId,
        'INFO',
        `Restocked ${product.name} by ${quantity}.`,
        businessId,
        branchId,
        now,
      ),
    ]);

    return json({
      success: true,
      productId,
      stockQuantity: nextStockQuantity,
      costPrice: costPrice ?? asNumber(product.costPrice),
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not restock inventory.' }, status);
  }
};

