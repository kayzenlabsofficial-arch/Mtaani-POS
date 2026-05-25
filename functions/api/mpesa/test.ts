import { authorizeRequest, canAccessBusiness, verifyPassword } from '../authUtils';
import { loadMpesaRuntimeCredentials, recordMpesaTestResult } from './credentialStore';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  MPESA_CREDENTIAL_ENCRYPTION_KEY?: string;
}

const CONFIRM_PHRASE = 'UPDATE MPESA';

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.DB) return json({ error: 'Database is not configured.' }, 500);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!auth.service && auth.principal.role !== 'ADMIN' && auth.principal.role !== 'ROOT') {
    return json({ error: 'Only an administrator can test M-Pesa settings.' }, 403);
  }

  const body = await request.json().catch(() => null) as any;
  const businessId = String(body?.businessId || request.headers.get('X-Business-ID') || '').trim();
  const userId = String(body?.userId || auth.principal.userId || '').trim();
  const adminPassword = String(body?.adminPassword || '');
  const confirmationText = String(body?.confirmationText || '').trim().toUpperCase();

  if (!businessId || !userId) return json({ error: 'Business and admin are required.' }, 400);
  if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

  if (!auth.service && auth.principal.role !== 'ROOT') {
    if (auth.principal.userId !== userId) {
      return json({ error: 'Please sign in as the administrator making this change.' }, 403);
    }
    const user = await env.DB.prepare('SELECT id, role, password FROM users WHERE id = ? AND businessId = ? LIMIT 1')
      .bind(userId, businessId)
      .first<any>();
    if (!user || user.role !== 'ADMIN') return json({ error: 'Only an administrator can test M-Pesa settings.' }, 403);
    const passwordOk = await verifyPassword(adminPassword, String(user.password || ''));
    if (!passwordOk || confirmationText !== CONFIRM_PHRASE) {
      return json({ error: `Security check failed. Enter the admin password and type ${CONFIRM_PHRASE}.` }, 401);
    }
  } else if (confirmationText !== CONFIRM_PHRASE) {
    return json({ error: `Type ${CONFIRM_PHRASE} to test M-Pesa settings.` }, 401);
  }

  try {
    const credentials = await loadMpesaRuntimeCredentials(env.DB, businessId, env.MPESA_CREDENTIAL_ENCRYPTION_KEY);
    const baseUrl = credentials.env === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
    const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${btoa(`${credentials.consumerKey}:${credentials.consumerSecret}`)}` },
    });

    if (!tokenRes.ok) {
      await tokenRes.text().catch(() => '');
      await recordMpesaTestResult(env.DB, businessId, 'FAILED', 'M-Pesa rejected the saved credentials.');
      return json({ error: 'M-Pesa rejected the saved credentials.' }, 400);
    }

    await tokenRes.json().catch(() => null);
    await recordMpesaTestResult(env.DB, businessId, 'PASSED', 'M-Pesa credentials connected successfully.');
    return json({ success: true, message: 'M-Pesa credentials connected successfully.' });
  } catch (err: any) {
    const message = String(err?.message || '').includes('safe storage key')
      ? err.message
      : 'M-Pesa settings could not be tested.';
    await recordMpesaTestResult(env.DB, businessId, 'FAILED', message).catch(() => {});
    console.error('[M-Pesa Test Error]', message);
    return json({ error: message }, 400);
  }
};
