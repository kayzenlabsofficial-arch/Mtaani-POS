import type { Principal } from '../authUtils';
import { DEFAULT_SHOP_ID, ensureInventoryIntegritySchema } from '../inventoryIntegrity';
import { PolicyError } from '../salesSecurity';
import { canPerformServerAction } from '../settingsPolicy';

type RefundLine = { productId: string; quantity: number };

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000000) / 1000000;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function deserializeRow(row: Record<string, any>): Record<string, any> {
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

export async function ensureRefundSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      total REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      discountAmount REAL,
      discountReason TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      paymentMethod TEXT,
      amountTendered REAL,
      changeGiven REAL,
      mpesaReference TEXT,
      mpesaCode TEXT,
      mpesaCustomer TEXT,
      mpesaCheckoutRequestId TEXT,
      cashierId TEXT,
      cashierName TEXT,
      customerId TEXT,
      customerName TEXT,
      discount REAL,
      discountType TEXT,
      splitPayments TEXT,
      splitData TEXT,
      isSynced INTEGER,
      approvedBy TEXT,
      pendingRefundItems TEXT,
      shiftId TEXT,
      shopId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      sellingPrice REAL NOT NULL DEFAULT 0,
      costPrice REAL,
      taxCategory TEXT NOT NULL DEFAULT 'A',
      stockQuantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      barcode TEXT NOT NULL DEFAULT '',
      imageUrl TEXT,
      reorderPoint REAL,
      expiryTracking INTEGER DEFAULT 0,
      expiryDate INTEGER,
      isBundle INTEGER DEFAULT 0,
      components TEXT,
      shopId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS productIngredients (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      ingredientProductId TEXT NOT NULL,
      quantity REAL NOT NULL,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
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
    CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY,
      refundNumber TEXT,
      originalTransactionId TEXT NOT NULL,
      receiptNumber TEXT,
      amount REAL NOT NULL,
      cashAmount REAL DEFAULT 0,
      paymentMethod TEXT,
      source TEXT,
      items TEXT,
      timestamp INTEGER NOT NULL,
      cashierName TEXT,
      approvedBy TEXT,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      shiftId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      startTime INTEGER NOT NULL,
      endTime INTEGER,
      cashierId TEXT,
      cashierName TEXT NOT NULL,
      tillId TEXT,
      tillName TEXT,
      openingCash REAL DEFAULT 0,
      closingCash REAL,
      expectedCash REAL,
      cashVariance REAL,
      closeBreakdown TEXT,
      status TEXT NOT NULL,
      lastSyncAt INTEGER,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
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
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      businessId TEXT,
      shiftId TEXT,
      shopId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    'ALTER TABLE transactions ADD COLUMN approvedBy TEXT',
    'ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT',
    'ALTER TABLE transactions ADD COLUMN businessId TEXT',
    'ALTER TABLE transactions ADD COLUMN shiftId TEXT',
    'ALTER TABLE transactions ADD COLUMN shopId TEXT',
    'ALTER TABLE transactions ADD COLUMN updated_at INTEGER',
    'ALTER TABLE products ADD COLUMN businessId TEXT',
    'ALTER TABLE products ADD COLUMN expiryTracking INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN expiryDate INTEGER',
    'ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN components TEXT',
    'ALTER TABLE products ADD COLUMN shopId TEXT',
    'ALTER TABLE products ADD COLUMN updated_at INTEGER',
    'ALTER TABLE productIngredients ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN reference TEXT',
    'ALTER TABLE stockMovements ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shiftId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shopId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER',
    'ALTER TABLE financialAccounts ADD COLUMN accountNumber TEXT',
    'ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE refunds ADD COLUMN refundNumber TEXT',
    'ALTER TABLE refunds ADD COLUMN cashAmount REAL DEFAULT 0',
    'ALTER TABLE refunds ADD COLUMN receiptNumber TEXT',
    'ALTER TABLE refunds ADD COLUMN paymentMethod TEXT',
    'ALTER TABLE refunds ADD COLUMN source TEXT',
    'ALTER TABLE refunds ADD COLUMN items TEXT',
    'ALTER TABLE refunds ADD COLUMN cashierName TEXT',
    'ALTER TABLE refunds ADD COLUMN approvedBy TEXT',
    "ALTER TABLE refunds ADD COLUMN status TEXT DEFAULT 'APPROVED'",
    'ALTER TABLE refunds ADD COLUMN shiftId TEXT',
    'ALTER TABLE refunds ADD COLUMN businessId TEXT',
    'ALTER TABLE refunds ADD COLUMN updated_at INTEGER',
    'ALTER TABLE shifts ADD COLUMN cashierId TEXT',
    'ALTER TABLE shifts ADD COLUMN tillId TEXT',
    'ALTER TABLE shifts ADD COLUMN tillName TEXT',
    'ALTER TABLE shifts ADD COLUMN openingCash REAL DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN closingCash REAL',
    'ALTER TABLE shifts ADD COLUMN expectedCash REAL',
    'ALTER TABLE shifts ADD COLUMN cashVariance REAL',
    'ALTER TABLE shifts ADD COLUMN closeBreakdown TEXT',
    'ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER',
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE idempotencyKeys ADD COLUMN transactionId TEXT',
    'CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, idempotencyKey)',
    'CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, transactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
  await ensureInventoryIntegritySchema(db);
}

async function loadTransaction(db: D1Database, businessId: string, transactionId: string) {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(transactionId, businessId).first<any>();
  if (!row) throw new PolicyError('Receipt was not found.', 404);
  return deserializeRow(row);
}

function refundLinesFor(transaction: any, itemsToReturn?: RefundLine[]): RefundLine[] {
  const txItems = asArray(transaction.items);
  const sourceLines = itemsToReturn?.length
    ? itemsToReturn
    : asArray(transaction.pendingRefundItems).length
      ? asArray(transaction.pendingRefundItems)
      : txItems.map(item => ({
          productId: item.productId,
          quantity: Math.max(0, asNumber(item.quantity) - asNumber(item.returnedQuantity)),
        }));

  const lines = sourceLines
    .map(line => ({
      productId: trimText(line.productId, 120),
      quantity: Math.max(0, asNumber(line.quantity)),
    }))
    .filter(line => line.productId && line.quantity > 0);

  for (const line of lines) {
    const item = txItems.find(row => row.productId === line.productId);
    if (!item) throw new PolicyError('Refund includes an item that is not on the receipt.', 400);
    const remaining = Math.max(0, asNumber(item.quantity) - asNumber(item.returnedQuantity));
    if (line.quantity > remaining + 0.0001) throw new PolicyError('Refund quantity exceeds the remaining receipt quantity.', 409);
  }

  return lines;
}

export function refundAmountFor(transaction: any, lines: RefundLine[]) {
  const txItems = asArray(transaction.items);
  const grossRefundAmount = roundMoney(lines.reduce((sum, line) => {
    const item = txItems.find(row => row.productId === line.productId);
    return sum + (Math.max(0, asNumber(item?.snapshotPrice)) * line.quantity);
  }, 0));
  if (grossRefundAmount <= 0) return 0;

  const directLineNetAmount = roundMoney(lines.reduce((sum, line) => {
    const item = txItems.find(row => row.productId === line.productId);
    const unitAmount = Math.max(0, asNumber(item?.snapshotPrice) - asNumber(item?.discountAmount));
    return sum + (unitAmount * line.quantity);
  }, 0));
  const originalGross = originalGrossSubtotal(transaction);
  const originalNet = originalNetTotal(transaction);
  const itemDiscountTotal = transactionItemDiscountTotal(transaction);
  const expectedDiscount = transactionExpectedDiscount(transaction);
  const itemDiscountsCoverTransactionDiscount = itemDiscountTotal > 0 && itemDiscountTotal >= expectedDiscount - 0.01;
  const proportionalNet = originalGross > 0
    ? roundMoney(originalNet * Math.min(1, grossRefundAmount / originalGross))
    : directLineNetAmount;
  const amount = itemDiscountsCoverTransactionDiscount ? directLineNetAmount : proportionalNet;
  return roundMoney(Math.min(originalNet, Math.max(0, amount)));
}

function lineGrossAmount(item: any, quantity = asNumber(item?.quantity)) {
  return roundMoney(Math.max(0, asNumber(item?.snapshotPrice)) * Math.max(0, quantity));
}

function lineDiscountAmount(item: any, quantity = asNumber(item?.quantity)) {
  const unitDiscount = Math.min(Math.max(0, asNumber(item?.snapshotPrice)), Math.max(0, asNumber(item?.discountAmount)));
  return roundMoney(unitDiscount * Math.max(0, quantity));
}

function originalGrossSubtotal(transaction: any) {
  const itemGross = roundMoney(asArray(transaction.items).reduce((sum, item) => sum + lineGrossAmount(item), 0));
  return itemGross > 0 ? itemGross : roundMoney(Math.max(0, asNumber(transaction?.subtotal ?? transaction?.total)));
}

function transactionItemDiscountTotal(transaction: any) {
  return roundMoney(asArray(transaction.items).reduce((sum, item) => sum + lineDiscountAmount(item), 0));
}

function transactionExpectedDiscount(transaction: any) {
  const storedDiscount = Math.max(0, asNumber(transaction?.discountAmount ?? transaction?.discount));
  const itemDiscount = transactionItemDiscountTotal(transaction);
  return roundMoney(Math.max(storedDiscount, itemDiscount));
}

export function originalNetTotal(transaction: any) {
  const subtotal = Math.max(0, asNumber(transaction?.subtotal));
  const discount = transactionExpectedDiscount(transaction);
  if (subtotal > 0 && discount > 0) return roundMoney(Math.max(0, subtotal - discount));
  const itemNet = roundMoney(asArray(transaction.items).reduce((sum, item) => {
    return sum + Math.max(0, lineGrossAmount(item) - lineDiscountAmount(item));
  }, 0));
  if (itemNet > 0) return itemNet;
  return roundMoney(Math.max(0, asNumber(transaction?.total)));
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function splitDetails(record: any) {
  return parseMaybeJson(record?.splitPayments) || parseMaybeJson(record?.splitData)?.splitPayments || parseMaybeJson(record?.splitData) || null;
}

function transactionNetTotal(record: any) {
  const subtotal = asNumber(record?.subtotal);
  const discount = Math.max(0, asNumber(record?.discountAmount ?? record?.discount));
  if (subtotal > 0 && discount > 0) return Math.max(0, roundMoney(subtotal - discount));
  return asNumber(record?.total);
}

function paymentAmount(record: any, method: 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT') {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === method) return transactionNetTotal(record);
  if (paymentMethod !== 'SPLIT') return 0;
  const split = splitDetails(record);
  if (method === 'CASH') return asNumber(split?.cashAmount);
  return String(split?.secondaryMethod || '').toUpperCase() === method ? asNumber(split?.secondaryAmount) : 0;
}

function recordInShift(record: any, since: number, until: number, shiftId?: string | null) {
  if (shiftId && record?.shiftId) return String(record.shiftId) === String(shiftId);
  const ts = asNumber(record?.timestamp || record?.issueDate);
  return ts >= since && ts <= until;
}

function cashRefundAmount(record: any) {
  if (String(record?.status || 'APPROVED').toUpperCase() === 'REJECTED') return 0;
  const source = String(record?.source || '').toUpperCase();
  if (source === 'TILL' || source === 'MIXED') return asNumber(record?.cashAmount ?? record?.amount);
  return asNumber(record?.cashAmount);
}

async function safeRows(db: D1Database, sql: string, binds: unknown[] = []) {
  const result = await db.prepare(sql).bind(...binds).all<any>().catch(() => ({ results: [] }));
  return (result.results || []) as any[];
}

async function requireOpenRefundShift(db: D1Database, businessId: string, shiftId?: string | null) {
  const cleanShiftId = trimText(shiftId, 180);
  if (!cleanShiftId) throw new PolicyError('Open a till shift before approving a cash refund.', 409);
  const shift = await db.prepare(`
    SELECT id, startTime, openingCash, status
    FROM shifts
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(cleanShiftId, businessId).first<any>();
  if (!shift) throw new PolicyError('The selected till shift was not found.', 404);
  if (String(shift.status || '').toUpperCase() !== 'OPEN') throw new PolicyError('Only an open till shift can approve a cash refund.', 409);
  return shift;
}

async function availableTillCashForShift(db: D1Database, businessId: string, shift: any, until: number): Promise<number> {
  const shiftId = trimText(shift?.id, 180);
  const since = asNumber(shift?.startTime);
  const openingCash = asNumber(shift?.openingCash);
  if (!shiftId || since <= 0) return 0;

  const [
    transactions,
    expenses,
    picks,
    refunds,
    supplierPayments,
    customerPayments,
  ] = await Promise.all([
    safeRows(db, `SELECT total, subtotal, discountAmount, discount, timestamp, status, paymentMethod, splitPayments, splitData, shiftId FROM transactions WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, status, source, shiftId FROM expenses WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, status, shiftId FROM cashPicks WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, cashAmount, timestamp, status, source, shiftId FROM refunds WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, source, shiftId FROM supplierPayments WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, paymentMethod, shiftId FROM customerPayments WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
  ]);

  const txRows = transactions.filter(row => recordInShift(row, since, until, shiftId) && !['VOIDED', 'QUOTE'].includes(String(row.status || '').toUpperCase()));
  const expenseRows = expenses.filter(row => recordInShift(row, since, until, shiftId) && String(row.source || 'TILL').toUpperCase() === 'TILL' && String(row.status || 'APPROVED').toUpperCase() === 'APPROVED');
  const pickRows = picks.filter(row => recordInShift(row, since, until, shiftId) && String(row.status || 'APPROVED').toUpperCase() === 'APPROVED');
  const refundRows = refunds.filter(row => recordInShift(row, since, until, shiftId) && String(row.status || 'APPROVED').toUpperCase() === 'APPROVED');
  const supplierRows = supplierPayments.filter(row => recordInShift(row, since, until, shiftId) && String(row.source || '').toUpperCase() === 'TILL');
  const customerRows = customerPayments.filter(row => recordInShift(row, since, until, shiftId) && String(row.paymentMethod || '').toUpperCase() === 'CASH');

  const cashSales = txRows.reduce((sum, row) => sum + paymentAmount(row, 'CASH'), 0);
  const customerCashPayments = customerRows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const tillExpenses = expenseRows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const picked = pickRows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const cashRefunds = refundRows.reduce((sum, row) => sum + cashRefundAmount(row), 0);
  const supplierTillPayments = supplierRows.reduce((sum, row) => sum + asNumber(row.amount), 0);

  return Math.max(0, roundMoney(openingCash + cashSales + customerCashPayments - tillExpenses - picked - supplierTillPayments - cashRefunds));
}

function makeRefundNumber(now: number) {
  const day = new Date(now).toISOString().slice(2, 10).replace(/-/g, '');
  return `REF-${day}-${String(now).slice(-5)}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
}

function refundDocumentItems(transaction: any, lines: RefundLine[], refundAmount: number) {
  const txItems = asArray(transaction.items);
  const expectedDiscount = transactionExpectedDiscount(transaction);
  const itemDiscountTotal = transactionItemDiscountTotal(transaction);
  const itemDiscountsCoverTransactionDiscount = itemDiscountTotal > 0 && itemDiscountTotal >= expectedDiscount - 0.01;
  const grossRefundTotal = roundMoney(lines.reduce((sum, line) => {
    const item = txItems.find(row => row.productId === line.productId) || {};
    return sum + lineGrossAmount(item, line.quantity);
  }, 0));
  const rows = lines.map(line => {
    const item = txItems.find(row => row.productId === line.productId) || {};
    const unitAmount = Math.max(0, asNumber(item.snapshotPrice) - asNumber(item.discountAmount));
    const grossAmount = lineGrossAmount(item, line.quantity);
    return {
      productId: line.productId,
      name: trimText(item.name || line.productId, 160),
      quantity: line.quantity,
      amount: itemDiscountsCoverTransactionDiscount
        ? roundMoney(unitAmount * line.quantity)
        : grossRefundTotal > 0
          ? roundMoney(refundAmount * (grossAmount / grossRefundTotal))
          : roundMoney(unitAmount * line.quantity),
    };
  });
  const allocated = rows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const drift = roundMoney(refundAmount - allocated);
  if (rows.length > 0 && Math.abs(drift) >= 0.01) {
    rows[rows.length - 1].amount = roundMoney(asNumber(rows[rows.length - 1].amount) + drift);
  }
  return rows;
}

function normalizeRefundLines(lines: RefundLine[]): RefundLine[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const productId = trimText(line.productId, 120);
    const quantity = Math.max(0, asNumber(line.quantity));
    if (!productId || quantity <= 0) continue;
    merged.set(productId, roundQuantity((merged.get(productId) || 0) + quantity));
  }
  return Array.from(merged.entries())
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function refundLineKey(lines: RefundLine[]) {
  return normalizeRefundLines(lines)
    .map(line => `${line.productId}:${line.quantity}`)
    .join('|');
}

function sameRefundLines(left: RefundLine[], right: RefundLine[]) {
  return refundLineKey(left) === refundLineKey(right);
}

async function loadIdempotentRefundTransaction(
  db: D1Database,
  businessId: string,
  idempotencyKey?: string,
) {
  const cleanKey = trimText(idempotencyKey, 240);
  if (!cleanKey) return null;
  const rowId = `${businessId}|${cleanKey}`;
  const row = await db.prepare(`
    SELECT operation, transactionId
    FROM idempotencyKeys
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(rowId, businessId).first<any>();
  if (!row) return null;
  if (row.operation !== 'sales.refund.approve') {
    throw new PolicyError('Refund retry key is already used for another operation.', 409);
  }
  const transactionId = trimText(row.transactionId, 120);
  if (!transactionId) throw new PolicyError('Refund retry key is already used.', 409);
  return loadTransaction(db, businessId, transactionId);
}

function idempotencyStatement(db: D1Database, args: {
  businessId: string;
  transactionId: string;
  idempotencyKey?: string;
  cashierName?: string | null;
}) {
  const cleanKey = trimText(args.idempotencyKey, 240);
  if (!cleanKey) return null;
  const rowId = `${args.businessId}|${cleanKey}`;
  return db.prepare(`
    INSERT INTO idempotencyKeys (id, businessId, idempotencyKey, operation, deviceId, cashierName, transactionId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    rowId,
    args.businessId,
    cleanKey,
    'sales.refund.approve',
    null,
    args.cashierName || null,
    args.transactionId,
    Date.now(),
  );
}

function isBundle(product: any) {
  return product?.isBundle === 1 || product?.isBundle === true || product?.isBundle === '1';
}

async function productById(db: D1Database, businessId: string, productId: string) {
  const row = await db.prepare(`
    SELECT id, name, stockQuantity, isBundle, components
    FROM products
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(productId, businessId).first<any>();
  return row ? deserializeRow(row) : null;
}

function componentsFromProduct(product: any): RefundLine[] {
  return asArray(product.components)
    .map(component => ({
      productId: trimText(component?.productId || component?.ingredientProductId, 120),
      quantity: asNumber(component?.quantity),
    }))
    .filter(component => component.productId && component.quantity > 0);
}

async function loadBundleComponents(db: D1Database, businessId: string, product: any): Promise<RefundLine[]> {
  const { results } = await db.prepare(`
    SELECT ingredientProductId, quantity
    FROM productIngredients
    WHERE businessId = ? AND productId = ?
  `).bind(businessId, product.id).all();
  const rows = ((results || []) as any[])
    .map(row => ({
      productId: trimText(row.ingredientProductId, 120),
      quantity: asNumber(row.quantity),
    }))
    .filter(row => row.productId && row.quantity > 0);
  return rows.length ? rows : componentsFromProduct(product);
}

function auditStatement(db: D1Database, args: {
  principal: Principal;
  businessId: string;
  transactionId: string;
  action: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  details: string;
}) {
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    args.principal.userId || null,
    args.principal.userName || null,
    args.action,
    'transaction',
    args.transactionId,
    args.severity,
    args.details,
    args.businessId,
    now,
  );
}

export async function prepareRefundRequest(db: D1Database, args: {
  businessId: string;
  principal: Principal;
  service?: boolean;
  transactionId: string;
  itemsToReturn?: RefundLine[];
}) {
  if (!await canPerformServerAction(db, args.businessId, args.principal, !!args.service, 'sale.refund.request')) {
    throw new PolicyError('Refund requests are locked for this staff role.', 403);
  }
  const tx = await loadTransaction(db, args.businessId, args.transactionId);
  if (tx.status === 'PENDING_REFUND') {
    const pendingLines = normalizeRefundLines(asArray(tx.pendingRefundItems));
    const requestedLines = args.itemsToReturn?.length
      ? refundLinesFor(tx, args.itemsToReturn)
      : pendingLines;
    if (pendingLines.length > 0 && sameRefundLines(pendingLines, requestedLines)) {
      tx.pendingRefundItems = pendingLines;
      return { transaction: tx, statements: [], idempotent: true };
    }
    throw new PolicyError('A different refund request is already pending for this receipt.', 409);
  }
  if (tx.status !== 'PAID' && tx.status !== 'PARTIAL_REFUND') {
    throw new PolicyError('Only paid receipts can be refunded.', 409);
  }
  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError('No refundable items selected.', 400);
  const now = Date.now();
  tx.status = 'PENDING_REFUND';
  tx.pendingRefundItems = lines;
  tx.updated_at = now;

  const statements = [
    db.prepare(`
      UPDATE transactions
      SET status = 'PENDING_REFUND', pendingRefundItems = ?, updated_at = ?
      WHERE id = ? AND businessId = ?
    `).bind(JSON.stringify(lines), now, tx.id, args.businessId),
    auditStatement(db, {
      principal: args.principal,
      businessId: args.businessId,
      transactionId: tx.id,
      action: 'sale.refund.request',
      severity: 'WARN',
      details: `Refund request submitted for Ksh ${refundAmountFor(tx, lines).toLocaleString()}.`,
    }),
  ];
  return { transaction: tx, statements, idempotent: false };
}

export async function prepareRefundApproval(db: D1Database, args: {
  businessId: string;
  principal: Principal;
  service: boolean;
  transactionId: string;
  itemsToReturn?: RefundLine[];
  approvedBy?: string;
  idempotencyKey?: string;
  shiftId?: string;
}) {
  if (!args.service && !APPROVER_ROLES.has(args.principal.role)) {
    throw new PolicyError('You are not allowed to approve refunds.', 403);
  }

  if (!trimText(args.idempotencyKey, 240)) {
    throw new PolicyError('Refund approval retry key is required.', 400);
  }

  const idempotentTransaction = await loadIdempotentRefundTransaction(
    db,
    args.businessId,
    args.idempotencyKey,
  );
  if (idempotentTransaction) {
    return { transaction: idempotentTransaction, refund: null, statements: [], idempotent: true };
  }

  const tx = await loadTransaction(db, args.businessId, args.transactionId);
  if (tx.status !== 'PENDING_REFUND' && tx.status !== 'PAID' && tx.status !== 'PARTIAL_REFUND') {
    throw new PolicyError('This receipt is not waiting for refund approval.', 409);
  }
  if (tx.status !== 'PENDING_REFUND' && !args.itemsToReturn?.length) {
    throw new PolicyError('Select the items to refund.', 400);
  }

  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError('No refundable items selected.', 400);
  const refundAmount = refundAmountFor(tx, lines);
  const statements: D1PreparedStatement[] = [];
  const now = Date.now();
  const refundShift = await requireOpenRefundShift(db, args.businessId, args.shiftId);
  const availableCash = await availableTillCashForShift(db, args.businessId, refundShift, now);
  if (availableCash + 0.01 < refundAmount) {
    throw new PolicyError(`Till has Ksh ${availableCash.toLocaleString()} available. Add cash before refunding Ksh ${refundAmount.toLocaleString()}.`, 409);
  }
  const cashRefundAmount = refundAmount;
  const idemStatement = idempotencyStatement(db, {
    businessId: args.businessId,
    transactionId: tx.id,
    idempotencyKey: args.idempotencyKey,
    cashierName: args.principal.userName || null,
  });
  if (idemStatement) statements.push(idemStatement);

  const movementDedupe = new Map<string, number>();
  for (const line of lines) {
    const product = await productById(db, args.businessId, line.productId);
    if (!product) continue;

    if (isBundle(product)) {
      const components = await loadBundleComponents(db, args.businessId, product);
      if (components.length === 0) throw new PolicyError(`${product.name} has no ingredients configured.`, 400);
      for (const component of components) {
        movementDedupe.set(component.productId, (movementDedupe.get(component.productId) || 0) + component.quantity * line.quantity);
      }
    } else {
      movementDedupe.set(line.productId, (movementDedupe.get(line.productId) || 0) + line.quantity);
    }
  }

  const txRef = String(tx.id).split('-')[0].toUpperCase();
  for (const [productId, quantity] of movementDedupe.entries()) {
    statements.push(
      db.prepare(`UPDATE products SET stockQuantity = stockQuantity + ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(quantity, now, productId, args.businessId)
    );
    statements.push(
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, businessId, shiftId, shopId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        'RETURN',
        quantity,
        now,
        `Return #${txRef}`,
        args.businessId,
        refundShift.id || null,
        tx.shopId || DEFAULT_SHOP_ID,
        now,
      )
    );
  }

  const updatedItems = asArray(tx.items).map(item => ({ ...item }));
  for (const line of lines) {
    const item = updatedItems.find(row => row.productId === line.productId);
    if (item) item.returnedQuantity = asNumber(item.returnedQuantity) + line.quantity;
  }
  const allReturned = updatedItems.every(item => asNumber(item.returnedQuantity) >= asNumber(item.quantity));
  tx.items = updatedItems;
  tx.status = allReturned ? 'REFUNDED' : 'PARTIAL_REFUND';
  tx.pendingRefundItems = undefined;
  tx.approvedBy = trimText(args.approvedBy || args.principal.userName, 120);
  tx.updated_at = now;
  const refundId = `refund_${tx.id}_${now}_${crypto.randomUUID().slice(0, 8)}`;
  const refundNumber = makeRefundNumber(now);
  const receiptNumber = trimText(tx.receiptNumber || tx.invoiceNumber || tx.id, 160);
  const refundDocument = {
    id: refundId,
    refundNumber,
    originalTransactionId: tx.id,
    receiptNumber,
    amount: refundAmount,
    cashAmount: cashRefundAmount,
    paymentMethod: 'CASH',
    source: 'TILL',
    items: refundDocumentItems(tx, lines, refundAmount),
    timestamp: now,
    cashierName: args.principal.userName || null,
    approvedBy: tx.approvedBy,
    status: 'APPROVED',
    shiftId: refundShift.id || null,
    businessId: args.businessId,
    updated_at: now,
  };

  statements.push(
    db.prepare(`
      UPDATE transactions
      SET status = ?, items = ?, pendingRefundItems = NULL, approvedBy = ?, updated_at = ?
      WHERE id = ? AND businessId = ?
    `).bind(tx.status, JSON.stringify(updatedItems), tx.approvedBy, now, tx.id, args.businessId)
  );
  statements.push(
    db.prepare(`
      INSERT INTO refunds (id, refundNumber, originalTransactionId, receiptNumber, amount, cashAmount, paymentMethod, source, items, timestamp, cashierName, approvedBy, status, shiftId, businessId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      refundDocument.id,
      refundDocument.refundNumber,
      refundDocument.originalTransactionId,
      refundDocument.receiptNumber,
      refundDocument.amount,
      refundDocument.cashAmount,
      refundDocument.paymentMethod,
      refundDocument.source,
      JSON.stringify(refundDocument.items),
      refundDocument.timestamp,
      refundDocument.cashierName,
      refundDocument.approvedBy,
      refundDocument.status,
      refundDocument.shiftId,
      refundDocument.businessId,
      refundDocument.updated_at,
    )
  );
  statements.push(auditStatement(db, {
    principal: args.principal,
    businessId: args.businessId,
    transactionId: tx.id,
    action: 'sale.refund.approve',
    severity: 'INFO',
    details: `Refund approved for Ksh ${refundAmount.toLocaleString()} against receipt ${receiptNumber}.`,
  }));

  return { transaction: tx, refund: refundDocument, statements, idempotent: false };
}
