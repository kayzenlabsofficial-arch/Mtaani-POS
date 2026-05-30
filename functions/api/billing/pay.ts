import { authorizeRequest, canAccessBusiness } from '../authUtils';
import {
  billingCorsHeaders,
  canManageBilling,
  getBillingBusiness,
  json,
  publicBillingStatus,
  recordPendingBillingPayment,
  sendBillingPesaPalOrder,
  sendBillingStkPush,
  type BillingEnv,
} from './_utils';

export const onRequestOptions: PagesFunction<BillingEnv> = async () => new Response(null, { headers: billingCorsHeaders });

export const onRequestPost: PagesFunction<BillingEnv> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'Database is not configured.' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const businessId = String(body?.businessId || request.headers.get('X-Business-ID') || auth.principal.businessId || '').trim();
    const phone = String(body?.phone || '').trim();
    const method = String(body?.method || body?.provider || 'PESAPAL').trim().toUpperCase();
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (method !== 'PESAPAL' && method !== 'MPESA') return json({ error: 'Unsupported payment method.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    if (!canManageBilling(auth.principal, businessId)) {
      return json({ error: 'Only a business administrator can pay from the POS.' }, 403);
    }

    const business = await getBillingBusiness(env.DB, businessId);
    if (!business) return json({ error: 'Business was not found.' }, 404);
    const billing = publicBillingStatus(business);
    if (billing.billingStatus === 'OK' || billing.amountDue <= 0) {
      return json({ error: 'There is no payment due for this business.' }, 409);
    }

    if (method === 'PESAPAL') {
      const order = await sendBillingPesaPalOrder(request, env, {
        businessId,
        businessCode: business.code,
        businessName: business.name,
        phone,
        amount: billing.amountDue,
      });
      const paymentId = await recordPendingBillingPayment(env.DB, {
        businessId,
        phone: order.phone,
        amount: order.amount,
        reference: order.reference,
        checkoutRequestId: order.checkoutRequestId,
        merchantRequestId: order.merchantRequestId,
        provider: 'PESAPAL',
        redirectUrl: order.redirectUrl,
      });

      return json({
        success: true,
        message: order.message,
        redirectUrl: order.redirectUrl,
        payment: {
          id: paymentId,
          businessId,
          phone: order.phone,
          amount: order.amount,
          reference: order.reference,
          checkoutRequestId: order.checkoutRequestId,
          merchantRequestId: order.merchantRequestId,
          provider: 'PESAPAL',
          redirectUrl: order.redirectUrl,
          status: 'PENDING',
        },
        billing,
      });
    }

    const stk = await sendBillingStkPush(request, env, {
      businessId,
      businessCode: business.code,
      phone,
      amount: billing.amountDue,
    });
    const paymentId = await recordPendingBillingPayment(env.DB, {
      businessId,
      phone: stk.phone,
      amount: stk.amount,
      reference: stk.reference,
      checkoutRequestId: stk.checkoutRequestId,
      merchantRequestId: stk.merchantRequestId,
      provider: 'MPESA',
    });

    return json({
      success: true,
      message: stk.message,
      payment: {
        id: paymentId,
        businessId,
        phone: stk.phone,
        amount: stk.amount,
        reference: stk.reference,
        checkoutRequestId: stk.checkoutRequestId,
        merchantRequestId: stk.merchantRequestId,
        provider: 'MPESA',
        status: 'PENDING',
      },
      billing,
    });
  } catch (err: any) {
    console.error('[Billing Pay]', err?.message || err);
    return json({ error: err?.message || 'Could not start billing payment.' }, 500);
  }
};
