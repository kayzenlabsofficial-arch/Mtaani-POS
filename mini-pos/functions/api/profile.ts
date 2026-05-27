import { cleanLogoDataUrl, ensureSchema, json, onOptions, readJson, requireRole } from './_utils';
import { text } from './_domain';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  await ensureSchema(env.DB);
  const profile = await env.DB.prepare(`SELECT id, storeName, logoDataUrl, updatedAt FROM storeProfile WHERE id = 'core'`).first<any>();
  return json({ profile });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    const principal = await requireRole(request, env.DB, ['ADMIN']);
    if (principal instanceof Response) return principal;
    const body = await readJson(request) as any;
    const storeName = text(body.storeName, 120) || 'Smart POS Mini';
    const logoDataUrl = cleanLogoDataUrl(body.logoDataUrl);
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO storeProfile (id, storeName, logoDataUrl, updatedAt)
      VALUES ('core', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET storeName = excluded.storeName, logoDataUrl = excluded.logoDataUrl, updatedAt = excluded.updatedAt
    `).bind(storeName, logoDataUrl, now).run();
    return json({ success: true, profile: { id: 'core', storeName, logoDataUrl, updatedAt: now } });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not save profile.' }, 400);
  }
};
