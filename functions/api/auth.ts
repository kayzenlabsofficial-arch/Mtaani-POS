import { clearSessionCookie, createSessionCookie, createSessionToken, hashPassword, isPasswordHashCurrent, json, rejectUntrustedBrowserOrigin, verifyPassword } from './authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  ROOT_USERNAME?: string;
  ROOT_PASSWORD?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Smart-Desktop, X-Smart-Native',
};

async function ensureAttemptTable(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
}

async function ensureAuthSchema(db: D1Database) {
  await ensureAttemptTable(db);
  const userColumns = [
    'pin TEXT',
    'updated_at INTEGER',
    'mustChangePassword INTEGER DEFAULT 0',
    'isBootstrapAdmin INTEGER DEFAULT 0',
  ];
  for (const column of userColumns) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run(); } catch {}
  }
}

async function getLockout(db: D1Database, id: string) {
  await ensureAttemptTable(db);
  const row = await db.prepare('SELECT count, lockedUntil FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  if (row?.lockedUntil && Date.now() < Number(row.lockedUntil)) {
    const mins = Math.ceil((Number(row.lockedUntil) - Date.now()) / 60000);
    return { locked: true, message: `Account locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
  }
  return { locked: false };
}

async function recordFailure(db: D1Database, id: string) {
  await ensureAttemptTable(db);
  const row = await db.prepare('SELECT count FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= 5 ? Date.now() + 30 * 60 * 1000 : null;
  await db.prepare('INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, count, lockedUntil, Date.now())
    .run();
}

async function clearFailure(db: D1Database, id: string) {
  await db.prepare('DELETE FROM loginAttempts WHERE id = ?').bind(id).run();
}

function safeUser(user: any) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    businessId: user.businessId,
    mustChangePassword: Number(user.mustChangePassword || 0),
    isBootstrapAdmin: Number(user.isBootstrapAdmin || 0),
  };
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) => {
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  return new Response(null, { headers: corsHeaders });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request }) => {
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  return json({ success: true }, 200, {
    ...corsHeaders,
    'Set-Cookie': clearSessionCookie(request),
  });
};

async function handleAuthPost(request: Request, env: Env) {
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  if (!env.API_SECRET) return json({ error: 'Server is not configured.' }, 500, corsHeaders);
  if (!env.DB) return json({ error: 'Database is not configured.' }, 500, corsHeaders);
  await ensureAuthSchema(env.DB);

  const body = await request.json().catch(() => null) as any;
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  const businessCode = String(body?.businessCode || '').trim().toUpperCase();
  const includeTokenInBody = request.headers.get('X-Smart-Desktop') === '1'
    || request.headers.get('X-Smart-Native') === '1';

  if (!username || !password) return json({ error: 'Enter username and password.' }, 400, corsHeaders);

  if (env.ROOT_USERNAME && username === env.ROOT_USERNAME) {
    const rootLockoutId = `ROOT_LOGIN:${username.toLowerCase()}`;
    const rootLockout = await getLockout(env.DB, rootLockoutId);
    if (rootLockout.locked) return json({ error: rootLockout.message }, 423, corsHeaders);

    if (env.ROOT_PASSWORD && password === env.ROOT_PASSWORD) {
      await clearFailure(env.DB, rootLockoutId);
      const token = await createSessionToken(env.API_SECRET, {
        userId: 'root',
        userName: 'System Root',
        role: 'ROOT',
      });
      return json({ user: { id: 'root', name: 'System Root', role: 'ROOT' }, businessId: null, ...(includeTokenInBody ? { token } : {}) }, 200, {
        ...corsHeaders,
        'Set-Cookie': createSessionCookie(request, token),
      });
    }

    await recordFailure(env.DB, rootLockoutId);
    return json({ error: 'Invalid username or password.' }, 401, corsHeaders);
  }

  if (!businessCode) return json({ error: 'Enter the business code.' }, 400, corsHeaders);

  const lockoutId = `LOGIN:${businessCode}:${username.toLowerCase()}`;
  const lockout = await getLockout(env.DB, lockoutId);
  if (lockout.locked) return json({ error: lockout.message }, 423, corsHeaders);

  const business = await env.DB.prepare('SELECT id, name, code, isActive FROM businesses WHERE code = ? LIMIT 1')
    .bind(businessCode)
    .first<any>();
  if (!business || Number(business.isActive ?? 1) === 0) {
    await recordFailure(env.DB, lockoutId);
    return json({ error: 'Business not found or inactive.' }, 401, corsHeaders);
  }

  const user = await env.DB.prepare(`
    SELECT id, name, role, password, businessId, mustChangePassword, isBootstrapAdmin
    FROM users
    WHERE businessId = ? AND lower(trim(name)) = ?
    LIMIT 1
  `).bind(business.id, username.toLowerCase()).first<any>();

  if (!user || !(await verifyPassword(password, String(user.password || '')))) {
    await recordFailure(env.DB, lockoutId);
    return json({ error: 'Invalid username or password.' }, 401, corsHeaders);
  }

  await clearFailure(env.DB, lockoutId);

  if (!isPasswordHashCurrent(String(user.password || ''))) {
    await env.DB.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ? AND businessId = ?')
      .bind(await hashPassword(password), Date.now(), user.id, business.id)
      .run();
  }

  const cleanUser = safeUser(user);
  const token = await createSessionToken(env.API_SECRET, {
    userId: cleanUser.id,
    userName: cleanUser.name,
    role: cleanUser.role,
    businessId: business.id,
  });

  return json({ user: cleanUser, businessId: business.id, ...(includeTokenInBody ? { token } : {}) }, 200, {
    ...corsHeaders,
    'Set-Cookie': createSessionCookie(request, token),
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    return await handleAuthPost(request, env);
  } catch (err: any) {
    console.error('Auth request failed:', err?.message || err);
    return json({ error: 'Could not sign in.' }, 500, corsHeaders);
  }
};
