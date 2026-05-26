import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';
import { ensureExpenseActionSchema, prepareExpenseApproval } from './expenseOps';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

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

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const expenseId = String(body?.expenseId || body?.id || '').trim();
    if (!businessId || !expenseId) return json({ error: 'Business and expense are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureExpenseActionSchema(env.DB);
    const prepared = await prepareExpenseApproval(env.DB, {
      businessId, principal: auth.principal,
      service: auth.service,
      expenseId,
      approvedBy: body?.approvedBy,
    });
    if (prepared.statements.length) await env.DB.batch(prepared.statements);
    return json({ success: true, expense: prepared.expense, idempotent: prepared.idempotent });
  } catch (err: any) {
    const message = String(err?.message || '');
    const insufficientStock = message.includes('Insufficient stock');
    const insufficientAccount = message.includes('Insufficient account balance');
    const status = err instanceof PolicyError ? err.status : insufficientStock || insufficientAccount ? 409 : 500;
    const errorMessage = insufficientStock
      ? 'Insufficient stock for the selected shop item.'
      : insufficientAccount
        ? 'Insufficient funds in the Main account.'
        : err?.message || 'Could not approve expense.';
    return json({ error: errorMessage }, status);
  }
};
