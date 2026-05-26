import { authorizeRequest, canAccessBusiness } from '../authUtils';
import {
  MAIN_ACCOUNT_NAME,
  ensureMainAccount,
  ensureMainAccountSchema,
  reconcileMpesaMainAccount,
} from './mainAccountPosting';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const FINANCE_ROLES = new Set(['ROOT', 'ADMIN']);

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

async function ensureSchema(db: D1Database) {
  await ensureMainAccountSchema(db);
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

    if (action === 'RECONCILE_MPESA') {
      const result = await reconcileMpesaMainAccount(env.DB, businessId, {
        userId: auth.principal.userId || null,
        userName: auth.principal.userName || 'Admin',
      });
      return json({ success: true, ...result });
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
