import { authorizeRequest, canAccessBusiness, verifyPassword } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders,
    },
  });
}

async function ensureAttemptTable(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
}

async function recordFailedAttempt(db: D1Database, id: string) {
  const row = await db.prepare('SELECT count FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;
  await db.prepare('INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, count, lockedUntil, Date.now())
    .run();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'Database is not configured.' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const businessId = String(body?.businessId || request.headers.get('X-Business-ID') || auth.principal.businessId || '').trim();
    const pin = String(body?.pin || '').trim();
    if (!businessId || !pin) return json({ error: 'Business and supervisor PIN are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureAttemptTable(env.DB);
    const attemptId = `ADMIN_VERIFY:${businessId}:${auth.principal.userId}`;
    const attempt = await env.DB.prepare('SELECT lockedUntil FROM loginAttempts WHERE id = ?').bind(attemptId).first<any>();
    if (attempt?.lockedUntil && Date.now() < Number(attempt.lockedUntil)) {
      const minutes = Math.ceil((Number(attempt.lockedUntil) - Date.now()) / 60000);
      return json({ error: `Supervisor check is locked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, 423);
    }

    const { results } = await env.DB.prepare('SELECT * FROM users WHERE businessId = ? AND role = ?').bind(businessId, 'ADMIN').all<any>();
    for (const admin of results || []) {
      const rawPin = typeof admin.pin === 'string' ? admin.pin : '';
      const pinOk = rawPin ? rawPin === pin : false;
      const passwordOk = await verifyPassword(pin, String(admin.password || ''));
      if (pinOk || passwordOk) {
        await env.DB.prepare('DELETE FROM loginAttempts WHERE id = ?').bind(attemptId).run();
        return json({ success: true, admin: { id: admin.id, name: admin.name } });
      }
    }

    await recordFailedAttempt(env.DB, attemptId);
    return json({ error: 'Invalid supervisor PIN.' }, 401);
  } catch (err: any) {
    console.error('[Admin Verify API]', err);
    return json({ error: err?.message || 'Could not verify supervisor.' }, 500);
  }
};
