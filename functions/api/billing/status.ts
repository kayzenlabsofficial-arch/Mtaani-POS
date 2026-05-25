import { authorizeRequest, canAccessBusiness } from '../authUtils';
import {
  billingCorsHeaders,
  getBillingBusiness,
  getBillingPaymentByCheckout,
  getRecentBillingPayments,
  json,
  publicBillingStatus,
  type BillingEnv,
} from './_utils';

export const onRequestOptions: PagesFunction<BillingEnv> = async () => new Response(null, { headers: billingCorsHeaders });

export const onRequestGet: PagesFunction<BillingEnv> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'Database is not configured.' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const businessId = String(url.searchParams.get('businessId') || request.headers.get('X-Business-ID') || auth.principal.businessId || '').trim();
    const checkoutRequestId = String(url.searchParams.get('checkoutRequestId') || '').trim();
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    const business = await getBillingBusiness(env.DB, businessId);
    if (!business) return json({ error: 'Business was not found.' }, 404);

    const payment = checkoutRequestId
      ? await getBillingPaymentByCheckout(env.DB, businessId, checkoutRequestId)
      : null;
    const recentPayments = auth.principal.role === 'ADMIN' || auth.principal.role === 'ROOT'
      ? await getRecentBillingPayments(env.DB, businessId, 6)
      : [];

    return json({
      success: true,
      billing: publicBillingStatus(business),
      payment,
      recentPayments,
    });
  } catch (err: any) {
    console.error('[Billing Status]', err?.message || err);
    return json({ error: err?.message || 'Could not load billing status.' }, 500);
  }
};
