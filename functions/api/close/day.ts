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
function n(value: unknown, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    if (!businessId || !branchId || !canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);
    const now = Date.now();
    const summary = body?.summary || {};
    const id = String(body?.summaryId || `day_${branchId}_${new Date(now).toISOString().slice(0, 10)}_${now}`);
    await env.DB.prepare(`
      INSERT INTO dailySummaries (id, date, shiftIds, totalSales, grossSales, taxTotal, totalExpenses, totalPicks, totalVariance, timestamp, branchId, businessId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, n(summary.date), JSON.stringify(Array.isArray(summary.shiftIds) ? summary.shiftIds : []), n(summary.totalSales), n(summary.grossSales), n(summary.taxTotal), n(summary.totalExpenses), n(summary.totalPicks), n(summary.totalVariance), now, branchId, businessId, now).run();
    return json({ success: true, summaryId: id });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not close day.' }, 500);
  }
};

