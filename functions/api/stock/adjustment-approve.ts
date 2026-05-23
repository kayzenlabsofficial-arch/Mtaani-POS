import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
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

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      productName TEXT,
      oldQty REAL,
      newQty REAL,
      requestedQuantity REAL,
      reason TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      preparedBy TEXT,
      approvedBy TEXT,
      businessId TEXT,
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
      updated_at INTEGER
    )
  `).run();

  const adjustmentColumns = [
    'productName TEXT',
    'oldQty REAL',
    'newQty REAL',
    'requestedQuantity REAL',
    'preparedBy TEXT',
    'approvedBy TEXT',
    'businessId TEXT',
    'updated_at INTEGER',
  ];
  for (const column of adjustmentColumns) {
    try { await db.prepare(`ALTER TABLE stockAdjustmentRequests ADD COLUMN ${column}`).run(); } catch {}
  }
  try { await db.prepare('ALTER TABLE stockMovements ADD COLUMN shiftId TEXT').run(); } catch {}
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to approve stock adjustments.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const requestId = String(body?.requestId || body?.id || '').trim();
    if (!businessId || !requestId) return json({ error: 'Business and request are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const req = await env.DB.prepare(`
      SELECT *
      FROM stockAdjustmentRequests
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(requestId, businessId).first<any>();
    if (!req) throw new PolicyError('Stock adjustment request was not found.', 404);
    if (req.status !== 'PENDING') throw new PolicyError('This stock adjustment has already been processed.', 409);

    const product = await env.DB.prepare(`
      SELECT id, name, stockQuantity
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(req.productId, businessId).first<any>();
    if (!product) throw new PolicyError('Product was not found.', 404);

    const delta = asNumber(req.newQty) - asNumber(req.oldQty);
    const adjustedQty = Math.max(0, asNumber(product.stockQuantity) + delta);
    const now = Date.now();
    const approvedBy = String(body?.approvedBy || auth.principal.userName || 'Administrator').slice(0, 120);

    await env.DB.batch([
      env.DB.prepare(`UPDATE products SET stockQuantity = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(adjustedQty, now, req.productId, businessId),
      env.DB.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        req.productId,
        'ADJUST',
        delta,
        now,
        `Approved Adj: ${String(req.reason || '').slice(0, 120)}`,
        businessId,
        req.shiftId || null,
        now,
      ),
      env.DB.prepare(`UPDATE stockAdjustmentRequests SET status = 'APPROVED', approvedBy = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(approvedBy, now, requestId, businessId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'stock.adjust.approve',
        'stockAdjustmentRequest',
        requestId,
        'INFO',
        `Adjusted ${product.name} by ${delta}.`,
        businessId, now,
      ),
    ]);

    return json({ success: true, productId: req.productId, stockQuantity: adjustedQty });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not approve stock adjustment.' }, status);
  }
};
