import { billingCorsHeaders, type BillingEnv } from '../_utils';

export const onRequestOptions: PagesFunction<BillingEnv> = async () => new Response(null, { headers: billingCorsHeaders });

export const onRequestGet: PagesFunction<BillingEnv> = async ({ request }) => {
  const url = new URL(request.url);
  const target = new URL('/', url.origin);
  const trackingId = url.searchParams.get('OrderTrackingId') || '';
  const reference = url.searchParams.get('OrderMerchantReference') || '';
  const notificationType = url.searchParams.get('OrderNotificationType') || 'CALLBACKURL';

  target.searchParams.set('billingProvider', 'PESAPAL');
  if (trackingId) target.searchParams.set('billingTrackingId', trackingId);
  if (reference) target.searchParams.set('billingReference', reference);
  target.searchParams.set('billingNotification', notificationType);

  return Response.redirect(target.toString(), 302);
};
