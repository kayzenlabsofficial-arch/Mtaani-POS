import { refreshPesaPalMpesaPayment } from '../../pesapalUtils';

interface Env {
  DB: D1Database;
  MPESA_CALLBACK_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function readPayload(request: Request) {
  const url = new URL(request.url);
  let body: any = null;
  if (request.method !== 'GET') {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      body = await request.json().catch(() => null);
    } else {
      const form = await request.formData().catch(() => null);
      if (form) body = Object.fromEntries(form.entries());
    }
  }

  return {
    orderNotificationType: String(url.searchParams.get('OrderNotificationType') || body?.OrderNotificationType || 'IPNCHANGE'),
    orderTrackingId: String(url.searchParams.get('OrderTrackingId') || body?.OrderTrackingId || ''),
    orderMerchantReference: String(url.searchParams.get('OrderMerchantReference') || body?.OrderMerchantReference || ''),
  };
}

async function handle(request: Request, env: Env, params: Record<string, string | string[]>) {
  const expectedSecret = env.MPESA_CALLBACK_SECRET;
  const receivedSecret = Array.isArray(params.secret) ? params.secret[0] : params.secret;
  if (!env.DB || !expectedSecret) {
    return json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: '', orderMerchantReference: '', status: 500 }, 500);
  }
  if (!receivedSecret || !timingSafeEqual(String(receivedSecret), expectedSecret)) {
    return json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: '', orderMerchantReference: '', status: 401 }, 401);
  }

  const payload = await readPayload(request);
  if (payload.orderTrackingId) {
    const row = await env.DB.prepare('SELECT businessId FROM mpesaCallbacks WHERE checkoutRequestId = ? LIMIT 1')
      .bind(payload.orderTrackingId)
      .first<any>();
    if (row?.businessId) {
      await refreshPesaPalMpesaPayment(env.DB, row.businessId, payload.orderTrackingId, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    }
  }

  return json({
    orderNotificationType: payload.orderNotificationType || 'IPNCHANGE',
    orderTrackingId: payload.orderTrackingId,
    orderMerchantReference: payload.orderMerchantReference,
    status: 200,
  });
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    return await handle(request, env, params);
  } catch (err) {
    console.error('[M-Pesa PesaPal IPN]', err);
    return json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: '', orderMerchantReference: '', status: 500 }, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    return await handle(request, env, params);
  } catch (err) {
    console.error('[M-Pesa PesaPal IPN]', err);
    return json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: '', orderMerchantReference: '', status: 500 }, 500);
  }
};
