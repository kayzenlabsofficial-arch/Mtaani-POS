interface Env {
  DB: D1Database;
  MPESA_CALLBACK_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    // 1. SECURITY: Verify Secret Key from URL
    const receivedSecret = Array.isArray(params.secret) ? params.secret[0] : params.secret;
    const expectedSecret = env.MPESA_CALLBACK_SECRET;
    if (!expectedSecret) {
      console.error('[Security] MPESA_CALLBACK_SECRET env var is not set. Refusing to process callbacks.');
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Server misconfigured" }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!receivedSecret || receivedSecret !== expectedSecret) {
      console.warn(`[M-PESA SECURITY ALERT]: Unauthorized callback attempt.`);
      return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Unauthorized" }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' } 
      });
    }

    const data = await request.json() as any;
    const callbackData = data?.Body?.stkCallback;
    console.log(`[M-Pesa Callback] Received payload for CheckoutID: ${callbackData?.CheckoutRequestID}`);
    
    if (callbackData) {
        const merchantRequestId = callbackData.MerchantRequestID;
        const checkoutRequestId = callbackData.CheckoutRequestID;
        const resultCode = callbackData.ResultCode; // 0 means success
        const resultDesc = callbackData.ResultDesc;
        
        let amount = 0;
        let receiptNumber = '';
        let phoneNumber = '';

        if (resultCode === 0 && callbackData.CallbackMetadata) {
            const items = callbackData.CallbackMetadata.Item;
            for (const item of items) {
                if (item.Name === 'Amount') amount = item.Value;
                if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
                if (item.Name === 'PhoneNumber') phoneNumber = item.Value;
            }
        }

        for (const sql of [
          'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT',
          'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT',
          'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT',
          'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER',
          'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)',
        ]) {
          try { await env.DB.prepare(sql).run(); } catch (e) {}
        }

        // 2. IDEMPOTENCY: Only update if the status is currently 'PENDING' (ResultCode 999)
        // This prevents duplicate callbacks from Safaricom from triggering duplicate logic.
        try {
           const existing = await env.DB.prepare(`
             SELECT resultCode, amount, receiptNumber, phoneNumber
             FROM mpesaCallbacks
             WHERE checkoutRequestId = ?
           `)
             .bind(checkoutRequestId)
             .first() as { resultCode: number; amount?: number; receiptNumber?: string; phoneNumber?: string } | null;

           if (existing && existing.resultCode !== 999) {
             console.log(`[M-PESA IDEMPOTENCY]: CheckoutID ${checkoutRequestId} already processed. Skipping.`);
             return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Duplicate Ignored" }), { 
               headers: { 'Content-Type': 'application/json' } 
             });
           }

           const nextAmount = amount || Number(existing?.amount || 0);
           const nextReceiptNumber = receiptNumber || existing?.receiptNumber || '';
           const nextPhoneNumber = phoneNumber || existing?.phoneNumber || '';

           // Update with actual Safaricom result
           await env.DB.prepare(`
             UPDATE mpesaCallbacks 
             SET resultCode = ?, resultDesc = ?, amount = ?, receiptNumber = ?, phoneNumber = ?, timestamp = ?
             WHERE checkoutRequestId = ?
           `).bind(
             resultCode, resultDesc, nextAmount, nextReceiptNumber, nextPhoneNumber, Date.now(), checkoutRequestId
           ).run();

           console.log(`[M-PESA CALLBACK SUCCESS]: Updated ${checkoutRequestId} with ResultCode ${resultCode}`);

        } catch (dbErr) {
           console.error("Failed to update callback in DB:", dbErr);
        }
    }

    // Always return success to Safaricom to prevent retries
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }), { 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    console.error("[Callback Processing Error]:", err);
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Error processed" }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
};
