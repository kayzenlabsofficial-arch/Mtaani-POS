import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { hardenTransactionBatch, PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}

function serializeValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function deserializeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normaliseCode(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

function parseMaybeJson(value: unknown) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function expectedMpesaAmount(tx: any) {
  const splitPayments = parseMaybeJson(tx.splitPayments) as any;
  if (
    String(tx.paymentMethod || '').toUpperCase() === 'SPLIT' &&
    String(splitPayments?.secondaryMethod || '').toUpperCase() === 'MPESA'
  ) {
    return asNumber(splitPayments?.secondaryAmount, 0);
  }
  return asNumber(tx.total, 0);
}

function mpesaReferenceFor(tx: any) {
  const method = String(tx.paymentMethod || '').toUpperCase();
  const splitPayments = parseMaybeJson(tx.splitPayments) as any;
  const usesMpesa = method === 'MPESA' || (
    method === 'SPLIT' &&
    String(splitPayments?.secondaryMethod || '').toUpperCase() === 'MPESA'
  );
  if (!usesMpesa) return '';
  return normaliseCode(tx.mpesaCode || tx.mpesaReference || tx.mpesaCheckoutRequestId);
}

async function ensureCheckoutSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      createdAt INTEGER NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey)').run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
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
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, branchId, utilizedTransactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function getExistingTransaction(db: D1Database, businessId: string, branchId: string, transactionId: string) {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(transactionId, businessId, branchId).first<any>();
  return row ? deserializeRow(row) : null;
}

async function verifyMpesaPayment(db: D1Database, businessId: string, branchId: string, tx: any): Promise<D1PreparedStatement[]> {
  const code = mpesaReferenceFor(tx);
  if (!code) return [];

  const payment = await db.prepare(`
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

  if (!payment) throw new PolicyError('M-Pesa payment not found.', 404);
  if (asNumber(payment.resultCode, -1) !== 0) {
    throw new PolicyError(payment.resultDesc || 'M-Pesa payment is not paid.', 409);
  }
  if (payment.utilizedTransactionId && payment.utilizedTransactionId !== tx.id) {
    throw new PolicyError('This M-Pesa payment is already tied to another POS receipt.', 409);
  }

  const amount = expectedMpesaAmount(tx);
  if (amount > 0 && asNumber(payment.amount, 0) + 0.01 < amount) {
    throw new PolicyError('M-Pesa paid amount is below the receipt amount.', 409);
  }

  return [
    db.prepare(`
      UPDATE mpesaCallbacks
      SET utilizedTransactionId = ?,
          utilizedCustomerId = ?,
          utilizedCustomerName = ?,
          utilizedAt = ?
      WHERE checkoutRequestId = ?
    `).bind(
      tx.id,
      tx.customerId || null,
      tx.customerName || null,
      Date.now(),
      payment.checkoutRequestId,
    ),
  ];
}

async function transactionInsert(db: D1Database, tx: any) {
  const { results: pragma } = await db.prepare(`PRAGMA table_info('transactions')`).all();
  const validCols = new Set((pragma as any[]).map((r: any) => r.name));
  const cols = Object.keys(tx).filter((k) => validCols.has(k));
  if (cols.length === 0) throw new PolicyError('No valid transaction columns to insert.', 400);
  const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return db.prepare(sql).bind(...cols.map((col) => serializeValue(tx[col])));
}

function auditInsert(db: D1Database, tx: any, businessId: string, branchId: string, principal: any) {
  const subtotal = asNumber(tx.subtotal, 0);
  const discount = asNumber(tx.discountAmount || tx.discount, 0);
  const severity = discount > subtotal * 0.1 ? 'WARN' : 'INFO';
  const details = discount > 0
    ? `Completed Ksh ${asNumber(tx.total, 0).toLocaleString()} sale with Ksh ${discount.toLocaleString()} discount.`
    : `Completed Ksh ${asNumber(tx.total, 0).toLocaleString()} sale.`;
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    principal.userId || null,
    principal.userName || null,
    'sale.checkout',
    'transaction',
    tx.id,
    severity,
    details,
    businessId,
    branchId,
    now,
  );
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const tx = body?.transaction || body;
    if (!tx || typeof tx !== 'object') return json({ error: 'Transaction payload is required.' }, 400);

    const businessId = String(request.headers.get('X-Business-ID') || tx.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || tx.branchId || '').trim();
    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureCheckoutSchema(env.DB);

    const transactionId = String(tx.id || crypto.randomUUID()).trim();
    tx.id = transactionId;
    const existing = await getExistingTransaction(env.DB, businessId, branchId, transactionId);
    if (existing) {
      return json({ success: true, transaction: existing, idempotent: true });
    }

    let sideEffects: D1PreparedStatement[] = [];
    try {
      sideEffects = await hardenTransactionBatch({
        db: env.DB,
        businessId,
        branchId,
        principal: auth.principal,
        service: auth.service,
      }, [tx]);
    } catch (err: any) {
      const status = err instanceof PolicyError ? err.status : 400;
      return json({ error: err?.message || 'Checkout was rejected.' }, status);
    }

    tx.isSynced = 1;
    tx.businessId = businessId;
    tx.branchId = branchId;

    const idempotencyKey = String(body?.idempotencyKey || tx.id).trim();
    const idempotencyId = `${businessId}|${branchId}|${idempotencyKey}`;
    const mpesaStatements = await verifyMpesaPayment(env.DB, businessId, branchId, tx);
    const batch = [
      await transactionInsert(env.DB, tx),
      ...sideEffects,
      ...mpesaStatements,
      auditInsert(env.DB, tx, businessId, branchId, auth.principal),
      env.DB.prepare(`
        INSERT OR IGNORE INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        idempotencyId,
        businessId,
        branchId,
        idempotencyKey,
        'sales.checkout',
        null,
        auth.principal.userName || null,
        Date.now(),
      ),
    ];

    await env.DB.batch(batch);

    return json({ success: true, transaction: tx });
  } catch (err: any) {
    console.error('[Checkout Error]', err);
    return json({ error: err?.message || 'Checkout failed.' }, 500);
  }
};

