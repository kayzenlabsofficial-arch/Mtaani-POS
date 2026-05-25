import { authorizeRequest, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...corsHeaders,
    },
  });
}

function normaliseCode(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function normalisePhone(value: unknown) {
  return String(value || '').replace(/[^\d+]/g, '').trim();
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, receiptNumber)',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, utilizedTransactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function findExistingPayment(db: D1Database, businessId: string, code: string) {
  return db.prepare(`
    SELECT
      m.*,
      COALESCE(m.utilizedTransactionId, (
        SELECT t.id
        FROM transactions t
        WHERE t.businessId = m.businessId
          AND (
            UPPER(COALESCE(t.mpesaCode, '')) = ?
            OR UPPER(COALESCE(t.mpesaReference, '')) = ?
            OR UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = ?
          )
        LIMIT 1
      )) AS linkedTransactionId
    FROM mpesaCallbacks m
    WHERE m.businessId = ?
      AND (
        UPPER(COALESCE(m.receiptNumber, '')) = ?
        OR UPPER(COALESCE(m.checkoutRequestId, '')) = ?
        OR UPPER(COALESCE(m.merchantRequestId, '')) = ?
      )
    ORDER BY CASE WHEN m.resultCode = 0 THEN 0 ELSE 1 END, m.timestamp DESC
    LIMIT 1
  `).bind(
    code, code, code,
    businessId, code, code, code,
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
    const code = normaliseCode(body?.code);
    const amount = roundMoney(asNumber(body?.amount, 0));
    const phoneNumber = normalisePhone(body?.phoneNumber || body?.phone);

    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied' }, 403);
    if (!code) return json({ error: 'Enter an M-Pesa transaction code.' }, 400);
    if (!/^[A-Z0-9]{4,40}$/.test(code)) return json({ error: 'Enter a valid M-Pesa transaction code.' }, 400);
    if (amount <= 0) return json({ error: 'Enter the M-Pesa amount received.' }, 400);

    await ensureMpesaLedgerSchema(env.DB);

    const existing = await findExistingPayment(env.DB, businessId, code);
    if (existing) {
      const existingAmount = asNumber(existing.amount, 0);
      if (existing.linkedTransactionId) {
        return json({ error: 'This M-Pesa payment is already tied to another POS receipt.' }, 409);
      }
      if (asNumber(existing.resultCode, -1) !== 0) {
        return json({ error: 'This M-Pesa code already exists but is not paid.' }, 409);
      }
      if (existingAmount + 0.01 < amount) {
        return json({ error: 'The existing M-Pesa payment amount is below the entered amount.' }, 409);
      }
      return json({
        success: true,
        existing: true,
        checkoutRequestId: existing.checkoutRequestId,
        receiptNumber: existing.receiptNumber || code,
        amount: existingAmount,
        phoneNumber: existing.phoneNumber || null,
        paymentStatus: 'PAID',
        utilizationStatus: 'UNUTILIZED',
      });
    }

    const now = Date.now();
    const checkoutRequestId = `manual_${crypto.randomUUID()}`;
    await env.DB.prepare(`
      INSERT INTO mpesaCallbacks (
        checkoutRequestId, merchantRequestId, resultCode, resultDesc,
        amount, receiptNumber, phoneNumber, businessId, timestamp,
        utilizedTransactionId, utilizedCustomerId, utilizedCustomerName, utilizedAt
      )
      VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
    `).bind(
      checkoutRequestId,
      'MANUAL',
      'Manual M-Pesa entry',
      amount,
      code,
      phoneNumber || null,
      businessId,
      now,
    ).run();

    return json({
      success: true,
      existing: false,
      checkoutRequestId,
      receiptNumber: code,
      amount,
      phoneNumber: phoneNumber || null,
      paymentStatus: 'PAID',
      utilizationStatus: 'UNUTILIZED',
    });
  } catch (err: any) {
    console.error('[M-Pesa Manual Error]', err?.message || err);
    return json({ error: err?.message || 'M-Pesa manual entry failed.' }, 500);
  }
};
