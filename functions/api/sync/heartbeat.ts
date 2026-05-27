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
      shopId TEXT,
      cashierName TEXT,
      lastSyncAt INTEGER,
      pendingOutboxCount INTEGER DEFAULT 0,
      failedOutboxCount INTEGER DEFAULT 0,
      oldestPendingAt INTEGER,
      lastErrorAt INTEGER,
      lastSyncError TEXT,
      updated_at INTEGER
    )`
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_business ON deviceSyncStatus(businessId, lastSyncAt)').run();
  for (const sql of [
    'ALTER TABLE deviceSyncStatus ADD COLUMN shopId TEXT',
    'ALTER TABLE deviceSyncStatus ADD COLUMN pendingOutboxCount INTEGER DEFAULT 0',
    'ALTER TABLE deviceSyncStatus ADD COLUMN failedOutboxCount INTEGER DEFAULT 0',
    'ALTER TABLE deviceSyncStatus ADD COLUMN oldestPendingAt INTEGER',
    'ALTER TABLE deviceSyncStatus ADD COLUMN lastErrorAt INTEGER',
    'ALTER TABLE deviceSyncStatus ADD COLUMN lastSyncError TEXT',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
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
  const shopId = body?.shopId ? String(body.shopId).slice(0, 120) : null;
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const lastSyncAt = Number(body?.lastSyncAt || Date.now());
  const pendingOutboxCount = Math.max(0, Math.floor(Number(body?.pendingOutboxCount || 0)));
  const failedOutboxCount = Math.max(0, Math.floor(Number(body?.failedOutboxCount || 0)));
  const oldestPendingAt = body?.oldestPendingAt ? Number(body.oldestPendingAt) : null;
  const lastErrorAt = body?.lastErrorAt ? Number(body.lastErrorAt) : null;
  const lastSyncError = body?.lastSyncError ? String(body.lastSyncError).slice(0, 220) : null;

  if (!deviceId) return json({ error: 'deviceId required' }, 400);

  const id = `${businessId}|${deviceId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO deviceSyncStatus (
       id, businessId, deviceId, shopId, cashierName, lastSyncAt,
       pendingOutboxCount, failedOutboxCount, oldestPendingAt, lastErrorAt, lastSyncError, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      businessId,
      deviceId,
      shopId,
      cashierName,
      lastSyncAt,
      pendingOutboxCount,
      failedOutboxCount,
      oldestPendingAt,
      lastErrorAt,
      lastSyncError,
      Date.now(),
    )
    .run();

  return json({ success: true });
};
