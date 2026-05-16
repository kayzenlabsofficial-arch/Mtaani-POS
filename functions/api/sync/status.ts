import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, 'Cache-Control': 'no-store' },
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const businessId = request.headers.get('X-Business-ID') || '';
  const branchId = request.headers.get('X-Branch-ID') || '';
  if (!businessId || !branchId) return json({ error: 'X-Business-ID and X-Branch-ID required' }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied' }, 403);

  const { results } = await env.DB.prepare(
    `SELECT deviceId, cashierName, lastSyncAt, updated_at
     FROM deviceSyncStatus
     WHERE businessId = ? AND branchId = ?
     ORDER BY lastSyncAt DESC
     LIMIT 100`
  )
    .bind(businessId, branchId)
    .all();

  return json({ success: true, rows: results || [] });
};

