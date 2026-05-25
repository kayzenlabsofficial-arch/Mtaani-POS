import { authorizeRequest, canAccessBusiness, verifyPassword } from '../authUtils';
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

async function ensureSettingsSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      storeName TEXT NOT NULL,
      location TEXT,
      tillNumber TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    'ALTER TABLE settings ADD COLUMN mpesaConsumerKey TEXT',
    'ALTER TABLE settings ADD COLUMN mpesaConsumerSecret TEXT',
    'ALTER TABLE settings ADD COLUMN mpesaPasskey TEXT',
    "ALTER TABLE settings ADD COLUMN mpesaEnv TEXT DEFAULT 'sandbox'",
    "ALTER TABLE settings ADD COLUMN mpesaType TEXT DEFAULT 'paybill'",
    'ALTER TABLE settings ADD COLUMN mpesaStoreNumber TEXT',
    'ALTER TABLE settings ADD COLUMN tillNumber TEXT',
    'ALTER TABLE settings ADD COLUMN businessId TEXT',
    'ALTER TABLE settings ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

function statusFromSettings(settings: any) {
  const savedSecrets = [settings?.mpesaConsumerKey, settings?.mpesaConsumerSecret, settings?.mpesaPasskey].filter(Boolean);
  return {
    mpesaConfigured: !!(settings?.mpesaConsumerKey && settings?.mpesaConsumerSecret && settings?.mpesaPasskey),
    mpesaConsumerKeySet: !!settings?.mpesaConsumerKey,
    mpesaConsumerSecretSet: !!settings?.mpesaConsumerSecret,
    mpesaPasskeySet: !!settings?.mpesaPasskey,
    mpesaEnv: settings?.mpesaEnv || 'sandbox',
    mpesaType: settings?.mpesaType || 'paybill',
    mpesaStoreNumberSet: !!settings?.mpesaStoreNumber,
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
  const userId = String(body?.userId || '').trim();
  const adminPassword = String(body?.adminPassword || '');
  const confirmationText = String(body?.confirmationText || '').trim().toUpperCase();

  if (!businessId || !userId) return json({ error: 'Business and admin are required.' }, 400);
  if (!canAccessBusiness(auth.principal, businessId)) {
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

  await ensureSettingsSchema(env.DB);
  const settingId = String(body?.settingsId || `core_${businessId}`).trim();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO settings (id, storeName, businessId, updated_at)
    VALUES (?, 'Smart Shop', ?, ?)
  `).bind(settingId, businessId, Date.now()).run();
  const settings = await env.DB.prepare('SELECT * FROM settings WHERE id = ? AND businessId = ? LIMIT 1')
    .bind(settingId, businessId)
    .first<any>();

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
      const savedValue = settings?.[field];
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
    updates.mpesaStoreNumber = String(credentials.storeNumber || '').trim() || settings?.mpesaStoreNumber || null;
  } else if (Object.prototype.hasOwnProperty.call(credentials, 'storeNumber')) {
    updates.mpesaStoreNumber = String(credentials.storeNumber || '').trim() || null;
  }

  const cols = Object.keys(updates);
  await env.DB.prepare(`UPDATE settings SET ${cols.map(col => `${col} = ?`).join(', ')} WHERE id = ? AND businessId = ?`)
    .bind(...cols.map(col => updates[col]), settingId, businessId)
    .run();

  const saved = await env.DB.prepare('SELECT * FROM settings WHERE id = ? AND businessId = ? LIMIT 1')
    .bind(settingId, businessId)
    .first<any>();

  return json({ success: true, status: statusFromSettings(saved) });
};
