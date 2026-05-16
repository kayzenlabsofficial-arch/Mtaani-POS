import { authorizeRequest, hashPassword, verifyPassword } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ...corsHeaders,
    },
  });
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'Database is not configured.' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (auth.service || auth.principal.role === 'ROOT') {
      return json({ error: 'Use the staff screen to reset business user passwords.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const currentPassword = String(body?.currentPassword || '');
    const newPassword = String(body?.newPassword || '');
    if (!currentPassword || !newPassword) return json({ error: 'Current and new password are required.' }, 400);
    if (newPassword.length < 4) return json({ error: 'New password must be at least 4 characters.' }, 400);

    const user = await env.DB.prepare('SELECT id, businessId, password FROM users WHERE id = ? AND businessId = ? LIMIT 1')
      .bind(auth.principal.userId, auth.principal.businessId)
      .first<any>();
    if (!user) return json({ error: 'User not found. Please sign in again.' }, 404);
    if (!(await verifyPassword(currentPassword, String(user.password || '')))) {
      return json({ error: 'Incorrect current password.' }, 401);
    }

    await env.DB.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ? AND businessId = ?')
      .bind(await hashPassword(newPassword), Date.now(), auth.principal.userId, auth.principal.businessId)
      .run();

    return json({ success: true });
  } catch (err: any) {
    console.error('[Password API]', err);
    return json({ error: err?.message || 'Could not update password.' }, 500);
  }
};
