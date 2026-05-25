import { authorizeRequest, canAccessBusiness, verifyPassword } from '../authUtils';
import { getMpesaPublicStatus, saveMpesaCredentials } from './credentialStore';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

const CONFIRM_PHRASE = 'UPDATE MPESA';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function ensureAttemptTable(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
}

async function rejectIfLocked(db: D1Database, id: string) {
  const row = await db.prepare('SELECT count, lockedUntil FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  if (row?.lockedUntil && Date.now() < Number(row.lockedUntil)) {
    const minutes = Math.ceil((Number(row.lockedUntil) - Date.now()) / 60000);
    return json({ error: `M-Pesa settings are locked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` }, 423);
  }
  return null;
}

async function recordFailedAttempt(db: D1Database, id: string) {
  const row = await db.prepare('SELECT count, lockedUntil FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;
  await db.prepare('INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, count, lockedUntil, Date.now())
    .run();
}

async function clearAttempts(db: D1Database, id: string) {
  await db.prepare('DELETE FROM loginAttempts WHERE id = ?').bind(id).run();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST' && request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!env.DB) return json({ error: 'Database is not configured.' }, 500);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;

  const body = request.method === 'POST' ? await request.json().catch(() => null) as any : null;
  const url = new URL(request.url);
  const businessId = String(body?.businessId || url.searchParams.get('businessId') || request.headers.get('X-Business-ID') || '').trim();
  const userId = String(body?.userId || auth.principal.userId || '').trim();
  const adminPassword = String(body?.adminPassword || '');
  const confirmationText = String(body?.confirmationText || '').trim().toUpperCase();

  if (!businessId) return json({ error: 'Business is required.' }, 400);
  if (!canAccessBusiness(auth.principal, businessId)) {
    return json({ error: 'Access denied.' }, 403);
  }
  if (!auth.service && auth.principal.role !== 'ADMIN' && auth.principal.role !== 'ROOT') {
    return json({ error: 'Only an administrator can open M-Pesa settings.' }, 403);
  }

  if (request.method === 'GET') {
    try {
      const status = await getMpesaPublicStatus(env.DB, businessId, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
      return json({ success: true, status });
    } catch {
      return json({ error: 'Could not load M-Pesa settings.' }, 500);
    }
  }

  if (!userId) return json({ error: 'Admin is required.' }, 400);
  if (!auth.service && auth.principal.role !== 'ROOT' && auth.principal.userId !== userId) {
    return json({ error: 'Please sign in as the administrator making this change.' }, 403);
  }

  await ensureAttemptTable(env.DB);
  const attemptId = `MPESA_SETTINGS:${businessId}:${userId}`;
  const locked = await rejectIfLocked(env.DB, attemptId);
  if (locked) return locked;

  const user = auth.service || auth.principal.role === 'ROOT'
    ? null
    : await env.DB.prepare('SELECT id, name, role, password FROM users WHERE id = ? AND businessId = ? LIMIT 1')
      .bind(userId, businessId)
      .first<any>();

  if (!auth.service && auth.principal.role !== 'ROOT' && (!user || user.role !== 'ADMIN')) {
    return json({ error: 'Only an administrator can change M-Pesa settings.' }, 403);
  }
  const passwordOk = auth.service || auth.principal.role === 'ROOT' ? true : await verifyPassword(adminPassword, String(user?.password || ''));
  const phraseOk = confirmationText === CONFIRM_PHRASE;
  if (!passwordOk || !phraseOk) {
    await recordFailedAttempt(env.DB, attemptId);
    return json({ error: `Security check failed. Enter the admin password and type ${CONFIRM_PHRASE}.` }, 401);
  }
  await clearAttempts(env.DB, attemptId);

  try {
    const status = await saveMpesaCredentials(
      env.DB,
      businessId,
      body?.credentials || {},
      env.MPESA_CREDENTIAL_ENCRYPTION_KEY,
    );
    return json({ success: true, status });
  } catch (err: any) {
    const safeMessage = String(err?.message || '').includes('safe storage key')
      ? err.message
      : err?.message || 'Could not save M-Pesa settings.';
    return json({ error: safeMessage }, 400);
  }
};
