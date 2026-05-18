import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const MANAGER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function trimText(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to manage categories.' }, 403);
    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim() || null;
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    const now = Date.now();
    if (action === 'DELETE') {
      const categoryId = trimText(body?.categoryId || body?.id, 160);
      if (!categoryId) return json({ error: 'Category is required.' }, 400);
      const category = await env.DB.prepare(`SELECT id, name FROM categories WHERE id = ? AND businessId = ? LIMIT 1`).bind(categoryId, businessId).first<any>();
      if (!category) throw new PolicyError('Category was not found.', 404);
      await env.DB.prepare(`DELETE FROM categories WHERE id = ? AND businessId = ?`).bind(categoryId, businessId).run();
      return json({ success: true, categoryId });
    }
    const category = body?.category || body || {};
    const name = trimText(category.name, 120);
    if (!name) return json({ error: 'Category name is required.' }, 400);
    const id = trimText(category.id || body?.categoryId, 160) || crypto.randomUUID();
    const saved = { id, name, iconName: trimText(category.iconName, 80) || 'Package', color: trimText(category.color, 40) || 'slate', businessId, branchId, updated_at: now };
    await env.DB.prepare(`INSERT OR REPLACE INTO categories (id, name, iconName, color, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(saved.id, saved.name, saved.iconName, saved.color, businessId, branchId, now)
      .run();
    return json({ success: true, category: saved });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update category.' }, status);
  }
};

