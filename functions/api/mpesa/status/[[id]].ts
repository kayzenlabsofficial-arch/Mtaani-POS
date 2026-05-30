import { authorizeRequest, canAccessBusiness } from '../../authUtils';
import { refreshPesaPalMpesaPayment } from '../pesapalUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID'
};

function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    ...corsHeaders,
  };
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
        let result = await env.DB.prepare(`SELECT * FROM mpesaCallbacks WHERE checkoutRequestId = ?`).bind(checkoutRequestId).first() as any;
        
        if (result) {
            if (!canAccessBusiness(auth.principal, result.businessId)) {
                return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403, headers: jsonHeaders() });
            }
            if (String(result.provider || '').toUpperCase() === 'PESAPAL' && Number(result.resultCode) === 999) {
                try {
                    result = await refreshPesaPalMpesaPayment(env.DB, result.businessId, checkoutRequestId, env.MPESA_CREDENTIAL_ENCRYPTION_KEY) || result;
                } catch (err) {
                    console.error('[PesaPal Status Refresh Error]', err);
                }
            }
            return new Response(JSON.stringify({
                found: true,
                resultCode: result.resultCode,
                resultDesc: result.resultDesc,
                amount: result.amount,
                receiptNumber: result.receiptNumber,
                phoneNumber: result.phoneNumber,
                provider: result.provider || 'MPESA',
                redirectUrl: result.redirectUrl || undefined,
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
