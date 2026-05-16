import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../_authUtils';
import { PolicyError } from '../_salesSecurity';

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

async function ensureCloseShiftSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS endOfDayReports (
      id TEXT PRIMARY KEY,
      shiftId TEXT,
      timestamp INTEGER NOT NULL,
      openingFloat REAL,
      totalSales REAL NOT NULL DEFAULT 0,
      grossSales REAL NOT NULL DEFAULT 0,
      taxTotal REAL NOT NULL DEFAULT 0,
      cashSales REAL NOT NULL DEFAULT 0,
      mpesaSales REAL NOT NULL DEFAULT 0,
      totalExpenses REAL NOT NULL DEFAULT 0,
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
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      startTime INTEGER NOT NULL,
      endTime INTEGER,
      openingFloat REAL,
      cashierName TEXT NOT NULL,
      status TEXT NOT NULL,
      branchId TEXT,
      lastSyncAt INTEGER,
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
    'ALTER TABLE endOfDayReports ADD COLUMN shiftId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN openingFloat REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN totalRefunds REAL',
    'ALTER TABLE endOfDayReports ADD COLUMN branchId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN businessId TEXT',
    'ALTER TABLE endOfDayReports ADD COLUMN updated_at INTEGER',
    'ALTER TABLE shifts ADD COLUMN openingFloat REAL',
    'ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER',
    'ALTER TABLE shifts ADD COLUMN branchId TEXT',
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
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

    const reportId = s(body?.reportId, 160) || `eod_${businessId}_${branchId}_${shiftId}`;
    const cashierName = s(report.cashierName || body?.cashierName || auth.principal.userName, 120) || 'Staff';
    const totalSales = nonNegative(report.totalSales);
    const grossSales = nonNegative(report.grossSales);
    const taxTotal = nonNegative(report.taxTotal);
    const cashSales = nonNegative(report.cashSales);
    const mpesaSales = nonNegative(report.mpesaSales);
    const totalExpenses = nonNegative(report.totalExpenses);
    const totalPicks = nonNegative(report.totalPicks);
    const totalRefunds = nonNegative(report.totalRefunds);
    const expectedCash = nonNegative(report.expectedCash);
    const reportedCash = nonNegative(report.reportedCash);
    const difference = n(report.difference, reportedCash - expectedCash);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO endOfDayReports (id, shiftId, timestamp, totalSales, grossSales, taxTotal, cashSales, mpesaSales, totalExpenses, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(reportId, shiftId, now, totalSales, grossSales, taxTotal, cashSales, mpesaSales, totalExpenses, totalPicks, totalRefunds, expectedCash, reportedCash, difference, cashierName, branchId, businessId, now),
      env.DB.prepare(`
        INSERT INTO shifts (id, startTime, endTime, cashierName, status, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          endTime = excluded.endTime,
          cashierName = excluded.cashierName,
          status = excluded.status,
          branchId = excluded.branchId,
          businessId = excluded.businessId,
          updated_at = excluded.updated_at
      `).bind(shiftId, n(body?.startTime || report.startTime || now), now, cashierName, 'CLOSED', branchId, businessId, now),
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
