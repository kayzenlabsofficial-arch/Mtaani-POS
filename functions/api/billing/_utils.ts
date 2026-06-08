import { canAccessBusiness, type Principal } from '../authUtils';

export type BillingStatus = 'OK' | 'REMINDER' | 'LOCKED';

export interface BillingEnv {
  DB: D1Database;
  API_SECRET?: string;
  BILLING_MPESA_ENV?: string;
  BILLING_MPESA_CONSUMER_KEY?: string;
  BILLING_MPESA_CONSUMER_SECRET?: string;
  BILLING_MPESA_SHORTCODE?: string;
  BILLING_MPESA_PASSKEY?: string;
  BILLING_MPESA_ACCOUNT_TYPE?: string;
  BILLING_MPESA_STORE_NUMBER?: string;
  BILLING_MPESA_CALLBACK_SECRET?: string;
}

export const billingCorsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      ...billingCorsHeaders,
    },
  });
}

export function text(value: unknown, fallback = '', max = 240) {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, max);
}

export function normalizeBillingStatus(value: unknown): BillingStatus {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'REMINDER' || status === 'LOCKED') return status;
  return 'OK';
}

export function canManageBilling(principal: Principal, businessId: string): boolean {
  return principal.role === 'ROOT' || (principal.role === 'ADMIN' && canAccessBusiness(principal, businessId));
}

export async function ensureBillingSchema(db: D1Database) {
  for (const column of [
    "billingStatus TEXT NOT NULL DEFAULT 'OK'",
    'billingAmountDue REAL DEFAULT 0',
    'billingDueAt INTEGER',
    'billingMessage TEXT',
    'billingLastPaidAt INTEGER',
  ]) {
    try { await db.prepare(`ALTER TABLE businesses ADD COLUMN ${column}`).run(); } catch {}
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingPayments (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      phone TEXT,
      amount REAL NOT NULL,
      reference TEXT,
      checkoutRequestId TEXT UNIQUE,
      merchantRequestId TEXT,
      receiptNumber TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      provider TEXT DEFAULT 'MPESA',
      redirectUrl TEXT,
      createdAt INTEGER,
      updated_at INTEGER
    )
  `).run();

  for (const sql of [
    'ALTER TABLE billingPayments ADD COLUMN phone TEXT',
    'ALTER TABLE billingPayments ADD COLUMN reference TEXT',
    'ALTER TABLE billingPayments ADD COLUMN checkoutRequestId TEXT',
    'ALTER TABLE billingPayments ADD COLUMN merchantRequestId TEXT',
    'ALTER TABLE billingPayments ADD COLUMN receiptNumber TEXT',
    'ALTER TABLE billingPayments ADD COLUMN resultCode INTEGER',
    'ALTER TABLE billingPayments ADD COLUMN resultDesc TEXT',
    "ALTER TABLE billingPayments ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING'",
    "ALTER TABLE billingPayments ADD COLUMN provider TEXT DEFAULT 'MPESA'",
    'ALTER TABLE billingPayments ADD COLUMN redirectUrl TEXT',
    'ALTER TABLE billingPayments ADD COLUMN createdAt INTEGER',
    'ALTER TABLE billingPayments ADD COLUMN updated_at INTEGER',
    'CREATE INDEX IF NOT EXISTS idx_billingPayments_business_created ON billingPayments(businessId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_billingPayments_checkout ON billingPayments(checkoutRequestId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export async function getBillingBusiness(db: D1Database, businessId: string) {
  await ensureBillingSchema(db);
  return db.prepare(`
    SELECT
      id, name, code, isActive,
      billingStatus, billingAmountDue, billingDueAt, billingMessage, billingLastPaidAt,
      updated_at
    FROM businesses
    WHERE id = ?
    LIMIT 1
  `).bind(businessId).first<any>();
}

export async function getRecentBillingPayments(db: D1Database, businessId: string, limit = 10) {
  await ensureBillingSchema(db);
  const { results } = await db.prepare(`
    SELECT *
    FROM billingPayments
    WHERE businessId = ?
    ORDER BY COALESCE(createdAt, updated_at, 0) DESC
    LIMIT ?
  `).bind(businessId, Math.max(1, Math.min(50, limit))).all<any>();
  return results || [];
}

export async function getBillingPaymentByCheckout(db: D1Database, businessId: string, checkoutRequestId: string) {
  await ensureBillingSchema(db);
  return db.prepare(`
    SELECT *
    FROM billingPayments
    WHERE businessId = ? AND checkoutRequestId = ?
    LIMIT 1
  `).bind(businessId, checkoutRequestId).first<any>();
}

export function publicBillingStatus(business: any) {
  return {
    businessId: business?.id || '',
    businessName: business?.name || '',
    businessCode: business?.code || '',
    billingStatus: normalizeBillingStatus(business?.billingStatus),
    amountDue: Number(business?.billingAmountDue || 0),
    dueAt: business?.billingDueAt || null,
    message: text(business?.billingMessage, '', 500),
    lastPaidAt: business?.billingLastPaidAt || null,
  };
}

export async function setBusinessBillingState(
  db: D1Database,
  businessId: string,
  status: BillingStatus,
  amountDue: number,
  dueAt: number | null,
  message: string,
) {
  await ensureBillingSchema(db);
  const now = Date.now();
  const normalized = normalizeBillingStatus(status);
  await db.prepare(`
    UPDATE businesses
    SET billingStatus = ?,
        billingAmountDue = ?,
        billingDueAt = ?,
        billingMessage = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(
    normalized,
    normalized === 'OK' ? 0 : Math.max(0, Number(amountDue) || 0),
    normalized === 'OK' ? null : dueAt,
    normalized === 'OK' ? '' : text(message, '', 500),
    now,
    businessId,
  ).run();
}

export async function markBillingPaid(db: D1Database, businessId: string, paymentId?: string | null) {
  await ensureBillingSchema(db);
  const now = Date.now();
  await db.prepare(`
    UPDATE businesses
    SET billingStatus = 'OK',
        billingAmountDue = 0,
        billingDueAt = NULL,
        billingMessage = '',
        billingLastPaidAt = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(now, now, businessId).run();

  if (paymentId) {
    await db.prepare(`
      UPDATE billingPayments
      SET status = 'PAID',
          resultCode = COALESCE(resultCode, 0),
          resultDesc = COALESCE(resultDesc, 'Paid'),
          updated_at = ?
      WHERE id = ? AND businessId = ?
    `).bind(now, paymentId, businessId).run();
  }
}

export function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = `254${cleaned.slice(1)}`;
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = `254${cleaned}`;
  return cleaned;
}

function requireSecret(value: string | undefined, name: string) {
  const clean = text(value, '', 4000);
  if (!clean) throw new Error(`${name} is not configured.`);
  return clean;
}

export async function sendBillingStkPush(request: Request, env: BillingEnv, input: {
  businessId: string;
  businessCode: string;
  phone: string;
  amount: number;
}) {
  const consumerKey = requireSecret(env.BILLING_MPESA_CONSUMER_KEY, 'BILLING_MPESA_CONSUMER_KEY');
  const consumerSecret = requireSecret(env.BILLING_MPESA_CONSUMER_SECRET, 'BILLING_MPESA_CONSUMER_SECRET');
  const shortcode = requireSecret(env.BILLING_MPESA_SHORTCODE, 'BILLING_MPESA_SHORTCODE');
  const passkey = requireSecret(env.BILLING_MPESA_PASSKEY, 'BILLING_MPESA_PASSKEY');
  const callbackSecret = requireSecret(env.BILLING_MPESA_CALLBACK_SECRET, 'BILLING_MPESA_CALLBACK_SECRET');
  const envName = String(env.BILLING_MPESA_ENV || 'sandbox').toLowerCase() === 'production' ? 'production' : 'sandbox';
  const accountType = String(env.BILLING_MPESA_ACCOUNT_TYPE || 'paybill').toLowerCase() === 'buygoods' ? 'buygoods' : 'paybill';
  const storeNumber = text(env.BILLING_MPESA_STORE_NUMBER, '', 120);
  const baseUrl = envName === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
  const amount = Math.ceil(Number(input.amount) || 0);
  if (amount <= 0) throw new Error('Payment amount is invalid.');
  const phone = formatPhone(input.phone);
  if (!/^254[17]\d{8}$/.test(phone)) throw new Error('Enter a valid Safaricom phone number.');

  const tokenRes = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${btoa(`${consumerKey}:${consumerSecret}`)}` },
  });
  if (!tokenRes.ok) throw new Error('Billing M-Pesa could not connect. Check platform credentials.');
  const { access_token } = await tokenRes.json() as any;

  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = btoa(`${shortcode}${passkey}${timestamp}`);
  const urlObj = new URL(request.url);
  const callbackUrl = `${urlObj.protocol}//${urlObj.host}/api/billing/callback/${callbackSecret}`;
  const isBuyGoods = accountType === 'buygoods';
  const reference = `BILL-${text(input.businessCode, 'POS', 8)}`;

  const stkRes = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
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
      TransactionDesc: 'Smart POS subscription',
    }),
  });

  const stkData = await stkRes.json() as any;
  if (!stkRes.ok || stkData.errorCode) {
    throw new Error(stkData?.errorMessage || stkData?.ResponseDescription || 'Billing M-Pesa request failed.');
  }

  return {
    phone,
    amount,
    reference,
    checkoutRequestId: String(stkData.CheckoutRequestID || ''),
    merchantRequestId: String(stkData.MerchantRequestID || ''),
    message: stkData.CustomerMessage || 'Payment request sent.',
  };
}

export async function recordPendingBillingPayment(db: D1Database, input: {
  businessId: string;
  phone?: string;
  amount: number;
  reference: string;
  checkoutRequestId: string;
  merchantRequestId?: string;
  provider?: string;
  redirectUrl?: string;
}) {
  await ensureBillingSchema(db);
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO billingPayments (
      id, businessId, phone, amount, reference, checkoutRequestId,
      merchantRequestId, resultCode, resultDesc, status, provider, redirectUrl, createdAt, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)
  `).bind(
    id,
    input.businessId,
    input.phone || '',
    input.amount,
    input.reference,
    input.checkoutRequestId,
    input.merchantRequestId || '',
    999,
    'PENDING',
    text(input.provider, 'MPESA', 24).toUpperCase(),
    input.redirectUrl || '',
    now,
    now,
  ).run();
  return id;
}

export async function applyBillingCallback(db: D1Database, input: {
  checkoutRequestId: string;
  merchantRequestId?: string;
  resultCode: number;
  resultDesc: string;
  amount: number;
  receiptNumber: string;
  phoneNumber: string;
}) {
  await ensureBillingSchema(db);
  const existing = await db.prepare(`
    SELECT id, businessId, status
    FROM billingPayments
    WHERE checkoutRequestId = ?
    LIMIT 1
  `).bind(input.checkoutRequestId).first<any>();
  if (!existing) return false;
  if (existing.status === 'PAID' || existing.status === 'FAILED') return true;

  const now = Date.now();
  const paid = Number(input.resultCode) === 0;
  await db.prepare(`
    UPDATE billingPayments
    SET merchantRequestId = COALESCE(?, merchantRequestId),
        resultCode = ?,
        resultDesc = ?,
        amount = COALESCE(NULLIF(?, 0), amount),
        receiptNumber = COALESCE(NULLIF(?, ''), receiptNumber),
        phone = COALESCE(NULLIF(?, ''), phone),
        status = ?,
        updated_at = ?
    WHERE id = ?
  `).bind(
    input.merchantRequestId || null,
    input.resultCode,
    input.resultDesc,
    input.amount || 0,
    input.receiptNumber || '',
    input.phoneNumber || '',
    paid ? 'PAID' : 'FAILED',
    now,
    existing.id,
  ).run();

  if (paid) await markBillingPaid(db, existing.businessId, existing.id);
  return true;
}
