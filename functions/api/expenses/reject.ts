import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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

async function ensureSchema(db: D1Database) {
  for (const sql of [
    'ALTER TABLE expenses ADD COLUMN shopId TEXT',
    "UPDATE expenses SET shopId = 'single-shop' WHERE COALESCE(shopId, '') = ''",
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
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
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to reject expenses.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const shopId = String(request.headers.get('X-Shop-ID') || body?.shopId || '').trim() || 'single-shop';
    const expenseId = String(body?.expenseId || body?.id || '').trim();
    if (!businessId || !expenseId) return json({ error: 'Business and expense are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const expense = await env.DB.prepare(`
      SELECT id, amount, status, shopId
      FROM expenses
      WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), 'single-shop') = ?
      LIMIT 1
    `).bind(expenseId, businessId, shopId).first<any>();
    if (!expense) throw new PolicyError('Expense was not found.', 404);
    if (expense.status === 'REJECTED') return json({ success: true, expenseId, idempotent: true });
    if (expense.status !== 'PENDING') throw new PolicyError('This expense has already been processed.', 409);

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE expenses SET status = 'REJECTED', updated_at = ? WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), 'single-shop') = ?`)
        .bind(now, expenseId, businessId, shopId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'expense.reject',
        'expense',
        expenseId,
        'WARN',
        `Rejected expense request of Ksh ${Number(expense.amount || 0).toLocaleString()}.`,
        businessId, now,
      ),
    ]);

    return json({ success: true, expenseId, idempotent: false });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not reject expense.' }, status);
  }
};
