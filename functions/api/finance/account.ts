import { authorizeRequest, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const FINANCE_ROLES = new Set(['ROOT', 'ADMIN']);
const MAIN_ACCOUNT_NAME = 'Main account';
const MAIN_ACCOUNT_NUMBER = 'PICKED-CASH';

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

function pickedCashAccountId(businessId: string) {
  return `picked_cash_${businessId}`.slice(0, 160);
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
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
}

async function ensureMainAccount(db: D1Database, businessId: string) {
  const id = pickedCashAccountId(businessId);
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
    VALUES (?, ?, 'CASH', 0, ?, ?, ?)
  `).bind(id, MAIN_ACCOUNT_NAME, businessId || null, MAIN_ACCOUNT_NUMBER, now).run();
  await db.prepare(`
    UPDATE financialAccounts
    SET name = ?, type = 'CASH', accountNumber = ?, updated_at = ?
    WHERE id = ? AND businessId = ?
  `).bind(MAIN_ACCOUNT_NAME, MAIN_ACCOUNT_NUMBER, now, id, businessId).run();
  return db.prepare(`
    SELECT id, name, type, accountNumber, balance, businessId, updated_at
    FROM financialAccounts
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(id, businessId).first<any>();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !FINANCE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to manage the Main account.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureSchema(env.DB);
    const account = await ensureMainAccount(env.DB, businessId);

    if (action === 'SAVE') {
      return json({ success: true, account });
    }

    if (action === 'DELETE') {
      return json({ error: 'The Main account is built in and cannot be deleted.' }, 409);
    }

    if (action === 'ADJUST') {
      const mode = String(body?.mode || '').trim().toUpperCase();
      if (!['IN', 'OUT', 'SET'].includes(mode)) return json({ error: 'Select money in, money out, or set balance.' }, 400);
      const amount = Number(body?.amount);
      if (!Number.isFinite(amount) || amount < 0) return json({ error: 'Enter a valid adjustment amount.' }, 400);
      if ((mode === 'IN' || mode === 'OUT') && amount <= 0) return json({ error: 'Adjustment amount must be above zero.' }, 400);

      const reason = String(body?.reason || '').trim().slice(0, 240) || 'Manual adjustment';
      const fresh = await ensureMainAccount(env.DB, businessId);
      const balanceBefore = Number(fresh?.balance || 0);
      const delta = mode === 'SET' ? amount - balanceBefore : mode === 'OUT' ? -amount : amount;
      const balanceAfter = Math.round((balanceBefore + delta) * 100) / 100;
      if (balanceAfter < 0) return json({ error: 'Main account balance cannot go below zero.' }, 409);

      const now = Date.now();
      const adjustmentId = crypto.randomUUID();
      const userName = String(body?.userName || auth.principal.userName || 'Admin').trim().slice(0, 120);
      const statements = [
        env.DB.prepare(`UPDATE financialAccounts SET balance = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(balanceAfter, now, fresh.id, businessId),
        env.DB.prepare(`
          INSERT INTO financialAccountAdjustments (id, accountId, amount, direction, balanceBefore, balanceAfter, reason, userName, timestamp, businessId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(adjustmentId, fresh.id, delta, mode, balanceBefore, balanceAfter, reason, userName, now, businessId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, userName, 'finance.main_account.adjust', 'financialAccount', fresh.id, 'WARN', `${mode === 'IN' ? 'Added' : mode === 'OUT' ? 'Removed' : 'Set'} Main account balance by Ksh ${Math.abs(delta).toLocaleString()}. ${reason}`, businessId, now),
      ];
      await env.DB.batch(statements);
      const updated = await ensureMainAccount(env.DB, businessId);
      return json({
        success: true,
        account: updated,
        adjustment: {
          id: adjustmentId,
          accountId: fresh.id,
          amount: delta,
          direction: mode,
          balanceBefore,
          balanceAfter,
          reason,
          userName,
          timestamp: now,
          businessId,
          updated_at: now,
        },
      });
    }

    if (action === 'DEPOSIT' || action === 'WITHDRAW') {
      return json({ error: 'Use Main account adjustment instead.' }, 409);
    }

    return json({ error: 'Unsupported finance action.' }, 400);
  } catch (err: any) {
    return json({ error: err?.message || 'Could not update Main account.' }, 500);
  }
};
