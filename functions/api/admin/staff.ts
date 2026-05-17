import { authorizeRequest, canAccessBusiness, hashPassword } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ADMIN_ROLES = new Set(['ROOT', 'ADMIN']);
const STAFF_ROLES = new Set(['ADMIN', 'MANAGER', 'CASHIER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function temporaryPassword() {
  return `MT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function ensureSchema(db: D1Database) {
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
}

async function adminCount(db: D1Database, businessId: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM users WHERE businessId = ? AND role = 'ADMIN'`)
    .bind(businessId)
    .first<any>();
  return Number(row?.count || 0);
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ADMIN_ROLES.has(auth.principal.role)) {
      return json({ error: 'Admin access required.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'SAVE') {
      const staff = body?.user || body?.staff || body || {};
      const name = trimText(staff.name, 120);
      const role = String(staff.role || 'CASHIER').toUpperCase();
      if (!name) return json({ error: 'Staff name is required.' }, 400);
      if (!STAFF_ROLES.has(role)) return json({ error: 'Staff role is not allowed.' }, 400);
      const id = trimText(staff.id || body?.userId, 160) || crypto.randomUUID();
      const existing = await env.DB.prepare(`SELECT * FROM users WHERE id = ? AND businessId = ? LIMIT 1`)
        .bind(id, businessId)
        .first<any>();
      if (existing?.role === 'ADMIN' && role !== 'ADMIN' && await adminCount(env.DB, businessId) <= 1) {
        throw new PolicyError('The last administrator cannot be changed.', 403);
      }
      const password = String(staff.password || '');
      const passwordHash = password
        ? await hashPassword(password)
        : existing?.password;
      if (!passwordHash) throw new PolicyError('Password is required for new staff accounts.', 400);

      const savedUser = {
        id,
        name,
        password: passwordHash,
        role,
        businessId,
        branchId: role === 'ADMIN' ? (trimText(staff.branchId, 160) || null) : (trimText(staff.branchId, 160) || existing?.branchId || null),
        updated_at: now,
      };
      await env.DB.batch([
        env.DB.prepare(`INSERT OR REPLACE INTO users (id, name, password, role, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .bind(savedUser.id, savedUser.name, savedUser.password, savedUser.role, businessId, savedUser.branchId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'admin.user.update' : 'admin.user.create', 'user', id, 'INFO', `${existing ? 'Updated' : 'Created'} ${role} account for ${name}.`, businessId, savedUser.branchId, now),
      ]);
      const { password: _password, ...safeUser } = savedUser;
      return json({ success: true, user: safeUser });
    }

    const userId = trimText(body?.userId || body?.id, 160);
    if (!userId) return json({ error: 'Staff user is required.' }, 400);
    const user = await env.DB.prepare(`SELECT id, name, role, businessId, branchId FROM users WHERE id = ? AND businessId = ? LIMIT 1`)
      .bind(userId, businessId)
      .first<any>();
    if (!user) throw new PolicyError('Staff user was not found.', 404);

    if (action === 'DELETE') {
      if (user.id === auth.principal.userId) throw new PolicyError('You cannot delete your own signed-in account.', 403);
      if (user.role === 'ADMIN' && await adminCount(env.DB, businessId) <= 1) {
        throw new PolicyError('The last administrator cannot be deleted.', 403);
      }
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM users WHERE id = ? AND businessId = ?`).bind(userId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'admin.user.delete', 'user', userId, 'WARN', `Deleted user ${user.name} (${user.role}).`, businessId, user.branchId || null, now),
      ]);
      return json({ success: true, userId });
    }

    if (action === 'RESET_PASSWORD') {
      const requested = String(body?.newPassword || '');
      const newPassword = requested.length >= 4 ? requested : temporaryPassword();
      await env.DB.batch([
        env.DB.prepare(`UPDATE users SET password = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(await hashPassword(newPassword), now, userId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'admin.user_password_reset', 'user', userId, 'WARN', `Reset password for ${user.name}.`, businessId, user.branchId || null, now),
      ]);
      return json({ success: true, userId, temporaryPassword: requested ? undefined : newPassword });
    }

    return json({ error: 'Unsupported staff action.' }, 400);
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update staff.' }, status);
  }
};

