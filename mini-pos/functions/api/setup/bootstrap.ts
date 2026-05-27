import { createSession, ensureSchema, hashPassword, json, needsSetup, onOptions, readJson } from '../_utils';
import { text } from '../_domain';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  return json({ needsSetup: await needsSetup(env.DB) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    await ensureSchema(env.DB);
    if (!await needsSetup(env.DB)) return json({ error: 'Setup is already complete.' }, 409);
    const body = await readJson(request) as any;
    const now = Date.now();
    const id = `admin_${crypto.randomUUID()}`;
    const name = text(body.name || 'Administrator', 120) || 'Administrator';
    const username = text(body.username || 'admin', 80).toLowerCase() || 'admin';
    const passwordHash = await hashPassword(String(body.password || ''));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, name, username, passwordHash, role, isActive, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, 'ADMIN', 1, ?, ?)
      `).bind(id, name, username, passwordHash, now, now),
      env.DB.prepare(`
        INSERT OR REPLACE INTO storeProfile (id, storeName, logoDataUrl, updatedAt)
        VALUES ('core', ?, NULL, ?)
      `).bind(text(body.storeName || 'Smart POS Mini', 120) || 'Smart POS Mini', now),
    ]);
    const session = await createSession(env.DB, id);
    return json({ success: true, token: session.token, expiresAt: session.expiresAt, user: { id, name, username, role: 'ADMIN' } });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not complete setup.' }, 400);
  }
};
