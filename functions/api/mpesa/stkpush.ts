interface Env {
  DB: D1Database;
  MPESA_CONSUMER_KEY?: string;
  MPESA_CONSUMER_SECRET?: string;
  MPESA_SHORTCODE?: string;
  MPESA_PASSKEY?: string;
  MPESA_CALLBACK_URL?: string;
  MPESA_ENV?: string; // 'sandbox' or 'production'
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key'
};

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders };
}

// Format phone number to 2547XXXXXXXX
function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1);
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = '254' + cleaned;
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);
  return cleaned;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders() });
  }

  try {
    const body = await request.json() as { amount: number, phone: string, reference?: string, businessId: string, branchId: string };
    
    if (!body.amount || !body.phone || !body.businessId || !body.branchId) {
      return new Response(JSON.stringify({ error: 'Amount, phone, businessId, and branchId are required' }), { status: 400, headers: jsonHeaders() });
    }

    const phone = formatPhone(body.phone);
    const amount = Math.ceil(body.amount);
    const reference = body.reference || 'POS_PAYMENT';
    const description = 'Payment for items';

    // 1. Fetch Credentials from D1 Database for this specific branch
    let consumerKey, consumerSecret, passkey, shortcode, isProd, mpesaType, storeNumber;

    try {
      const branch = await env.DB.prepare(`
        SELECT mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey, mpesaEnv, tillNumber, mpesaType, mpesaStoreNumber 
        FROM branches 
        WHERE id = ? AND businessId = ?
      `).bind(body.branchId, body.businessId).first() as any;

      if (branch && branch.mpesaConsumerKey && branch.mpesaConsumerSecret) {
        consumerKey = branch.mpesaConsumerKey;
        consumerSecret = branch.mpesaConsumerSecret;
        passkey = branch.mpesaPasskey;
        isProd = branch.mpesaEnv === 'production';
        mpesaType = branch.mpesaType || 'paybill';
        
        // For Paybill: shortcode = tillNumber
        // For Buy Goods: shortcode = Store Number, PartyB = tillNumber
        if (mpesaType === 'buygoods') {
          shortcode = branch.mpesaStoreNumber;
          storeNumber = branch.mpesaStoreNumber;
        } else {
          shortcode = branch.tillNumber;
        }
      } else {
        // Fallback to Global Env Vars if branch settings are missing
        consumerKey = env.MPESA_CONSUMER_KEY;
        consumerSecret = env.MPESA_CONSUMER_SECRET;
        passkey = env.MPESA_PASSKEY;
        isProd = env.MPESA_ENV === 'production';
        mpesaType = env.MPESA_TYPE || 'paybill';
        
        if (mpesaType === 'buygoods') {
           shortcode = env.MPESA_STORE_NUMBER;
           storeNumber = env.MPESA_STORE_NUMBER;
        } else {
           shortcode = env.MPESA_SHORTCODE || '174379';
        }
      }
    } catch (dbErr) {
      console.error("[DB Error fetching credentials]:", dbErr);
      isProd = false;
    }

    // Security & Validation: Prevent using sandbox defaults in production
    if (isProd && (!consumerKey || !consumerSecret || !shortcode || !passkey)) {
       throw new Error("M-Pesa configuration is incomplete for this branch in PRODUCTION mode.");
    }

    if (!consumerKey || !consumerSecret || !passkey) {
      // Sandbox Fallback
      consumerKey = 'LpAmyYqABzW0zg0HDkzSVoDGsDbspcUutfyOpAACv45ZPBtG';
      consumerSecret = '4BOGBBmgJ7rk4GKtMc6TU2Gx6Q02OK2ZJGDRdjGChOPv176qnCMW88FUNa7awEDn';
      passkey = 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
      shortcode = '174379';
      mpesaType = 'paybill';
      isProd = false;
    }

    const baseUrl = isProd 
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

    console.log(`[M-Pesa] Triggering STK Push (${mpesaType}) for ${body.branchId} in ${isProd ? 'PRODUCTION' : 'SANDBOX'} mode`);

    // 2. Generate OAuth Token
    const authString = btoa(`${consumerKey}:${consumerSecret}`);
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { 'Authorization': `Basic ${authString}` }
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new Error(`Failed to generate M-Pesa token: ${err}`);
    }

    const { access_token } = await tokenRes.json() as any;

    // 3. Prepare STK Push Payload
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    
    // SECURITY: Use a secret callback path to prevent spoofing
    const callbackSecret = env.MPESA_CALLBACK_SECRET || 'default_secret_key_123';
    const urlObj = new URL(request.url);
    const callbackUrl = `${urlObj.protocol}//${urlObj.host}/api/mpesa/callback/${callbackSecret}`;

    const isBuyGoods = mpesaType === 'buygoods';

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: isBuyGoods ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: isBuyGoods ? body.phone.replace(/\D/g, '').replace(/^0/, '254') : shortcode, // For Till, PartyB is the Till Number (handled via tillNumber in DB usually, but wait...)
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: description
    };

    // Correcting PartyB if it's Buy Goods
    // In our DB, 'tillNumber' field usually stores the Till Number.
    // If it's Buy Goods: BusinessShortCode = Store Number, PartyB = Till Number.
    if (isBuyGoods) {
      // Re-fetch branch tillNumber just in case it was overwritten in local variable
      const branchAgain = await env.DB.prepare(`SELECT tillNumber FROM branches WHERE id = ?`).bind(body.branchId).first() as any;
      stkPayload.PartyB = branchAgain?.tillNumber || shortcode;
    }

    // 4. PRE-LOG: Record as PENDING before the push to prevent race conditions
    // We don't have CheckoutRequestID yet, but we can generate a temporary internal ID or wait for response.
    // Safaricom returns CheckoutRequestID in the response.
    
    // Send STK Push Request
    const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(stkPayload)
    });

    const stkData = await stkRes.json() as any;

    if (!stkRes.ok || stkData.errorCode) {
       throw new Error(`STK Push failed: ${JSON.stringify(stkData)}`);
    }

    // 5. SECURE LOGGING: Save the pending request to D1
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS mpesaCallbacks (
        checkoutRequestId TEXT PRIMARY KEY,
        merchantRequestId TEXT,
        resultCode INTEGER,
        resultDesc TEXT,
        amount REAL,
        receiptNumber TEXT,
        phoneNumber TEXT,
        businessId TEXT,
        branchId TEXT,
        timestamp INTEGER
      )
    `).run();

    await env.DB.prepare(`
      INSERT INTO mpesaCallbacks 
      (checkoutRequestId, merchantRequestId, resultCode, resultDesc, amount, phoneNumber, businessId, branchId, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      stkData.CheckoutRequestID, stkData.MerchantRequestID, 999, 'PENDING', amount, phone, body.businessId, body.branchId, Date.now()
    ).run();

    return new Response(JSON.stringify({ 
      success: true, 
      message: stkData.CustomerMessage || 'STK Push sent successfully',
      checkoutRequestId: stkData.CheckoutRequestID
    }), { headers: jsonHeaders() });

  } catch (err: any) {
    console.error("[STK Push Error]:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: jsonHeaders() });
  }
};
