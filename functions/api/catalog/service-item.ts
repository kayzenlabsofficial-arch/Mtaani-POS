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
function isActiveValue(value: unknown) { return value === false || value === 0 || value === '0' ? 0 : 1; }

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !MANAGER_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to manage services.' }, 403);
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    const service = body?.service || body || {};
    const name = trimText(service.name, 120);
    if (!name) return json({ error: 'Service name is required.' }, 400);
    const now = Date.now();
    const id = trimText(service.id || body?.serviceId, 160) || `service_${businessId}_${crypto.randomUUID()}`;
    const saved = {
      id,
      name,
      category: trimText(service.category, 120) || 'General',
      description: trimText(service.description, 500) || null,
      price: Number(service.price || 0),
      taxCategory: service.taxCategory === 'A' ? 'A' : 'E',
      isActive: isActiveValue(service.isActive),
      businessId,
      updated_at: now,
    };
    await env.DB.prepare(`INSERT OR REPLACE INTO serviceItems (id, name, category, description, price, taxCategory, isActive, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(saved.id, saved.name, saved.category, saved.description, saved.price, saved.taxCategory, saved.isActive, businessId, now)
      .run();
    return json({ success: true, service: saved });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update service.' }, status);
  }
};

