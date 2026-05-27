import { makeId, text } from './_domain';
import { ensureSchema, hashPassword, json, onOptions, readJson, requireRole } from './_utils';

type MiniRole = 'ADMIN' | 'CASHIER';

const normalizeRole = (value: unknown): MiniRole => text(value, 20).toUpperCase() === 'CASHIER' ? 'CASHIER' : 'ADMIN';

async function activeAdminCount(db: D1Database) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND isActive = 1`).first<any>();
  return Number(row?.count || 0);
}

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  const principal = await requireRole(request, env.DB, ['ADMIN']);
  if (principal instanceof Response) return principal;
  const { results } = await env.DB.prepare(`
    SELECT id, name, username, role, isActive, createdAt, updatedAt
    FROM users
    ORDER BY isActive DESC, role ASC, name ASC
  `).all();
  return json({ users: results || [] });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    const principal = await requireRole(request, env.DB, ['ADMIN']);
    if (principal instanceof Response) return principal;
    await ensureSchema(env.DB);
    const body = await readJson(request) as any;
    const action = text(body.action || 'SAVE', 20).toUpperCase();
    const now = Date.now();

    if (action === 'DEACTIVATE') {
      const id = text(body.id, 160);
      if (!id) return json({ error: 'User is required.' }, 400);
      if (id === principal.id) return json({ error: 'You cannot deactivate your own user.' }, 400);
      const existing = await env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(id).first<any>();
      if (!existing) return json({ error: 'User was not found.' }, 404);
      if (existing.role === 'ADMIN' && await activeAdminCount(env.DB) <= 1) {
        return json({ error: 'At least one active admin is required.' }, 409);
      }
      await env.DB.prepare(`UPDATE users SET isActive = 0, updatedAt = ? WHERE id = ?`).bind(now, id).run();
      return json({ success: true, id });
    }

    const id = text(body.id, 160) || makeId('user');
    const name = text(body.name, 120);
    const username = text(body.username, 80).toLowerCase();
    const role = normalizeRole(body.role);
    const password = String(body.password || '');
    if (!name || !username) return json({ error: 'Name and username are required.' }, 400);
    const existing = await env.DB.prepare(`SELECT id, role, createdAt FROM users WHERE id = ?`).bind(id).first<any>();
    if (existing?.role === 'ADMIN' && role !== 'ADMIN' && await activeAdminCount(env.DB) <= 1) {
      return json({ error: 'At least one active admin is required.' }, 409);
    }
    if (!existing && password.length < 4) return json({ error: 'Password must be at least 4 characters.' }, 400);

    const passwordHash = password
      ? await hashPassword(password)
      : (await env.DB.prepare(`SELECT passwordHash FROM users WHERE id = ?`).bind(id).first<any>())?.passwordHash;
    if (!passwordHash) return json({ error: 'Password is required for new users.' }, 400);

    await env.DB.prepare(`
      INSERT INTO users (id, name, username, passwordHash, role, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        username = excluded.username,
        passwordHash = excluded.passwordHash,
        role = excluded.role,
        isActive = 1,
        updatedAt = excluded.updatedAt
    `).bind(id, name, username, passwordHash, role, Number(existing?.createdAt || now), now).run();

    const user = await env.DB.prepare(`
      SELECT id, name, username, role, isActive, createdAt, updatedAt
      FROM users
      WHERE id = ?
    `).bind(id).first<any>();
    return json({ success: true, user });
  } catch (err: any) {
    const message = String(err?.message || '');
    if (message.toLowerCase().includes('unique')) return json({ error: 'Username is already in use.' }, 409);
    return json({ error: message || 'Could not save user.' }, 400);
  }
};
