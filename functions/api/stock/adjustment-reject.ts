import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../_authUtils';
import { PolicyError } from '../_salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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

  try { await db.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN preparedBy TEXT').run(); } catch {}
  try { await db.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN approvedBy TEXT').run(); } catch {}
  try { await db.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN requestedQuantity REAL').run(); } catch {}
  try { await db.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN businessId TEXT').run(); } catch {}
  try { await db.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN branchId TEXT').run(); } catch {}
  try { await db.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN updated_at INTEGER').run(); } catch {}
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to reject stock adjustments.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const requestId = String(body?.requestId || body?.id || '').trim();
    if (!businessId || !branchId || !requestId) return json({ error: 'Business, branch and request are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const req = await env.DB.prepare(`
      SELECT *
      FROM stockAdjustmentRequests
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(requestId, businessId, branchId).first<any>();
    if (!req) throw new PolicyError('Stock adjustment request was not found.', 404);
    if (req.status !== 'PENDING') throw new PolicyError('This stock adjustment has already been processed.', 409);

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE stockAdjustmentRequests
        SET status = 'REJECTED', approvedBy = ?, updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ? AND status = 'PENDING'
      `).bind(auth.principal.userName || 'Administrator', now, requestId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'stock.adjust.reject',
        'stockAdjustmentRequest',
        requestId,
        'WARN',
        `Rejected stock adjustment for ${req.productName || req.productId}.`,
        businessId,
        branchId,
        now,
      ),
    ]);

    return json({ success: true });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not reject stock adjustment.' }, status);
  }
};
