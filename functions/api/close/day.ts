import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const CLOSE_DAY_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const DAY_MS = 24 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function n(value: unknown, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function nonNegative(value: unknown) { return Math.max(0, n(value)); }
function roundMoney(value: number) { return Math.round(value * 100) / 100; }
function s(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }
function dayStartMs(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

async function safeRows(db: D1Database, sql: string, binds: unknown[] = []) {
  const result = await db.prepare(sql).bind(...binds).all<any>().catch(() => ({ results: [] }));
  return (result.results || []) as any[];
}

function sumRows(rows: any[], key: string) {
  return roundMoney(rows.reduce((sum, row) => sum + n(row?.[key]), 0));
}

async function ensureCloseDaySchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS dailySummaries (
      id TEXT PRIMARY KEY,
      date INTEGER NOT NULL,
      shiftIds TEXT NOT NULL,
      totalSales REAL NOT NULL DEFAULT 0,
      grossSales REAL NOT NULL DEFAULT 0,
      taxTotal REAL NOT NULL DEFAULT 0,
      totalExpenses REAL NOT NULL DEFAULT 0,
      cashSales REAL NOT NULL DEFAULT 0,
      customerCashPayments REAL NOT NULL DEFAULT 0,
      customerMpesaPayments REAL NOT NULL DEFAULT 0,
      mpesaSales REAL NOT NULL DEFAULT 0,
      pdqSales REAL NOT NULL DEFAULT 0,
      supplierPaymentsTotal REAL NOT NULL DEFAULT 0,
      remittanceTotal REAL NOT NULL DEFAULT 0,
      totalPicks REAL NOT NULL DEFAULT 0,
      totalRefunds REAL,
      cashRefunds REAL NOT NULL DEFAULT 0,
      openingCash REAL NOT NULL DEFAULT 0,
      expectedCash REAL NOT NULL DEFAULT 0,
      reportedCash REAL NOT NULL DEFAULT 0,
      totalVariance REAL NOT NULL DEFAULT 0,
      shiftReports TEXT,
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
    'ALTER TABLE dailySummaries ADD COLUMN grossSales REAL',
    'ALTER TABLE dailySummaries ADD COLUMN taxTotal REAL',
    'ALTER TABLE dailySummaries ADD COLUMN totalExpenses REAL',
    'ALTER TABLE dailySummaries ADD COLUMN cashSales REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN customerCashPayments REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN customerMpesaPayments REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN mpesaSales REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN pdqSales REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN supplierPaymentsTotal REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN remittanceTotal REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN totalPicks REAL',
    'ALTER TABLE dailySummaries ADD COLUMN totalRefunds REAL',
    'ALTER TABLE dailySummaries ADD COLUMN cashRefunds REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN openingCash REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN expectedCash REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN reportedCash REAL DEFAULT 0',
    'ALTER TABLE dailySummaries ADD COLUMN totalVariance REAL',
    'ALTER TABLE dailySummaries ADD COLUMN shiftReports TEXT',
    'ALTER TABLE dailySummaries ADD COLUMN businessId TEXT',
    'ALTER TABLE dailySummaries ADD COLUMN updated_at INTEGER',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_dailySummaries_business_date ON dailySummaries(businessId, date)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function pendingDayApprovals(db: D1Database, businessId: string, since: number, until: number) {
  const checks = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND status = 'PENDING' AND timestamp >= ? AND timestamp < ?`)
      .bind(businessId, since, until).first<any>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS count FROM cashPicks WHERE businessId = ? AND status = 'PENDING' AND timestamp >= ? AND timestamp < ?`)
      .bind(businessId, since, until).first<any>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE businessId = ? AND status = 'PENDING_REFUND' AND timestamp >= ? AND timestamp < ?`)
      .bind(businessId, since, until).first<any>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS count FROM purchaseOrders WHERE businessId = ? AND approvalStatus = 'PENDING' AND orderDate >= ? AND orderDate < ?`)
      .bind(businessId, since, until).first<any>().catch(() => null),
    db.prepare(`SELECT COUNT(*) AS count FROM stockAdjustmentRequests WHERE businessId = ? AND status = 'PENDING' AND timestamp >= ? AND timestamp < ?`)
      .bind(businessId, since, until).first<any>().catch(() => null),
  ]);
  const labels = ['expenses', 'cash picks', 'refund approvals', 'purchase orders', 'stock adjustments'];
  return checks
    .map((row, index) => n(row?.count) > 0 ? labels[index] : null)
    .filter(Boolean) as string[];
}

async function buildServerDaySummary(db: D1Database, businessId: string, summaryDate: number) {
  const dayEnd = summaryDate + DAY_MS;
  const openShifts = await safeRows(
    db,
    `SELECT id, tillName, cashierName
     FROM shifts
     WHERE businessId = ? AND UPPER(status) = 'OPEN'
     ORDER BY startTime ASC`,
    [businessId],
  );
  if (openShifts.length) {
    const names = openShifts
      .slice(0, 3)
      .map(row => s(row.tillName || row.cashierName || row.id, 80))
      .filter(Boolean)
      .join(', ');
    throw new PolicyError(`Close all open shifts before closing the day${names ? ` (${names})` : ''}.`, 409);
  }

  const pending = await pendingDayApprovals(db, businessId, summaryDate, dayEnd);
  if (pending.length) {
    throw new PolicyError(`Resolve pending ${pending.join(', ')} before closing the day.`, 409);
  }

  const reports = await safeRows(
    db,
    `SELECT *
     FROM endOfDayReports
     WHERE businessId = ? AND timestamp >= ? AND timestamp < ?
     ORDER BY timestamp ASC`,
    [businessId, summaryDate, dayEnd],
  );
  if (!reports.length) {
    throw new PolicyError('Close at least one shift before closing the business day.', 409);
  }

  const shiftIds = reports.map(row => s(row.shiftId || row.id, 180)).filter(Boolean);
  const totalExpenses = sumRows(reports, 'totalExpenses');
  const supplierPaymentsTotal = sumRows(reports, 'supplierPaymentsTotal');
  const remittanceTotal = roundMoney(reports.reduce((sum, row) => {
    const stored = n(row.remittanceTotal);
    return sum + (stored > 0 ? stored : n(row.totalExpenses) + n(row.supplierPaymentsTotal));
  }, 0));

  const shiftReports = reports.map(row => ({
    id: s(row.id, 180),
    shiftId: s(row.shiftId || row.id, 180),
    tillId: s(row.tillId, 160) || null,
    tillName: s(row.tillName, 120) || null,
    cashierName: s(row.cashierName, 120) || 'Staff',
    timestamp: n(row.timestamp),
    totalSales: nonNegative(row.totalSales),
    grossSales: nonNegative(row.grossSales),
    taxTotal: nonNegative(row.taxTotal),
    cashSales: nonNegative(row.cashSales),
    customerCashPayments: nonNegative(row.customerCashPayments),
    customerMpesaPayments: nonNegative(row.customerMpesaPayments),
    mpesaSales: nonNegative(row.mpesaSales),
    pdqSales: nonNegative(row.pdqSales),
    totalExpenses: nonNegative(row.totalExpenses),
    supplierPaymentsTotal: nonNegative(row.supplierPaymentsTotal),
    remittanceTotal: nonNegative(row.remittanceTotal || (n(row.totalExpenses) + n(row.supplierPaymentsTotal))),
    totalPicks: nonNegative(row.totalPicks),
    totalRefunds: nonNegative(row.totalRefunds),
    cashRefunds: nonNegative(row.cashRefunds),
    openingCash: nonNegative(row.openingCash),
    expectedCash: nonNegative(row.expectedCash),
    reportedCash: nonNegative(row.reportedCash ?? row.closingCash),
    difference: n(row.difference),
  }));

  return {
    date: summaryDate,
    shiftIds,
    totalSales: sumRows(reports, 'totalSales'),
    grossSales: sumRows(reports, 'grossSales'),
    taxTotal: sumRows(reports, 'taxTotal'),
    cashSales: sumRows(reports, 'cashSales'),
    customerCashPayments: sumRows(reports, 'customerCashPayments'),
    customerMpesaPayments: sumRows(reports, 'customerMpesaPayments'),
    mpesaSales: sumRows(reports, 'mpesaSales'),
    pdqSales: sumRows(reports, 'pdqSales'),
    totalExpenses,
    supplierPaymentsTotal,
    remittanceTotal,
    totalPicks: sumRows(reports, 'totalPicks'),
    totalRefunds: sumRows(reports, 'totalRefunds'),
    cashRefunds: sumRows(reports, 'cashRefunds'),
    openingCash: sumRows(reports, 'openingCash'),
    expectedCash: sumRows(reports, 'expectedCash'),
    reportedCash: roundMoney(reports.reduce((sum, row) => sum + n(row.reportedCash ?? row.closingCash), 0)),
    totalVariance: roundMoney(reports.reduce((sum, row) => sum + n(row.difference), 0)),
    shiftReports,
  };
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !CLOSE_DAY_ROLES.has(auth.principal.role)) throw new PolicyError('You are not allowed to close the business day.', 403);
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    await ensureCloseDaySchema(env.DB);
    const now = Date.now();
    const summary = body?.summary || {};
    const requestedDate = n(summary.date, 0);
    const summaryDate = requestedDate > 0 ? dayStartMs(requestedDate) : dayStartMs(now);
    const dayEnd = summaryDate + DAY_MS;
    const existing = await env.DB.prepare(`
      SELECT id
      FROM dailySummaries
      WHERE businessId = ?
        AND date >= ?
        AND date < ?
      LIMIT 1
    `).bind(businessId, summaryDate, dayEnd).first<any>();
    if (existing) {
      return json({
        error: `This business already has a daily close report for ${new Date(summaryDate).toLocaleDateString('en-KE')}.`,
        summaryId: existing.id,
      }, 409);
    }

    const id = String(body?.summaryId || `day_${businessId}_${new Date(summaryDate).toISOString().slice(0, 10)}`).trim();
    const serverSummary = await buildServerDaySummary(env.DB, businessId, summaryDate);
    const totalSales = nonNegative(serverSummary.totalSales);
    const grossSales = nonNegative(serverSummary.grossSales);
    const taxTotal = nonNegative(serverSummary.taxTotal);
    const cashSales = nonNegative(serverSummary.cashSales);
    const customerCashPayments = nonNegative(serverSummary.customerCashPayments);
    const customerMpesaPayments = nonNegative(serverSummary.customerMpesaPayments);
    const mpesaSales = nonNegative(serverSummary.mpesaSales);
    const pdqSales = nonNegative(serverSummary.pdqSales);
    const totalExpenses = nonNegative(serverSummary.totalExpenses);
    const supplierPaymentsTotal = nonNegative(serverSummary.supplierPaymentsTotal);
    const remittanceTotal = nonNegative(serverSummary.remittanceTotal);
    const totalPicks = nonNegative(serverSummary.totalPicks);
    const totalRefunds = nonNegative(serverSummary.totalRefunds);
    const cashRefunds = nonNegative(serverSummary.cashRefunds);
    const openingCash = nonNegative(serverSummary.openingCash);
    const expectedCash = nonNegative(serverSummary.expectedCash);
    const reportedCash = nonNegative(serverSummary.reportedCash);
    const totalVariance = n(serverSummary.totalVariance);
    const shiftIdsJson = JSON.stringify(serverSummary.shiftIds);
    const shiftReportsJson = JSON.stringify(serverSummary.shiftReports).slice(0, 20000);
    await env.DB.prepare(`
      INSERT INTO dailySummaries (id, date, shiftIds, totalSales, grossSales, taxTotal, cashSales, customerCashPayments, customerMpesaPayments, mpesaSales, pdqSales, totalExpenses, supplierPaymentsTotal, remittanceTotal, totalPicks, totalRefunds, cashRefunds, openingCash, expectedCash, reportedCash, totalVariance, shiftReports, timestamp, businessId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, summaryDate, shiftIdsJson, totalSales, grossSales, taxTotal, cashSales, customerCashPayments, customerMpesaPayments, mpesaSales, pdqSales, totalExpenses, supplierPaymentsTotal, remittanceTotal, totalPicks, totalRefunds, cashRefunds, openingCash, expectedCash, reportedCash, totalVariance, shiftReportsJson, now, businessId, now).run();
    await env.DB.prepare(`
      INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      now,
      auth.principal.userId || null,
      auth.principal.userName || null,
      'report.day.close',
      'dailySummary',
      id,
      totalVariance === 0 ? 'INFO' : 'WARN',
      `Closed business day ${new Date(summaryDate).toISOString().slice(0, 10)} with sales Ksh ${totalSales.toLocaleString()} and variance Ksh ${totalVariance.toLocaleString()}.`,
        businessId, now,
      ).run();
    return json({
      success: true,
      summaryId: id,
      idempotent: false,
      summary: {
        ...serverSummary,
        id,
        timestamp: now,
        businessId,
        recordType: 'DAILY_SUMMARY',
      },
    });
  } catch (err: any) {
    if (/unique|constraint/i.test(String(err?.message || ''))) {
      return json({ error: 'This business already has a daily close report for that day.' }, 409);
    }
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not close day.' }, status);
  }
};
