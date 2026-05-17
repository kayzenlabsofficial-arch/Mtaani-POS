import type { Principal } from '../authUtils';
import { PolicyError } from '../salesSecurity';

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const STAFF_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimText(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max);
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

async function upsertStatement(db: D1Database, table: string, item: Record<string, any>) {
  const { results: pragma } = await db.prepare(`PRAGMA table_info('${table}')`).all();
  const validCols = new Set((pragma as any[]).map((r: any) => r.name));
  const cols = Object.keys(item).filter(k => validCols.has(k));
  if (cols.length === 0) throw new PolicyError(`No valid ${table} columns to save.`, 400);
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.map(c => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  return db.prepare(sql).bind(...cols.map(col => {
    const value = item[col];
    if (value === null || value === undefined) return null;
    return typeof value === 'object' ? JSON.stringify(value) : value;
  }));
}

export async function ensureExpenseActionSchema(db: D1Database) {
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
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
}

function auditStatement(db: D1Database, args: {
  principal: Principal;
  businessId: string;
  branchId: string;
  expenseId: string;
  action: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  details: string;
}) {
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    args.branchId,
    now,
  );
}

async function effectStatementsForApprovedExpense(
  db: D1Database,
  businessId: string,
  branchId: string,
  expense: Record<string, any>,
): Promise<D1PreparedStatement[]> {
  const source = String(expense.source || 'TILL').toUpperCase();
  const amount = asNumber(expense.amount);
  const now = Date.now();

  if (source === 'ACCOUNT') {
    const accountId = trimText(expense.accountId, 120);
    if (!accountId) throw new PolicyError('Select the account paying this expense.', 400);
    const account = await db.prepare(`
      SELECT id, name, balance, branchId
      FROM financialAccounts
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(accountId, businessId).first<any>();
    if (!account) throw new PolicyError('Selected payment account was not found.', 404);
    if (account.branchId && account.branchId !== branchId) throw new PolicyError('Selected account belongs to another branch.', 403);
    if (asNumber(account.balance) < amount) {
      throw new PolicyError(`Insufficient funds in ${account.name}.`, 409);
    }
    return [
      db.prepare(`UPDATE financialAccounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(amount, now, accountId, businessId),
    ];
  }

  if (source === 'SHOP') {
    const productId = trimText(expense.productId, 120);
    const quantity = Math.max(0, asNumber(expense.quantity, 1));
    if (!productId || quantity <= 0) throw new PolicyError('Select the stock item and quantity being expensed.', 400);
    const product = await db.prepare(`
      SELECT id, name, stockQuantity, branchId
      FROM products
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(productId, businessId).first<any>();
    if (!product) throw new PolicyError('Selected shop item was not found.', 404);
    if (product.branchId && product.branchId !== branchId) throw new PolicyError('Selected stock item belongs to another branch.', 403);
    if (asNumber(product.stockQuantity) < quantity) throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);

    return [
      db.prepare(`UPDATE products SET stockQuantity = stockQuantity - ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(quantity, now, productId, businessId),
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        'OUT',
        quantity,
        now,
        `Expense: ${trimText(expense.description || 'Shop Use', 120)}`,
        branchId,
        businessId,
        expense.shiftId || null,
        now,
      ),
    ];
  }

  return [];
}

export async function prepareExpenseSubmit(
  db: D1Database,
  args: {
    businessId: string;
    branchId: string;
    principal: Principal;
    service: boolean;
    expense: Record<string, any>;
  },
) {
  const { businessId, branchId, principal, service } = args;
  if (!service && !STAFF_ROLES.has(principal.role)) throw new PolicyError('Staff access required.', 403);

  const now = Date.now();
  const expense = { ...(args.expense || {}) };
  expense.id = trimText(expense.id || crypto.randomUUID(), 120);
  expense.amount = Math.round(asNumber(expense.amount) * 100) / 100;
  if (expense.amount <= 0) throw new PolicyError('Expense amount must be more than zero.', 400);
  expense.category = trimText(expense.category || 'General', 120);
  expense.description = trimText(expense.description, 240);
  expense.source = String(expense.source || 'TILL').toUpperCase();
  expense.timestamp = Math.min(asNumber(expense.timestamp, now), now + 5 * 60 * 1000);
  expense.userName = trimText(expense.userName || principal.userName, 120);
  expense.preparedBy = trimText(expense.preparedBy || principal.userName, 120);
  expense.businessId = businessId;
  expense.branchId = branchId;
  expense.updated_at = now;

  const requestedApproved = String(expense.status || '').toUpperCase() === 'APPROVED';
  const approved = requestedApproved && (service || APPROVER_ROLES.has(principal.role));
  if (requestedApproved && !approved) throw new PolicyError('You are not allowed to approve expenses.', 403);
  expense.status = approved ? 'APPROVED' : 'PENDING';
  expense.approvedBy = approved ? trimText(expense.approvedBy || principal.userName, 120) : null;

  const statements = [await upsertStatement(db, 'expenses', expense)];
  if (approved) statements.push(...await effectStatementsForApprovedExpense(db, businessId, branchId, expense));
  statements.push(auditStatement(db, {
    principal,
    businessId,
    branchId,
    expenseId: expense.id,
    action: approved ? 'expense.create.approved' : 'expense.create.pending',
    severity: approved ? 'INFO' : 'WARN',
    details: `${approved ? 'Approved' : 'Created pending'} expense for Ksh ${expense.amount.toLocaleString()} (${expense.category}).`,
  }));

  return { expense, statements };
}

export async function prepareExpenseApproval(
  db: D1Database,
  args: {
    businessId: string;
    branchId: string;
    principal: Principal;
    service: boolean;
    expenseId: string;
    approvedBy?: string;
  },
) {
  const { businessId, branchId, principal, service } = args;
  if (!service && !APPROVER_ROLES.has(principal.role)) throw new PolicyError('You are not allowed to approve expenses.', 403);

  const expense = await db.prepare(`
    SELECT *
    FROM expenses
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(args.expenseId, businessId, branchId).first<any>();
  if (!expense) throw new PolicyError('Expense was not found.', 404);
  const clean = deserializeRow(expense);
  if (clean.status !== 'PENDING') throw new PolicyError('This expense has already been processed.', 409);

  clean.status = 'APPROVED';
  clean.approvedBy = trimText(args.approvedBy || principal.userName, 120);
  clean.updated_at = Date.now();

  const statements = [
    db.prepare(`UPDATE expenses SET status = 'APPROVED', approvedBy = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`)
      .bind(clean.approvedBy, clean.updated_at, clean.id, businessId, branchId),
    ...await effectStatementsForApprovedExpense(db, businessId, branchId, clean),
    auditStatement(db, {
      principal,
      businessId,
      branchId,
      expenseId: clean.id,
      action: 'expense.approve',
      severity: 'INFO',
      details: `Approved expense for Ksh ${asNumber(clean.amount).toLocaleString()} (${clean.category || 'General'}).`,
    }),
  ];

  return { expense: clean, statements };
}

