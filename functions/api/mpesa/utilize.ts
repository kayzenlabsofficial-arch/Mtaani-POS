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

function parseMaybeJson(value: unknown) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
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

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const businessId = String(body?.businessId || request.headers.get('X-Business-ID') || '').trim();
    const branchId = String(body?.branchId || request.headers.get('X-Branch-ID') || '').trim();
    const transactionId = String(body?.transactionId || '').trim();
    const code = normaliseCode(body?.code);
    const customerId = String(body?.customerId || '').trim() || null;
    const customerName = String(body?.customerName || '').trim() || null;

    if (!businessId || !branchId || !transactionId || !code) {
      return json({ error: 'Business, branch, transaction and M-Pesa code are required.' }, 400);
    }
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied' }, 403);

    await ensureMpesaLedgerSchema(env.DB);
    const transaction = await env.DB.prepare(`
      SELECT id, customerId, customerName, total, paymentMethod, splitPayments
      FROM transactions
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(transactionId, businessId, branchId).first<any>();

    if (!transaction) return json({ error: 'POS receipt not found for this M-Pesa utilization.' }, 404);

    const payment = await env.DB.prepare(`
      SELECT *
      FROM mpesaCallbacks
      WHERE businessId = ?
        AND branchId = ?
        AND (
          UPPER(COALESCE(receiptNumber, '')) = ?
          OR UPPER(COALESCE(checkoutRequestId, '')) = ?
          OR UPPER(COALESCE(merchantRequestId, '')) = ?
        )
      ORDER BY CASE WHEN resultCode = 0 THEN 0 ELSE 1 END, timestamp DESC
      LIMIT 1
    `).bind(businessId, branchId, code, code, code).first<any>();

    if (!payment) return json({ error: 'M-Pesa payment not found.' }, 404);
    if (Number(payment.resultCode) !== 0) return json({ error: payment.resultDesc || 'M-Pesa payment is not paid.' }, 409);

    const splitPayments = parseMaybeJson(transaction.splitPayments) as any;
    const expectedMpesaAmount = String(transaction.paymentMethod || '').toUpperCase() === 'SPLIT'
      && String(splitPayments?.secondaryMethod || '').toUpperCase() === 'MPESA'
        ? asNumber(splitPayments?.secondaryAmount, 0)
        : asNumber(transaction.total, 0);
    if (expectedMpesaAmount > 0 && asNumber(payment.amount, 0) + 0.01 < expectedMpesaAmount) {
      return json({ error: `M-Pesa paid amount is below the receipt amount.` }, 409);
    }

    const existingLink = payment.utilizedTransactionId
      ? { id: payment.utilizedTransactionId }
      : await env.DB.prepare(`
          SELECT id
          FROM transactions
          WHERE businessId = ?
            AND branchId = ?
            AND id != ?
            AND (
              UPPER(COALESCE(mpesaCode, '')) = ?
              OR UPPER(COALESCE(mpesaReference, '')) = ?
              OR UPPER(COALESCE(mpesaCheckoutRequestId, '')) = ?
            )
          LIMIT 1
        `).bind(businessId, branchId, transactionId, code, code, code).first<any>();

    if (existingLink?.id && existingLink.id !== transactionId) {
      return json({ error: 'This M-Pesa payment is already tied to another POS receipt.' }, 409);
    }

    await env.DB.prepare(`
      UPDATE mpesaCallbacks
      SET utilizedTransactionId = ?,
          utilizedCustomerId = ?,
          utilizedCustomerName = ?,
          utilizedAt = ?
      WHERE checkoutRequestId = ?
    `).bind(
      transactionId,
      customerId || transaction.customerId || null,
      customerName || transaction.customerName || null,
      Date.now(),
      payment.checkoutRequestId,
    ).run();

    return json({ success: true, utilizationStatus: 'UTILIZED' });
  } catch (err: any) {
    console.error('[M-Pesa Utilize Error]', err);
    return json({ error: err?.message || 'Could not mark M-Pesa payment as utilized.' }, 500);
  }
};
