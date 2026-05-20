import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const STAFF_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);
const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);
const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders } });
}
function asNumber(value: unknown, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function trimText(value: unknown, max = 160) { return String(value ?? '').trim().slice(0, max); }

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS cashPicks (
      id TEXT PRIMARY KEY,
      amount REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      userName TEXT,
      accountId TEXT,
      shiftId TEXT,
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
      cashierId TEXT,
      cashierName TEXT NOT NULL,
      status TEXT NOT NULL,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      branchId TEXT,
      accountNumber TEXT,
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
    'ALTER TABLE cashPicks ADD COLUMN accountId TEXT',
    'ALTER TABLE cashPicks ADD COLUMN shiftId TEXT',
    'ALTER TABLE cashPicks ADD COLUMN branchId TEXT',
    'ALTER TABLE cashPicks ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN cashierId TEXT',
    'ALTER TABLE shifts ADD COLUMN branchId TEXT',
    'ALTER TABLE shifts ADD COLUMN businessId TEXT',
    'ALTER TABLE shifts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE financialAccounts ADD COLUMN branchId TEXT',
    'ALTER TABLE financialAccounts ADD COLUMN accountNumber TEXT',
    'ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

function todayStartMs(now = Date.now()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function cashAmountFromTransaction(row: any): number {
  const method = String(row?.paymentMethod || '').toUpperCase();
  if (method === 'CASH') return asNumber(row?.total);
  if (method !== 'SPLIT') return 0;
  const split = parseMaybeJson(row?.splitPayments) || parseMaybeJson(row?.splitData) || {};
  return asNumber(split.cashAmount);
}

function inShiftScope(row: any, since: number, shiftId?: string | null): boolean {
  if (shiftId && row?.shiftId) return row.shiftId === shiftId;
  return asNumber(row?.timestamp || row?.issueDate) >= since;
}

function cashAmountFromRefund(row: any): number {
  if (String(row?.status || 'APPROVED').toUpperCase() === 'REJECTED') return 0;
  const source = String(row?.source || '').toUpperCase();
  if (source === 'TILL' || source === 'MIXED') return asNumber(row?.cashAmount ?? row?.amount);
  return asNumber(row?.cashAmount);
}

async function requireOwnOpenShift(
  db: D1Database,
  businessId: string,
  branchId: string,
  shiftId: string | null,
  principal: any,
  service: boolean,
) {
  if (!shiftId) throw new PolicyError('Open your own shift before picking cash.', 409);
  const shift = await db.prepare(`
    SELECT id, startTime, cashierId, cashierName, status
    FROM shifts
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(shiftId, businessId, branchId).first<any>();
  if (!shift) throw new PolicyError('Shift was not found.', 404);
  if (String(shift.status || '').toUpperCase() !== 'OPEN') throw new PolicyError('Only open shifts can pick cash.', 409);
  if (!service) {
    const userId = String(principal?.userId || '').trim();
    const userName = String(principal?.userName || '').trim().toLowerCase();
    const cashierId = String(shift.cashierId || '').trim();
    const cashierName = String(shift.cashierName || '').trim().toLowerCase();
    const ownsShift = (userId && cashierId === userId)
      || (userName && cashierName === userName)
      || (userId && String(shift.id || '').includes(`_${userId}`));
    if (!ownsShift) throw new PolicyError('You can only pick cash from your own shift.', 403);
  }
  return shift;
}

async function resolveShiftStart(db: D1Database, businessId: string, branchId: string, shiftId?: string | null, fallback?: unknown): Promise<number> {
  const inputStart = asNumber(fallback);
  if (inputStart > 0) return inputStart;
  if (shiftId) {
    const shift = await db.prepare(`
      SELECT startTime
      FROM shifts
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(shiftId, businessId, branchId).first<any>().catch(() => null);
    if (shift?.startTime) return asNumber(shift.startTime, todayStartMs());
  }
  return todayStartMs();
}

async function availableCashForPick(db: D1Database, businessId: string, branchId: string, since: number, shiftId?: string | null): Promise<number> {
  const [transactions, expenses, picks, refunds, supplierPayments] = await Promise.all([
    db.prepare(`SELECT total, timestamp, status, paymentMethod, splitPayments, splitData, shiftId FROM transactions WHERE businessId = ? AND branchId = ? AND timestamp >= ?`)
      .bind(businessId, branchId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, timestamp, status, source, shiftId FROM expenses WHERE businessId = ? AND branchId = ? AND timestamp >= ?`)
      .bind(businessId, branchId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, timestamp, status, shiftId FROM cashPicks WHERE businessId = ? AND branchId = ? AND timestamp >= ?`)
      .bind(businessId, branchId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, cashAmount, timestamp, status, source, shiftId FROM refunds WHERE businessId = ? AND branchId = ? AND timestamp >= ?`)
      .bind(businessId, branchId, since).all<any>().catch(() => ({ results: [] })),
    db.prepare(`SELECT amount, timestamp, source, shiftId FROM supplierPayments WHERE businessId = ? AND branchId = ? AND timestamp >= ?`)
      .bind(businessId, branchId, since).all<any>().catch(() => ({ results: [] })),
  ]);
  const txRows = (transactions.results || []).filter(row => inShiftScope(row, since, shiftId) && String(row.status || '').toUpperCase() === 'PAID');
  const expenseRows = (expenses.results || []).filter(row => inShiftScope(row, since, shiftId) && String(row.source || '').toUpperCase() === 'TILL' && String(row.status || '').toUpperCase() !== 'REJECTED');
  const pickRows = (picks.results || []).filter(row => inShiftScope(row, since, shiftId) && String(row.status || '').toUpperCase() !== 'REJECTED');
  const refundRows = (refunds.results || []).filter(row => inShiftScope(row, since, shiftId));
  const supplierRows = (supplierPayments.results || []).filter(row => inShiftScope(row, since, shiftId) && String(row.source || '').toUpperCase() === 'TILL');
  const cashSales = txRows.reduce((sum, row) => sum + cashAmountFromTransaction(row), 0);
  const tillExpenses = expenseRows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const picked = pickRows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  const cashRefunds = refundRows.reduce((sum, row) => sum + cashAmountFromRefund(row), 0);
  const supplierTillPayments = supplierRows.reduce((sum, row) => sum + asNumber(row.amount), 0);
  return Math.max(0, Math.round((cashSales - tillExpenses - picked - supplierTillPayments - cashRefunds) * 100) / 100);
}

async function ensurePickedCashAccount(db: D1Database, businessId: string, branchId: string, requestedAccountId?: unknown): Promise<any> {
  const accountId = trimText(requestedAccountId, 160);
  if (accountId) {
    const account = await db.prepare(`
      SELECT id, name, branchId
      FROM financialAccounts
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(accountId, businessId).first<any>();
    if (!account) throw new PolicyError('Selected picked-cash account was not found.', 404);
    if (account.branchId && account.branchId !== branchId) throw new PolicyError('Selected picked-cash account belongs to another branch.', 403);
    return account;
  }

  const id = trimText(`picked_cash_${businessId}_${branchId}`, 160);
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, branchId, accountNumber, updated_at)
    VALUES (?, 'Picked cash', 'CASH', 0, ?, ?, 'PICKED-CASH', ?)
  `).bind(id, businessId, branchId, now).run();
  return db.prepare(`SELECT id, name, branchId FROM financialAccounts WHERE id = ? AND businessId = ? LIMIT 1`)
    .bind(id, businessId)
    .first<any>();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'CREATE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);
    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'CREATE') {
      if (!auth.service && !STAFF_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to record cash picks.' }, 403);
      const amount = asNumber(body?.amount);
      if (amount <= 0) throw new PolicyError('Cash pick amount must be more than zero.', 400);
      const status = String(body?.status || 'PENDING').toUpperCase() === 'APPROVED' && (auth.service || APPROVER_ROLES.has(auth.principal.role)) ? 'APPROVED' : 'PENDING';
      const id = trimText(body?.cashPickId, 160) || crypto.randomUUID();
      const shiftId = trimText(body?.shiftId, 160) || null;
      const shift = await requireOwnOpenShift(env.DB, businessId, branchId, shiftId, auth.principal, auth.service);
      const shiftStart = await resolveShiftStart(env.DB, businessId, branchId, shiftId, body?.shiftStart || shift.startTime);
      const availableCash = await availableCashForPick(env.DB, businessId, branchId, shiftStart, shiftId);
      if (amount > availableCash + 0.01) throw new PolicyError(`Cash pick exceeds cash sales available in this shift. Available: Ksh ${availableCash.toLocaleString()}.`, 409);
      const pickedAccount = status === 'APPROVED' ? await ensurePickedCashAccount(env.DB, businessId, branchId, body?.accountId) : null;
      const cashPick = { id, amount, timestamp: now, status, userName: trimText(body?.userName || auth.principal.userName, 120), branchId, businessId, accountId: pickedAccount?.id || null, shiftId, updated_at: now };
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(`INSERT INTO cashPicks (id, amount, timestamp, status, userName, accountId, shiftId, branchId, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(cashPick.id, amount, now, status, cashPick.userName, cashPick.accountId, cashPick.shiftId, branchId, businessId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, status === 'APPROVED' ? 'cash.pick.owner_sweep' : 'cash.pick.request', 'cashPick', id, 'INFO', `Recorded cash pick of Ksh ${amount.toLocaleString()}.`, businessId, branchId, now),
      ];
      if (pickedAccount) {
        statements.push(
          env.DB.prepare(`UPDATE financialAccounts SET balance = COALESCE(balance, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`)
            .bind(amount, now, pickedAccount.id, businessId)
        );
      }
      await env.DB.batch(statements);
      return json({ success: true, cashPick });
    }

    if (action === 'APPROVE') {
      if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to approve cash picks.' }, 403);
      const cashPickId = trimText(body?.cashPickId || body?.id, 160);
      if (!cashPickId) return json({ error: 'Cash pick is required.' }, 400);
      const pick = await env.DB.prepare(`SELECT id, amount, status, accountId FROM cashPicks WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1`)
        .bind(cashPickId, businessId, branchId)
        .first<any>();
      if (!pick) throw new PolicyError('Cash pick was not found.', 404);
      if (String(pick.status || '').toUpperCase() === 'APPROVED' && pick.accountId) {
        return json({ success: true, cashPickId, idempotent: true });
      }
      const pickedAccount = await ensurePickedCashAccount(env.DB, businessId, branchId, body?.accountId || pick.accountId);
      await env.DB.batch([
        env.DB.prepare(`UPDATE cashPicks SET status = 'APPROVED', accountId = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`)
          .bind(pickedAccount.id, now, cashPickId, businessId, branchId),
        env.DB.prepare(`UPDATE financialAccounts SET balance = COALESCE(balance, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(asNumber(pick.amount), now, pickedAccount.id, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'cash.pick.approve', 'cashPick', cashPickId, 'INFO', `Approved cash pick of Ksh ${Number(pick.amount || 0).toLocaleString()}.`, businessId, branchId, now),
      ]);
      return json({ success: true, cashPickId });
    }

    return json({ error: 'Unsupported cash pick action.' }, 400);
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update cash pick.' }, status);
  }
};
