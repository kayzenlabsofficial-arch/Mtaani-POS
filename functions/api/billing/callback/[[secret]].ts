import { applyBillingCallback, billingCorsHeaders, type BillingEnv } from '../_utils';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequestOptions: PagesFunction<BillingEnv> = async () => new Response(null, { headers: billingCorsHeaders });

export const onRequestPost: PagesFunction<BillingEnv> = async ({ request, env, params }) => {
  try {
    const receivedSecret = Array.isArray(params.secret) ? params.secret[0] : params.secret;
    const expectedSecret = env.BILLING_MPESA_CALLBACK_SECRET;
    if (!env.DB || !expectedSecret) {
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!receivedSecret || !timingSafeEqual(String(receivedSecret), expectedSecret)) {
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await request.json().catch(() => null) as any;
    const callbackData = data?.Body?.stkCallback;
    if (callbackData) {
      let amount = 0;
      let receiptNumber = '';
      let phoneNumber = '';
      if (Number(callbackData.ResultCode) === 0 && callbackData.CallbackMetadata?.Item) {
        for (const item of callbackData.CallbackMetadata.Item) {
          if (item.Name === 'Amount') amount = Number(item.Value) || 0;
          if (item.Name === 'MpesaReceiptNumber') receiptNumber = String(item.Value || '');
          if (item.Name === 'PhoneNumber') phoneNumber = String(item.Value || '');
        }
      }

      await applyBillingCallback(env.DB, {
        checkoutRequestId: String(callbackData.CheckoutRequestID || ''),
        merchantRequestId: String(callbackData.MerchantRequestID || ''),
        resultCode: Number(callbackData.ResultCode),
        resultDesc: String(callbackData.ResultDesc || ''),
        amount,
        receiptNumber,
        phoneNumber,
      });
    }

    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Success' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Billing Callback]', err);
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: 'Error processed' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
