import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../_authUtils';
import { PolicyError } from '../_salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const REQUEST_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

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

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
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
      branchId TEXT,
      businessId TEXT,
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

  const adjustmentColumns = [
    'productName TEXT',
    'oldQty REAL',
    'newQty REAL',
    'requestedQuantity REAL',
    'preparedBy TEXT',
    'approvedBy TEXT',
    'branchId TEXT',
    'businessId TEXT',
    'updated_at INTEGER',
  ];
  for (const column of adjustmentColumns) {
    try { await db.prepare(`ALTER TABLE stockAdjustmentRequests ADD COLUMN ${column}`).run(); } catch {}
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !REQUEST_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to request stock adjustments.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const productId = trimText(body?.productId, 160);
    if (!businessId || !branchId || !productId) return json({ error: 'Business, branch and product are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const product = await env.DB.prepare(`
      SELECT id, name, stockQuantity, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first<any>();
    if (!product) throw new PolicyError('Product was not found.', 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError('Product belongs to another branch.', 403);

    const newQty = asNumber(body?.newQty);
    if (newQty < 0) throw new PolicyError('New stock quantity cannot be negative.', 400);
    const reason = trimText(body?.reason, 240);
    if (!reason) throw new PolicyError('Adjustment reason is required.', 400);

    const now = Date.now();
    const oldQty = asNumber(product.stockQuantity);
    const requestId = trimText(body?.requestId || body?.id, 160) || crypto.randomUUID();
    const adjustment = {
      id: requestId,
      productId,
      productName: product.name,
      oldQty,
      newQty,
      requestedQuantity: newQty - oldQty,
      reason,
      timestamp: now,
      status: 'PENDING',
      preparedBy: trimText(body?.preparedBy || auth.principal.userName || 'Staff', 120),
      branchId,
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO stockAdjustmentRequests (id, productId, productName, oldQty, newQty, requestedQuantity, reason, timestamp, status, preparedBy, approvedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        adjustment.id,
        adjustment.productId,
        adjustment.productName,
        adjustment.oldQty,
        adjustment.newQty,
        adjustment.requestedQuantity,
        adjustment.reason,
        adjustment.timestamp,
        adjustment.status,
        adjustment.preparedBy,
        null,
        branchId,
        businessId,
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
        'stock.adjust.request',
        'stockAdjustmentRequest',
        adjustment.id,
        'WARN',
        `Requested stock adjustment for ${product.name} from ${oldQty} to ${newQty}.`,
        businessId,
        branchId,
        now,
      ),
    ]);

    return json({ success: true, adjustment });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not request stock adjustment.' }, status);
  }
};
