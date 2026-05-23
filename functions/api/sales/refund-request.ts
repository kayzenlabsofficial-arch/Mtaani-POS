import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';
import { ensureRefundSchema, prepareRefundRequest } from './refundOps';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const transactionId = String(body?.transactionId || body?.id || '').trim();
    if (!businessId || !transactionId) return json({ error: 'Business and receipt are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureRefundSchema(env.DB);
    const prepared = await prepareRefundRequest(env.DB, {
      businessId, principal: auth.principal,
      transactionId,
      itemsToReturn: body?.itemsToReturn,
    });
    if (prepared.statements.length) await env.DB.batch(prepared.statements);
    return json({ success: true, transaction: prepared.transaction, idempotent: prepared.idempotent });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not request refund.' }, status);
  }
};
