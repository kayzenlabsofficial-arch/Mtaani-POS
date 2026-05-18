import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const FINANCE_ROLES = new Set(['ROOT', 'ADMIN']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

async function ensureSchema(db: D1Database) {
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
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !FINANCE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to manage financial accounts.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);
    if (branchId && !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'SAVE') {
      const account = body?.account || body || {};
      const name = trimText(account.name, 120);
      if (!name) return json({ error: 'Account name is required.' }, 400);
      const id = trimText(account.id || body?.accountId, 160) || crypto.randomUUID();
      const existing = await env.DB.prepare(`
        SELECT *
        FROM financialAccounts
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(id, businessId).first<any>();
      const accountBranchId = trimText(account.branchId, 160) || null;
      if (accountBranchId && !canAccessBranch(auth.principal, accountBranchId)) return json({ error: 'Access denied.' }, 403);
      const type = ['BANK', 'MPESA', 'CASH'].includes(String(account.type || '').toUpperCase()) ? String(account.type).toUpperCase() : 'BANK';
      const savedAccount = {
        id,
        name,
        type,
        accountNumber: trimText(account.accountNumber, 80) || null,
        balance: existing ? asNumber(existing.balance) : roundMoney(Math.max(0, asNumber(account.balance))),
        branchId: existing?.branchId || accountBranchId,
        businessId,
        updated_at: now,
      };

      await env.DB.batch([
        env.DB.prepare(`
          INSERT OR REPLACE INTO financialAccounts (id, name, type, balance, businessId, branchId, accountNumber, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(savedAccount.id, savedAccount.name, savedAccount.type, savedAccount.balance, businessId, savedAccount.branchId, savedAccount.accountNumber, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'finance.account.update' : 'finance.account.create', 'financialAccount', id, 'INFO', `${existing ? 'Updated' : 'Created'} financial account ${name}.`, businessId, savedAccount.branchId, now),
      ]);
      return json({ success: true, account: savedAccount });
    }

    const accountId = trimText(body?.accountId || body?.id, 160);
    if (!accountId) return json({ error: 'Account is required.' }, 400);
    const account = await env.DB.prepare(`
      SELECT *
      FROM financialAccounts
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(accountId, businessId).first<any>();
    if (!account) throw new PolicyError('Account was not found.', 404);
    if (account.branchId && !canAccessBranch(auth.principal, account.branchId)) return json({ error: 'Access denied.' }, 403);

    if (action === 'DELETE') {
      if (Math.abs(asNumber(account.balance)) > 0.01) throw new PolicyError('Only zero-balance accounts can be deleted.', 409);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM financialAccounts WHERE id = ? AND businessId = ?`).bind(accountId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'finance.account.delete', 'financialAccount', accountId, 'WARN', `Deleted financial account ${account.name}.`, businessId, account.branchId || null, now),
      ]);
      return json({ success: true, accountId });
    }

    if (action !== 'DEPOSIT' && action !== 'WITHDRAW') return json({ error: 'Unsupported finance action.' }, 400);
    const amount = roundMoney(asNumber(body?.amount));
    if (amount <= 0) throw new PolicyError('Enter a valid amount.', 400);
    if (action === 'WITHDRAW' && asNumber(account.balance) < amount) throw new PolicyError(`Insufficient balance in ${account.name}.`, 409);
    const nextBalance = action === 'DEPOSIT'
      ? roundMoney(asNumber(account.balance) + amount)
      : roundMoney(asNumber(account.balance) - amount);

    await env.DB.batch([
      env.DB.prepare(`UPDATE financialAccounts SET balance = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(nextBalance, now, accountId, businessId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, action === 'DEPOSIT' ? 'finance.account.deposit' : 'finance.account.withdraw', 'financialAccount', accountId, action === 'WITHDRAW' ? 'WARN' : 'INFO', `${action === 'DEPOSIT' ? 'Deposited' : 'Withdrew'} Ksh ${amount.toLocaleString()} ${action === 'DEPOSIT' ? 'to' : 'from'} ${account.name}.`, businessId, account.branchId || null, now),
    ]);

    return json({ success: true, accountId, balance: nextBalance });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update financial account.' }, status);
  }
};

