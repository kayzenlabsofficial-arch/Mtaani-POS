import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { loadMpesaRuntimeCredentials } from './credentialStore';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  MPESA_CALLBACK_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    // ── Auth: require API key ────────────────────────────────────────────────
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json() as { amount: number, phone: string, reference?: string, businessId: string };
    
    if (!body.amount || !body.phone || !body.businessId) {
      return new Response(JSON.stringify({ error: 'Amount, phone, and businessId are required' }), { status: 400, headers: jsonHeaders() });
    }
    if (!canAccessBusiness(auth.principal, body.businessId)) {
      return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403, headers: jsonHeaders() });
    }

    const phone = formatPhone(body.phone);
    const amount = Math.ceil(body.amount);
    const reference = body.reference || 'POS_PAYMENT';
    const description = 'Payment for items';

    // 1. Fetch credentials from the server-only encrypted M-Pesa store.
    const credentials = await loadMpesaRuntimeCredentials(env.DB, body.businessId, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    const consumerKey = credentials.consumerKey;
    const consumerSecret = credentials.consumerSecret;
    const passkey = credentials.passkey;
    const shortcode = credentials.shortcode;
    const isProd = credentials.env === 'production';
    const mpesaType = credentials.type;
    const storeNumber = credentials.storeNumber;

    // Security & Validation: Prevent using sandbox defaults in production
    if (isProd && (!consumerKey || !consumerSecret || !shortcode || !passkey)) {
       throw new Error("M-Pesa configuration is incomplete for this business in PRODUCTION mode.");
    }

    if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
      // Never fall back to hardcoded credentials.
      // Misconfiguration should fail closed to protect financial integrity.
      throw new Error('M-Pesa is not configured.');
    }

    const baseUrl = isProd 
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

    console.log(`[M-Pesa] Sending phone request (${mpesaType}) for business=${body.businessId} env=${isProd ? 'PRODUCTION' : 'SANDBOX'}`);

    // 2. Generate OAuth Token
    const authString = btoa(`${consumerKey}:${consumerSecret}`);
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { 'Authorization': `Basic ${authString}` }
    });

    if (!tokenRes.ok) {
      await tokenRes.text().catch(() => '');
      throw new Error('M-Pesa could not connect. Check the saved credentials.');
    }

    const { access_token } = await tokenRes.json() as any;

    // 3. Prepare M-Pesa phone request
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    
    // SECURITY: Use a secret callback path to prevent spoofing
    const callbackSecret = env.MPESA_CALLBACK_SECRET;
    if (!callbackSecret) {
      throw new Error("MPESA_CALLBACK_SECRET is not set. Refusing to initiate STK push without a protected callback path.");
    }
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
      PartyB: isBuyGoods ? (storeNumber || shortcode) : shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: description
    };

    // 4. PRE-LOG: Record as PENDING before the push to prevent race conditions
    // We don't have CheckoutRequestID yet, but we can generate a temporary internal ID or wait for response.
    // Safaricom returns CheckoutRequestID in the response.
    
    // Send M-Pesa phone request
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
       throw new Error(stkData?.errorMessage || stkData?.ResponseDescription || 'M-Pesa request failed.');
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
        timestamp INTEGER,
        utilizedTransactionId TEXT,
        utilizedCustomerId TEXT,
        utilizedCustomerName TEXT,
        utilizedAt INTEGER
      )
    `).run();

    for (const sql of [
      'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT',
      'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT',
      'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT',
      'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER',
      'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, receiptNumber)',
    ]) {
      try { await env.DB.prepare(sql).run(); } catch (e) {}
    }

    await env.DB.prepare(`
      INSERT INTO mpesaCallbacks 
      (checkoutRequestId, merchantRequestId, resultCode, resultDesc, amount, phoneNumber, businessId, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      stkData.CheckoutRequestID, stkData.MerchantRequestID, 999, 'PENDING', amount, phone, body.businessId, Date.now()
    ).run();

    return new Response(JSON.stringify({ 
      success: true, 
      message: stkData.CustomerMessage || 'M-Pesa request sent successfully',
      checkoutRequestId: stkData.CheckoutRequestID
    }), { headers: jsonHeaders() });

  } catch (err: any) {
    const message = err?.message || 'M-Pesa request failed.';
    console.error('[M-Pesa Request Error]', message);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: jsonHeaders() });
  }
};
