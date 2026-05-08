interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expectedKey = env.API_SECRET;
  const apiKey = request.headers.get('X-API-Key');
  if (!expectedKey || apiKey !== expectedKey) return json({ error: 'Unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const businessId = request.headers.get('X-Business-ID') || '';
  const branchId = request.headers.get('X-Branch-ID') || '';
  if (!businessId || !branchId) return json({ error: 'X-Business-ID and X-Branch-ID required' }, 400);

  const body = (await request.json().catch(() => null)) as any;
  const deviceId = String(body?.deviceId || '').trim();
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const lastSyncAt = Number(body?.lastSyncAt || Date.now());

  if (!deviceId) return json({ error: 'deviceId required' }, 400);

  const id = `${businessId}|${branchId}|${deviceId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO deviceSyncStatus (id, businessId, branchId, deviceId, cashierName, lastSyncAt, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, businessId, branchId, deviceId, cashierName, lastSyncAt, Date.now())
    .run();

  return json({ success: true });
};

