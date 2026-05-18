import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function trimText(value: unknown, max = 240) { return String(value ?? '').trim().slice(0, max); }

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim() || null;
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    if (branchId && !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);
    const severity = ['INFO', 'WARN', 'CRITICAL'].includes(String(body?.severity || '').toUpperCase()) ? String(body.severity).toUpperCase() : 'INFO';
    const now = Date.now();
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      now,
      trimText(body?.userId || auth.principal.userId, 160) || null,
      trimText(body?.userName || auth.principal.userName, 160) || null,
      trimText(body?.action, 160) || 'audit.event',
      trimText(body?.entity, 120) || null,
      trimText(body?.entityId, 160) || null,
      severity,
      trimText(body?.details, 500) || null,
      businessId,
      branchId,
      now,
    ).run();
    return json({ success: true, id });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not record audit event.' }, 500);
  }
};

