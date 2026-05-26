type MainAccountCreditKind = 'MPESA_SALE' | 'MPESA_CUSTOMER_PAYMENT';

export type MainAccountReconcileAnomaly = {
  source: 'transaction' | 'customerPayment';
  id: string;
  message: string;
};

export type MainAccountCreditResult = {
  adjustmentId: string;
  statements: D1PreparedStatement[];
  skipped: boolean;
  anomaly?: MainAccountReconcileAnomaly;
};

export type MainAccountCreditInput = {
  kind: MainAccountCreditKind;
  businessId: string;
  sourceId: string;
  amount: number;
  reference?: string | null;
  customerName?: string | null;
  userId?: string | null;
  userName?: string | null;
  timestamp?: number;
};

export const MAIN_ACCOUNT_NAME = 'Main account';
export const MAIN_ACCOUNT_NUMBER = 'PICKED-CASH';

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function parseMaybeJson(value: unknown) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normaliseCode(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim().toUpperCase();
}

export function mainAccountId(businessId: string) {
  return `picked_cash_${businessId}`.slice(0, 160);
}

export function mainAccountCreditId(kind: MainAccountCreditKind, businessId: string, sourceId: string) {
  const prefix = kind === 'MPESA_CUSTOMER_PAYMENT' ? 'mpesa_customer_payment' : 'mpesa_sale';
  return `${prefix}_${businessId}_${sourceId}`;
}

export function mpesaAmountForTransaction(tx: any) {
  const method = String(tx?.paymentMethod || '').toUpperCase();
  const splitPayments = parseMaybeJson(tx?.splitPayments) as any;
  if (method === 'MPESA') return roundMoney(asNumber(tx?.total, 0));
  if (method === 'SPLIT' && String(splitPayments?.secondaryMethod || '').toUpperCase() === 'MPESA') {
    return roundMoney(asNumber(splitPayments?.secondaryAmount, 0));
  }
  return 0;
}

function creditTitle(kind: MainAccountCreditKind) {
  return kind === 'MPESA_CUSTOMER_PAYMENT' ? 'M-Pesa customer payment' : 'M-Pesa sale';
}

function creditReason(input: MainAccountCreditInput) {
  const ref = trimText(input.reference, 80);
  const customer = trimText(input.customerName, 100);
  const title = creditTitle(input.kind);
  if (customer && ref) return `${title} from ${customer} (${ref})`;
  if (customer) return `${title} from ${customer}`;
  if (ref) return `${title} (${ref})`;
  return `${title} ${input.sourceId}`;
}

export async function ensureMainAccountSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccountAdjustments (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      amount REAL NOT NULL,
      direction TEXT NOT NULL,
      balanceBefore REAL NOT NULL,
      balanceAfter REAL NOT NULL,
      reason TEXT,
      userName TEXT,
      timestamp INTEGER NOT NULL,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
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
  for (const sql of [
    'ALTER TABLE financialAccounts ADD COLUMN accountNumber TEXT',
    'ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE financialAccountAdjustments ADD COLUMN updated_at INTEGER',
    'ALTER TABLE auditLogs ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export async function ensureMainAccount(db: D1Database, businessId: string) {
  await ensureMainAccountSchema(db);
  const id = mainAccountId(businessId);
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
    VALUES (?, ?, 'CASH', 0, ?, ?, ?)
  `).bind(id, MAIN_ACCOUNT_NAME, businessId || null, MAIN_ACCOUNT_NUMBER, now).run();
  await db.prepare(`
    UPDATE financialAccounts
    SET name = ?, type = 'CASH', accountNumber = ?, updated_at = ?
    WHERE id = ? AND businessId = ?
  `).bind(MAIN_ACCOUNT_NAME, MAIN_ACCOUNT_NUMBER, now, id, businessId).run();
  return db.prepare(`
    SELECT id, name, type, accountNumber, balance, businessId, updated_at
    FROM financialAccounts
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(id, businessId).first<any>();
}

export async function createMainAccountCreditStatements(
  db: D1Database,
  input: MainAccountCreditInput,
): Promise<MainAccountCreditResult> {
  const amount = roundMoney(Math.max(0, asNumber(input.amount)));
  const adjustmentId = mainAccountCreditId(input.kind, input.businessId, input.sourceId);
  if (amount <= 0) return { adjustmentId, statements: [], skipped: true };

  const existing = await db.prepare(`
    SELECT id, amount
    FROM financialAccountAdjustments
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(adjustmentId, input.businessId).first<any>().catch(() => null);
  if (existing) {
    const existingAmount = roundMoney(asNumber(existing.amount));
    if (Math.abs(existingAmount - amount) > 0.01) {
      return {
        adjustmentId,
        statements: [],
        skipped: true,
        anomaly: {
          source: input.kind === 'MPESA_CUSTOMER_PAYMENT' ? 'customerPayment' : 'transaction',
          id: input.sourceId,
          message: `Existing Main account posting is Ksh ${existingAmount.toLocaleString()} but expected Ksh ${amount.toLocaleString()}.`,
        },
      };
    }
    return { adjustmentId, statements: [], skipped: true };
  }

  const account = await ensureMainAccount(db, input.businessId);
  const now = input.timestamp || Date.now();
  const reason = creditReason(input).slice(0, 240);
  const userName = trimText(input.userName || 'System', 120);
  const auditAction = input.kind === 'MPESA_CUSTOMER_PAYMENT'
    ? 'finance.main_account.mpesa_customer_payment'
    : 'finance.main_account.mpesa_sale';
  const auditEntity = input.kind === 'MPESA_CUSTOMER_PAYMENT' ? 'customerPayment' : 'transaction';
  const details = `${creditTitle(input.kind)} credited Main account by Ksh ${amount.toLocaleString()}. ${reason}`;

  const insertAdjustment = db.prepare(`
    INSERT OR IGNORE INTO financialAccountAdjustments (
      id, accountId, amount, direction, balanceBefore, balanceAfter,
      reason, userName, timestamp, businessId, updated_at
    )
    SELECT ?, id, ?, 'IN', COALESCE(balance, 0), ROUND(COALESCE(balance, 0) + ?, 2),
           ?, ?, ?, ?, ?
    FROM financialAccounts
    WHERE id = ? AND businessId = ?
      AND NOT EXISTS (
        SELECT 1 FROM financialAccountAdjustments
        WHERE id = ? AND businessId = ?
      )
  `).bind(
    adjustmentId,
    amount,
    amount,
    reason,
    userName,
    now,
    input.businessId,
    now,
    account.id,
    input.businessId,
    adjustmentId,
    input.businessId,
  );

  const updateAccount = db.prepare(`
    UPDATE financialAccounts
    SET balance = (
          SELECT balanceAfter
          FROM financialAccountAdjustments
          WHERE id = ? AND businessId = ? AND updated_at = ?
        ),
        updated_at = ?
    WHERE id = ? AND businessId = ?
      AND EXISTS (
        SELECT 1 FROM financialAccountAdjustments
        WHERE id = ? AND businessId = ? AND updated_at = ?
      )
  `).bind(
    adjustmentId,
    input.businessId,
    now,
    now,
    account.id,
    input.businessId,
    adjustmentId,
    input.businessId,
    now,
  );

  const audit = db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'INFO', ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM financialAccountAdjustments
      WHERE id = ? AND businessId = ? AND updated_at = ?
    )
  `).bind(
    crypto.randomUUID(),
    now,
    input.userId || null,
    userName,
    auditAction,
    auditEntity,
    input.sourceId,
    details,
    input.businessId,
    now,
    adjustmentId,
    input.businessId,
    now,
  );

  return { adjustmentId, statements: [insertAdjustment, updateAccount, audit], skipped: false };
}

async function ensureReconcileSchemas(db: D1Database) {
  await ensureMainAccountSchema(db);
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
    'ALTER TABLE transactions ADD COLUMN mpesaReference TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCode TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT',
    'ALTER TABLE transactions ADD COLUMN splitPayments TEXT',
    'ALTER TABLE transactions ADD COLUMN customerName TEXT',
    'ALTER TABLE customerPayments ADD COLUMN transactionCode TEXT',
    'ALTER TABLE customerPayments ADD COLUMN reference TEXT',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, receiptNumber)',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, utilizedTransactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function findMpesaCallbackForSale(db: D1Database, businessId: string, tx: any) {
  const codes = Array.from(new Set([
    normaliseCode(tx?.mpesaCode),
    normaliseCode(tx?.mpesaReference),
    normaliseCode(tx?.mpesaCheckoutRequestId),
  ].filter(Boolean)));

  const codeClauses = codes.length
    ? ` OR UPPER(COALESCE(receiptNumber, '')) IN (${codes.map(() => '?').join(',')})
        OR UPPER(COALESCE(checkoutRequestId, '')) IN (${codes.map(() => '?').join(',')})
        OR UPPER(COALESCE(merchantRequestId, '')) IN (${codes.map(() => '?').join(',')})`
    : '';
  return db.prepare(`
    SELECT *
    FROM mpesaCallbacks
    WHERE businessId = ?
      AND (
        utilizedTransactionId = ?
        ${codeClauses}
      )
    ORDER BY CASE WHEN resultCode = 0 THEN 0 ELSE 1 END, timestamp DESC
    LIMIT 1
  `).bind(businessId, tx.id, ...codes, ...codes, ...codes).first<any>();
}

async function findMpesaCallbackForCustomerPayment(db: D1Database, businessId: string, payment: any) {
  const marker = `customer_payment:${payment.id}`;
  const code = normaliseCode(payment.transactionCode || payment.reference);
  return db.prepare(`
    SELECT *
    FROM mpesaCallbacks
    WHERE businessId = ?
      AND (
        utilizedTransactionId = ?
        OR UPPER(COALESCE(receiptNumber, '')) = ?
        OR UPPER(COALESCE(checkoutRequestId, '')) = ?
        OR UPPER(COALESCE(merchantRequestId, '')) = ?
      )
    ORDER BY CASE WHEN resultCode = 0 THEN 0 ELSE 1 END, timestamp DESC
    LIMIT 1
  `).bind(businessId, marker, code, code, code).first<any>();
}

export async function reconcileMpesaMainAccount(
  db: D1Database,
  businessId: string,
  principal: { userId?: string | null; userName?: string | null } = {},
) {
  await ensureReconcileSchemas(db);
  await ensureMainAccount(db, businessId);

  let posted = 0;
  let skipped = 0;
  const anomalies: MainAccountReconcileAnomaly[] = [];

  const txRows = await db.prepare(`
    SELECT id, total, paymentMethod, splitPayments, mpesaCode, mpesaReference, mpesaCheckoutRequestId, customerName, timestamp, status
    FROM transactions
    WHERE businessId = ?
      AND UPPER(COALESCE(status, 'PAID')) NOT IN ('VOIDED', 'QUOTE')
      AND UPPER(COALESCE(paymentMethod, '')) IN ('MPESA', 'SPLIT')
  `).bind(businessId).all<any>().catch(() => ({ results: [] }));

  for (const tx of (txRows.results || []) as any[]) {
    const amount = mpesaAmountForTransaction(tx);
    if (amount <= 0) continue;
    const payment = await findMpesaCallbackForSale(db, businessId, tx);
    if (!payment) {
      anomalies.push({ source: 'transaction', id: tx.id, message: 'No confirmed M-Pesa callback was found for this sale.' });
      continue;
    }
    if (asNumber(payment.resultCode, -1) !== 0) {
      anomalies.push({ source: 'transaction', id: tx.id, message: payment.resultDesc || 'M-Pesa callback is not paid.' });
      continue;
    }
    if (payment.utilizedTransactionId && payment.utilizedTransactionId !== tx.id) {
      anomalies.push({ source: 'transaction', id: tx.id, message: `M-Pesa callback is linked to ${payment.utilizedTransactionId}.` });
      continue;
    }
    if (asNumber(payment.amount) + 0.01 < amount) {
      anomalies.push({ source: 'transaction', id: tx.id, message: `M-Pesa paid Ksh ${asNumber(payment.amount).toLocaleString()} but sale needs Ksh ${amount.toLocaleString()}.` });
      continue;
    }

    const result = await createMainAccountCreditStatements(db, {
      kind: 'MPESA_SALE',
      businessId,
      sourceId: tx.id,
      amount,
      reference: payment.receiptNumber || payment.checkoutRequestId || tx.mpesaCode || tx.mpesaReference,
      customerName: tx.customerName,
      userId: principal.userId,
      userName: principal.userName || 'Reconciliation',
    });
    if (result.anomaly) {
      anomalies.push(result.anomaly);
      continue;
    }
    if (result.statements.length) {
      await db.batch(result.statements);
      posted += 1;
    } else {
      skipped += 1;
    }
  }

  const customerPaymentRows = await db.prepare(`
    SELECT id, customerId, amount, paymentMethod, transactionCode, reference, timestamp, preparedBy
    FROM customerPayments
    WHERE businessId = ?
      AND UPPER(COALESCE(paymentMethod, '')) = 'MPESA'
  `).bind(businessId).all<any>().catch(() => ({ results: [] }));

  for (const paymentRow of (customerPaymentRows.results || []) as any[]) {
    const amount = roundMoney(asNumber(paymentRow.amount));
    if (amount <= 0) continue;
    const payment = await findMpesaCallbackForCustomerPayment(db, businessId, paymentRow);
    const marker = `customer_payment:${paymentRow.id}`;
    if (!payment) {
      anomalies.push({ source: 'customerPayment', id: paymentRow.id, message: 'No confirmed M-Pesa callback was found for this customer payment.' });
      continue;
    }
    if (asNumber(payment.resultCode, -1) !== 0) {
      anomalies.push({ source: 'customerPayment', id: paymentRow.id, message: payment.resultDesc || 'M-Pesa callback is not paid.' });
      continue;
    }
    if (payment.utilizedTransactionId && payment.utilizedTransactionId !== marker) {
      anomalies.push({ source: 'customerPayment', id: paymentRow.id, message: `M-Pesa callback is linked to ${payment.utilizedTransactionId}.` });
      continue;
    }
    if (Math.abs(asNumber(payment.amount) - amount) > 0.01) {
      anomalies.push({ source: 'customerPayment', id: paymentRow.id, message: `M-Pesa paid Ksh ${asNumber(payment.amount).toLocaleString()} but customer payment is Ksh ${amount.toLocaleString()}.` });
      continue;
    }

    const result = await createMainAccountCreditStatements(db, {
      kind: 'MPESA_CUSTOMER_PAYMENT',
      businessId,
      sourceId: paymentRow.id,
      amount,
      reference: payment.receiptNumber || payment.checkoutRequestId || paymentRow.transactionCode || paymentRow.reference,
      customerName: payment.utilizedCustomerName,
      userId: principal.userId,
      userName: principal.userName || 'Reconciliation',
    });
    if (result.anomaly) {
      anomalies.push(result.anomaly);
      continue;
    }
    if (result.statements.length) {
      await db.batch(result.statements);
      posted += 1;
    } else {
      skipped += 1;
    }
  }

  const account = await ensureMainAccount(db, businessId);
  return { posted, skipped, anomalies, account };
}
