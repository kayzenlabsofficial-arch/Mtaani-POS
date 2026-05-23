import { authorizeRequest, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, 'Cache-Control': 'no-store' },
  });
}

async function ensureDeviceSyncSchema(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS deviceSyncStatus (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      cashierName TEXT,
      lastSyncAt INTEGER,
      updated_at INTEGER
    )`
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_business ON deviceSyncStatus(businessId, lastSyncAt)').run();
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  await ensureDeviceSyncSchema(env.DB);

  const businessId = request.headers.get('X-Business-ID') || '';
  if (!businessId) return json({ error: 'X-Business-ID required' }, 400);
  if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied' }, 403);

  const body = (await request.json().catch(() => null)) as any;
  const deviceId = String(body?.deviceId || '').trim();
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const lastSyncAt = Number(body?.lastSyncAt || Date.now());

  if (!deviceId) return json({ error: 'deviceId required' }, 400);

  const id = `${businessId}|${deviceId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO deviceSyncStatus (id, businessId, deviceId, cashierName, lastSyncAt, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(id, businessId, deviceId, cashierName, lastSyncAt, Date.now())
    .run();

  return json({ success: true });
};
