import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const CLOSE_SHIFT_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function n(value: unknown, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function s(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }
function nonNegative(value: unknown) { return Math.max(0, n(value)); }

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function splitDetails(record: any) {
  return parseMaybeJson(record?.splitPayments) || parseMaybeJson(record?.splitData)?.splitPayments || parseMaybeJson(record?.splitData) || null;
}

function transactionNetTotal(record: any) {
  const subtotal = n(record?.subtotal);
  const discount = Math.max(0, n(record?.discountAmount ?? record?.discount));
  if (subtotal > 0 && discount > 0) return Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  return n(record?.total);
}

function paymentAmount(record: any, method: 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT') {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === method) return transactionNetTotal(record);
  if (paymentMethod !== 'SPLIT') return 0;
  const split = splitDetails(record);
  if (method === 'CASH') return n(split?.cashAmount);
  return String(split?.secondaryMethod || '').toUpperCase() === method ? n(split?.secondaryAmount) : 0;
}

function recordInShift(record: any, since: number, until: number, shiftId?: string | null) {
  if (shiftId && record?.shiftId) return String(record.shiftId) === String(shiftId);
  const ts = n(record?.timestamp || record?.issueDate);
  return ts >= since && ts <= until;
}

function cashRefundAmount(record: any) {
  if (String(record?.status || 'APPROVED').toUpperCase() === 'REJECTED') return 0;
  const source = String(record?.source || '').toUpperCase();
  if (source === 'TILL' || source === 'MIXED') return n(record?.cashAmount ?? record?.amount);
  return n(record?.cashAmount);
}

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
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
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

async function pendingShiftApprovals(db: D1Database, businessId: string, shiftId: string, startTime: number, until: number) {
  const checks = await Promise.all([
    pendingCount(
      db,
      'expenses',
      `SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND status = 'PENDING' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'cash picks',
      `SELECT COUNT(*) AS count FROM cashPicks WHERE businessId = ? AND status = 'PENDING' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'refund approvals',
      `SELECT COUNT(*) AS count FROM transactions WHERE businessId = ? AND status = 'PENDING_REFUND' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'purchase orders',
      `SELECT COUNT(*) AS count FROM purchaseOrders WHERE businessId = ? AND approvalStatus = 'PENDING' AND orderDate >= ? AND orderDate <= ?`,
      [businessId, startTime, until],
    ),
    pendingCount(
      db,
      'stock adjustments',
      `SELECT COUNT(*) AS count FROM stockAdjustmentRequests WHERE businessId = ? AND status = 'PENDING' AND timestamp >= ? AND timestamp <= ?`,
      [businessId, startTime, until],
    ),
  ]);
  return checks.filter(Boolean) as string[];
}

async function buildServerShiftReport(
  db: D1Database,
  businessId: string,
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
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(shiftId, businessId).first<any>().catch(() => null);

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
    safeRows(db, `SELECT total, subtotal, discountAmount, discount, tax, timestamp, status, paymentMethod, splitPayments, splitData, shiftId FROM transactions WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT total, subtotal, tax, balance, issueDate, timestamp, status, shiftId FROM salesInvoices WHERE businessId = ? AND COALESCE(issueDate, timestamp, 0) >= ? AND COALESCE(issueDate, timestamp, 0) <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, status, source, shiftId FROM expenses WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, status, shiftId FROM cashPicks WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, cashAmount, timestamp, status, source, shiftId FROM refunds WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, source, shiftId FROM supplierPayments WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
    safeRows(db, `SELECT amount, timestamp, paymentMethod, shiftId FROM customerPayments WHERE businessId = ? AND timestamp >= ? AND timestamp <= ?`, [businessId, since, until]),
  ]);

  const txs = transactions.filter(row => recordInShift(row, since, until, shiftId) && !['VOIDED', 'QUOTE'].includes(String(row.status || '').toUpperCase()));
  const invoiceRows = invoices.filter(row => recordInShift(row, since, until, shiftId) && String(row.status || '').toUpperCase() !== 'CANCELLED');
  const expenseRows = expenses.filter(row => recordInShift(row, since, until, shiftId) && String(row.status || '').toUpperCase() !== 'REJECTED');
  const pickRows = picks.filter(row => recordInShift(row, since, until, shiftId) && String(row.status || '').toUpperCase() !== 'REJECTED');
  const refundRows = refunds.filter(row => recordInShift(row, since, until, shiftId) && String(row.status || 'APPROVED').toUpperCase() !== 'REJECTED');
  const supplierRows = supplierPayments.filter(row => recordInShift(row, since, until, shiftId));
  const customerRows = customerPayments.filter(row => recordInShift(row, since, until, shiftId));

  const openingCash = nonNegative(shift?.openingCash ?? clientReport?.openingCash);
  const cashSales = txs.reduce((sum, row) => sum + paymentAmount(row, 'CASH'), 0);
  const mpesaSales = txs.reduce((sum, row) => sum + paymentAmount(row, 'MPESA'), 0);
  const pdqSales = txs.reduce((sum, row) => sum + paymentAmount(row, 'PDQ'), 0);
  const customerCashPayments = customerRows
    .filter(row => String(row.paymentMethod || '').toUpperCase() === 'CASH')
    .reduce((sum, row) => sum + n(row.amount), 0);
  const customerMpesaPayments = customerRows
    .filter(row => String(row.paymentMethod || '').toUpperCase() === 'MPESA')
    .reduce((sum, row) => sum + n(row.amount), 0);
  const grossSales = txs.reduce((sum, row) => sum + n(row.subtotal ?? row.total), 0)
    + invoiceRows.reduce((sum, row) => sum + n(row.subtotal ?? row.total), 0);
  const totalSales = txs.reduce((sum, row) => sum + transactionNetTotal(row), 0)
    + invoiceRows.reduce((sum, row) => sum + n(row.total), 0);
  const taxTotal = txs.reduce((sum, row) => sum + n(row.tax), 0)
    + invoiceRows.reduce((sum, row) => sum + n(row.tax), 0);
  const totalExpenses = expenseRows
    .filter(row => String(row.source || '').toUpperCase() === 'TILL')
    .reduce((sum, row) => sum + n(row.amount), 0);
  const supplierPaymentsTotal = supplierRows
    .filter(row => String(row.source || '').toUpperCase() === 'TILL')
    .reduce((sum, row) => sum + n(row.amount), 0);
  const remittanceTotal = totalExpenses + supplierPaymentsTotal;
  const totalPicks = pickRows.reduce((sum, row) => sum + n(row.amount), 0);
  const totalRefunds = refundRows.reduce((sum, row) => sum + n(row.amount), 0);
  const cashRefunds = refundRows.reduce((sum, row) => sum + cashRefundAmount(row), 0);
  const closingCash = nonNegative(clientReport?.closingCash ?? clientReport?.reportedCash);
  const expectedBeforePicks = Math.round((openingCash + cashSales + customerCashPayments - remittanceTotal - cashRefunds) * 100) / 100;
  const expectedCash = Math.max(0, Math.round((expectedBeforePicks - totalPicks) * 100) / 100);
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
