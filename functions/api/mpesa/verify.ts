import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function normaliseCode(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureMpesaLedgerSchema(db: D1Database) {
  await db.prepare(`
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
    'ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, branchId, utilizedTransactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function findPayment(db: D1Database, businessId: string, branchId: string, code: string) {
  return db.prepare(`
    SELECT
      m.*,
      COALESCE(m.utilizedTransactionId, (
        SELECT t.id
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND t.branchId = m.branchId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedTransactionId,
      COALESCE(m.utilizedCustomerId, (
        SELECT t.customerId
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND t.branchId = m.branchId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedCustomerId,
      COALESCE(m.utilizedCustomerName, (
        SELECT t.customerName
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND t.branchId = m.branchId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedCustomerName
    FROM mpesaCallbacks m
    WHERE m.businessId = ?
      AND m.branchId = ?
      AND (
        UPPER(COALESCE(m.receiptNumber, '')) = ?
        OR UPPER(COALESCE(m.checkoutRequestId, '')) = ?
        OR UPPER(COALESCE(m.merchantRequestId, '')) = ?
      )
    ORDER BY CASE WHEN m.resultCode = 0 THEN 0 ELSE 1 END, m.timestamp DESC
    LIMIT 1
  `).bind(
    code, code, code,
    code, code, code,
    code, code, code,
    businessId, branchId, code, code, code,
  ).first<any>();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const businessId = String(body?.businessId || request.headers.get('X-Business-ID') || '').trim();
    const branchId = String(body?.branchId || request.headers.get('X-Branch-ID') || '').trim();
    const code = normaliseCode(body?.code);
    const expectedAmount = asNumber(body?.amount, 0);

    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied' }, 403);
    if (!code) return json({ error: 'Enter an M-Pesa receipt code.' }, 400);

    await ensureMpesaLedgerSchema(env.DB);
    const payment = await findPayment(env.DB, businessId, branchId, code);
    if (!payment) {
      return json({
        found: false,
        paid: false,
        usable: false,
        utilizationStatus: 'UNUTILIZED',
        message: 'No matching M-Pesa payment has reached this branch yet. Check the code or wait for the Daraja callback.',
      });
    }

    const paid = asNumber(payment.resultCode, -1) === 0;
    const amount = asNumber(payment.amount, 0);
    const amountOk = !expectedAmount || amount >= expectedAmount;
    const utilized = !!payment.linkedTransactionId;

    return json({
      found: true,
      paid,
      usable: paid && amountOk && !utilized,
      utilizationStatus: utilized ? 'UTILIZED' : 'UNUTILIZED',
      paymentStatus: paid ? 'PAID' : asNumber(payment.resultCode, 999) === 999 ? 'PENDING' : 'FAILED',
      receiptNumber: payment.receiptNumber,
      checkoutRequestId: payment.checkoutRequestId,
      amount,
      expectedAmount,
      amountOk,
      phoneNumber: payment.phoneNumber,
      resultCode: payment.resultCode,
      resultDesc: payment.resultDesc,
      linkedTransactionId: payment.linkedTransactionId,
      linkedCustomerId: payment.linkedCustomerId,
      linkedCustomerName: payment.linkedCustomerName,
      message: !paid
        ? (payment.resultDesc || 'This M-Pesa request is not paid yet.')
        : !amountOk
          ? `Paid amount is Ksh ${amount.toLocaleString()} but this sale needs Ksh ${expectedAmount.toLocaleString()}.`
          : utilized
            ? 'This M-Pesa payment has already been used on a POS receipt.'
            : 'M-Pesa payment verified and ready to use.',
    });
  } catch (err: any) {
    console.error('[M-Pesa Verify Error]', err);
    return json({ error: err?.message || 'M-Pesa verification failed.' }, 500);
  }
};
