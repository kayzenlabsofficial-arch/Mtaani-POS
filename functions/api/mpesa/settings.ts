import { authorizeRequest, canAccessBusiness, verifyPassword } from '../authUtils';
import { getMpesaPublicStatus, saveMpesaCredentials } from './credentialStore';
import {
  clearMpesaSettingsAttempts,
  ensureMpesaSettingsAttemptTable,
  getMpesaSettingsLockMinutes,
  mpesaSettingsAttemptId,
  recordFailedMpesaSettingsAttempt,
} from './settingsLockout';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

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

async function auditMpesaSettingsSave(db: D1Database, principal: any, businessId: string) {
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
      updated_at INTEGER
    )
  `).run();
  const now = Date.now();
  await db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    principal.userId || null,
    principal.userName || null,
    'settings.mpesa.save',
    'mpesaCredentials',
    businessId,
    'WARN',
    'Updated encrypted M-Pesa settings.',
    businessId,
    now,
  ).run();
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

  const needsPasswordCheck = !auth.service && auth.principal.role !== 'ROOT';
  const attemptId = mpesaSettingsAttemptId(businessId, userId);
  if (needsPasswordCheck) {
    await ensureMpesaSettingsAttemptTable(env.DB);
    const lockedMinutes = await getMpesaSettingsLockMinutes(env.DB, attemptId);
    if (lockedMinutes > 0) {
      return json({ error: `M-Pesa settings are locked. Try again in ${lockedMinutes} minute${lockedMinutes === 1 ? '' : 's'}.` }, 423);
    }
  }

  const user = !needsPasswordCheck
    ? null
    : await env.DB.prepare('SELECT id, name, role, password FROM users WHERE id = ? AND businessId = ? LIMIT 1')
      .bind(userId, businessId)
      .first<any>();

  if (needsPasswordCheck && (!user || user.role !== 'ADMIN')) {
    return json({ error: 'Only an administrator can change M-Pesa settings.' }, 403);
  }
  const passwordOk = !needsPasswordCheck ? true : await verifyPassword(adminPassword, String(user?.password || ''));
  if (!passwordOk) {
    await recordFailedMpesaSettingsAttempt(env.DB, attemptId);
    return json({ error: 'Security check failed. Enter the admin password.' }, 401);
  }
  if (needsPasswordCheck) await clearMpesaSettingsAttempts(env.DB, attemptId);

  try {
    const status = await saveMpesaCredentials(
      env.DB,
      businessId,
      body?.credentials || {},
      env.MPESA_CREDENTIAL_ENCRYPTION_KEY,
    );
    await auditMpesaSettingsSave(env.DB, auth.principal, businessId);
    return json({ success: true, status });
  } catch (err: any) {
    const safeMessage = String(err?.message || '').includes('safe storage key')
      ? err.message
      : err?.message || 'Could not save M-Pesa settings.';
    return json({ error: safeMessage }, 400);
  }
};
