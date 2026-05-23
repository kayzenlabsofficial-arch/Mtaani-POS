import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const OPEN_SHIFT_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function text(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function nonNegative(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

async function ensureOpenShiftSchema(db: D1Database) {
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
  await db.prepare('CREATE TABLE IF NOT EXISTS salesTills (id TEXT PRIMARY KEY, name TEXT NOT NULL, isActive INTEGER DEFAULT 1, businessId TEXT, updated_at INTEGER)').run();
  for (const sql of [
    'ALTER TABLE shifts ADD COLUMN cashierId TEXT',
    'ALTER TABLE shifts ADD COLUMN tillId TEXT',
    'ALTER TABLE shifts ADD COLUMN tillName TEXT',
    'ALTER TABLE shifts ADD COLUMN openingCash REAL DEFAULT 0',
    'ALTER TABLE shifts ADD COLUMN closingCash REAL',
    'ALTER TABLE shifts ADD COLUMN expectedCash REAL',
    'ALTER TABLE shifts ADD COLUMN cashVariance REAL',
    'ALTER TABLE shifts ADD COLUMN closeBreakdown TEXT',
    'ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER',
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE salesTills ADD COLUMN isActive INTEGER DEFAULT 1',
    'ALTER TABLE salesTills ADD COLUMN businessId TEXT',
    'ALTER TABLE salesTills ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

function ownsShift(shift: any, userId: string, userName: string) {
  const cashierId = text(shift?.cashierId, 160);
  const cashierName = text(shift?.cashierName, 160).toLowerCase();
  return (userId && cashierId === userId)
    || (userName && cashierName === userName.toLowerCase())
    || (userId && String(shift?.id || '').includes(`_${userId}`));
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !OPEN_SHIFT_ROLES.has(auth.principal.role)) throw new PolicyError('You are not allowed to open shifts.', 403);

    const body = await request.json().catch(() => null) as any;
    const businessId = text(request.headers.get('X-Business-ID') || body?.businessId, 160);
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureOpenShiftSchema(env.DB);

    const userId = text(body?.cashierId || auth.principal.userId, 160);
    const userName = text(body?.cashierName || auth.principal.userName, 120) || 'Staff';
    const tillId = text(body?.tillId, 160);
    const tillName = text(body?.tillName, 120);
    if (!tillId || !tillName) throw new PolicyError('Choose a till before opening a shift.', 400);

    const openShifts = await env.DB.prepare(`
      SELECT *
      FROM shifts
      WHERE businessId = ? AND UPPER(COALESCE(status, '')) = 'OPEN'
    `).bind(businessId).all<any>();
    const rows = (openShifts.results || []) as any[];
    const ownOpenShift = rows.find(shift => ownsShift(shift, userId, userName));
    if (ownOpenShift) {
      return json({ success: true, shift: ownOpenShift, idempotent: true });
    }
    const tillBusy = rows.find(shift => text(shift.tillId, 160) === tillId);
    if (tillBusy) throw new PolicyError(`${text(tillBusy.tillName, 120) || 'This till'} is already open.`, 409);

    const activeTillCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM salesTills
      WHERE businessId = ? AND id = ? AND COALESCE(isActive, 1) != 0
    `).bind(businessId, tillId).first<any>().catch(() => null);
    const anyTillCount = await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM salesTills
      WHERE businessId = ? AND COALESCE(isActive, 1) != 0
    `).bind(businessId).first<any>().catch(() => null);
    if (Number(anyTillCount?.count || 0) > 0 && Number(activeTillCount?.count || 0) === 0) {
      throw new PolicyError('This till is not active. Check till setup in Settings.', 409);
    }

    const now = Date.now();
    const shift = {
      id: text(body?.id, 220) || `shift_${businessId}_${new Date(now).toISOString().slice(0, 10)}_${tillId}_${userId}_${now}`,
      startTime: Number(body?.startTime) || now,
      cashierId: userId || null,
      cashierName: userName,
      tillId,
      tillName,
      openingCash: nonNegative(body?.openingCash),
      status: 'OPEN',
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO shifts (id, startTime, cashierId, cashierName, tillId, tillName, openingCash, status, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(shift.id, shift.startTime, shift.cashierId, shift.cashierName, shift.tillId, shift.tillName, shift.openingCash, shift.status, businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'shift.open',
        'shift',
        shift.id,
        'INFO',
        `Opened ${shift.tillName} shift with opening cash Ksh ${shift.openingCash.toLocaleString()}.`,
        businessId,
        now,
      ),
    ]);

    return json({ success: true, shift, idempotent: false });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not open shift.' }, status);
  }
};
