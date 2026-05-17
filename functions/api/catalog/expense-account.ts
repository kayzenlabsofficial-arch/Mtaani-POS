import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const MANAGER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function trimText(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to manage expense accounts.' }, 403);
    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    if (action === 'DELETE') {
      const accountId = trimText(body?.accountId || body?.id, 160);
      if (!accountId) return json({ error: 'Expense account is required.' }, 400);
      const refs = await env.DB.prepare(`SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND category = (SELECT name FROM expenseAccounts WHERE id = ? AND businessId = ? LIMIT 1)`)
        .bind(businessId, accountId, businessId)
        .first<any>();
      if (Number(refs?.count || 0) > 0) throw new PolicyError('Expense accounts with expense history cannot be deleted.', 409);
      await env.DB.prepare(`DELETE FROM expenseAccounts WHERE id = ? AND businessId = ?`).bind(accountId, businessId).run();
      return json({ success: true, accountId });
    }
    const account = body?.account || body || {};
    const name = trimText(account.name, 120);
    if (!name) return json({ error: 'Expense account name is required.' }, 400);
    const now = Date.now();
    const id = trimText(account.id || body?.accountId, 160) || crypto.randomUUID();
    const saved = { id, name, description: trimText(account.description, 240), businessId, updated_at: now };
    await env.DB.prepare(`INSERT OR REPLACE INTO expenseAccounts (id, name, description, businessId, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(saved.id, saved.name, saved.description, businessId, now)
      .run();
    return json({ success: true, account: saved });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update expense account.' }, status);
  }
};

