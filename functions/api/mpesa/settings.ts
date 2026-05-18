import { authorizeRequest, canAccessBranch, canAccessBusiness, verifyPassword } from '../authUtils';
import { encryptSecret, isEncryptedSecret } from './secureCredentials';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

const CONFIRM_PHRASE = 'UPDATE MPESA';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
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

function statusFromBranch(branch: any) {
  const savedSecrets = [branch?.mpesaConsumerKey, branch?.mpesaConsumerSecret, branch?.mpesaPasskey].filter(Boolean);
  return {
    mpesaConfigured: !!(branch?.mpesaConsumerKey && branch?.mpesaConsumerSecret && branch?.mpesaPasskey),
    mpesaConsumerKeySet: !!branch?.mpesaConsumerKey,
    mpesaConsumerSecretSet: !!branch?.mpesaConsumerSecret,
    mpesaPasskeySet: !!branch?.mpesaPasskey,
    mpesaEnv: branch?.mpesaEnv || 'sandbox',
    mpesaType: branch?.mpesaType || 'paybill',
    mpesaStoreNumberSet: !!branch?.mpesaStoreNumber,
    credentialsEncrypted: savedSecrets.length > 0 && savedSecrets.every(value => isEncryptedSecret(String(value))),
  };
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.DB) return json({ error: 'Database is not configured.' }, 500);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as any;
  const businessId = String(body?.businessId || request.headers.get('X-Business-ID') || '').trim();
  const branchId = String(body?.branchId || request.headers.get('X-Branch-ID') || '').trim();
  const userId = String(body?.userId || '').trim();
  const adminPassword = String(body?.adminPassword || '');
  const confirmationText = String(body?.confirmationText || '').trim().toUpperCase();

  if (!businessId || !branchId || !userId) return json({ error: 'Business, branch, and admin are required.' }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
    return json({ error: 'Access denied.' }, 403);
  }
  if (!auth.service && auth.principal.role !== 'ADMIN' && auth.principal.role !== 'ROOT') {
    return json({ error: 'Only an administrator can change M-Pesa settings.' }, 403);
  }
  if (!auth.service && auth.principal.role !== 'ROOT' && auth.principal.userId !== userId) {
    return json({ error: 'Please sign in as the administrator making this change.' }, 403);
  }

  await ensureAttemptTable(env.DB);
  const attemptId = `MPESA_SETTINGS:${businessId}:${userId}`;
  const locked = await rejectIfLocked(env.DB, attemptId);
  if (locked) return locked;

  const user = await env.DB.prepare('SELECT id, name, role, password FROM users WHERE id = ? AND businessId = ? LIMIT 1')
    .bind(userId, businessId)
    .first<any>();

  if (!user || user.role !== 'ADMIN') return json({ error: 'Only an administrator can change M-Pesa settings.' }, 403);
  const passwordOk = await verifyPassword(adminPassword, String(user.password || ''));
  const phraseOk = confirmationText === CONFIRM_PHRASE;
  if (!passwordOk || !phraseOk) {
    await recordFailedAttempt(env.DB, attemptId);
    return json({ error: `Security check failed. Enter the admin password and type ${CONFIRM_PHRASE}.` }, 401);
  }
  await clearAttempts(env.DB, attemptId);

  const branch = await env.DB.prepare('SELECT * FROM branches WHERE id = ? AND businessId = ? LIMIT 1')
    .bind(branchId, businessId)
    .first<any>();
  if (!branch) return json({ error: 'Branch not found.' }, 404);

  const credentials = body?.credentials || {};
  const secretUpdates: Record<string, string> = {};
  const consumerKey = String(credentials.consumerKey || '').trim();
  const consumerSecret = String(credentials.consumerSecret || '').trim();
  const passkey = String(credentials.passkey || '').trim();

  if (consumerKey || consumerSecret || passkey) {
    if (!env.MPESA_CREDENTIAL_ENCRYPTION_KEY) {
      return json({ error: 'M-Pesa safe storage key is missing. Add MPESA_CREDENTIAL_ENCRYPTION_KEY as a Pages secret before saving credentials.' }, 500);
    }
    if (consumerKey) secretUpdates.mpesaConsumerKey = await encryptSecret(consumerKey, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    if (consumerSecret) secretUpdates.mpesaConsumerSecret = await encryptSecret(consumerSecret, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    if (passkey) secretUpdates.mpesaPasskey = await encryptSecret(passkey, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
  }

  if (env.MPESA_CREDENTIAL_ENCRYPTION_KEY) {
    for (const field of ['mpesaConsumerKey', 'mpesaConsumerSecret', 'mpesaPasskey']) {
      const savedValue = branch[field];
      if (!secretUpdates[field] && savedValue && !isEncryptedSecret(String(savedValue))) {
        secretUpdates[field] = await encryptSecret(String(savedValue), env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
      }
    }
  }

  const updates: Record<string, any> = {
    mpesaEnv: credentials.env === 'production' ? 'production' : 'sandbox',
    mpesaType: credentials.type === 'buygoods' ? 'buygoods' : 'paybill',
    updated_at: Date.now(),
    ...secretUpdates,
  };

  if (credentials.type === 'buygoods') {
    updates.mpesaStoreNumber = String(credentials.storeNumber || '').trim() || branch.mpesaStoreNumber || null;
  } else if (Object.prototype.hasOwnProperty.call(credentials, 'storeNumber')) {
    updates.mpesaStoreNumber = String(credentials.storeNumber || '').trim() || null;
  }

  const cols = Object.keys(updates);
  await env.DB.prepare(`UPDATE branches SET ${cols.map(col => `${col} = ?`).join(', ')} WHERE id = ? AND businessId = ?`)
    .bind(...cols.map(col => updates[col]), branchId, businessId)
    .run();

  const saved = await env.DB.prepare('SELECT * FROM branches WHERE id = ? AND businessId = ? LIMIT 1')
    .bind(branchId, businessId)
    .first<any>();

  return json({ success: true, status: statusFromBranch(saved) });
};
