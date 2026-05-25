import { authorizeRequest, createSessionCookie, createSessionToken, hashPassword } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders,
      ...extraHeaders,
    },
  });
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
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

async function ensureSchema(db: D1Database) {
  const userColumns = [
    'pin TEXT',
    'updated_at INTEGER',
    'mustChangePassword INTEGER DEFAULT 0',
    'isBootstrapAdmin INTEGER DEFAULT 0',
  ];
  for (const column of userColumns) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run(); } catch {}
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)`).run();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'Database is not configured.' }, 500);
    if (!env.API_SECRET) return json({ error: 'Server is not configured.' }, 500);

    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (auth.service || auth.principal.role === 'ROOT' || !auth.principal.businessId) {
      return json({ error: 'Business user setup is required.' }, 403);
    }

    await ensureSchema(env.DB);

    const body = await request.json().catch(() => null) as any;
    const name = trimText(body?.name, 120);
    const password = String(body?.password || '');
    if (!name) return json({ error: 'Enter the new account name.' }, 400);
    if (password.length < 4) return json({ error: 'Password must be at least 4 characters.' }, 400);

    const user = await env.DB.prepare(`
      SELECT id, name, role, businessId, mustChangePassword, isBootstrapAdmin
      FROM users
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(auth.principal.userId, auth.principal.businessId).first<any>();

    if (!user) return json({ error: 'User not found. Please sign in again.' }, 404);
    if (Number(user.mustChangePassword || 0) !== 1) {
      return json({ error: 'This account is already set up.' }, 409);
    }
    if (Number(user.isBootstrapAdmin || 0) === 1 && name.toLowerCase() === 'admin') {
      return json({ error: 'Choose your own admin username instead of admin.' }, 400);
    }

    const duplicate = await env.DB.prepare(`
      SELECT id
      FROM users
      WHERE businessId = ? AND lower(trim(name)) = lower(trim(?)) AND id != ?
      LIMIT 1
    `).bind(user.businessId, name, user.id).first<any>();
    if (duplicate) return json({ error: 'Another account already uses that username.' }, 409);

    const business = await env.DB.prepare(`SELECT code FROM businesses WHERE id = ? LIMIT 1`)
      .bind(user.businessId)
      .first<any>();
    const businessCode = String(business?.code || '').trim().toUpperCase();
    const oldLockoutId = businessCode ? `LOGIN:${businessCode}:${String(user.name || '').trim().toLowerCase()}` : null;
    const newLockoutId = businessCode ? `LOGIN:${businessCode}:${name.toLowerCase()}` : null;
    const now = Date.now();

    await env.DB.batch([
      env.DB.prepare(`
        UPDATE users
        SET name = ?, password = ?, mustChangePassword = 0, isBootstrapAdmin = 0, updated_at = ?
        WHERE id = ? AND businessId = ? AND mustChangePassword = 1
      `).bind(name, await hashPassword(password), now, user.id, user.businessId),
      ...(oldLockoutId ? [env.DB.prepare(`DELETE FROM loginAttempts WHERE id = ?`).bind(oldLockoutId)] : []),
      ...(newLockoutId && newLockoutId !== oldLockoutId ? [env.DB.prepare(`DELETE FROM loginAttempts WHERE id = ?`).bind(newLockoutId)] : []),
    ]);

    const updatedUser = {
      id: user.id,
      name,
      role: user.role,
      businessId: user.businessId,
      mustChangePassword: 0,
      isBootstrapAdmin: 0,
    };
    const token = await createSessionToken(env.API_SECRET, {
      userId: updatedUser.id,
      userName: updatedUser.name,
      role: updatedUser.role,
      businessId: updatedUser.businessId,
    });

    return json({ success: true, user: safeUser(updatedUser) }, 200, {
      'Set-Cookie': createSessionCookie(request, token),
    });
  } catch (err: any) {
    console.error('[Account setup API]', err);
    return json({ error: err?.message || 'Could not complete account setup.' }, 500);
  }
};
