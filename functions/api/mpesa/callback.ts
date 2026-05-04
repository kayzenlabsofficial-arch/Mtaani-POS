interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const data = await request.json() as any;
    console.log("[M-PESA CALLBACK RECEIVED]:", JSON.stringify(data, null, 2));

    const callbackData = data?.Body?.stkCallback;
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
            console.log(`[STK SUCCESS] Receipt: ${receiptNumber}, Amount: ${amount}, Phone: ${phoneNumber}`);
            
            // Ideally, we store this in D1 so the frontend can poll it
            // For now, we will create a dynamic table if it doesn't exist to store callbacks
            try {
               await env.DB.prepare(`
                 CREATE TABLE IF NOT EXISTS mpesaCallbacks (
                   checkoutRequestId TEXT PRIMARY KEY,
                   merchantRequestId TEXT,
                   resultCode INTEGER,
                   resultDesc TEXT,
                   amount REAL,
                   receiptNumber TEXT,
                   phoneNumber TEXT,
                   timestamp INTEGER
                 )
               `).run();

               await env.DB.prepare(`
                 INSERT OR REPLACE INTO mpesaCallbacks 
                 (checkoutRequestId, merchantRequestId, resultCode, resultDesc, amount, receiptNumber, phoneNumber, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               `).bind(
                 checkoutRequestId, merchantRequestId, resultCode, resultDesc, amount, receiptNumber, phoneNumber, Date.now()
               ).run();
            } catch (dbErr) {
               console.error("Failed to save callback to DB:", dbErr);
            }
        } else {
            console.log(`[STK FAILED/CANCELLED] CheckoutReq: ${checkoutRequestId}, Reason: ${resultDesc}`);
             try {
               await env.DB.prepare(`
                 CREATE TABLE IF NOT EXISTS mpesaCallbacks (
                   checkoutRequestId TEXT PRIMARY KEY,
                   merchantRequestId TEXT,
                   resultCode INTEGER,
                   resultDesc TEXT,
                   amount REAL,
                   receiptNumber TEXT,
                   phoneNumber TEXT,
                   timestamp INTEGER
                 )
               `).run();

               await env.DB.prepare(`
                 INSERT OR REPLACE INTO mpesaCallbacks 
                 (checkoutRequestId, merchantRequestId, resultCode, resultDesc, amount, receiptNumber, phoneNumber, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               `).bind(
                 checkoutRequestId, merchantRequestId, resultCode, resultDesc, 0, '', '', Date.now()
               ).run();
            } catch (dbErr) {
               console.error("Failed to save callback to DB:", dbErr);
            }
        }
    }

    // Always return success to Safaricom
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }), { 
      headers: { 'Content-Type': 'application/json' } 
    });

  } catch (err: any) {
    console.error("[Callback Processing Error]:", err);
    // Even on error, it's best to return 0 to Safaricom so they stop retrying
    return new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Error processed but ignored" }), { 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
};