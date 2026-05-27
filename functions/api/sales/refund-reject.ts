import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';
import { deserializeRow, ensureRefundSchema } from './refundOps';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Shop-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to reject refunds.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const shopId = String(request.headers.get('X-Shop-ID') || body?.shopId || '').trim() || 'single-shop';
    const transactionId = String(body?.transactionId || body?.id || '').trim();
    if (!businessId || !transactionId) return json({ error: 'Business and sale are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureRefundSchema(env.DB);
    const tx = await env.DB.prepare(`
      SELECT id, status, total, items, pendingRefundItems, shopId
      FROM transactions
      WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), 'single-shop') = ?
      LIMIT 1
    `).bind(transactionId, businessId, shopId).first<any>();
    if (!tx) throw new PolicyError('Sale was not found.', 404);
    if (tx.status !== 'PENDING_REFUND') throw new PolicyError('This receipt is not waiting for refund approval.', 409);
    const clean = deserializeRow(tx);
    const restoredStatus = asArray(clean.items).some(item => Number(item?.returnedQuantity || 0) > 0)
      ? 'PARTIAL_REFUND'
      : 'PAID';

    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`UPDATE transactions SET status = ?, pendingRefundItems = NULL, updated_at = ? WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), 'single-shop') = ?`)
        .bind(restoredStatus, now, transactionId, businessId, shopId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'sale.refund.reject',
        'transaction',
        transactionId,
        'WARN',
        `Rejected refund request for sale of Ksh ${Number(tx.total || 0).toLocaleString()}.`,
        businessId, now,
      ),
    ]);

    return json({ success: true, transactionId });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not reject refund.' }, status);
  }
};
