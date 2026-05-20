import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const CLOSE_SHIFT_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function n(value: unknown, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function s(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }
function nonNegative(value: unknown) { return Math.max(0, n(value)); }

const END_OF_DAY_REPORTS_SCHEMA = `
    CREATE TABLE IF NOT EXISTS endOfDayReports (
      id TEXT PRIMARY KEY,
      shiftId TEXT,
      timestamp INTEGER NOT NULL,
      totalSales REAL NOT NULL DEFAULT 0,
      grossSales REAL NOT NULL DEFAULT 0,
      taxTotal REAL NOT NULL DEFAULT 0,
      cashSales REAL NOT NULL DEFAULT 0,
      mpesaSales REAL NOT NULL DEFAULT 0,
      pdqSales REAL NOT NULL DEFAULT 0,
      totalExpenses REAL NOT NULL DEFAULT 0,
      supplierPaymentsTotal REAL NOT NULL DEFAULT 0,
      remittanceTotal REAL NOT NULL DEFAULT 0,
      totalPicks REAL NOT NULL DEFAULT 0,
      totalRefunds REAL,
      expectedCash REAL NOT NULL DEFAULT 0,
      reportedCash REAL NOT NULL DEFAULT 0,
      difference REAL NOT NULL DEFAULT 0,
      cashierName TEXT NOT NULL,
      branchId TEXT,
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
      status TEXT NOT NULL,
      branchId TEXT,
      lastSyncAt INTEGER,
      businessId TEXT,
      updated_at INTEGER
    )
`;

const END_OF_DAY_REPORT_COLUMNS = [
  'id',
  'shiftId',
  'timestamp',
  'totalSales',
  'grossSales',
  'taxTotal',
  'cashSales',
  'mpesaSales',
  'pdqSales',
  'totalExpenses',
  'supplierPaymentsTotal',
  'remittanceTotal',
  'totalPicks',
  'totalRefunds',
  'expectedCash',
  'reportedCash',
  'difference',
  'cashierName',
  'branchId',
  'businessId',
  'updated_at',
];

const SHIFT_COLUMNS = [
  'id',
  'startTime',
  'endTime',
  'cashierId',
  'cashierName',
  'status',
  'branchId',
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
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  for (const sql of [
    'ALTER TABLE endOfDayReports ADD COLUMN shiftId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN totalRefunds REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN pdqSales REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN supplierPaymentsTotal REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN remittanceTotal REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN branchId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN businessId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN updated_at INTEGER',
    'ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER',
    'ALTER TABLE shifts ADD COLUMN cashierId TEXT',
    'ALTER TABLE shifts ADD COLUMN branchId TEXT',
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

async function pendingShiftApprovals(db: D1Database, businessId: string, branchId: string, shiftId: string, startTime: number, until: number) {
  const checks = await Promise.all([
    pendingCount(
      db,
      'expenses',
      `SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND branchId = ? AND status = 'PENDING' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, branchId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'cash picks',
      `SELECT COUNT(*) AS count FROM cashPicks WHERE businessId = ? AND branchId = ? AND status = 'PENDING' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, branchId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'refund approvals',
      `SELECT COUNT(*) AS count FROM transactions WHERE businessId = ? AND branchId = ? AND status = 'PENDING_REFUND' AND (shiftId = ? OR (COALESCE(shiftId, '') = '' AND timestamp >= ? AND timestamp <= ?))`,
      [businessId, branchId, shiftId, startTime, until],
    ),
    pendingCount(
      db,
      'purchase orders',
      `SELECT COUNT(*) AS count FROM purchaseOrders WHERE businessId = ? AND branchId = ? AND approvalStatus = 'PENDING' AND orderDate >= ? AND orderDate <= ?`,
      [businessId, branchId, startTime, until],
    ),
    pendingCount(
      db,
      'stock adjustments',
      `SELECT COUNT(*) AS count FROM stockAdjustmentRequests WHERE businessId = ? AND branchId = ? AND status = 'PENDING' AND timestamp >= ? AND timestamp <= ?`,
      [businessId, branchId, startTime, until],
    ),
  ]);
  return checks.filter(Boolean) as string[];
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
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    if (!businessId || !branchId || !canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);
    await ensureCloseShiftSchema(env.DB);
    const now = Date.now();
    const report = body?.report || {};
    const shiftId = s(body?.shiftId || report.shiftId, 160) || `shift_${branchId}_${new Date(now).toISOString().slice(0, 10)}_${auth.principal.userId || 'staff'}`;
    const existing = await env.DB.prepare(`
      SELECT id, shiftId
      FROM endOfDayReports
      WHERE businessId = ? AND branchId = ? AND shiftId = ?
      LIMIT 1
    `).bind(businessId, branchId, shiftId).first<any>();
    if (existing) return json({ success: true, reportId: existing.id, shiftId: existing.shiftId || shiftId, idempotent: true });

    const startTime = n(body?.startTime || report.startTime || now);
    const pending = await pendingShiftApprovals(env.DB, businessId, branchId, shiftId, startTime, now);
    if (pending.length) {
      throw new PolicyError(`Resolve pending ${pending.join(', ')} for this shift before closing it.`, 409);
    }

    const reportId = s(body?.reportId, 160) || `eod_${businessId}_${branchId}_${shiftId}`;
    const cashierName = s(report.cashierName || body?.cashierName || auth.principal.userName, 120) || 'Staff';
    const totalSales = nonNegative(report.totalSales);
    const grossSales = nonNegative(report.grossSales);
    const taxTotal = nonNegative(report.taxTotal);
    const cashSales = nonNegative(report.cashSales);
    const mpesaSales = nonNegative(report.mpesaSales);
    const pdqSales = nonNegative(report.pdqSales);
    const rawTotalExpenses = nonNegative(report.totalExpenses);
    const rawSupplierPaymentsTotal = nonNegative(report.supplierPaymentsTotal);
    const rawRemittanceTotal = nonNegative(report.remittanceTotal ?? (rawTotalExpenses + rawSupplierPaymentsTotal));
    const remittanceTotal = Math.min(cashSales, rawRemittanceTotal);
    const remittanceScale = rawRemittanceTotal > 0 ? remittanceTotal / rawRemittanceTotal : 0;
    const totalExpenses = Math.round(rawTotalExpenses * remittanceScale * 100) / 100;
    const supplierPaymentsTotal = Math.round((remittanceTotal - totalExpenses) * 100) / 100;
    const totalPicks = nonNegative(report.totalPicks);
    const totalRefunds = nonNegative(report.totalRefunds);
    const expectedCash = nonNegative(report.expectedCash);
    const reportedCash = nonNegative(report.reportedCash);
    const difference = n(report.difference, reportedCash - expectedCash);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO endOfDayReports (id, shiftId, timestamp, totalSales, grossSales, taxTotal, cashSales, mpesaSales, pdqSales, totalExpenses, supplierPaymentsTotal, remittanceTotal, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(reportId, shiftId, now, totalSales, grossSales, taxTotal, cashSales, mpesaSales, pdqSales, totalExpenses, supplierPaymentsTotal, remittanceTotal, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, now),
      env.DB.prepare(`
        INSERT INTO shifts (id, startTime, endTime, cashierId, cashierName, status, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          endTime = excluded.endTime,
          cashierId = COALESCE(excluded.cashierId, shifts.cashierId),
          cashierName = excluded.cashierName,
          status = excluded.status,
          branchId = excluded.branchId,
          businessId = excluded.businessId,
          updated_at = excluded.updated_at
      `).bind(shiftId, startTime, now, auth.principal.userId || null, cashierName, 'CLOSED', branchId, businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        branchId,
        now,
      ),
    ]);
    return json({ success: true, reportId, shiftId, idempotent: false });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not close shift.' }, status);
  }
};
