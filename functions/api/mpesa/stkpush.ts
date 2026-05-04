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
    const body = await request.json() as { amount: number, phone: string, reference?: string };
    
    if (!body.amount || !body.phone) {
      return new Response(JSON.stringify({ error: 'Amount and phone are required' }), { status: 400, headers: jsonHeaders() });
    }

    const phone = formatPhone(body.phone);
    const amount = Math.ceil(body.amount); // Mpesa takes integers
    const reference = body.reference || 'POS_PAYMENT';
    const description = 'Payment for items';

    // 1. Get Credentials (Fallback to user-provided keys if env vars missing, and Sandbox defaults for shortcode)
    // The user provided these keys specifically:
    const consumerKey = env.MPESA_CONSUMER_KEY || 'LpAmyYqABzW0zg0HDkzSVoDGsDbspcUutfyOpAACv45ZPBtG';
    const consumerSecret = env.MPESA_CONSUMER_SECRET || '4BOGBBmgJ7rk4GKtMc6TU2Gx6Q02OK2ZJGDRdjGChOPv176qnCMW88FUNa7awEDn';
    
    // Defaulting to Daraja Sandbox for shortcode if not provided
    const shortcode = env.MPESA_SHORTCODE || '174379'; 
    const passkey = env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    const isProd = env.MPESA_ENV === 'production';

    const baseUrl = isProd 
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

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
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14); // YYYYMMDDHHmmss
    const password = btoa(`${shortcode}${passkey}${timestamp}`);
    
    // Auto-detect domain for callback if not provided
    const urlObj = new URL(request.url);
    const defaultCallback = `${urlObj.protocol}//${urlObj.host}/api/mpesa/callback`;
    const callbackUrl = env.MPESA_CALLBACK_URL || defaultCallback;

    const stkPayload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline', // or CustomerBuyGoodsOnline if Till
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: description
    };

    // 4. Send STK Push Request
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

    // stkData typically returns: CheckoutRequestID, MerchantRequestID, ResponseCode, ResponseDescription, CustomerMessage
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
