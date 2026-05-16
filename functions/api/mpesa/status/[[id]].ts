import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID'
};

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders };
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders() });
  }

  try {
    // ── Auth: require API key ────────────────────────────────────────────────
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const checkoutRequestId = Array.isArray(params.id) ? params.id[0] : params.id;

    if (!checkoutRequestId) {
        return new Response(JSON.stringify({ error: 'CheckoutRequestID required' }), { status: 400, headers: jsonHeaders() });
    }

    // Attempt to query the mpesaCallbacks table
    try {
        const result = await env.DB.prepare(`SELECT * FROM mpesaCallbacks WHERE checkoutRequestId = ?`).bind(checkoutRequestId).first() as any;
        
        if (result) {
            if (!canAccessBusiness(auth.principal, result.businessId) || !canAccessBranch(auth.principal, result.branchId)) {
                return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403, headers: jsonHeaders() });
            }
            return new Response(JSON.stringify({
                found: true,
                resultCode: result.resultCode,
                resultDesc: result.resultDesc,
                amount: result.amount,
                receiptNumber: result.receiptNumber,
                phoneNumber: result.phoneNumber
            }), { headers: jsonHeaders() });
        } else {
            return new Response(JSON.stringify({ found: false, status: 'PENDING' }), { headers: jsonHeaders() });
        }
    } catch (dbErr: any) {
        // Table might not exist yet if no callback has ever fired
        if (dbErr.message.includes('no such table')) {
            return new Response(JSON.stringify({ found: false, status: 'PENDING' }), { headers: jsonHeaders() });
        }
        throw dbErr;
    }

  } catch (err: any) {
    console.error("[M-Pesa Status Error]:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders() });
  }
};
