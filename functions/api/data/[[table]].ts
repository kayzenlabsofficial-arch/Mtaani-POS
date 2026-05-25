import { authorizeRequest, canAccessBusiness, hashPassword, isPasswordHashCurrent } from '../authUtils';
import { hardenTransactionBatch, PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ALLOWED_TABLES = new Set([
  'users', 'products', 'transactions', 'refunds', 'cashPicks', 'shifts',
  'endOfDayReports', 'stockMovements', 'expenses', 'customers',
  'customerPayments', 'serviceItems', 'salesInvoices', 'suppliers', 'supplierPayments',
  'creditNotes', 'dailySummaries', 'stockAdjustmentRequests', 'purchaseOrders',
  'settings', 'salesTills', 'categories', 'businesses', 'system', 'expenseAccounts',
  'financialAccounts', 'financialAccountAdjustments', 'productIngredients', 'loginAttempts', 'auditLogs',
  'hrStaff', 'hrStaffDocuments', 'hrAttendance', 'hrPayrollAdjustments',
  'mpesaCallbacks', 'deviceSyncStatus', 'idempotencyKeys',
]);

const UNSCOPED_TABLES = new Set(['businesses', 'loginAttempts']);
const ADMIN_WRITE_TABLES = new Set(['users', 'settings', 'salesTills', 'expenseAccounts', 'financialAccounts', 'categories']);
const MANAGER_WRITE_TABLES = new Set([
  'products', 'productIngredients', 'serviceItems', 'suppliers',
  'purchaseOrders', 'supplierPayments', 'creditNotes', 'salesInvoices',
  'stockMovements', 'expenses',
  'hrStaff', 'hrStaffDocuments', 'hrAttendance', 'hrPayrollAdjustments',
]);
const CASHIER_WRITE_TABLES = new Set([
  'transactions', 'customers', 'customerPayments', 'shifts',
  'cashPicks', 'endOfDayReports', 'dailySummaries', 'stockAdjustmentRequests',
]);
const MANAGER_DELETE_TABLES = new Set([
  'products', 'productIngredients', 'serviceItems', 'suppliers',
  'purchaseOrders', 'supplierPayments', 'creditNotes', 'salesInvoices',
  'customers', 'expenses', 'stockAdjustmentRequests',
  'hrStaff', 'hrStaffDocuments', 'hrAttendance', 'hrPayrollAdjustments',
]);
const MANAGER_READ_TABLES = new Set(['hrStaff', 'hrStaffDocuments', 'hrAttendance', 'hrPayrollAdjustments']);
const HR_TABLES = new Set(['hrStaff', 'hrStaffDocuments', 'hrAttendance', 'hrPayrollAdjustments']);
const COMMAND_ONLY_WRITE_TABLES = new Set([
  'businesses',
  'users',
  'settings',
  'categories',
  'expenseAccounts',
  'products',
  'productIngredients',
  'serviceItems',
  'customers',
  'customerPayments',
  'suppliers',
  'supplierPayments',
  'creditNotes',
  'purchaseOrders',
  'salesInvoices',
  'expenses',
  'financialAccounts',
  'financialAccountAdjustments',
  'cashPicks',
  'refunds',
  'shifts',
  'endOfDayReports',
  'dailySummaries',
  'stockAdjustmentRequests',
  'stockMovements',
  'auditLogs',
]);
const LEGACY_SCOPE_COLUMN = String.fromCharCode(98, 114, 97, 110, 99, 104, 73, 100);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders };
}

function secureJsonHeaders() {
  return {
    ...jsonHeaders(),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, isActive INTEGER DEFAULT 1, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, businessId TEXT, mustChangePassword INTEGER DEFAULT 0, isBootstrapAdmin INTEGER DEFAULT 0, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, sellingPrice REAL NOT NULL, costPrice REAL, discountType TEXT DEFAULT 'NONE', discountValue REAL DEFAULT 0, taxCategory TEXT NOT NULL, stockQuantity REAL NOT NULL, unit TEXT, barcode TEXT NOT NULL, imageUrl TEXT, reorderPoint REAL, supplierIds TEXT, expiryTracking INTEGER DEFAULT 0, expiryDate INTEGER, isBundle INTEGER DEFAULT 0, components TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total REAL NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, discountAmount REAL, discountReason TEXT, items TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, paymentMethod TEXT, amountTendered REAL, changeGiven REAL, mpesaReference TEXT, mpesaCode TEXT, mpesaCustomer TEXT, mpesaCheckoutRequestId TEXT, cashierId TEXT, cashierName TEXT, customerId TEXT, customerName TEXT, discount REAL, discountType TEXT, splitPayments TEXT, splitData TEXT, isSynced INTEGER, approvedBy TEXT, pendingRefundItems TEXT, shiftId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS refunds (id TEXT PRIMARY KEY, originalTransactionId TEXT NOT NULL, receiptNumber TEXT, amount REAL NOT NULL, cashAmount REAL DEFAULT 0, paymentMethod TEXT, source TEXT, items TEXT, timestamp INTEGER NOT NULL, cashierName TEXT, approvedBy TEXT, status TEXT NOT NULL DEFAULT 'APPROVED', shiftId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS cashPicks (id TEXT PRIMARY KEY, amount REAL NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, userName TEXT, accountId TEXT, shiftId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, startTime INTEGER NOT NULL, endTime INTEGER, cashierId TEXT, cashierName TEXT NOT NULL, tillId TEXT, tillName TEXT, openingCash REAL DEFAULT 0, closingCash REAL, expectedCash REAL, cashVariance REAL, closeBreakdown TEXT, status TEXT NOT NULL, lastSyncAt INTEGER, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS endOfDayReports (id TEXT PRIMARY KEY, shiftId TEXT, tillId TEXT, tillName TEXT, timestamp INTEGER NOT NULL, totalSales REAL NOT NULL DEFAULT 0, grossSales REAL NOT NULL DEFAULT 0, taxTotal REAL NOT NULL DEFAULT 0, cashSales REAL NOT NULL DEFAULT 0, customerCashPayments REAL DEFAULT 0, mpesaSales REAL NOT NULL DEFAULT 0, pdqSales REAL, totalExpenses REAL NOT NULL DEFAULT 0, supplierPaymentsTotal REAL, remittanceTotal REAL, totalPicks REAL NOT NULL DEFAULT 0, totalRefunds REAL, cashRefunds REAL DEFAULT 0, openingCash REAL DEFAULT 0, closingCash REAL, expectedCash REAL NOT NULL DEFAULT 0, reportedCash REAL NOT NULL DEFAULT 0, difference REAL NOT NULL DEFAULT 0, cashierId TEXT, cashierName TEXT NOT NULL, closeBreakdown TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, businessId TEXT, shiftId TEXT, expiryDate INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT, timestamp INTEGER NOT NULL, userName TEXT, status TEXT NOT NULL, source TEXT, accountId TEXT, productId TEXT, quantity REAL, preparedBy TEXT, approvedBy TEXT, shiftId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS hrStaff (id TEXT PRIMARY KEY, fullName TEXT NOT NULL, phone TEXT, email TEXT, roleTitle TEXT NOT NULL, department TEXT, nationalId TEXT, kraPin TEXT, nhifNumber TEXT, nssfNumber TEXT, hireDate INTEGER, status TEXT NOT NULL DEFAULT 'ACTIVE', baseSalary REAL DEFAULT 0, payCycle TEXT DEFAULT 'MONTHLY', emergencyContact TEXT, notes TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS hrStaffDocuments (id TEXT PRIMARY KEY, staffId TEXT NOT NULL, name TEXT NOT NULL, documentType TEXT NOT NULL, documentNumber TEXT, issueDate INTEGER, expiryDate INTEGER, fileName TEXT, fileUrl TEXT, notes TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS hrAttendance (id TEXT PRIMARY KEY, staffId TEXT NOT NULL, date INTEGER NOT NULL, checkIn TEXT, checkOut TEXT, status TEXT NOT NULL, hoursWorked REAL, notes TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS hrPayrollAdjustments (id TEXT PRIMARY KEY, staffId TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL, effectiveDate INTEGER NOT NULL, recurring INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE', notes TEXT, businessId TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_hrStaff_status ON hrStaff(businessId, status);
CREATE INDEX IF NOT EXISTS idx_hrStaffDocuments_staff ON hrStaffDocuments(businessId, staffId);
CREATE INDEX IF NOT EXISTS idx_hrAttendance_staff_date ON hrAttendance(businessId, staffId, date);
CREATE INDEX IF NOT EXISTS idx_hrPayrollAdjustments_staff_date ON hrPayrollAdjustments(businessId, staffId, effectiveDate);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, totalSpent REAL, balance REAL, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS customerPayments (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, reference TEXT, allocations TEXT, timestamp INTEGER NOT NULL, preparedBy TEXT, shiftId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS serviceItems (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, price REAL NOT NULL, taxCategory TEXT DEFAULT 'A', isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS salesInvoices (id TEXT PRIMARY KEY, invoiceNumber TEXT NOT NULL, customerId TEXT NOT NULL, customerName TEXT, customerPhone TEXT, customerEmail TEXT, items TEXT NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, paidAmount REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT NOT NULL, issueDate INTEGER NOT NULL, dueDate INTEGER, notes TEXT, preparedBy TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, address TEXT, kraPin TEXT, balance REAL, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS supplierPayments (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, purchaseOrderId TEXT, purchaseOrderIds TEXT, invoiceAllocations TEXT, creditNoteIds TEXT, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, timestamp INTEGER NOT NULL, reference TEXT, source TEXT, accountId TEXT, shopId TEXT, shiftId TEXT, preparedBy TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS creditNotes (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, amount REAL NOT NULL, reference TEXT NOT NULL, timestamp INTEGER NOT NULL, reason TEXT, status TEXT DEFAULT 'PENDING', allocatedTo TEXT, items TEXT, productId TEXT, quantity REAL, businessId TEXT, shiftId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS dailySummaries (id TEXT PRIMARY KEY, date INTEGER NOT NULL, shiftIds TEXT NOT NULL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalRefunds REAL, totalVariance REAL NOT NULL, timestamp INTEGER NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dailySummaries_business_date ON dailySummaries(businessId, date);
CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT, oldQty REAL, newQty REAL, requestedQuantity REAL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, preparedBy TEXT, approvedBy TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS purchaseOrders (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, items TEXT NOT NULL, totalAmount REAL NOT NULL, status TEXT NOT NULL, approvalStatus TEXT NOT NULL, paymentStatus TEXT, paidAmount REAL, orderDate INTEGER NOT NULL, expectedDate INTEGER, receivedDate INTEGER, invoiceNumber TEXT, poNumber TEXT, preparedBy TEXT, approvedBy TEXT, receivedBy TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, storeName TEXT NOT NULL, location TEXT, tillNumber TEXT, kraPin TEXT, receiptFooter TEXT, ownerModeEnabled INTEGER DEFAULT 0, autoApproveOwnerActions INTEGER DEFAULT 1, cashSweepEnabled INTEGER DEFAULT 1, cashDrawerLimit REAL DEFAULT 5000, salesTills TEXT, defaultOpeningFloat REAL DEFAULT 0, mpesaConsumerKey TEXT, mpesaConsumerSecret TEXT, mpesaPasskey TEXT, mpesaEnv TEXT DEFAULT 'sandbox', mpesaType TEXT DEFAULT 'paybill', mpesaStoreNumber TEXT, accessControl TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS salesTills (id TEXT PRIMARY KEY, name TEXT NOT NULL, isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, iconName TEXT NOT NULL, color TEXT NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS expenseAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS financialAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, businessId TEXT, accountNumber TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS financialAccountAdjustments (id TEXT PRIMARY KEY, accountId TEXT NOT NULL, amount REAL NOT NULL, direction TEXT NOT NULL, balanceBefore REAL NOT NULL, balanceAfter REAL NOT NULL, reason TEXT, userName TEXT, timestamp INTEGER NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS mpesaCallbacks (checkoutRequestId TEXT PRIMARY KEY, merchantRequestId TEXT, resultCode INTEGER, resultDesc TEXT, amount REAL, receiptNumber TEXT, phoneNumber TEXT, businessId TEXT, timestamp INTEGER, utilizedTransactionId TEXT, utilizedCustomerId TEXT, utilizedCustomerName TEXT, utilizedAt INTEGER);
CREATE TABLE IF NOT EXISTS deviceSyncStatus (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, deviceId TEXT NOT NULL, cashierName TEXT, lastSyncAt INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS idempotencyKeys (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, idempotencyKey TEXT NOT NULL, operation TEXT NOT NULL, deviceId TEXT, cashierName TEXT, transactionId TEXT, createdAt INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS auditLogs (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, userId TEXT, userName TEXT, action TEXT NOT NULL, entity TEXT, entityId TEXT, severity TEXT NOT NULL, details TEXT, businessId TEXT, updated_at INTEGER);
`;

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
  delete out[LEGACY_SCOPE_COLUMN];
  return out;
}

function isAdminLike(role: string): boolean {
  return role === 'ADMIN' || role === 'ROOT';
}

function canWriteTable(role: string, table: string, service: boolean): boolean {
  if (service || isAdminLike(role)) return true;
  if (role === 'MANAGER') return MANAGER_WRITE_TABLES.has(table) || CASHIER_WRITE_TABLES.has(table);
  if (role === 'CASHIER') return CASHIER_WRITE_TABLES.has(table);
  return false;
}

function canDeleteTable(role: string, table: string, service: boolean): boolean {
  if (service || isAdminLike(role)) return true;
  if (role === 'MANAGER') return MANAGER_DELETE_TABLES.has(table);
  return false;
}

function canReadTable(role: string, table: string, service: boolean): boolean {
  if (service || isAdminLike(role)) return true;
  if (MANAGER_READ_TABLES.has(table)) return role === 'MANAGER';
  return true;
}

async function ensureCoreSchema(db: D1Database): Promise<void> {
  const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
  for (const statement of statements) {
    try { await db.prepare(statement).run(); } catch {}
  }
  await ensureUserSetupColumns(db);
}

async function ensureUserSetupColumns(db: D1Database): Promise<void> {
  const columns = [
    'mustChangePassword INTEGER DEFAULT 0',
    'isBootstrapAdmin INTEGER DEFAULT 0',
  ];
  for (const column of columns) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run(); } catch {}
  }
}

async function ensureHrSchema(db: D1Database): Promise<void> {
  const statements = [
    'CREATE TABLE IF NOT EXISTS hrStaff (id TEXT PRIMARY KEY, fullName TEXT NOT NULL, phone TEXT, email TEXT, roleTitle TEXT NOT NULL, department TEXT, nationalId TEXT, kraPin TEXT, nhifNumber TEXT, nssfNumber TEXT, hireDate INTEGER, status TEXT NOT NULL DEFAULT "ACTIVE", baseSalary REAL DEFAULT 0, payCycle TEXT DEFAULT "MONTHLY", emergencyContact TEXT, notes TEXT, businessId TEXT, updated_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS hrStaffDocuments (id TEXT PRIMARY KEY, staffId TEXT NOT NULL, name TEXT NOT NULL, documentType TEXT NOT NULL, documentNumber TEXT, issueDate INTEGER, expiryDate INTEGER, fileName TEXT, fileUrl TEXT, notes TEXT, businessId TEXT, updated_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS hrAttendance (id TEXT PRIMARY KEY, staffId TEXT NOT NULL, date INTEGER NOT NULL, checkIn TEXT, checkOut TEXT, status TEXT NOT NULL, hoursWorked REAL, notes TEXT, businessId TEXT, updated_at INTEGER)',
    'CREATE TABLE IF NOT EXISTS hrPayrollAdjustments (id TEXT PRIMARY KEY, staffId TEXT NOT NULL, type TEXT NOT NULL, label TEXT NOT NULL, amount REAL NOT NULL, effectiveDate INTEGER NOT NULL, recurring INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT "ACTIVE", notes TEXT, businessId TEXT, updated_at INTEGER)',
    'CREATE INDEX IF NOT EXISTS idx_hrStaff_status ON hrStaff(businessId, status)',
    'CREATE INDEX IF NOT EXISTS idx_hrStaffDocuments_staff ON hrStaffDocuments(businessId, staffId)',
    'CREATE INDEX IF NOT EXISTS idx_hrAttendance_staff_date ON hrAttendance(businessId, staffId, date)',
    'CREATE INDEX IF NOT EXISTS idx_hrPayrollAdjustments_staff_date ON hrPayrollAdjustments(businessId, staffId, effectiveDate)',
  ];
  for (const statement of statements) await db.prepare(statement).run();
}

async function ensureSettingsSchema(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      storeName TEXT NOT NULL,
      location TEXT,
      tillNumber TEXT,
      kraPin TEXT,
      receiptFooter TEXT,
      ownerModeEnabled INTEGER DEFAULT 0,
      autoApproveOwnerActions INTEGER DEFAULT 1,
      cashSweepEnabled INTEGER DEFAULT 1,
      cashDrawerLimit REAL DEFAULT 5000,
      salesTills TEXT,
      defaultOpeningFloat REAL DEFAULT 0,
      mpesaConsumerKey TEXT,
      mpesaConsumerSecret TEXT,
      mpesaPasskey TEXT,
      mpesaEnv TEXT DEFAULT 'sandbox',
      mpesaType TEXT DEFAULT 'paybill',
      mpesaStoreNumber TEXT,
      accessControl TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();

  const columns: Array<[string, string]> = [
    ['location', 'TEXT'],
    ['tillNumber', 'TEXT'],
    ['kraPin', 'TEXT'],
    ['receiptFooter', 'TEXT'],
    ['ownerModeEnabled', 'INTEGER DEFAULT 0'],
    ['autoApproveOwnerActions', 'INTEGER DEFAULT 1'],
    ['cashSweepEnabled', 'INTEGER DEFAULT 1'],
    ['cashDrawerLimit', 'REAL DEFAULT 5000'],
    ['salesTills', 'TEXT'],
    ['defaultOpeningFloat', 'REAL DEFAULT 0'],
    ['mpesaConsumerKey', 'TEXT'],
    ['mpesaConsumerSecret', 'TEXT'],
    ['mpesaPasskey', 'TEXT'],
    ['mpesaEnv', "TEXT DEFAULT 'sandbox'"],
    ['mpesaType', "TEXT DEFAULT 'paybill'"],
    ['mpesaStoreNumber', 'TEXT'],
    ['accessControl', 'TEXT'],
    ['businessId', 'TEXT'],
    ['updated_at', 'INTEGER'],
  ];
  for (const [name, type] of columns) {
    try {
      await db.prepare(`ALTER TABLE settings ADD COLUMN ${name} ${type}`).run();
    } catch {}
  }
}

async function ensurePickedCashAccount(db: D1Database, businessId: string) {
  await db.prepare('CREATE TABLE IF NOT EXISTS financialAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, businessId TEXT, accountNumber TEXT, updated_at INTEGER)').run();
  const id = `picked_cash_${businessId}`;
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
    VALUES (?, 'Main account', 'CASH', 0, ?, 'PICKED-CASH', ?)
  `).bind(id, businessId, now).run();
  await db.prepare(`
    UPDATE financialAccounts
    SET name = 'Main account', type = 'CASH', accountNumber = 'PICKED-CASH', updated_at = ?
    WHERE id = ? AND businessId = ?
  `).bind(now, id, businessId).run();
}

async function ensureFinancialAccountAdjustmentSchema(db: D1Database) {
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
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function trimText(value: unknown, max = 160): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.slice(0, max);
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

async function existingRowsById(db: D1Database, table: string, businessId: string, ids: string[]) {
  const rows = new Map<string, Record<string, any>>();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return rows;
  const placeholders = uniqueIds.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT * FROM ${table} WHERE businessId = ? AND id IN (${placeholders})`)
    .bind(businessId, ...uniqueIds)
    .all();
  (results as any[]).forEach(row => rows.set(String(row.id), deserializeRow(row)));
  return rows;
}

async function protectCustomerTotals(db: D1Database, businessId: string, principalRole: string, service: boolean, items: any[]) {
  if (service || isAdminLike(principalRole)) return;
  const existing = await existingRowsById(db, 'customers', businessId, items.map(item => String(item?.id || '').trim()));
  items.forEach(item => {
    const saved = existing.get(String(item?.id || '').trim());
    item.name = trimText(item.name, 120) || saved?.name || 'Customer';
    item.phone = trimText(item.phone, 40) || saved?.phone || '';
    item.email = trimText(item.email, 120) || saved?.email || '';
    item.totalSpent = Number(saved?.totalSpent || 0);
    item.balance = Number(saved?.balance || 0);
    delete item[LEGACY_SCOPE_COLUMN];
  });
}

async function hardenCustomerPaymentWrites(db: D1Database, businessId: string, principalName: string, items: any[]) {
  const sideEffects: D1PreparedStatement[] = [];
  const existing = await existingRowsById(db, 'customerPayments', businessId, items.map(item => String(item?.id || '').trim()));
  const methods = new Set(['CASH', 'MPESA', 'BANK', 'PDQ', 'CHEQUE']);
  const allocationTypes = new Set(['SALE', 'INVOICE']);
  const now = Date.now();

  for (const item of items) {
    const id = String(item?.id || '').trim();
    if (!id) throw new PolicyError('Customer payment ID is required.');
    if (existing.has(id)) throw new PolicyError('Customer payment records cannot be edited after saving.', 403);
    const customerId = trimText(item.customerId, 120);
    if (!customerId) throw new PolicyError('Customer is required for payment.');
    const amount = roundMoney(asNumber(item.amount));
    if (amount <= 0 || amount > 10_000_000) throw new PolicyError('Payment amount is invalid.');

    const method = String(item.paymentMethod || '').toUpperCase();
    item.customerId = customerId;
    item.amount = amount;
    item.paymentMethod = methods.has(method) ? method : 'CASH';
    item.transactionCode = trimText(item.transactionCode, 80);
    item.reference = trimText(item.reference, 160) || 'Customer payment';
    item.preparedBy = trimText(item.preparedBy, 120) || principalName;
    item.timestamp = Math.min(asNumber(item.timestamp, now), now + 5 * 60 * 1000);
    item.updated_at = now;
    delete item[LEGACY_SCOPE_COLUMN];

    let allocationTotal = 0;
    item.allocations = asArray(item.allocations)
      .slice(0, 50)
      .map((allocation) => {
        const sourceType = String(allocation?.sourceType || '').toUpperCase();
        const sourceId = trimText(allocation?.sourceId, 120);
        const allocationAmount = roundMoney(asNumber(allocation?.amount));
        return sourceType && sourceId && allocationTypes.has(sourceType) && allocationAmount > 0
          ? { sourceType, sourceId, amount: allocationAmount }
          : null;
      })
      .filter(Boolean);
    for (const allocation of item.allocations) allocationTotal += allocation.amount;
    if (allocationTotal > amount + 0.01) {
      throw new PolicyError('Payment allocations exceed the payment amount.', 400);
    }

    sideEffects.push(
      db.prepare(`UPDATE customers SET balance = MAX(0, COALESCE(balance, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(amount, now, customerId, businessId)
    );
    for (const allocation of item.allocations) {
      if (allocation.sourceType !== 'INVOICE') continue;
      sideEffects.push(
        db.prepare(
          `UPDATE salesInvoices
           SET paidAmount = MIN(COALESCE(total, 0), COALESCE(paidAmount, 0) + ?),
               balance = MAX(0, COALESCE(balance, total, 0) - ?),
               status = CASE WHEN MAX(0, COALESCE(balance, total, 0) - ?) <= 0 THEN 'PAID' ELSE 'PARTIAL' END,
               updated_at = ?
           WHERE id = ? AND customerId = ? AND businessId = ?`
        ).bind(allocation.amount, allocation.amount, allocation.amount, now, allocation.sourceId, customerId, businessId)
      );
    }
  }
  return sideEffects;
}

function looksLikeStoredPassword(value: string): boolean {
  return isPasswordHashCurrent(value)
    || /^[a-f0-9]{64}$/i.test(value)
    || value.startsWith('$2a$')
    || value.startsWith('$2b$')
    || value.startsWith('$2y$');
}

async function hardenUserWrites(db: D1Database, businessId: string, principalRole: string, principalUserId: string, service: boolean, items: any[]) {
  const existing = await existingRowsById(db, 'users', businessId, items.map(item => String(item?.id || '').trim()));
  const adminCountRow = await db.prepare("SELECT COUNT(*) AS count FROM users WHERE businessId = ? AND role = 'ADMIN'")
    .bind(businessId)
    .first<any>();
  const currentAdminCount = Number(adminCountRow?.count || 0);

  for (const item of items) {
    const id = String(item?.id || crypto.randomUUID()).trim();
    item.id = id;
    const saved = existing.get(id);
    const role = String(item.role || saved?.role || 'CASHIER').trim().toUpperCase();
    if (role === 'ROOT' || !['ADMIN', 'MANAGER', 'CASHIER'].includes(role)) {
      throw new PolicyError('Staff role is not allowed.', 403);
    }
    if (!service && principalRole !== 'ROOT' && saved?.role === 'ADMIN' && role !== 'ADMIN' && currentAdminCount <= 1) {
      throw new PolicyError('The last administrator cannot be changed.', 403);
    }

    item.name = trimText(item.name, 120) || saved?.name || 'Staff Member';
    item.role = role;
    item.mustChangePassword = Number(item.mustChangePassword ?? saved?.mustChangePassword ?? 0) ? 1 : 0;
    item.isBootstrapAdmin = Number(item.isBootstrapAdmin ?? saved?.isBootstrapAdmin ?? 0) ? 1 : 0;
    item.updated_at = Date.now();
    delete item[LEGACY_SCOPE_COLUMN];

    const providedPassword = String(item.password || '');
    if (providedPassword) {
      if (!service && looksLikeStoredPassword(providedPassword)) {
        throw new PolicyError('Password must be entered as text so the server can secure it.', 400);
      }
      item.password = isPasswordHashCurrent(providedPassword) ? providedPassword : await hashPassword(providedPassword);
    } else if (saved?.password) {
      item.password = saved.password;
    } else {
      throw new PolicyError('Password is required for new staff accounts.', 400);
    }
  }
}

function cleanLegacyScopeFields(items: any[]) {
  items.forEach(item => { delete item[LEGACY_SCOPE_COLUMN]; });
}

function redactRows(table: string, rows: Record<string, any>[]): Record<string, any>[] {
  if (table === 'users') return rows.map(row => {
    const out = { ...row };
    delete out.password;
    delete out.pin;
    delete out[LEGACY_SCOPE_COLUMN];
    return out;
  });
  return rows.map(row => {
    const out = { ...row };
    delete out[LEGACY_SCOPE_COLUMN];
    return out;
  });
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  try {
    const parts = (params.table as string[]) ?? [];
    const table = parts[0];
    const recordId = parts[1];

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const { principal, service } = auth;

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: secureJsonHeaders() });
    }

    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength) > 1_048_576) {
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: secureJsonHeaders() });
    }

    const requestedBusinessId = request.headers.get('X-Business-ID');
    const businessId = principal.role === 'ROOT' || service ? requestedBusinessId : principal.businessId;

    if (table === 'system') {
      if (recordId === 'ping') return new Response(JSON.stringify({ success: true, message: 'pong' }), { headers: jsonHeaders() });
      if (recordId === 'status') {
        if (principal.role !== 'ROOT' && !service) {
          return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        }
        return new Response(JSON.stringify({ success: true, hasDB: !!env.DB, hasSecret: !!env.API_SECRET }), { headers: jsonHeaders() });
      }
      if (recordId === 'setup') {
        if (principal.role !== 'ROOT' && !service) {
          return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        }
        await ensureCoreSchema(env.DB);
        return new Response(JSON.stringify({ success: true, message: 'Database initialized.' }), { headers: jsonHeaders() });
      }
    }

    if (!table || !ALLOWED_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: 'Table not allowed' }), { status: 400, headers: jsonHeaders() });
    }

    if (!canReadTable(principal.role, table, service)) {
      return new Response(JSON.stringify({ error: 'You are not allowed to open this data.' }), { status: 403, headers: jsonHeaders() });
    }

    if (HR_TABLES.has(table)) await ensureHrSchema(env.DB);
    if (table === 'users') await ensureUserSetupColumns(env.DB);
    if (table === 'settings') await ensureSettingsSchema(env.DB);
    if (table === 'financialAccounts' && businessId) await ensurePickedCashAccount(env.DB, businessId);
    if (table === 'financialAccountAdjustments') await ensureFinancialAccountAdjustmentSchema(env.DB);
    if (table === 'loginAttempts') {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
    }

    if (request.method === 'GET') {
      if (table === 'businesses') {
        const query = principal.role === 'ROOT' || service
          ? env.DB.prepare('SELECT id, name, code, isActive FROM businesses')
          : env.DB.prepare('SELECT id, name, code, isActive FROM businesses WHERE id = ?').bind(principal.businessId);
        const { results } = await query.all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }
      if (table === 'loginAttempts') {
        if (principal.role !== 'ROOT' && !service) {
          return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        }
        const { results } = await env.DB.prepare('SELECT * FROM loginAttempts').all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }

      if (!businessId || !canAccessBusiness(principal, businessId)) {
        return new Response(JSON.stringify({ error: 'X-Business-ID header required' }), { status: 400, headers: jsonHeaders() });
      }

      let results: any[] = [];
      if (table === 'users' && !isAdminLike(principal.role)) {
        const query = await env.DB.prepare('SELECT * FROM users WHERE businessId = ? AND id = ?')
          .bind(businessId, principal.userId)
          .all();
        results = (query.results as any[]) || [];
      } else if (table === 'financialAccounts') {
        const query = await env.DB.prepare('SELECT * FROM financialAccounts WHERE businessId = ? AND id = ? LIMIT 1')
          .bind(businessId, `picked_cash_${businessId}`)
          .all();
        results = (query.results as any[]) || [];
      } else if ((table === 'suppliers' || table === 'expenseAccounts') && principal.role === 'CASHIER') {
        results = [];
      } else {
        const query = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ?`).bind(businessId).all();
        results = (query.results as any[]) || [];
      }
      return new Response(JSON.stringify(redactRows(table, results.map(deserializeRow))), { headers: jsonHeaders() });
    }

    if (request.method === 'POST') {
      const body = await request.json() as any;
      const items = Array.isArray(body) ? body : [body];
      if (items.length === 0) return new Response(JSON.stringify({ success: true, count: 0 }), { headers: jsonHeaders() });
      if (items.length > 250) return new Response(JSON.stringify({ error: 'Too many records in one request' }), { status: 413, headers: jsonHeaders() });

      if (table === 'businesses') {
        if (principal.role !== 'ROOT' && !service) {
          return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        }
        items.forEach(item => {
          if (typeof item?.code === 'string') item.code = item.code.trim().toUpperCase();
        });
      }

      if (table === 'loginAttempts' && principal.role !== 'ROOT' && !service) {
        return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
      }

      if (!canWriteTable(principal.role, table, service)) {
        return new Response(JSON.stringify({ error: 'You are not allowed to change this data.' }), { status: 403, headers: jsonHeaders() });
      }

      if (!service && COMMAND_ONLY_WRITE_TABLES.has(table)) {
        return new Response(JSON.stringify({ error: `Writes to ${table} must use the domain API.` }), { status: 409, headers: jsonHeaders() });
      }

      if (!UNSCOPED_TABLES.has(table)) {
        if (!businessId || !canAccessBusiness(principal, businessId)) {
          return new Response(JSON.stringify({ error: 'X-Business-ID header required for POST' }), { status: 400, headers: jsonHeaders() });
        }
        items.forEach(item => { item.businessId = businessId; });
      }
      cleanLegacyScopeFields(items);

      if (table === 'financialAccounts' && businessId) {
        const existing = await env.DB.prepare('SELECT id, balance FROM financialAccounts WHERE businessId = ? AND id = ? LIMIT 1')
          .bind(businessId, `picked_cash_${businessId}`)
          .first<any>();
        items.splice(0, items.length, {
          id: `picked_cash_${businessId}`,
          name: 'Main account',
          type: 'CASH',
          accountNumber: 'PICKED-CASH',
          balance: existing ? asNumber(existing.balance) : 0,
          businessId,
          updated_at: Date.now(),
        });
      }

      let sideEffects: D1PreparedStatement[] = [];
      try {
        if (table === 'users') {
          await hardenUserWrites(env.DB, businessId!, principal.role, principal.userId, service, items);
        }
        if (table === 'customers') {
          await protectCustomerTotals(env.DB, businessId!, principal.role, service, items);
        }
        if (table === 'suppliers') {
          cleanLegacyScopeFields(items);
        }
        if (table === 'customerPayments') {
          sideEffects.push(...await hardenCustomerPaymentWrites(env.DB, businessId!, principal.userName, items));
        }
        if (table === 'transactions') {
          sideEffects = await hardenTransactionBatch({
            db: env.DB,
            businessId: businessId!,
            principal,
            service,
          }, items);
        }
      } catch (err: any) {
        const status = err instanceof PolicyError ? err.status : 400;
        return new Response(JSON.stringify({ error: err?.message || 'Request was rejected.' }), { status, headers: jsonHeaders() });
      }

      const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('${table}')`).all();
      const validCols = new Set(pragma.map((r: any) => r.name));
      const cols = Object.keys(items[0]).filter(k => validCols.has(k));
      if (cols.length === 0) return new Response(JSON.stringify({ error: 'No valid columns to insert' }), { status: 400, headers: jsonHeaders() });

      const sql = `INSERT OR REPLACE INTO ${table} (${cols.map(c => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const stmt = env.DB.prepare(sql);
      const batch = items.map(item => stmt.bind(...cols.map(col => serializeValue(item[col]))));
      await env.DB.batch([...batch, ...sideEffects]);
      return new Response(JSON.stringify({ success: true, count: items.length }), { headers: jsonHeaders() });
    }

    if (request.method === 'DELETE') {
      let id = recordId;
      if (!id) {
        const body = await request.json() as any;
        id = body?.id;
      }
      if (!id) return new Response(JSON.stringify({ error: 'ID required for DELETE' }), { status: 400, headers: jsonHeaders() });

      if (!service && COMMAND_ONLY_WRITE_TABLES.has(table)) {
        return new Response(JSON.stringify({ error: `Deletes from ${table} must use the domain API.` }), { status: 409, headers: jsonHeaders() });
      }

      if (table === 'businesses') {
        if (principal.role !== 'ROOT' && !service) return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        const cascadeTables = Array.from(ALLOWED_TABLES).filter(t => !UNSCOPED_TABLES.has(t) && t !== 'system');
        const batch = cascadeTables.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE businessId = ?`).bind(id));
        batch.push(env.DB.prepare('DELETE FROM businesses WHERE id = ?').bind(id));
        await env.DB.batch(batch);
      } else if (table === 'loginAttempts') {
        if (principal.role !== 'ROOT' && !service) return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        await env.DB.prepare('DELETE FROM loginAttempts WHERE id = ?').bind(id).run();
      } else {
        if (!businessId || !canAccessBusiness(principal, businessId)) {
          return new Response(JSON.stringify({ error: 'X-Business-ID required for DELETE' }), { status: 400, headers: jsonHeaders() });
        }
        if (!canDeleteTable(principal.role, table, service)) {
          if (table !== 'transactions' || principal.role !== 'CASHIER') {
            return new Response(JSON.stringify({ error: 'You are not allowed to delete this data.' }), { status: 403, headers: jsonHeaders() });
          }
          const transaction = await env.DB.prepare('SELECT cashierId, timestamp FROM transactions WHERE id = ? AND businessId = ? LIMIT 1')
            .bind(id, businessId)
            .first<any>();
          const isOwnRecentSale = transaction
            && String(transaction.cashierId || '') === principal.userId
            && Date.now() - Number(transaction.timestamp || 0) <= 2 * 60 * 1000;
          if (!isOwnRecentSale) {
            return new Response(JSON.stringify({ error: 'Cashier accounts can only undo their own just-created sale.' }), { status: 403, headers: jsonHeaders() });
          }
        }
        if (table === 'financialAccounts') {
          return new Response(JSON.stringify({ error: 'The Main account is built in and cannot be deleted.' }), { status: 409, headers: jsonHeaders() });
        }
        if (table === 'users' && !service && principal.role !== 'ROOT') {
          if (id === principal.userId) {
            return new Response(JSON.stringify({ error: 'You cannot delete your own signed-in account.' }), { status: 403, headers: jsonHeaders() });
          }
          const user = await env.DB.prepare('SELECT role FROM users WHERE id = ? AND businessId = ? LIMIT 1')
            .bind(id, businessId)
            .first<any>();
          if (user?.role === 'ADMIN') {
            const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE businessId = ? AND role = 'ADMIN'")
              .bind(businessId)
              .first<any>();
            if (Number(row?.count || 0) <= 1) {
              return new Response(JSON.stringify({ error: 'The last administrator cannot be deleted.' }), { status: 403, headers: jsonHeaders() });
            }
          }
        }
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ?`).bind(id, businessId).run();
      }
      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders() });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders() });
  } catch (err: any) {
    console.error('[Worker Error]', err);
    return new Response(JSON.stringify({ error: 'Request failed.' }), { status: 500, headers: jsonHeaders() });
  }
};
