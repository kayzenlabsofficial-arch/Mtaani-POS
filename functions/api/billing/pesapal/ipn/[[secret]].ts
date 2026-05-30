import { billingCorsHeaders, refreshPesaPalBillingPayment, type BillingEnv } from '../../_utils';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...billingCorsHeaders },
  });
}

async function readIpnPayload(request: Request) {
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
    orderNotificationType: String(
      url.searchParams.get('OrderNotificationType')
        || body?.OrderNotificationType
        || body?.orderNotificationType
        || 'IPNCHANGE',
    ),
    orderTrackingId: String(
      url.searchParams.get('OrderTrackingId')
        || body?.OrderTrackingId
        || body?.orderTrackingId
        || '',
    ),
    orderMerchantReference: String(
      url.searchParams.get('OrderMerchantReference')
        || body?.OrderMerchantReference
        || body?.orderMerchantReference
        || '',
    ),
  };
}

async function handleIpn(request: Request, env: BillingEnv, params: Record<string, string | string[]>) {
  const receivedSecret = Array.isArray(params.secret) ? params.secret[0] : params.secret;
  const expectedSecret = env.BILLING_PESAPAL_IPN_SECRET || env.BILLING_MPESA_CALLBACK_SECRET;
  if (!env.DB || !expectedSecret) {
    return json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId: '',
      orderMerchantReference: '',
      status: 500,
    }, 500);
  }
  if (!receivedSecret || !timingSafeEqual(String(receivedSecret), expectedSecret)) {
    return json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId: '',
      orderMerchantReference: '',
      status: 401,
    }, 401);
  }

  const payload = await readIpnPayload(request);
  if (payload.orderTrackingId) {
    await refreshPesaPalBillingPayment(env.DB, env, payload.orderTrackingId);
  }

  return json({
    orderNotificationType: payload.orderNotificationType || 'IPNCHANGE',
    orderTrackingId: payload.orderTrackingId,
    orderMerchantReference: payload.orderMerchantReference,
    status: 200,
  });
}

export const onRequestOptions: PagesFunction<BillingEnv> = async () => new Response(null, { headers: billingCorsHeaders });

export const onRequestGet: PagesFunction<BillingEnv> = async ({ request, env, params }) => {
  try {
    return await handleIpn(request, env, params);
  } catch (err) {
    console.error('[Billing PesaPal IPN]', err);
    return json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: '', orderMerchantReference: '', status: 500 }, 500);
  }
};

export const onRequestPost: PagesFunction<BillingEnv> = async ({ request, env, params }) => {
  try {
    return await handleIpn(request, env, params);
  } catch (err) {
    console.error('[Billing PesaPal IPN]', err);
    return json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: '', orderMerchantReference: '', status: 500 }, 500);
  }
};
