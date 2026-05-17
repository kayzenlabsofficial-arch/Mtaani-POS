import { authorizeRequest, canAccessBranch, canAccessBusiness, hashPassword, isPasswordHashCurrent } from '../authUtils';
import { hardenTransactionBatch, PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ALLOWED_TABLES = new Set([
  'users', 'products', 'transactions', 'cashPicks', 'shifts',
  'endOfDayReports', 'stockMovements', 'expenses', 'customers',
  'customerPayments', 'serviceItems', 'salesInvoices', 'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries',
  'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories',
  'branches', 'businesses', 'system', 'expenseAccounts', 'financialAccounts', 'productIngredients', 'loginAttempts'
]);

// Global tables: shared across branches, isolated by businessId
const GLOBAL_TABLES = new Set(['users', 'branches', 'settings', 'expenseAccounts', 'financialAccounts', 'customers', 'serviceItems', 'suppliers', 'products', 'productIngredients', 'categories']);
// Truly unscoped tables: not filtered by businessId/branchId
const UNSCOPED_TABLES = new Set(['businesses', 'loginAttempts']);
const ADMIN_WRITE_TABLES = new Set(['users', 'branches', 'settings', 'expenseAccounts', 'financialAccounts', 'categories']);
const MANAGER_WRITE_TABLES = new Set([
  'products', 'productIngredients', 'serviceItems', 'suppliers',
  'purchaseOrders', 'supplierPayments', 'creditNotes', 'salesInvoices',
  'stockMovements', 'expenses',
]);
const CASHIER_WRITE_TABLES = new Set([
  'transactions', 'customers', 'customerPayments', 'shifts',
  'cashPicks', 'endOfDayReports', 'dailySummaries', 'stockAdjustmentRequests',
]);
const STAFF_ROLES = new Set(['ADMIN', 'MANAGER', 'CASHIER']);
const MANAGER_DELETE_TABLES = new Set([
  'products', 'productIngredients', 'serviceItems', 'suppliers',
  'purchaseOrders', 'supplierPayments', 'creditNotes', 'salesInvoices',
  'customers', 'expenses', 'stockAdjustmentRequests',
]);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID'
};

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders };
}

function secureJsonHeaders() {
  return {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, isActive INTEGER DEFAULT 1, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, businessId TEXT, branchId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, sellingPrice REAL NOT NULL, costPrice REAL, taxCategory TEXT NOT NULL, stockQuantity REAL NOT NULL, unit TEXT, barcode TEXT NOT NULL, imageUrl TEXT, reorderPoint REAL, isBundle INTEGER DEFAULT 0, components TEXT, businessId TEXT, branchId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total REAL NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, discountAmount REAL, discountReason TEXT, items TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, paymentMethod TEXT, amountTendered REAL, changeGiven REAL, mpesaReference TEXT, mpesaCode TEXT, mpesaCustomer TEXT, mpesaCheckoutRequestId TEXT, cashierId TEXT, cashierName TEXT, customerId TEXT, customerName TEXT, discount REAL, discountType TEXT, splitPayments TEXT, splitData TEXT, isSynced INTEGER, approvedBy TEXT, pendingRefundItems TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS cashPicks (id TEXT PRIMARY KEY, amount REAL NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, userName TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, startTime INTEGER NOT NULL, endTime INTEGER, openingFloat REAL, cashierName TEXT NOT NULL, status TEXT NOT NULL, branchId TEXT, lastSyncAt INTEGER, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS endOfDayReports (id TEXT PRIMARY KEY, shiftId TEXT, timestamp INTEGER NOT NULL, openingFloat REAL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, cashSales REAL NOT NULL, mpesaSales REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalRefunds REAL, expectedCash REAL NOT NULL, reportedCash REAL NOT NULL, difference REAL NOT NULL, cashierName TEXT NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT, timestamp INTEGER NOT NULL, userName TEXT, status TEXT NOT NULL, source TEXT, accountId TEXT, productId TEXT, quantity REAL, preparedBy TEXT, approvedBy TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, totalSpent REAL, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS customerPayments (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, reference TEXT, allocations TEXT, timestamp INTEGER NOT NULL, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS serviceItems (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, price REAL NOT NULL, taxCategory TEXT DEFAULT 'A', isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS salesInvoices (id TEXT PRIMARY KEY, invoiceNumber TEXT NOT NULL, customerId TEXT NOT NULL, customerName TEXT, customerPhone TEXT, customerEmail TEXT, items TEXT NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, paidAmount REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT NOT NULL, issueDate INTEGER NOT NULL, dueDate INTEGER, notes TEXT, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS supplierPayments (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, purchaseOrderId TEXT, purchaseOrderIds TEXT, creditNoteIds TEXT, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, timestamp INTEGER NOT NULL, reference TEXT, source TEXT, accountId TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS creditNotes (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, amount REAL NOT NULL, reference TEXT NOT NULL, timestamp INTEGER NOT NULL, reason TEXT, status TEXT DEFAULT 'PENDING', allocatedTo TEXT, productId TEXT, quantity REAL, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS dailySummaries (id TEXT PRIMARY KEY, date INTEGER NOT NULL, shiftIds TEXT NOT NULL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalVariance REAL NOT NULL, timestamp INTEGER NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT, oldQty REAL, newQty REAL, requestedQuantity REAL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, preparedBy TEXT, approvedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS purchaseOrders (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, items TEXT NOT NULL, totalAmount REAL NOT NULL, status TEXT NOT NULL, approvalStatus TEXT NOT NULL, paymentStatus TEXT, paidAmount REAL, orderDate INTEGER NOT NULL, expectedDate INTEGER, receivedDate INTEGER, invoiceNumber TEXT, poNumber TEXT, preparedBy TEXT, approvedBy TEXT, receivedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, storeName TEXT NOT NULL, location TEXT, tillNumber TEXT, kraPin TEXT, receiptFooter TEXT, ownerModeEnabled INTEGER DEFAULT 0, autoApproveOwnerActions INTEGER DEFAULT 1, cashSweepEnabled INTEGER DEFAULT 1, cashDrawerLimit REAL DEFAULT 5000, cashFloatTarget REAL DEFAULT 1000, aiAssistantEnabled INTEGER DEFAULT 1, aiDailyRequestLimit INTEGER DEFAULT 20, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, iconName TEXT NOT NULL, color TEXT NOT NULL, businessId TEXT, branchId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, phone TEXT, tillNumber TEXT, kraPin TEXT, isActive INTEGER NOT NULL DEFAULT 1, businessId TEXT, mpesaConsumerKey TEXT, mpesaConsumerSecret TEXT, mpesaPasskey TEXT, mpesaEnv TEXT, mpesaType TEXT DEFAULT 'paybill', mpesaStoreNumber TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS expenseAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS financialAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, businessId TEXT, branchId TEXT, accountNumber TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS mpesaCallbacks (checkoutRequestId TEXT PRIMARY KEY, merchantRequestId TEXT, resultCode INTEGER, resultDesc TEXT, amount REAL, receiptNumber TEXT, phoneNumber TEXT, businessId TEXT, branchId TEXT, timestamp INTEGER, utilizedTransactionId TEXT, utilizedCustomerId TEXT, utilizedCustomerName TEXT, utilizedAt INTEGER);
CREATE TABLE IF NOT EXISTS deviceSyncStatus (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, deviceId TEXT NOT NULL, cashierName TEXT, lastSyncAt INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt);
CREATE TABLE IF NOT EXISTS idempotencyKeys (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, idempotencyKey TEXT NOT NULL, operation TEXT NOT NULL, deviceId TEXT, cashierName TEXT, createdAt INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey);
CREATE TABLE IF NOT EXISTS aiUsage (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, userId TEXT NOT NULL, userName TEXT, branchId TEXT, day TEXT NOT NULL, count INTEGER DEFAULT 0, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_aiUsage_scope ON aiUsage(businessId, userId, day);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER);
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

async function protectCustomerTotals(db: D1Database, businessId: string, branchId: string | null, principalRole: string, service: boolean, items: any[]) {
  if (service || isAdminLike(principalRole)) return;
  if (!branchId) throw new PolicyError('Branch is required for customer changes.', 400);
  const existing = await existingRowsById(db, 'customers', businessId, items.map(item => String(item?.id || '').trim()));
  items.forEach(item => {
    const saved = existing.get(String(item?.id || '').trim());
    if (saved?.branchId && saved.branchId !== branchId) {
      throw new PolicyError('You cannot change customers from another branch.', 403);
    }
    item.name = trimText(item.name, 120) || saved?.name || 'Customer';
    item.phone = trimText(item.phone, 40) || saved?.phone || '';
    item.email = trimText(item.email, 120) || saved?.email || '';
    item.totalSpent = Number(saved?.totalSpent || 0);
    item.balance = Number(saved?.balance || 0);
    item.branchId = saved?.branchId || branchId;
  });
}

async function hardenCustomerPaymentWrites(db: D1Database, businessId: string, branchId: string, principalName: string, items: any[]) {
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
    if (role === 'ROOT' || !STAFF_ROLES.has(role)) {
      throw new PolicyError('Staff role is not allowed.', 403);
    }
    if (!service && principalRole !== 'ROOT' && saved?.role === 'ADMIN' && role !== 'ADMIN' && currentAdminCount <= 1) {
      throw new PolicyError('The last administrator cannot be changed.', 403);
    }

    item.name = trimText(item.name, 120) || saved?.name || 'Staff Member';
    item.role = role;
    item.branchId = role === 'ADMIN' ? (trimText(item.branchId, 120) || null) : (trimText(item.branchId, 120) || saved?.branchId || null);
    item.updated_at = Date.now();

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

async function enforceGlobalBranchOwnership(db: D1Database, table: string, businessId: string, branchId: string | null, principalRole: string, service: boolean, items: any[]) {
  if (service || isAdminLike(principalRole)) return;
  if (!branchId) throw new PolicyError('Branch is required for this change.', 400);
  if (table !== 'suppliers') return;
  const existing = await existingRowsById(db, table, businessId, items.map(item => String(item?.id || '').trim()));
  items.forEach(item => {
    const saved = existing.get(String(item?.id || '').trim());
    if (saved?.branchId && saved.branchId !== branchId) {
      throw new PolicyError('You cannot change records from another branch.', 403);
    }
    item.branchId = saved?.branchId || branchId;
  });
}

const BRANCH_MPESA_LOCKED_FIELDS = [
  'mpesaConsumerKey',
  'mpesaConsumerSecret',
  'mpesaPasskey',
  'mpesaEnv',
  'mpesaType',
  'mpesaStoreNumber',
];

function redactBranch(row: Record<string, any>): Record<string, any> {
  const out = { ...row };
  out.mpesaConsumerKeySet = !!row.mpesaConsumerKey;
  out.mpesaConsumerSecretSet = !!row.mpesaConsumerSecret;
  out.mpesaPasskeySet = !!row.mpesaPasskey;
  out.mpesaConfigured = !!(row.mpesaConsumerKey && row.mpesaConsumerSecret && row.mpesaPasskey);
  out.mpesaEnv = row.mpesaEnv || 'sandbox';
  out.mpesaType = row.mpesaType || 'paybill';
  out.mpesaStoreNumber = row.mpesaStoreNumber ? 'Saved' : '';
  delete out.mpesaConsumerKey;
  delete out.mpesaConsumerSecret;
  delete out.mpesaPasskey;
  return out;
}

function redactRows(table: string, rows: Record<string, any>[]): Record<string, any>[] {
  if (table === 'branches') return rows.map(redactBranch);
  if (table === 'users') return rows.map(row => {
    const out = { ...row };
    delete out.password;
    delete out.pin;
    return out;
  });
  return rows;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  try {
    const parts = (params.table as string[]) ?? [];
    const table = parts[0];
    const recordId = parts[1];

    // Allow CORS preflight
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // ── Auth: ALL endpoints require a valid API key ───────────────────────────
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const { principal, service } = auth;

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: secureJsonHeaders() });
    }

    // ── Request size limit (1MB) ─────────────────────────────────────────────
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength) > 1_048_576) {
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: secureJsonHeaders() });
    }

    const requestedBusinessId = request.headers.get('X-Business-ID');
    const businessId = principal.role === 'ROOT' || service ? requestedBusinessId : principal.businessId;
    const branchId = request.headers.get('X-Branch-ID');

    // ── System / Schema Setup ────────────────────────────────────────────────
    if (table === 'system') {
      if (recordId === 'ping') {
        return new Response(JSON.stringify({ success: true, message: 'pong' }), { headers: jsonHeaders() });
      }
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
        const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
        for (const s of statements) {
          try { await env.DB.prepare(s).run(); } catch (e) {}
        }
        // Migrations: add new columns if they don't exist
        const migrationCols: [string, string][] = [
          ['products',   'unit TEXT'],
          ['products',   'branchId TEXT'],
          ['products',   'costPrice REAL'],
          ['products',   "taxCategory TEXT DEFAULT 'A'"],
          ['products',   'reorderPoint REAL'],
          ['products',   'isBundle INTEGER DEFAULT 0'],
          ['products',   'components TEXT'],
          ['transactions', 'shiftId TEXT'],
          ['transactions', 'approvedBy TEXT'],
          ['transactions', 'pendingRefundItems TEXT'],
          ['transactions', 'changeGiven REAL'],
          ['transactions', 'mpesaReference TEXT'],
          ['transactions', 'mpesaCode TEXT'],
          ['transactions', 'mpesaCustomer TEXT'],
          ['transactions', 'mpesaCheckoutRequestId TEXT'],
          ['transactions', 'cashierId TEXT'],
          ['transactions', 'customerId TEXT'],
          ['transactions', 'customerName TEXT'],
          ['transactions', 'discount REAL'],
          ['transactions', 'discountType TEXT'],
          ['transactions', 'splitPayments TEXT'],
          ['transactions', 'splitData TEXT'],
          ['transactions', 'isSynced INTEGER'],
          ['customerPayments', 'allocations TEXT'],
          ['categories', 'branchId TEXT'],
          ['shifts',     'lastSyncAt INTEGER'],
          ['shifts',     'openingFloat REAL'],
          ['businesses', 'isActive INTEGER DEFAULT 1'],
          ['stockAdjustmentRequests', 'preparedBy TEXT'],
          ['stockAdjustmentRequests', 'approvedBy TEXT'],
          ['users',      'branchId TEXT'],
          ['cashPicks',  'shiftId TEXT'],
          ['stockMovements', 'shiftId TEXT'],
          ['expenses',   'source TEXT'],
          ['expenses',   'accountId TEXT'],
          ['expenses',   'productId TEXT'],
          ['expenses',   'quantity REAL'],
          ['expenses',   'preparedBy TEXT'],
          ['expenses',   'approvedBy TEXT'],
          ['expenses',   'shiftId TEXT'],
          ['supplierPayments', 'source TEXT'],
          ['supplierPayments', 'accountId TEXT'],
          ['supplierPayments', 'shiftId TEXT'],
          ['supplierPayments', 'creditNoteIds TEXT'],
          ['supplierPayments', 'reference TEXT'],
          ['creditNotes', "status TEXT DEFAULT 'PENDING'"],
          ['creditNotes', 'allocatedTo TEXT'],
          ['creditNotes', 'shiftId TEXT'],
          ['creditNotes', 'productId TEXT'],
          ['creditNotes', 'quantity REAL'],
          ['purchaseOrders', 'poNumber TEXT'],
          ['purchaseOrders', 'preparedBy TEXT'],
          ['purchaseOrders', 'approvedBy TEXT'],
          ['purchaseOrders', 'receivedBy TEXT'],
          ['endOfDayReports', 'totalRefunds REAL'],
          ['financialAccounts', 'accountNumber TEXT'],
          ['branches', 'mpesaConsumerKey TEXT'],
          ['branches', 'mpesaConsumerSecret TEXT'],
          ['branches', 'mpesaPasskey TEXT'],
          ['branches', 'mpesaEnv TEXT'],
          ['branches', "mpesaType TEXT DEFAULT 'paybill'"],
          ['branches', 'mpesaStoreNumber TEXT'],
          ['settings', 'location TEXT'],
          ['settings', 'ownerModeEnabled INTEGER DEFAULT 0'],
          ['settings', 'autoApproveOwnerActions INTEGER DEFAULT 1'],
          ['settings', 'cashSweepEnabled INTEGER DEFAULT 1'],
          ['settings', 'cashDrawerLimit REAL DEFAULT 5000'],
          ['settings', 'cashFloatTarget REAL DEFAULT 1000'],
          ['settings', 'aiAssistantEnabled INTEGER DEFAULT 1'],
          ['settings', 'aiDailyRequestLimit INTEGER DEFAULT 20'],
          ['mpesaCallbacks', 'utilizedTransactionId TEXT'],
          ['mpesaCallbacks', 'utilizedCustomerId TEXT'],
          ['mpesaCallbacks', 'utilizedCustomerName TEXT'],
          ['mpesaCallbacks', 'utilizedAt INTEGER'],
        ];
        const allTables = ['users', 'products', 'productIngredients', 'transactions', 'cashPicks', 'shifts', 'endOfDayReports', 'stockMovements', 'expenses', 'customers', 'customerPayments', 'serviceItems', 'salesInvoices', 'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries', 'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories', 'branches', 'financialAccounts'];
        for (const t of allTables) {
          try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN businessId TEXT`).run(); } catch (e) {}
        }
        for (const [t, col] of migrationCols) {
          try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${col}`).run(); } catch (e) {}
        }
        return new Response(JSON.stringify({ success: true, message: 'Database initialized.' }), { headers: jsonHeaders() });
      }
    }

    // ── Table Allow-list check ───────────────────────────────────────────────
    if (!table || !ALLOWED_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: 'Table not allowed' }), { status: 400, headers: jsonHeaders() });
    }

    if (table === 'loginAttempts') {
      // Defensive migration for environments where /system/setup has not run yet.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
    }

    if (table === 'productIngredients') {
      // Defensive migration for deployed databases that predate bundle ingredients.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)').run();
    }

    if (table === 'customerPayments') {
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS customerPayments (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, reference TEXT, allocations TEXT, timestamp INTEGER NOT NULL, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER)').run();
      try { await env.DB.prepare('ALTER TABLE customerPayments ADD COLUMN allocations TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE salesInvoices ADD COLUMN paidAmount REAL DEFAULT 0').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE salesInvoices ADD COLUMN balance REAL DEFAULT 0').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE salesInvoices ADD COLUMN status TEXT DEFAULT \'SENT\'').run(); } catch (e) {}
    }

    if (table === 'serviceItems') {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS serviceItems (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, description TEXT, price REAL NOT NULL, taxCategory TEXT DEFAULT 'A', isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER)").run();
    }

    if (table === 'salesInvoices') {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS salesInvoices (id TEXT PRIMARY KEY, invoiceNumber TEXT NOT NULL, customerId TEXT NOT NULL, customerName TEXT, customerPhone TEXT, customerEmail TEXT, items TEXT NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, paidAmount REAL DEFAULT 0, balance REAL DEFAULT 0, status TEXT NOT NULL, issueDate INTEGER NOT NULL, dueDate INTEGER, notes TEXT, preparedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER)").run();
    }

    if (table === 'transactions') {
      // Cash sales now validate products and write stock movements atomically.
      // Older D1 databases may be missing columns needed by that side-effect path.
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN branchId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN businessId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN shiftId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN approvedBy TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN changeGiven REAL').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN mpesaReference TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN mpesaCode TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN cashierId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN customerId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN customerName TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN discount REAL').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN discountType TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN splitPayments TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN splitData TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE transactions ADD COLUMN isSynced INTEGER').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN businessId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN branchId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN unit TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN costPrice REAL').run(); } catch (e) {}
      try { await env.DB.prepare("ALTER TABLE products ADD COLUMN taxCategory TEXT DEFAULT 'A'").run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN components TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN updated_at INTEGER').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE customers ADD COLUMN totalSpent REAL').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE customers ADD COLUMN balance REAL').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE customers ADD COLUMN businessId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE customers ADD COLUMN updated_at INTEGER').run(); } catch (e) {}
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)').run();
      try { await env.DB.prepare('ALTER TABLE productIngredients ADD COLUMN businessId TEXT').run(); } catch (e) {}
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)').run();
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER)').run();
      try { await env.DB.prepare('ALTER TABLE stockMovements ADD COLUMN reference TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE stockMovements ADD COLUMN branchId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE stockMovements ADD COLUMN businessId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE stockMovements ADD COLUMN shiftId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER').run(); } catch (e) {}
    }

    if (table === 'products') {
      // Product catalog fields were added across multiple releases; keep old D1 databases usable.
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN unit TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN branchId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN costPrice REAL').run(); } catch (e) {}
      try { await env.DB.prepare("ALTER TABLE products ADD COLUMN taxCategory TEXT DEFAULT 'A'").run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN reorderPoint REAL').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN components TEXT').run(); } catch (e) {}
    }

    if (table === 'expenses') {
      // Keep item-based expenses durable across deployments that predate shop-use tracking.
      try { await env.DB.prepare('ALTER TABLE expenses ADD COLUMN productId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE expenses ADD COLUMN quantity REAL').run(); } catch (e) {}
    }

    if (table === 'settings') {
      // Owner-mode settings were added after the base table existed in some D1 databases.
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN ownerModeEnabled INTEGER DEFAULT 0').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN autoApproveOwnerActions INTEGER DEFAULT 1').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN cashSweepEnabled INTEGER DEFAULT 1').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN cashDrawerLimit REAL DEFAULT 5000').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN cashFloatTarget REAL DEFAULT 1000').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN aiAssistantEnabled INTEGER DEFAULT 1').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE settings ADD COLUMN aiDailyRequestLimit INTEGER DEFAULT 20').run(); } catch (e) {}
    }

    if (table === 'creditNotes') {
      // Preserve stock-return details for supplier credits.
      try { await env.DB.prepare("ALTER TABLE creditNotes ADD COLUMN status TEXT DEFAULT 'PENDING'").run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE creditNotes ADD COLUMN allocatedTo TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE creditNotes ADD COLUMN shiftId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE creditNotes ADD COLUMN productId TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE creditNotes ADD COLUMN quantity REAL').run(); } catch (e) {}
    }

    if (table === 'branches') {
      // Branch-level Daraja credentials were added after the original branch table.
      try { await env.DB.prepare('ALTER TABLE branches ADD COLUMN mpesaConsumerKey TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE branches ADD COLUMN mpesaConsumerSecret TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE branches ADD COLUMN mpesaPasskey TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE branches ADD COLUMN mpesaEnv TEXT').run(); } catch (e) {}
      try { await env.DB.prepare("ALTER TABLE branches ADD COLUMN mpesaType TEXT DEFAULT 'paybill'").run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE branches ADD COLUMN mpesaStoreNumber TEXT').run(); } catch (e) {}
    }

    // ── GET ──────────────────────────────────────────────────────────────────
    if (request.method === 'GET') {
      if (table === 'businesses') {
        const query = principal.role === 'ROOT' || service
          ? env.DB.prepare(`SELECT id, name, code, isActive FROM businesses`)
          : env.DB.prepare(`SELECT id, name, code, isActive FROM businesses WHERE id = ?`).bind(principal.businessId);
        const { results } = await query.all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }
      if (table === 'loginAttempts') {
        if (principal.role !== 'ROOT' && !service) {
          return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        }
        const { results } = await env.DB.prepare(`SELECT * FROM loginAttempts`).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }

      if (!businessId || !canAccessBusiness(principal, businessId)) {
        return new Response(JSON.stringify({ error: 'X-Business-ID header required' }), { status: 400, headers: jsonHeaders() });
      }
      if (branchId && !canAccessBranch(principal, branchId)) {
        return new Response(JSON.stringify({ error: 'Branch access denied' }), { status: 403, headers: jsonHeaders() });
      }

      // Branch-scoped tables MUST be requested with an explicit branchId.
      // Otherwise a caller could read all branch data for a business in one request.
      if (!GLOBAL_TABLES.has(table) && !branchId) {
        return new Response(JSON.stringify({ error: 'X-Branch-ID header required for this table' }), { status: 400, headers: jsonHeaders() });
      }

      if (GLOBAL_TABLES.has(table)) {
        let results: any[] = [];
        if (table === 'users' && !isAdminLike(principal.role)) {
          const query = await env.DB.prepare(`SELECT * FROM users WHERE businessId = ? AND id = ?`)
            .bind(businessId, principal.userId)
            .all();
          results = (query.results as any[]) || [];
        } else if (table === 'branches' && !isAdminLike(principal.role) && principal.branchId) {
          const query = await env.DB.prepare(`SELECT * FROM branches WHERE businessId = ? AND id = ?`)
            .bind(businessId, principal.branchId)
            .all();
          results = (query.results as any[]) || [];
        } else if (table === 'customers' && principal.role === 'CASHIER' && branchId) {
          const query = await env.DB.prepare(`SELECT * FROM customers WHERE businessId = ? AND (branchId IS NULL OR branchId = ?)`)
            .bind(businessId, branchId)
            .all();
          results = (query.results as any[]) || [];
        } else if (table === 'financialAccounts' && principal.role === 'CASHIER') {
          results = [];
        } else if ((table === 'suppliers' || table === 'expenseAccounts') && principal.role === 'CASHIER') {
          results = [];
        } else if (table === 'financialAccounts' && principal.role === 'MANAGER' && principal.branchId) {
          const query = await env.DB.prepare(`SELECT * FROM financialAccounts WHERE businessId = ? AND (branchId IS NULL OR branchId = ?)`)
            .bind(businessId, principal.branchId)
            .all();
          results = (query.results as any[]) || [];
        } else {
          const query = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ?`).bind(businessId).all();
          results = (query.results as any[]) || [];
        }
        return new Response(JSON.stringify(redactRows(table, results.map(deserializeRow))), { headers: jsonHeaders() });
      } else {
        // Branch-specific table (and branchId is provided)
        const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ? AND branchId = ?`).bind(businessId, branchId).all();
        return new Response(JSON.stringify(redactRows(table, results.map(deserializeRow))), { headers: jsonHeaders() });
      }
    }

    // ── POST (upsert) ────────────────────────────────────────────────────────
    if (request.method === 'POST') {
      const body = await request.json() as any;
      const items = Array.isArray(body) ? body : [body];
      if (items.length === 0) return new Response(JSON.stringify({ success: true, count: 0 }), { headers: jsonHeaders() });
      if (items.length > 250) return new Response(JSON.stringify({ error: 'Too many records in one request' }), { status: 413, headers: jsonHeaders() });

      // Normalize business code to uppercase at write time.
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

      if (table === 'branches') {
        items.forEach(item => {
          for (const field of BRANCH_MPESA_LOCKED_FIELDS) delete item[field];
        });
      }

      if (!UNSCOPED_TABLES.has(table)) {
        if (!businessId || !canAccessBusiness(principal, businessId)) {
          return new Response(JSON.stringify({ error: 'X-Business-ID header required for POST' }), { status: 400, headers: jsonHeaders() });
        }
        // Always stamp businessId from the trusted header (not client body)
        items.forEach(item => { item.businessId = businessId; });

        // Stamp branchId for branch-specific tables
        if (!GLOBAL_TABLES.has(table)) {
          if (!branchId || !canAccessBranch(principal, branchId)) {
            return new Response(JSON.stringify({ error: 'X-Branch-ID header required for POST to this table' }), { status: 400, headers: jsonHeaders() });
          }
          items.forEach(item => { item.branchId = branchId; });
        }
      }

      if (table === 'settings' && principal.role !== 'ROOT' && !service) {
        for (const item of items) {
          const existing = item?.id
            ? await env.DB.prepare('SELECT aiAssistantEnabled, aiDailyRequestLimit FROM settings WHERE id = ? AND businessId = ? LIMIT 1')
              .bind(item.id, businessId)
              .first<any>()
            : null;
          if (existing) {
            item.aiAssistantEnabled = existing.aiAssistantEnabled;
            item.aiDailyRequestLimit = existing.aiDailyRequestLimit;
          } else {
            delete item.aiAssistantEnabled;
            delete item.aiDailyRequestLimit;
          }
        }
      }

      let sideEffects: D1PreparedStatement[] = [];
      try {
        if (table === 'users') {
          await hardenUserWrites(env.DB, businessId!, principal.role, principal.userId, service, items);
        }
        if (table === 'customers') {
          await protectCustomerTotals(env.DB, businessId!, branchId, principal.role, service, items);
        }
        if (table === 'suppliers') {
          await enforceGlobalBranchOwnership(env.DB, table, businessId!, branchId, principal.role, service, items);
        }
        if (table === 'customerPayments') {
          sideEffects.push(...await hardenCustomerPaymentWrites(env.DB, businessId!, branchId!, principal.userName, items));
        }
        if (table === 'transactions') {
          sideEffects = await hardenTransactionBatch({
            db: env.DB,
            businessId: businessId!,
            branchId: branchId!,
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

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (request.method === 'DELETE') {
      let id = recordId;
      if (!id) {
        const body = await request.json() as any;
        id = body?.id;
      }
      if (!id) return new Response(JSON.stringify({ error: 'ID required for DELETE' }), { status: 400, headers: jsonHeaders() });

      if (table === 'businesses') {
        if (principal.role !== 'ROOT' && !service) return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        // Cascade delete: remove ALL data for this business
        const cascadeTables = ['users', 'products', 'productIngredients', 'transactions', 'cashPicks', 'shifts', 'endOfDayReports', 'stockMovements', 'expenses', 'customers', 'customerPayments', 'serviceItems', 'salesInvoices', 'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries', 'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories', 'branches', 'financialAccounts'];
        const batch = cascadeTables.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE businessId = ?`).bind(id));
        batch.push(env.DB.prepare(`DELETE FROM businesses WHERE id = ?`).bind(id));
        await env.DB.batch(batch);
      } else if (table === 'loginAttempts') {
        if (principal.role !== 'ROOT' && !service) return new Response(JSON.stringify({ error: 'Root access required' }), { status: 403, headers: jsonHeaders() });
        await env.DB.prepare(`DELETE FROM loginAttempts WHERE id = ?`).bind(id).run();
      } else if (GLOBAL_TABLES.has(table)) {
        if (!businessId || !canAccessBusiness(principal, businessId)) return new Response(JSON.stringify({ error: 'X-Business-ID required for DELETE' }), { status: 400, headers: jsonHeaders() });
        if (!canDeleteTable(principal.role, table, service)) return new Response(JSON.stringify({ error: 'You are not allowed to delete this data.' }), { status: 403, headers: jsonHeaders() });
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
      } else {
        if (!businessId || !branchId || !canAccessBusiness(principal, businessId) || !canAccessBranch(principal, branchId)) return new Response(JSON.stringify({ error: 'X-Business-ID and X-Branch-ID required for DELETE' }), { status: 400, headers: jsonHeaders() });
        if (!canDeleteTable(principal.role, table, service)) {
          if (table !== 'transactions' || principal.role !== 'CASHIER') {
            return new Response(JSON.stringify({ error: 'You are not allowed to delete this data.' }), { status: 403, headers: jsonHeaders() });
          }
          const transaction = await env.DB.prepare(
            `SELECT cashierId, timestamp FROM transactions WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1`
          ).bind(id, businessId, branchId).first<any>();
          const isOwnRecentSale = transaction
            && String(transaction.cashierId || '') === principal.userId
            && Date.now() - Number(transaction.timestamp || 0) <= 2 * 60 * 1000;
          if (!isOwnRecentSale) {
            return new Response(JSON.stringify({ error: 'Cashier accounts can only undo their own just-created sale.' }), { status: 403, headers: jsonHeaders() });
          }
        }
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ? AND branchId = ?`).bind(id, businessId, branchId).run();
      }
      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders() });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders() });

  } catch (err: any) {
    console.error('[Worker Error]', err);
    return new Response(JSON.stringify({ error: 'Request failed.' }), { status: 500, headers: jsonHeaders() });
  }
};
