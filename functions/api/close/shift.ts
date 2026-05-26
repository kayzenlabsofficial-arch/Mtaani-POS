import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { DEFAULT_SHOP_ID } from '../inventoryIntegrity';
import { PolicyError } from '../salesSecurity';
import { calculateServerCloseReportTotals } from './reportMath';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const CLOSE_SHIFT_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Shop-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function n(value: unknown, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function s(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }
function nonNegative(value: unknown) { return Math.max(0, n(value)); }

function ownsShift(shift: any, userId: string, userName: string) {
  const cashierId = s(shift?.cashierId, 160);
  const cashierName = s(shift?.cashierName, 160).toLowerCase();
  return (userId && cashierId === userId)
    || (userName && cashierName === userName.toLowerCase())
    || (userId && String(shift?.id || '').includes(`_${userId}`));
}

async function safeRows(db: D1Database, sql: string, binds: unknown[] = []) {
  const result = await db.prepare(sql).bind(...binds).all<any>().catch(() => ({ results: [] }));
  return (result.results || []) as any[];
}

const END_OF_DAY_REPORTS_SCHEMA = `
    CREATE TABLE IF NOT EXISTS endOfDayReports (
      id TEXT PRIMARY KEY,
      shiftId TEXT,
      tillId TEXT,
      tillName TEXT,
      timestamp INTEGER NOT NULL,
      totalSales REAL NOT NULL DEFAULT 0,
      grossSales REAL NOT NULL DEFAULT 0,
      taxTotal REAL NOT NULL DEFAULT 0,
      cashSales REAL NOT NULL DEFAULT 0,
      customerCashPayments REAL NOT NULL DEFAULT 0,
      customerMpesaPayments REAL NOT NULL DEFAULT 0,
      mpesaSales REAL NOT NULL DEFAULT 0,
      pdqSales REAL NOT NULL DEFAULT 0,
      totalExpenses REAL NOT NULL DEFAULT 0,
      supplierPaymentsTotal REAL NOT NULL DEFAULT 0,
      remittanceTotal REAL NOT NULL DEFAULT 0,
      totalPicks REAL NOT NULL DEFAULT 0,
      totalRefunds REAL,
      cashRefunds REAL NOT NULL DEFAULT 0,
      openingCash REAL NOT NULL DEFAULT 0,
      closingCash REAL,
      expectedCash REAL NOT NULL DEFAULT 0,
      reportedCash REAL NOT NULL DEFAULT 0,
      difference REAL NOT NULL DEFAULT 0,
      cashierId TEXT,
      cashierName TEXT NOT NULL,
      closeBreakdown TEXT,
      shopId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
`;

const SHIFTS_SCHEMA = `
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
`;

const END_OF_DAY_REPORT_COLUMNS = [
  'id',
  'shiftId',
  'tillId',
  'tillName',
  'timestamp',
  'totalSales',
  'grossSales',
  'taxTotal',
  'cashSales',
  'customerCashPayments',
  'customerMpesaPayments',
  'mpesaSales',
  'pdqSales',
  'totalExpenses',
  'supplierPaymentsTotal',
  'remittanceTotal',
  'totalPicks',
  'totalRefunds',
  'cashRefunds',
  'openingCash',
  'closingCash',
  'expectedCash',
  'reportedCash',
  'difference',
  'cashierId',
  'cashierName',
  'closeBreakdown',
  'shopId',
  'businessId',
  'updated_at',
];

const SHIFT_COLUMNS = [
  'id',
  'startTime',
  'endTime',
  'cashierId',
  'cashierName',
  'tillId',
  'tillName',
  'openingCash',
  'closingCash',
  'expectedCash',
  'cashVariance',
  'closeBreakdown',
  'status',
  'lastSyncAt',
  'shopId',
  'businessId',
  'updated_at',
];

async function getTableColumns(db: D1Database, table: string): Promise<string[]> {
  const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<any>();
  return (results || []).map(row => String(row.name || '')).filter(Boolean);
}

function tempCreateSql(schema: string, table: string, tempTable: string) {
  return schema.replace(`CREATE TABLE IF NOT EXISTS ${table}`, `CREATE TABLE ${tempTable}`);
}

async function removeLegacyOpeningFloat(db: D1Database, table: string, schema: string, columns: string[]) {
  const existingColumns = await getTableColumns(db, table);
  if (!existingColumns.includes('openingFloat')) return;

  try {
    await db.prepare(`ALTER TABLE ${table} DROP COLUMN openingFloat`).run();
    return;
  } catch {
    // Some D1 deployments may not support DROP COLUMN; rebuild without the legacy field.
  }

  const tempTable = `${table}_without_float_${Date.now()}`;
  const copyColumns = columns.filter(column => existingColumns.includes(column));
  if (copyColumns.length === 0) return;
  const columnList = copyColumns.join(', ');
  await db.prepare(tempCreateSql(schema, table, tempTable)).run();
  await db.prepare(`INSERT OR REPLACE INTO ${tempTable} (${columnList}) SELECT ${columnList} FROM ${table}`).run();
  await db.prepare(`DROP TABLE ${table}`).run();
  await db.prepare(`ALTER TABLE ${tempTable} RENAME TO ${table}`).run();
}

async function ensureCloseShiftSchema(db: D1Database) {
  await db.prepare(END_OF_DAY_REPORTS_SCHEMA).run();
  await db.prepare(SHIFTS_SCHEMA).run();
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
    'ALTER TABLE endOfDayReports ADD COLUMN shiftId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN tillId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN tillName TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN customerCashPayments REAL DEFAULT 0',
    'ALTER TABLE endOfDayReports ADD COLUMN customerMpesaPayments REAL DEFAULT 0',
    'ALTER TABLE endOfDayReports ADD COLUMN totalRefunds REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN cashRefunds REAL DEFAULT 0',
    'ALTER TABLE endOfDayReports ADD COLUMN openingCash REAL DEFAULT 0',
    'ALTER TABLE endOfDayReports ADD COLUMN closingCash REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN pdqSales REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN supplierPaymentsTotal REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN remittanceTotal REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN cashierId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN closeBreakdown TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN shopId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN businessId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN updated_at INTEGER',
    'ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER',
    'ALTER TABLE shifts ADD COLUMN cashierId TEXT',
    'ALTER TABLE shifts ADD COLUMN tillId TEXT',
    'ALTER TABLE shifts ADD COLUMN tillName TEXT',
    'ALTER TABLE shifts ADD COLUMN openingCash REAL DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN closingCash REAL',
    'ALTER TABLE shifts ADD COLUMN expectedCash REAL',
    'ALTER TABLE shifts ADD COLUMN cashVariance REAL',
    'ALTER TABLE shifts ADD COLUMN closeBreakdown TEXT',
    'ALTER TABLE shifts ADD COLUMN shopId TEXT',
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE salesInvoices ADD COLUMN shiftId TEXT',
    'ALTER TABLE salesInvoices ADD COLUMN shopId TEXT',
    `UPDATE shifts SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    `UPDATE endOfDayReports SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
    'DROP INDEX IF EXISTS idx_shifts_one_open_till',
    'DROP INDEX IF EXISTS idx_shifts_one_open_cashier',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_till ON shifts(businessId, COALESCE(NULLIF(shopId, ''), 'single-shop'), tillId) WHERE UPPER(COALESCE(status, '')) = 'OPEN' AND COALESCE(tillId, '') != ''",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_cashier ON shifts(businessId, COALESCE(NULLIF(shopId, ''), 'single-shop'), cashierId) WHERE UPPER(COALESCE(status, '')) = 'OPEN' AND COALESCE(cashierId, '') != ''",
    'CREATE INDEX IF NOT EXISTS idx_endofday_business_shop_timestamp ON endOfDayReports(businessId, shopId, timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_shifts_business_shop_status ON shifts(businessId, shopId, status)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_salesInvoices_business_number ON salesInvoices(businessId, invoiceNumber)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
  await removeLegacyOpeningFloat(db, 'endOfDayReports', END_OF_DAY_REPORTS_SCHEMA, END_OF_DAY_REPORT_COLUMNS);
  await removeLegacyOpeningFloat(db, 'shifts', SHIFTS_SCHEMA, SHIFT_COLUMNS);
}

async function pendingCount(db: D1Database, label: string, sql: string, binds: unknown[]): Promise<string | null> {
  const row = await db.prepare(sql).bind(...binds).first<any>().catch(() => null);
  return n(row?.count) > 0 ? label : null;
}

async function pendingShiftApprovals(db: D1Database, businessId: string, shopId: string, shiftId: string, startTime: number, until: number) {
  const checks = await Promise.all([
    pendingCount(
      db,
      'expenses',
      `SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND status = 'PENDING' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, DEFAULT_SHOP_ID, shopId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'cash picks',
      `SELECT COUNT(*) AS count FROM cashPicks WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND status = 'PENDING' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, DEFAULT_SHOP_ID, shopId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'refund approvals',
      `SELECT COUNT(*) AS count FROM transactions WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND status = 'PENDING_REFUND' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, DEFAULT_SHOP_ID, shopId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'purchase orders',
      `SELECT COUNT(*) AS count FROM purchaseOrders WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND approvalStatus = 'PENDING' AND orderDate >= ? AND orderDate <= ?`,
      [businessId, DEFAULT_SHOP_ID, shopId, startTime, until],
    ),
    pendingCount(
      db,
      'stock adjustments',
      `SELECT COUNT(*) AS count FROM stockAdjustmentRequests WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND status = 'PENDING' AND timestamp >= ? AND timestamp <= ?`,
      [businessId, DEFAULT_SHOP_ID, shopId, startTime, until],
    ),
  ]);
  return checks.filter(Boolean) as string[];
}

async function buildServerShiftReport(
  db: D1Database,
  businessId: string,
  shopId: string,
  shiftId: string,
  startTime: number,
  until: number,
  clientReport: any,
  principal: any,
  service: boolean,
) {
  const shift = await db.prepare(`
    SELECT *
    FROM shifts
    WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?
    LIMIT 1
  `).bind(shiftId, businessId, DEFAULT_SHOP_ID, shopId).first<any>().catch(() => null);

  if (shift && !service && String(principal?.role || '').toUpperCase() === 'CASHIER') {
    const userId = s(principal?.userId, 160);
    const userName = s(principal?.userName, 120);
    if (!ownsShift(shift, userId, userName)) throw new PolicyError('You can only close your own shift.', 403);
  }
  if (shift && String(shift.status || '').toUpperCase() !== 'OPEN') {
    throw new PolicyError('Only open shifts can be closed.', 409);
  }

  const since = n(shift?.startTime || startTime, startTime);
  const [
    transactions,
    invoices,
    expenses,
    picks,
    refunds,
    supplierPayments,
    customerPayments,
  ] = await Promise.all([
    safeRows(db, `SELECT total, subtotal, discountAmount, discount, tax, items, timestamp, status, paymentMethod, splitPayments, splitData, shiftId FROM transactions WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
    safeRows(db, `SELECT total, subtotal, tax, balance, issueDate, timestamp, status, shiftId FROM salesInvoices WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND COALESCE(issueDate, timestamp, 0) >= ? AND COALESCE(issueDate, timestamp, 0) <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
    safeRows(db, `SELECT amount, timestamp, status, source, shiftId FROM expenses WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
    safeRows(db, `SELECT amount, timestamp, status, shiftId FROM cashPicks WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
    safeRows(db, `SELECT amount, cashAmount, timestamp, status, source, shiftId FROM refunds WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
    safeRows(db, `SELECT amount, timestamp, source, shiftId FROM supplierPayments WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
    safeRows(db, `SELECT amount, timestamp, paymentMethod, shiftId FROM customerPayments WHERE businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, DEFAULT_SHOP_ID, shopId, since, until]),
  ]);

  const openingCash = nonNegative(shift?.openingCash ?? clientReport?.openingCash);
  const closeTotals = calculateServerCloseReportTotals({
    transactions,
    invoices,
    expenses,
    picks,
    refunds,
    supplierPayments,
    customerPayments,
    openingCash,
    since,
    until,
    shiftId,
  });
  const txs = closeTotals.txs;
  const invoiceRows = closeTotals.invoices;
  const cashSales = closeTotals.cashSales;
  const mpesaSales = closeTotals.mpesaSales;
  const pdqSales = closeTotals.pdqSales;
  const customerCashPayments = closeTotals.customerCashPayments;
  const customerMpesaPayments = closeTotals.customerMpesaPayments;
  const grossSales = closeTotals.grossSales;
  const totalSales = closeTotals.totalSales;
  const taxTotal = closeTotals.taxTotal;
  const totalExpenses = closeTotals.totalExpenses;
  const supplierPaymentsTotal = closeTotals.supplierPaymentsTotal;
  const remittanceTotal = closeTotals.remittanceTotal;
  const totalPicks = closeTotals.totalPicks;
  const totalRefunds = closeTotals.totalRefunds;
  const cashRefunds = closeTotals.cashRefunds;
  const closingCash = nonNegative(clientReport?.closingCash ?? clientReport?.reportedCash);
  const expectedBeforePicks = closeTotals.expectedBeforePicks;
  const expectedCash = closeTotals.expectedCash;
  const reportedCash = nonNegative(clientReport?.reportedCash ?? closingCash);
  const difference = Math.round((reportedCash + totalPicks - expectedBeforePicks) * 100) / 100;

  return {
    timestamp: until,
    tillId: s(shift?.tillId || clientReport?.tillId, 160) || null,
    tillName: s(shift?.tillName || clientReport?.tillName, 120) || null,
    openingCash,
    totalSales,
    grossSales,
    taxTotal,
    cashSales,
    customerCashPayments,
    customerMpesaPayments,
    mpesaSales,
    pdqSales,
    totalExpenses,
    supplierPaymentsTotal,
    remittanceTotal,
    totalPicks,
    totalRefunds,
    cashRefunds,
    expectedCash,
    reportedCash,
    closingCash,
    difference,
    cashierId: s(shift?.cashierId || clientReport?.cashierId || principal?.userId, 160) || null,
    cashierName: s(shift?.cashierName || clientReport?.cashierName || principal?.userName, 120) || 'Staff',
    closeBreakdown: {
      receipts: txs.length,
      invoices: invoiceRows.length,
      customerCashPayments,
      customerMpesaPayments,
      tillExpenses: totalExpenses,
      supplierTillPayments: supplierPaymentsTotal,
      cashRefunds,
      cashPicks: totalPicks,
      cashExpectedBeforePicks: expectedBeforePicks,
    },
  };
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !CLOSE_SHIFT_ROLES.has(auth.principal.role)) throw new PolicyError('You are not allowed to close shifts.', 403);
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    await ensureCloseShiftSchema(env.DB);
    const now = Date.now();
    const report = body?.report || {};
    const shiftId = s(body?.shiftId || report.shiftId, 160) || `shift_${businessId}_${new Date(now).toISOString().slice(0, 10)}_${auth.principal.userId || 'staff'}`;
    const existing = await env.DB.prepare(`
      SELECT id, shiftId
      FROM endOfDayReports
      WHERE businessId = ? AND shiftId = ?
      LIMIT 1
    `).bind(businessId, shiftId).first<any>();
    if (existing) return json({ success: true, reportId: existing.id, shiftId: existing.shiftId || shiftId, idempotent: true });

    const startTime = n(body?.startTime || report.startTime || now);
    const pending = await pendingShiftApprovals(env.DB, businessId, shiftId, startTime, now);
    if (pending.length) {
      throw new PolicyError(`Resolve pending ${pending.join(', ')} for this shift before closing it.`, 409);
    }

    const reportId = s(body?.reportId, 160) || `eod_${businessId}_${shiftId}`;
    const serverReport = await buildServerShiftReport(env.DB, businessId, shiftId, startTime, now, report, auth.principal, auth.service);
    const cashierName = serverReport.cashierName;
    const cashierId = serverReport.cashierId;
    const tillId = serverReport.tillId;
    const tillName = serverReport.tillName;
    const totalSales = nonNegative(serverReport.totalSales);
    const grossSales = nonNegative(serverReport.grossSales);
    const taxTotal = nonNegative(serverReport.taxTotal);
    const cashSales = nonNegative(serverReport.cashSales);
    const customerCashPayments = nonNegative(serverReport.customerCashPayments);
    const customerMpesaPayments = nonNegative(serverReport.customerMpesaPayments);
    const mpesaSales = nonNegative(serverReport.mpesaSales);
    const pdqSales = nonNegative(serverReport.pdqSales);
    const totalExpenses = nonNegative(serverReport.totalExpenses);
    const supplierPaymentsTotal = nonNegative(serverReport.supplierPaymentsTotal);
    const remittanceTotal = nonNegative(serverReport.remittanceTotal);
    const totalPicks = nonNegative(serverReport.totalPicks);
    const totalRefunds = nonNegative(serverReport.totalRefunds);
    const cashRefunds = nonNegative(serverReport.cashRefunds);
    const openingCash = nonNegative(serverReport.openingCash);
    const closingCash = nonNegative(serverReport.closingCash ?? serverReport.reportedCash);
    const expectedCash = nonNegative(serverReport.expectedCash);
    const reportedCash = nonNegative(serverReport.reportedCash ?? closingCash);
    const difference = n(serverReport.difference, reportedCash - expectedCash);
    const closeBreakdown = serverReport.closeBreakdown ? JSON.stringify(serverReport.closeBreakdown).slice(0, 5000) : null;
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO endOfDayReports (id, shiftId, tillId, tillName, timestamp, totalSales, grossSales, taxTotal, cashSales, customerCashPayments, customerMpesaPayments, mpesaSales, pdqSales, totalExpenses, supplierPaymentsTotal, remittanceTotal, totalPicks, totalRefunds, cashRefunds, openingCash, closingCash, expectedCash, reportedCash, difference, cashierId, cashierName, closeBreakdown, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(reportId, shiftId, tillId, tillName, now, totalSales, grossSales, taxTotal, cashSales, customerCashPayments, customerMpesaPayments, mpesaSales, pdqSales, totalExpenses, supplierPaymentsTotal, remittanceTotal, totalPicks, totalRefunds, cashRefunds, openingCash, closingCash, expectedCash, reportedCash, difference, cashierId, cashierName, closeBreakdown, businessId, now),
      env.DB.prepare(`
        INSERT INTO shifts (id, startTime, endTime, cashierId, cashierName, tillId, tillName, openingCash, closingCash, expectedCash, cashVariance, closeBreakdown, status, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          endTime = excluded.endTime,
          cashierId = COALESCE(excluded.cashierId, shifts.cashierId),
          cashierName = excluded.cashierName,
          tillId = COALESCE(excluded.tillId, shifts.tillId),
          tillName = COALESCE(excluded.tillName, shifts.tillName),
          openingCash = COALESCE(excluded.openingCash, shifts.openingCash),
          closingCash = excluded.closingCash,
          expectedCash = excluded.expectedCash,
          cashVariance = excluded.cashVariance,
          closeBreakdown = excluded.closeBreakdown,
          status = excluded.status,
          businessId = excluded.businessId,
          updated_at = excluded.updated_at
      `).bind(shiftId, startTime, now, cashierId, cashierName, tillId, tillName, openingCash, closingCash, expectedCash, difference, closeBreakdown, 'CLOSED', businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'report.shift.close',
        'endOfDayReport',
        reportId,
        difference === 0 ? 'INFO' : 'WARN',
        `Closed shift ${shiftId} with reported cash Ksh ${reportedCash.toLocaleString()} and variance Ksh ${difference.toLocaleString()}.`,
        businessId,
        now,
      ),
    ]);
    return json({
      success: true,
      reportId,
      shiftId,
      idempotent: false,
      report: {
        ...serverReport,
        id: reportId,
        shiftId,
        recordType: 'CLOSE_DAY_REPORT',
      },
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not close shift.' }, status);
  }
};
