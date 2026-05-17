import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

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
    if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to reject refunds.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const transactionId = String(body?.transactionId || body?.id || '').trim();
    if (!businessId || !branchId || !transactionId) return json({ error: 'Business, branch and sale are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const tx = await env.DB.prepare(`
      SELECT id, status, total
      FROM transactions
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(transactionId, businessId, branchId).first<any>();
    if (!tx) throw new PolicyError('Sale was not found.', 404);
    if (tx.status !== 'PENDING_REFUND' && tx.status !== 'PAID') throw new PolicyError('This refund has already been processed.', 409);

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE transactions SET status = 'PAID', pendingRefundItems = NULL, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`)
        .bind(now, transactionId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'sale.refund.reject',
        'transaction',
        transactionId,
        'WARN',
        `Rejected refund request for sale of Ksh ${Number(tx.total || 0).toLocaleString()}.`,
        businessId,
        branchId,
        now,
      ),
    ]);

    return json({ success: true, transactionId });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not reject refund.' }, status);
  }
};

