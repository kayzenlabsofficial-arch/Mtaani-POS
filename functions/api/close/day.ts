import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const CLOSE_DAY_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const DAY_MS = 24 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function n(value: unknown, fallback = 0) { const x = Number(value); return Number.isFinite(x) ? x : fallback; }
function nonNegative(value: unknown) { return Math.max(0, n(value)); }
function dayStartMs(value = Date.now()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
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
      totalPicks REAL NOT NULL DEFAULT 0,
      totalVariance REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      branchId TEXT,
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
    'ALTER TABLE dailySummaries ADD COLUMN grossSales REAL',
    'ALTER TABLE dailySummaries ADD COLUMN taxTotal REAL',
    'ALTER TABLE dailySummaries ADD COLUMN totalExpenses REAL',
    'ALTER TABLE dailySummaries ADD COLUMN totalPicks REAL',
    'ALTER TABLE dailySummaries ADD COLUMN totalVariance REAL',
    'ALTER TABLE dailySummaries ADD COLUMN branchId TEXT',
    'ALTER TABLE dailySummaries ADD COLUMN businessId TEXT',
    'ALTER TABLE dailySummaries ADD COLUMN updated_at INTEGER',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_dailySummaries_business_branch_date ON dailySummaries(businessId, branchId, date)',
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
    if (!auth.service && !CLOSE_DAY_ROLES.has(auth.principal.role)) throw new PolicyError('You are not allowed to close the business day.', 403);
    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    if (!businessId || !branchId || !canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);
    await ensureCloseDaySchema(env.DB);
    const now = Date.now();
    const summary = body?.summary || {};
    const requestedDate = n(summary.date, 0);
    const summaryDate = requestedDate > 0 ? requestedDate : dayStartMs(now);
    const existing = await env.DB.prepare(`
      SELECT id
      FROM dailySummaries
      WHERE businessId = ?
        AND branchId = ?
        AND date > ?
        AND date < ?
      LIMIT 1
    `).bind(businessId, branchId, summaryDate - DAY_MS, summaryDate + DAY_MS).first<any>();
    if (existing) {
      return json({
        error: `This branch already has a daily close report for ${new Date(summaryDate).toLocaleDateString('en-KE')}.`,
        summaryId: existing.id,
      }, 409);
    }

    const id = String(body?.summaryId || `day_${businessId}_${branchId}_${new Date(summaryDate).toISOString().slice(0, 10)}`).trim();
    const totalSales = nonNegative(summary.totalSales);
    const grossSales = nonNegative(summary.grossSales);
    const taxTotal = nonNegative(summary.taxTotal);
    const totalExpenses = nonNegative(summary.totalExpenses);
    const totalPicks = nonNegative(summary.totalPicks);
    const totalVariance = n(summary.totalVariance);
    await env.DB.prepare(`
      INSERT INTO dailySummaries (id, date, shiftIds, totalSales, grossSales, taxTotal, totalExpenses, totalPicks, totalVariance, timestamp, branchId, businessId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, summaryDate, JSON.stringify(Array.isArray(summary.shiftIds) ? summary.shiftIds : []), totalSales, grossSales, taxTotal, totalExpenses, totalPicks, totalVariance, now, branchId, businessId, now).run();
    await env.DB.prepare(`
      INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      businessId,
      branchId,
      now,
    ).run();
    return json({ success: true, summaryId: id, idempotent: false });
  } catch (err: any) {
    if (/unique|constraint/i.test(String(err?.message || ''))) {
      return json({ error: 'This branch already has a daily close report for that day.' }, 409);
    }
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not close day.' }, status);
  }
};
