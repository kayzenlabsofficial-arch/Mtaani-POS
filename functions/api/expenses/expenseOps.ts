import type { Principal } from '../authUtils';
import { calculateServerCloseReportTotals } from '../close/reportMath';
import { DEFAULT_SHOP_ID, ensureInventoryIntegritySchema, isBundleInventoryRow } from '../inventoryIntegrity';
import { PolicyError } from '../salesSecurity';
import { canPerformServerAction } from '../settingsPolicy';

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const STAFF_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

export const FINANCIAL_ACCOUNTS_NON_NEGATIVE_BALANCE_TRIGGER = `
  CREATE TRIGGER IF NOT EXISTS financialAccounts_non_negative_balance_guard
  BEFORE UPDATE OF balance ON financialAccounts
  WHEN NEW.balance < -0.0001
  BEGIN
    SELECT RAISE(ABORT, 'Insufficient account balance.');
  END
`;

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimText(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedShopId(value: unknown): string {
  return trimText(value, 160) || DEFAULT_SHOP_ID;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function inShiftScope(row: any, since: number, shiftId?: string | null): boolean {
  if (shiftId && row?.shiftId) return String(row.shiftId) === String(shiftId);
  return asNumber(row?.timestamp || row?.issueDate) >= since;
}

function ownsShift(shift: any, principal: Principal) {
  const userId = trimText(principal?.userId, 160);
  const userName = trimText(principal?.userName, 120).toLowerCase();
  const cashierId = trimText(shift?.cashierId, 160);
  const cashierName = trimText(shift?.cashierName, 120).toLowerCase();
  return (userId && cashierId === userId)
    || (userName && cashierName === userName)
    || (userId && String(shift?.id || '').includes(`_${userId}`));
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

async function insertStatement(db: D1Database, table: string, item: Record<string, any>) {
  const { results: pragma } = await db.prepare(`PRAGMA table_info('${table}')`).all();
  const validCols = new Set((pragma as any[]).map((r: any) => r.name));
  const cols = Object.keys(item).filter(k => validCols.has(k));
  if (cols.length === 0) throw new PolicyError(`No valid ${table} columns to save.`, 400);
  const sql = `INSERT INTO ${table} (${cols.map(c => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return db.prepare(sql).bind(...cols.map(col => {
    const value = item[col];
    if (value === null || value === undefined) return null;
    return typeof value === 'object' ? JSON.stringify(value) : value;
  }));
}

export async function ensureExpenseActionSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'General',
      description TEXT,
      timestamp INTEGER NOT NULL,
      userName TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      source TEXT,
      accountId TEXT,
      productId TEXT,
      quantity REAL,
      preparedBy TEXT,
      approvedBy TEXT,
      shiftId TEXT,
      shopId TEXT,
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
      shopId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    'ALTER TABLE expenses ADD COLUMN source TEXT',
    'ALTER TABLE expenses ADD COLUMN accountId TEXT',
    'ALTER TABLE expenses ADD COLUMN productId TEXT',
    'ALTER TABLE expenses ADD COLUMN quantity REAL',
    'ALTER TABLE expenses ADD COLUMN preparedBy TEXT',
    'ALTER TABLE expenses ADD COLUMN approvedBy TEXT',
    'ALTER TABLE expenses ADD COLUMN shiftId TEXT',
    'ALTER TABLE expenses ADD COLUMN shopId TEXT',
    'ALTER TABLE expenses ADD COLUMN businessId TEXT',
    'ALTER TABLE expenses ADD COLUMN updated_at INTEGER',
    'ALTER TABLE financialAccounts ADD COLUMN accountNumber TEXT',
    'ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE products ADD COLUMN businessId TEXT',
    'ALTER TABLE products ADD COLUMN expiryTracking INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN expiryDate INTEGER',
    'ALTER TABLE products ADD COLUMN shopId TEXT',
    'ALTER TABLE products ADD COLUMN updated_at INTEGER',
    'ALTER TABLE stockMovements ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shiftId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shopId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER',
    'ALTER TABLE shifts ADD COLUMN cashierId TEXT',
    'ALTER TABLE shifts ADD COLUMN shopId TEXT',
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE cashPicks ADD COLUMN shopId TEXT',
    'ALTER TABLE refunds ADD COLUMN shopId TEXT',
    'ALTER TABLE supplierPayments ADD COLUMN shopId TEXT',
    'ALTER TABLE customerPayments ADD COLUMN shopId TEXT',
    `UPDATE expenses SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    `UPDATE shifts SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    `UPDATE cashPicks SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    `UPDATE refunds SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    `UPDATE supplierPayments SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    `UPDATE customerPayments SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    'CREATE INDEX IF NOT EXISTS idx_expenses_business_shop_timestamp ON expenses(businessId, shopId, timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_expenses_business_status_timestamp ON expenses(businessId, status, timestamp)',
    FINANCIAL_ACCOUNTS_NON_NEGATIVE_BALANCE_TRIGGER,
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
  await ensureInventoryIntegritySchema(db);
}

function sameExpenseIdentity(existing: Record<string, any>, next: Record<string, any>) {
  return asNumber(existing.amount) === asNumber(next.amount)
    && String(existing.source || 'TILL').toUpperCase() === String(next.source || 'TILL').toUpperCase()
    && trimText(existing.accountId || '', 120) === trimText(next.accountId || '', 120)
    && trimText(existing.productId || '', 120) === trimText(next.productId || '', 120)
    && asNumber(existing.quantity, 0) === asNumber(next.quantity, 0);
}

function auditStatement(db: D1Database, args: {
  principal: Principal;
  businessId: string;
  expenseId: string;
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
    'expense',
    args.expenseId,
    args.severity,
    args.details,
    args.businessId,
    now,
  );
}

function pickedCashAccountId(businessId: string) {
  return trimText(`picked_cash_${businessId}`, 160);
}

async function ensurePickedCashAccount(db: D1Database, businessId: string) {
  const id = pickedCashAccountId(businessId);
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
    VALUES (?, 'Main account', 'CASH', 0, ?, 'PICKED-CASH', ?)
  `).bind(id, businessId, now).run();
  await db.prepare(`
    UPDATE financialAccounts
    SET name = 'Main account', type = 'CASH', accountNumber = 'PICKED-CASH',
        updated_at = ?
    WHERE id = ? AND businessId = ?
  `).bind(now, id, businessId).run();
  return db.prepare(`
    SELECT id, name, balance
    FROM financialAccounts
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(id, businessId).first<any>();
}

async function requireOpenTillExpenseShift(
  db: D1Database,
  businessId: string,
  shopId: string,
  shiftId: unknown,
  principal?: Principal,
  service = false,
) {
  const cleanShiftId = trimText(shiftId, 180);
  if (!cleanShiftId) throw new PolicyError('Open a till shift before paying expenses from the till.', 409);
  const shift = await db.prepare(`
    SELECT id, startTime, openingCash, cashierId, cashierName, status, shopId
    FROM shifts
    WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?
    LIMIT 1
  `).bind(cleanShiftId, businessId, DEFAULT_SHOP_ID, shopId).first<any>();
  if (!shift) throw new PolicyError('The selected till shift was not found.', 404);
  if (String(shift.status || '').toUpperCase() !== 'OPEN') {
    throw new PolicyError('Till expenses can only use an open shift.', 409);
  }
  const canUseAnyOpenShift = service || APPROVER_ROLES.has(String(principal?.role || '').toUpperCase());
  if (!canUseAnyOpenShift && principal && !ownsShift(shift, principal)) {
    throw new PolicyError('You can only pay till expenses from your own shift.', 403);
  }
  return shift;
}

async function availableTillCashForExpense(
  db: D1Database,
  businessId: string,
  shopId: string,
  shift: any,
  excludeExpenseId?: string,
): Promise<number> {
  const since = asNumber(shift?.startTime);
  const shiftId = trimText(shift?.id, 180);
  const openingCash = asNumber(shift?.openingCash);
  const until = Date.now();
  const [transactions, expenses, picks, refunds, supplierPayments, customerPayments] = await Promise.all([
    db.prepare(`SELECT total, subtotal, tax, discountAmount, discount, items, timestamp, status, paymentMethod, splitPayments, splitData, shiftId FROM transactions WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`)
      .bind(businessId, DEFAULT_SHOP_ID, shopId, since, until).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT id, amount, timestamp, status, source, shiftId FROM expenses WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ?`)
      .bind(businessId, DEFAULT_SHOP_ID, shopId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, timestamp, status, shiftId FROM cashPicks WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ?`)
      .bind(businessId, DEFAULT_SHOP_ID, shopId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, cashAmount, timestamp, status, source, shiftId FROM refunds WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ?`)
      .bind(businessId, DEFAULT_SHOP_ID, shopId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, timestamp, source, shiftId FROM supplierPayments WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ?`)
      .bind(businessId, DEFAULT_SHOP_ID, shopId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, timestamp, paymentMethod, shiftId FROM customerPayments WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ?`)
      .bind(businessId, DEFAULT_SHOP_ID, shopId, since).all<any>().catch(() => ({ results: [] })),
  ]);

  return calculateTillCashAvailableForExpenseRows({
    transactions: transactions.results || [],
    expenses: expenses.results || [],
    picks: picks.results || [],
    refunds: refunds.results || [],
    supplierPayments: supplierPayments.results || [],
    customerPayments: customerPayments.results || [],
    openingCash,
    since,
    until,
    shiftId,
    shopId,
    excludeExpenseId,
  });
}

export function calculateTillCashAvailableForExpenseRows(args: {
  transactions?: any[];
  expenses?: any[];
  picks?: any[];
  refunds?: any[];
  supplierPayments?: any[];
  customerPayments?: any[];
  openingCash?: number;
  since: number;
  until: number;
  shiftId?: string | null;
  shopId?: string | null;
  excludeExpenseId?: string;
}) {
  const since = asNumber(args.since);
  const shiftId = trimText(args.shiftId, 180);
  const shopId = args.shopId ? normalizedShopId(args.shopId) : '';
  const inShop = (row: any) => !shopId || normalizedShopId(row?.shopId) === shopId;
  const expenses = (args.expenses || []).filter(row => inShop(row) && trimText(row?.id, 160) !== args.excludeExpenseId);
  const closeTotals = calculateServerCloseReportTotals({
    transactions: (args.transactions || []).filter(row => inShop(row) && inShiftScope(row, since, shiftId)),
    invoices: [],
    expenses,
    picks: (args.picks || []).filter(inShop),
    refunds: (args.refunds || []).filter(inShop),
    supplierPayments: (args.supplierPayments || []).filter(inShop),
    customerPayments: (args.customerPayments || []).filter(inShop),
    openingCash: args.openingCash || 0,
    since,
    until: args.until,
    shiftId,
  });
  return Math.max(0, roundMoney(closeTotals.expectedCash));
}

async function effectStatementsForApprovedExpense(
  db: D1Database,
  businessId: string,
  expense: Record<string, any>,
  context: { principal?: Principal; service?: boolean; excludeExpenseId?: string } = {},
): Promise<D1PreparedStatement[]> {
  const source = String(expense.source || 'TILL').toUpperCase();
  const amount = asNumber(expense.amount);
  const now = Date.now();

  if (source === 'ACCOUNT') {
    const accountId = pickedCashAccountId(businessId);
    const account = await ensurePickedCashAccount(db, businessId);
    if (!account) throw new PolicyError('Selected payment account was not found.', 404);
    if (asNumber(account.balance) < amount) {
      throw new PolicyError(`Insufficient funds in ${account.name}.`, 409);
    }
    return [
      db.prepare(`
        UPDATE financialAccounts
        SET balance = CASE
          WHEN COALESCE(balance, 0) >= ? THEN ROUND(COALESCE(balance, 0) - ?, 2)
          ELSE -1
        END, updated_at = ?
        WHERE id = ? AND businessId = ?
      `).bind(amount, amount, now, accountId, businessId),
    ];
  }

  if (source === 'TILL') {
    const shopId = normalizedShopId(expense.shopId);
    const shift = await requireOpenTillExpenseShift(db, businessId, shopId, expense.shiftId, context.principal, context.service);
    const availableCash = await availableTillCashForExpense(db, businessId, shopId, shift, context.excludeExpenseId);
    if (amount > availableCash + 0.01) {
      throw new PolicyError(`Insufficient till cash. Available: Ksh ${availableCash.toLocaleString()}.`, 409);
    }
    return [];
  }

  if (source === 'SHOP') {
    const productId = trimText(expense.productId, 120);
    const quantity = Math.max(0, asNumber(expense.quantity, 1));
    const shopId = trimText(expense.shopId || DEFAULT_SHOP_ID, 160) || DEFAULT_SHOP_ID;
    if (!productId || quantity <= 0) throw new PolicyError('Select the stock item and quantity being expensed.', 400);
    const product = await db.prepare(`
      SELECT id, name, stockQuantity, isBundle, components, shopId
      FROM products
      WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?
      LIMIT 1
    `).bind(productId, businessId, DEFAULT_SHOP_ID, shopId).first<any>();
    if (!product) throw new PolicyError('Selected shop item was not found.', 404);
    if (isBundleInventoryRow(product)) throw new PolicyError('Bundle stock is derived from its ingredients and cannot be expensed directly.', 409);
    if (asNumber(product.stockQuantity) < quantity) throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);

    return [
      db.prepare(`
        UPDATE products
        SET stockQuantity = COALESCE(stockQuantity, 0) - ?, updated_at = ?
        WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?
      `).bind(quantity, now, productId, businessId, DEFAULT_SHOP_ID, shopId),
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, businessId, shiftId, shopId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        'OUT',
        quantity,
        now,
        `Expense: ${trimText(expense.description || 'Shop Use', 120)}`,
        businessId,
        expense.shiftId || null,
        shopId,
        now,
      ),
    ];
  }

  return [];
}

async function amountForStockExpense(
  db: D1Database,
  businessId: string,
  expense: Record<string, any>,
): Promise<number> {
  const productId = trimText(expense.productId, 120);
  const quantity = Math.max(0, asNumber(expense.quantity, 1));
  const shopId = trimText(expense.shopId || DEFAULT_SHOP_ID, 160) || DEFAULT_SHOP_ID;
  if (!productId || quantity <= 0) throw new PolicyError('Select the stock item and quantity being expensed.', 400);

  const product = await db.prepare(`
    SELECT id, name, stockQuantity, costPrice, isBundle, components, shopId
    FROM products
    WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?
    LIMIT 1
  `).bind(productId, businessId, DEFAULT_SHOP_ID, shopId).first<any>();
  if (!product) throw new PolicyError('Selected shop item was not found.', 404);
  if (isBundleInventoryRow(product)) throw new PolicyError('Bundle stock is derived from its ingredients and cannot be expensed directly.', 409);
  if (asNumber(product.stockQuantity) < quantity) throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);

  const costPrice = asNumber(product.costPrice);
  if (costPrice <= 0) throw new PolicyError(`Set a cost price for ${product.name} before expensing it from stock.`, 400);
  return Math.round(costPrice * quantity * 100) / 100;
}

export async function prepareExpenseSubmit(
  db: D1Database,
  args: {
    businessId: string;
    shopId?: string;
    principal: Principal;
    service: boolean;
    expense: Record<string, any>;
  },
) {
  const { businessId, principal, service } = args;
  if (!service && !STAFF_ROLES.has(principal.role)) throw new PolicyError('Staff access required.', 403);
  if (!await canPerformServerAction(db, businessId, principal, service, 'expense.create')) {
    throw new PolicyError('Expense creation is locked for this staff role.', 403);
  }

  const now = Date.now();
  const expense = { ...(args.expense || {}) };
  expense.id = trimText(expense.id || crypto.randomUUID(), 120);
  const requestedSource = String(expense.source || 'TILL').toUpperCase();
  expense.source = requestedSource === 'ACCOUNT' ? 'ACCOUNT' : requestedSource === 'SHOP' ? 'SHOP' : 'TILL';
  expense.shopId = normalizedShopId(expense.shopId);
  expense.accountId = expense.source === 'ACCOUNT' ? pickedCashAccountId(businessId) : null;
  expense.productId = expense.source === 'SHOP' ? trimText(expense.productId, 120) : null;
  expense.quantity = expense.source === 'SHOP' ? Math.max(0, asNumber(expense.quantity, 1)) : null;
  expense.amount = expense.source === 'SHOP'
    ? await amountForStockExpense(db, businessId, expense)
    : Math.round(asNumber(expense.amount) * 100) / 100;
  if (expense.amount <= 0) throw new PolicyError('Expense amount must be more than zero.', 400);
  expense.category = trimText(expense.category || 'General', 120);
  expense.description = trimText(expense.description, 240);
  expense.timestamp = Math.min(asNumber(expense.timestamp, now), now + 5 * 60 * 1000);
  expense.userName = trimText(expense.userName || principal.userName, 120);
  expense.preparedBy = trimText(expense.preparedBy || principal.userName, 120);
  expense.businessId = businessId;
  expense.updated_at = now;

  const requestedApproved = String(expense.status || '').toUpperCase() === 'APPROVED';
  const approved = requestedApproved && (service || APPROVER_ROLES.has(principal.role));
  if (requestedApproved && !approved) throw new PolicyError('You are not allowed to approve expenses.', 403);
  expense.status = approved ? 'APPROVED' : 'PENDING';
  expense.approvedBy = approved ? trimText(expense.approvedBy || principal.userName, 120) : null;

  const existing = await db.prepare(`
    SELECT *
    FROM expenses
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(expense.id, businessId).first<any>();
  if (existing) {
    const clean = deserializeRow(existing);
    if (!sameExpenseIdentity(clean, expense)) {
      throw new PolicyError('Expense id is already used by a different expense.', 409);
    }
    return { expense: clean, statements: [], idempotent: true };
  }

  if (expense.source === 'TILL') {
    await requireOpenTillExpenseShift(db, businessId, expense.shopId, expense.shiftId, principal, service);
  }

  const statements = [await insertStatement(db, 'expenses', expense)];
  if (approved) statements.push(...await effectStatementsForApprovedExpense(db, businessId, expense, { principal, service }));
  statements.push(auditStatement(db, {
    principal,
    businessId, expenseId: expense.id,
    action: approved ? 'expense.create.approved' : 'expense.create.pending',
    severity: approved ? 'INFO' : 'WARN',
    details: `${approved ? 'Approved' : 'Created pending'} expense for Ksh ${expense.amount.toLocaleString()} (${expense.category}).`,
  }));

  return { expense, statements, idempotent: false };
}

export async function prepareExpenseApproval(
  db: D1Database,
  args: {
    businessId: string;
    shopId?: string;
    principal: Principal;
    service: boolean;
    expenseId: string;
    approvedBy?: string;
  },
) {
  const { businessId, principal, service } = args;
  if (!service && !APPROVER_ROLES.has(principal.role)) throw new PolicyError('You are not allowed to approve expenses.', 403);
  const shopId = normalizedShopId(args.shopId);

  const expense = await db.prepare(`
    SELECT *
    FROM expenses
    WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?
    LIMIT 1
  `).bind(args.expenseId, businessId, DEFAULT_SHOP_ID, shopId).first<any>();
  if (!expense) throw new PolicyError('Expense was not found.', 404);
  const clean = deserializeRow(expense);
  if (clean.status === 'APPROVED') return { expense: clean, statements: [], idempotent: true };
  if (clean.status !== 'PENDING') throw new PolicyError('This expense has already been processed.', 409);
  if (String(clean.source || '').toUpperCase() === 'SHOP') {
    clean.amount = await amountForStockExpense(db, businessId, clean);
  }

  clean.status = 'APPROVED';
  clean.approvedBy = trimText(args.approvedBy || principal.userName, 120);
  clean.updated_at = Date.now();

  const statements = [
    db.prepare(`UPDATE expenses SET status = 'APPROVED', approvedBy = ?, amount = ?, updated_at = ? WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?`)
      .bind(clean.approvedBy, clean.amount, clean.updated_at, clean.id, businessId, DEFAULT_SHOP_ID, shopId),
    ...await effectStatementsForApprovedExpense(db, businessId, clean, { principal, service, excludeExpenseId: clean.id }),
    auditStatement(db, {
      principal,
      businessId, expenseId: clean.id,
      action: 'expense.approve',
      severity: 'INFO',
      details: `Approved expense for Ksh ${asNumber(clean.amount).toLocaleString()} (${clean.category || 'General'}).`,
    }),
  ];

  return { expense: clean, statements, idempotent: false };
}
