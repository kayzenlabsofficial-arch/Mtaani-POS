import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { ensureInventoryIntegritySchema } from '../inventoryIntegrity';
import { hardenTransactionBatch, PolicyError } from '../salesSecurity';
import { canPerformServerAction } from '../settingsPolicy';
import { createMainAccountCreditStatements, mpesaAmountForTransaction } from '../finance/mainAccountPosting';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Shop-ID',
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

let checkoutSchemaReady: Promise<void> | null = null;
let transactionColumnCache: Promise<Set<string>> | null = null;

async function ensureCheckoutSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      transactionId TEXT,
      createdAt INTEGER NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, idempotencyKey)').run();
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
      timestamp INTEGER,
      utilizedTransactionId TEXT,
      utilizedCustomerId TEXT,
      utilizedCustomerName TEXT,
      utilizedAt INTEGER
    )
  `).run();

  for (const sql of [
    'ALTER TABLE idempotencyKeys ADD COLUMN transactionId TEXT',
    'CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, transactionId)',
    'CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, businessId TEXT, shiftId TEXT, shopId TEXT, updated_at INTEGER)',
    'ALTER TABLE stockMovements ADD COLUMN shiftId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shopId TEXT',
    'ALTER TABLE transactions ADD COLUMN shiftId TEXT',
    'ALTER TABLE transactions ADD COLUMN shopId TEXT',
    'ALTER TABLE customers ADD COLUMN shopId TEXT',
    'ALTER TABLE shifts ADD COLUMN shopId TEXT',
    "UPDATE customers SET shopId = 'single-shop' WHERE COALESCE(shopId, '') = ''",
    "UPDATE shifts SET shopId = 'single-shop' WHERE COALESCE(shopId, '') = ''",
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT',
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT',
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT',
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, receiptNumber)',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, utilizedTransactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
  await ensureInventoryIntegritySchema(db);
}

async function ensureCheckoutSchemaCached(db: D1Database) {
  if (!checkoutSchemaReady) {
    checkoutSchemaReady = ensureCheckoutSchema(db).catch((err) => {
      checkoutSchemaReady = null;
      throw err;
    });
  }
  return checkoutSchemaReady;
}

async function getTransactionColumns(db: D1Database) {
  if (!transactionColumnCache) {
    transactionColumnCache = db.prepare(`PRAGMA table_info('transactions')`).all()
      .then(({ results }) => new Set((results as any[]).map((row: any) => row.name)))
      .catch((err) => {
        transactionColumnCache = null;
        throw err;
      });
  }
  return transactionColumnCache;
}

async function getIdempotentTransaction(
  db: D1Database,
  businessId: string,
  idempotencyId: string,
  idempotencyKey: string,
) {
  const keyRow = await db.prepare(`
    SELECT transactionId
    FROM idempotencyKeys
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(idempotencyId, businessId).first<{ transactionId?: string | null }>();
  if (!keyRow) return null;

  const candidateIds = Array.from(new Set([
    String(keyRow.transactionId || '').trim(),
    String(idempotencyKey || '').trim(),
  ].filter(Boolean)));

  for (const candidateId of candidateIds) {
    const existing = await getExistingTransaction(db, businessId, candidateId);
    if (existing) return existing;
  }

  throw new PolicyError('Checkout retry key is already used.', 409);
}

async function getExistingTransaction(db: D1Database, businessId: string, transactionId: string) {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(transactionId, businessId).first<any>();
  return row ? deserializeRow(row) : null;
}

async function verifyMpesaPayment(db: D1Database, businessId: string, tx: any): Promise<{
  amount: number;
  payment: any;
  statements: D1PreparedStatement[];
} | null> {
  const code = mpesaReferenceFor(tx);
  if (!code) return null;

  const payment = await db.prepare(`
    SELECT *
    FROM mpesaCallbacks
    WHERE businessId = ?
      AND (
        UPPER(COALESCE(receiptNumber, '')) = ?
        OR UPPER(COALESCE(checkoutRequestId, '')) = ?
        OR UPPER(COALESCE(merchantRequestId, '')) = ?
      )
    ORDER BY CASE WHEN resultCode = 0 THEN 0 ELSE 1 END, timestamp DESC
    LIMIT 1
  `).bind(businessId, code, code, code).first<any>();

  if (!payment) throw new PolicyError('M-Pesa payment not found.', 404);
  if (asNumber(payment.resultCode, -1) !== 0) {
    throw new PolicyError(payment.resultDesc || 'M-Pesa payment is not paid.', 409);
  }
  if (payment.utilizedTransactionId && payment.utilizedTransactionId !== tx.id) {
    throw new PolicyError('This M-Pesa payment is already tied to another POS receipt.', 409);
  }

  const amount = mpesaAmountForTransaction(tx);
  if (amount > 0 && asNumber(payment.amount, 0) + 0.01 < amount) {
    throw new PolicyError('M-Pesa paid amount is below the receipt amount.', 409);
  }

  return {
    amount,
    payment,
    statements: [
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
    ],
  };
}

async function transactionInsert(db: D1Database, tx: any) {
  const validCols = await getTransactionColumns(db);
  const cols = Object.keys(tx).filter((k) => validCols.has(k));
  if (cols.length === 0) throw new PolicyError('No valid transaction columns to insert.', 400);
  const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return db.prepare(sql).bind(...cols.map((col) => serializeValue(tx[col])));
}

function auditInsert(db: D1Database, tx: any, businessId: string, principal: any) {
  const subtotal = asNumber(tx.subtotal, 0);
  const discount = asNumber(tx.discountAmount || tx.discount, 0);
  const severity = discount > subtotal * 0.1 ? 'WARN' : 'INFO';
  const details = discount > 0
    ? `Completed Ksh ${asNumber(tx.total, 0).toLocaleString()} sale with Ksh ${discount.toLocaleString()} discount.`
    : `Completed Ksh ${asNumber(tx.total, 0).toLocaleString()} sale.`;
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureCheckoutSchemaCached(env.DB);
    if (!await canPerformServerAction(env.DB, businessId, auth.principal, auth.service, 'sale.checkout')) {
      return json({ error: 'Checkout is locked for this staff role.' }, 403);
    }

    const transactionId = String(tx.id || crypto.randomUUID()).trim();
    tx.id = transactionId;
    const existing = await getExistingTransaction(env.DB, businessId, transactionId);
    if (existing) {
      return json({ success: true, transaction: existing, idempotent: true });
    }

    const idempotencyKey = String(body?.idempotencyKey || tx.id).trim() || transactionId;
    const idempotencyId = `${businessId}|${idempotencyKey}`;
    try {
      const existingByKey = await getIdempotentTransaction(env.DB, businessId, idempotencyId, idempotencyKey);
      if (existingByKey) return json({ success: true, transaction: existingByKey, idempotent: true });
    } catch (err: any) {
      const status = err instanceof PolicyError ? err.status : 409;
      return json({ error: err?.message || 'Checkout retry key is already used.' }, status);
    }

    let sideEffects: D1PreparedStatement[] = [];
    try {
      sideEffects = await hardenTransactionBatch({
        db: env.DB,
        businessId,
        principal: auth.principal,
        service: auth.service,
      }, [tx]);
    } catch (err: any) {
      const status = err instanceof PolicyError ? err.status : 400;
      return json({ error: err?.message || 'Checkout was rejected.' }, status);
    }

    tx.isSynced = 1;
    tx.businessId = businessId;

    let mpesaStatements: D1PreparedStatement[] = [];
    try {
      const mpesaVerification = await verifyMpesaPayment(env.DB, businessId, tx);
      if (mpesaVerification) {
        mpesaStatements = [...mpesaVerification.statements];
        if (mpesaVerification.amount > 0) {
          const posting = await createMainAccountCreditStatements(env.DB, {
            kind: 'MPESA_SALE',
            businessId,
            sourceId: tx.id,
            amount: mpesaVerification.amount,
            reference: mpesaVerification.payment.receiptNumber || mpesaVerification.payment.checkoutRequestId || tx.mpesaCode || tx.mpesaReference,
            customerName: tx.customerName,
            userId: auth.principal.userId || null,
            userName: auth.principal.userName || tx.cashierName || 'Cashier',
          });
          if (posting.anomaly) throw new PolicyError(posting.anomaly.message, 409);
          mpesaStatements.push(...posting.statements);
        }
      }
    } catch (err: any) {
      const status = err instanceof PolicyError ? err.status : 400;
      return json({ error: err?.message || 'M-Pesa payment could not be verified.' }, status);
    }

    const batch = [
      await transactionInsert(env.DB, tx),
      ...sideEffects,
      ...mpesaStatements,
      auditInsert(env.DB, tx, businessId, auth.principal),
      env.DB.prepare(`
        INSERT OR IGNORE INTO idempotencyKeys (id, businessId, idempotencyKey, operation, deviceId, cashierName, transactionId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        idempotencyId,
        businessId,
        idempotencyKey,
        'sales.checkout',
        null,
        auth.principal.userName || null,
        tx.id,
        Date.now(),
      ),
    ];

    await env.DB.batch(batch);

    return json({ success: true, transaction: tx });
  } catch (err: any) {
    console.error('[Checkout Error]', err);
    const message = String(err?.message || '');
    const stockRace = message.includes('Insufficient stock');
    return json({ error: stockRace ? 'Insufficient stock for one or more sale items.' : err?.message || 'Checkout failed.' }, stockRace ? 409 : 500);
  }
};
