import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
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
function isActiveValue(value: unknown) { return value === false || value === 0 || value === '0' ? 0 : 1; }
function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS serviceItems (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      price REAL NOT NULL,
      taxCategory TEXT DEFAULT 'A',
      isActive INTEGER DEFAULT 1,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
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

  for (const sql of [
    'ALTER TABLE serviceItems ADD COLUMN category TEXT',
    'ALTER TABLE serviceItems ADD COLUMN description TEXT',
    'ALTER TABLE serviceItems ADD COLUMN price REAL DEFAULT 0',
    "ALTER TABLE serviceItems ADD COLUMN taxCategory TEXT DEFAULT 'A'",
    'ALTER TABLE serviceItems ADD COLUMN isActive INTEGER DEFAULT 1',
    'ALTER TABLE serviceItems ADD COLUMN businessId TEXT',
    'ALTER TABLE serviceItems ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to manage services.' }, 403);
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || auth.principal.branchId || '').trim();
    if (branchId && !canAccessBranch(auth.principal, branchId)) return json({ error: 'Branch access denied.' }, 403);
    const service = body?.service || body || {};
    const name = trimText(service.name, 120);
    if (!name) return json({ error: 'Service name is required.' }, 400);
    const price = Math.max(0, asNumber(service.price));
    const now = Date.now();
    const id = trimText(service.id || body?.serviceId, 160) || `service_${businessId}_${crypto.randomUUID()}`;
    await ensureSchema(env.DB);
    const existing = await env.DB.prepare(`
      SELECT id
      FROM serviceItems
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(id, businessId).first<any>();
    const saved = {
      id,
      name,
      category: trimText(service.category, 120) || 'General',
      description: trimText(service.description, 500) || null,
      price,
      taxCategory: service.taxCategory === 'A' ? 'A' : 'E',
      isActive: isActiveValue(service.isActive),
      businessId,
      updated_at: now,
    };
    await env.DB.batch([
      env.DB.prepare(`INSERT OR REPLACE INTO serviceItems (id, name, category, description, price, taxCategory, isActive, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(saved.id, saved.name, saved.category, saved.description, saved.price, saved.taxCategory, saved.isActive, businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        existing ? 'catalog.service.update' : 'catalog.service.create',
        'serviceItem',
        id,
        'INFO',
        `${existing ? 'Updated' : 'Created'} service ${name}.`,
        businessId,
        branchId || null,
        now,
      ),
    ]);
    return json({ success: true, service: saved });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update service.' }, status);
  }
};
