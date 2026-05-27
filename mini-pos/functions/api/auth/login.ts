import { createSession, ensureSchema, json, onOptions, readJson, verifyPassword } from '../_utils';
import { text } from '../_domain';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    await ensureSchema(env.DB);
    const body = await readJson(request) as any;
    const username = text(body.username, 80).toLowerCase();
    const password = String(body.password || '');
    const user = await env.DB.prepare(`
      SELECT id, name, username, passwordHash, role, isActive
      FROM users
      WHERE username = ?
      LIMIT 1
    `).bind(username).first<any>();
    if (!user || Number(user.isActive || 0) !== 1 || !await verifyPassword(password, user.passwordHash)) {
      return json({ error: 'Invalid username or password.' }, 401);
    }
    const session = await createSession(env.DB, user.id);
    return json({
      success: true,
      token: session.token,
      expiresAt: session.expiresAt,
      user: { id: user.id, name: user.name, username: user.username, role: user.role },
    });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not sign in.' }, 500);
  }
};
