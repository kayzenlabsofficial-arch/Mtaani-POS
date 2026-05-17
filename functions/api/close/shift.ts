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
function s(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }

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
    const report = body?.report || {};
    const shiftId = s(body?.shiftId || report.shiftId, 160) || `shift_${branchId}_${new Date(now).toISOString().slice(0, 10)}_${auth.principal.userId || 'staff'}`;
    const reportId = s(body?.reportId, 160) || `eod_${branchId}_${now}`;
    const cashierName = s(report.cashierName || body?.cashierName || auth.principal.userName, 120) || 'Staff';
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO endOfDayReports (id, shiftId, timestamp, totalSales, grossSales, taxTotal, cashSales, mpesaSales, totalExpenses, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(reportId, shiftId, now, n(report.totalSales), n(report.grossSales), n(report.taxTotal), n(report.cashSales), n(report.mpesaSales), n(report.totalExpenses), n(report.totalPicks), n(report.totalRefunds), n(report.expectedCash), n(report.reportedCash), n(report.difference), cashierName, branchId, businessId, now),
      env.DB.prepare(`
        INSERT OR REPLACE INTO shifts (id, startTime, endTime, cashierName, status, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(shiftId, n(body?.startTime || report.startTime || now), now, cashierName, 'CLOSED', branchId, businessId, now),
    ]);
    return json({ success: true, reportId, shiftId });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not close shift.' }, 500);
  }
};

