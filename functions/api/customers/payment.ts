import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../_authUtils';
import { PolicyError } from '../_salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

type Allocation = {
  sourceType: 'SALE' | 'INVOICE';
  sourceId: string;
  amount: number;
};

const PAYMENT_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);
const PAYMENT_METHODS = new Set(['CASH', 'MPESA', 'BANK', 'PDQ', 'CHEQUE']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

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

function parseAllocations(value: unknown): Allocation[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string'
    ? (() => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : [];
  return raw
    .map((row: any) => {
      const sourceType = String(row?.sourceType || '').toUpperCase();
      const sourceId = trimText(row?.sourceId, 160);
      const amount = roundMoney(asNumber(row?.amount));
      if ((sourceType !== 'SALE' && sourceType !== 'INVOICE') || !sourceId || amount <= 0) return null;
      return { sourceType, sourceId, amount } as Allocation;
    })
    .filter(Boolean)
    .slice(0, 100) as Allocation[];
}

function parseMaybeJson(value: unknown) {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function creditAmountForSale(row: Record<string, any>) {
  const total = asNumber(row.total);
  const method = String(row.paymentMethod || '').toUpperCase();
  if (method === 'CREDIT') return total;

  const splitPayments = parseMaybeJson(row.splitPayments) as any;
  if (method === 'SPLIT' && String(splitPayments?.secondaryMethod || '').toUpperCase() === 'CREDIT') {
    return roundMoney(Math.min(Math.max(0, asNumber(splitPayments?.secondaryAmount)), total));
  }
  return 0;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS customerPayments (
      id TEXT PRIMARY KEY,
      customerId TEXT NOT NULL,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      transactionCode TEXT,
      reference TEXT,
      allocations TEXT,
      timestamp INTEGER NOT NULL,
      preparedBy TEXT,
      branchId TEXT,
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
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();

  for (const sql of [
    'ALTER TABLE customerPayments ADD COLUMN transactionCode TEXT',
    'ALTER TABLE customerPayments ADD COLUMN reference TEXT',
    'ALTER TABLE customerPayments ADD COLUMN allocations TEXT',
    'ALTER TABLE customerPayments ADD COLUMN preparedBy TEXT',
    'ALTER TABLE customerPayments ADD COLUMN branchId TEXT',
    'ALTER TABLE customerPayments ADD COLUMN businessId TEXT',
    'ALTER TABLE customerPayments ADD COLUMN updated_at INTEGER',
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
    if (!auth.service && !PAYMENT_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to record customer payments.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const payment = body?.payment || body || {};
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || payment.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || payment.branchId || '').trim();
    const customerId = String(payment.customerId || body?.customerId || '').trim();
    if (!businessId || !branchId || !customerId) return json({ error: 'Business, branch and customer are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);

    const customer = await env.DB.prepare(`
      SELECT id, name, balance, branchId
      FROM customers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(customerId, businessId).first<any>();
    if (!customer) throw new PolicyError('Customer was not found.', 404);
    if (customer.branchId && customer.branchId !== branchId) throw new PolicyError('Customer belongs to another branch.', 403);

    const paymentId = trimText(payment.id, 160) || crypto.randomUUID();
    const existingPayment = await env.DB.prepare(`
      SELECT id, customerId, amount
      FROM customerPayments
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(paymentId, businessId, branchId).first<any>();
    if (existingPayment) {
      if (existingPayment.customerId !== customerId) throw new PolicyError('Payment ID is already used for another customer.', 409);
      return json({
        success: true,
        paymentId,
        customerId,
        amount: roundMoney(asNumber(existingPayment.amount)),
        customerBalance: roundMoney(asNumber(customer.balance)),
        allocationCount: 0,
        idempotent: true,
      });
    }

    const amount = roundMoney(asNumber(payment.amount));
    if (amount <= 0) throw new PolicyError('Enter a valid payment amount.', 400);
    if (amount > asNumber(customer.balance) + 0.01) throw new PolicyError('Payment cannot exceed the customer balance.', 409);

    const method = String(payment.paymentMethod || payment.method || 'CASH').toUpperCase();
    const paymentMethod = PAYMENT_METHODS.has(method) ? method : 'CASH';
    const allocations = parseAllocations(payment.allocations);
    const allocationTotal = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
    if (allocationTotal > amount + 0.01) throw new PolicyError('Payment allocations exceed the payment amount.', 400);

    const requestedBySource = new Map<string, Allocation>();
    for (const allocation of allocations) {
      const key = `${allocation.sourceType}:${allocation.sourceId}`;
      const existing = requestedBySource.get(key);
      requestedBySource.set(key, {
        ...allocation,
        amount: roundMoney((existing?.amount || 0) + allocation.amount),
      });
    }

    const paidBySource = new Map<string, number>();
    if (requestedBySource.size > 0) {
      const { results } = await env.DB.prepare(`
        SELECT allocations
        FROM customerPayments
        WHERE customerId = ? AND businessId = ? AND branchId = ?
      `).bind(customerId, businessId, branchId).all();
      for (const row of (results || []) as any[]) {
        for (const allocation of parseAllocations(row.allocations)) {
          const key = `${allocation.sourceType}:${allocation.sourceId}`;
          paidBySource.set(key, roundMoney((paidBySource.get(key) || 0) + allocation.amount));
        }
      }
    }

    for (const allocation of requestedBySource.values()) {
      if (allocation.sourceType === 'INVOICE') {
        const invoice = await env.DB.prepare(`
          SELECT id, customerId, balance, status
          FROM salesInvoices
          WHERE id = ? AND businessId = ? AND branchId = ?
          LIMIT 1
        `).bind(allocation.sourceId, businessId, branchId).first<any>();
        if (!invoice || invoice.customerId !== customerId) throw new PolicyError('Payment allocation refers to an invoice that was not found.', 404);
        if (invoice.status === 'CANCELLED') throw new PolicyError('Cannot allocate payment to a cancelled invoice.', 409);
        if (allocation.amount > asNumber(invoice.balance) + 0.01) throw new PolicyError('Payment allocation exceeds an invoice balance.', 409);
        continue;
      }

      const sale = await env.DB.prepare(`
        SELECT id, customerId, total, paymentMethod, splitPayments, status
        FROM transactions
        WHERE id = ? AND businessId = ? AND branchId = ?
        LIMIT 1
      `).bind(allocation.sourceId, businessId, branchId).first<any>();
      if (!sale || sale.customerId !== customerId) throw new PolicyError('Payment allocation refers to a sale that was not found.', 404);
      if (sale.status === 'VOIDED' || sale.status === 'QUOTE') throw new PolicyError('Cannot allocate payment to a non-credit sale.', 409);
      const creditTotal = creditAmountForSale(sale);
      if (creditTotal <= 0) throw new PolicyError('Payment allocation refers to a sale without customer credit.', 409);
      const alreadyPaid = paidBySource.get(`SALE:${allocation.sourceId}`) || 0;
      if (allocation.amount > Math.max(0, creditTotal - alreadyPaid) + 0.01) {
        throw new PolicyError('Payment allocation exceeds a sale credit balance.', 409);
      }
    }

    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO customerPayments (id, customerId, amount, paymentMethod, transactionCode, reference, allocations, timestamp, preparedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        paymentId,
        customerId,
        amount,
        paymentMethod,
        trimText(payment.transactionCode || payment.referenceCode, 80) || null,
        trimText(payment.reference, 180) || `${paymentMethod} payment from ${customer.name}`,
        allocations.length ? JSON.stringify(allocations) : null,
        asNumber(payment.timestamp, now),
        trimText(payment.preparedBy || body?.preparedBy || auth.principal.userName, 120) || 'Staff',
        branchId,
        businessId,
        now,
      ),
      env.DB.prepare(`UPDATE customers SET balance = MAX(0, COALESCE(balance, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(amount, now, customerId, businessId),
    ];

    for (const allocation of allocations) {
      if (allocation.sourceType !== 'INVOICE') continue;
      statements.push(
        env.DB.prepare(`
          UPDATE salesInvoices
          SET paidAmount = MIN(COALESCE(total, 0), COALESCE(paidAmount, 0) + ?),
              balance = MAX(0, COALESCE(balance, total, 0) - ?),
              status = CASE WHEN MAX(0, COALESCE(balance, total, 0) - ?) <= 0 THEN 'PAID' ELSE 'PARTIAL' END,
              updated_at = ?
          WHERE id = ? AND customerId = ? AND businessId = ? AND branchId = ?
        `).bind(allocation.amount, allocation.amount, allocation.amount, now, allocation.sourceId, customerId, businessId, branchId)
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'customer.payment.record',
        'customerPayment',
        paymentId,
        'INFO',
        `Recorded Ksh ${amount.toLocaleString()} payment for ${customer.name}.`,
        businessId,
        branchId,
        now,
      )
    );

    await env.DB.batch(statements);

    return json({
      success: true,
      paymentId,
      customerId,
      amount,
      customerBalance: Math.max(0, roundMoney(asNumber(customer.balance) - amount)),
      allocationCount: allocations.length,
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not record customer payment.' }, status);
  }
};
