import { authorizeRequest, hashPassword } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

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

function temporaryPassword() {
  return `MT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && auth.principal.role !== 'ROOT') return json({ error: 'Root access required.' }, 403);

    const body = await request.json().catch(() => null) as any;
    const name = String(body?.name || '').trim();
    const code = String(body?.code || '').trim().toUpperCase();
    if (!name || !/^[A-Z0-9]{3,20}$/.test(code)) return json({ error: 'Valid business name and code are required.' }, 400);

    const exists = await env.DB.prepare(`SELECT id FROM businesses WHERE code = ? LIMIT 1`).bind(code).first<any>();
    if (exists) return json({ error: 'Business code is already in use.' }, 409);

    const now = Date.now();
    const businessId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const adminPassword = temporaryPassword();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO businesses (id, name, code, isActive, updated_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(businessId, name, code, 1, now),
      env.DB.prepare(`INSERT INTO users (id, name, password, role, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(userId, 'admin', await hashPassword(adminPassword), 'ADMIN', businessId, null, now),
      env.DB.prepare(`INSERT INTO branches (id, name, location, phone, tillNumber, kraPin, isActive, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(branchId, 'Main Branch', 'Default', null, null, null, 1, businessId, now),
    ]);

    return json({ success: true, businessId, branchId, adminPassword });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not create business.' }, 500);
  }
};

