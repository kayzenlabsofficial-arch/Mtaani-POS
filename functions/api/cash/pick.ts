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
      const cashPick = { id, amount, timestamp: now, status, userName: trimText(body?.userName || auth.principal.userName, 120), branchId, businessId, shiftId: body?.shiftId || null, updated_at: now };
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO cashPicks (id, amount, timestamp, status, userName, shiftId, branchId, businessId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(cashPick.id, amount, now, status, cashPick.userName, cashPick.shiftId, branchId, businessId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, status === 'APPROVED' ? 'cash.pick.owner_sweep' : 'cash.pick.request', 'cashPick', id, 'INFO', `Recorded cash pick of Ksh ${amount.toLocaleString()}.`, businessId, branchId, now),
      ]);
      return json({ success: true, cashPick });
    }

    if (action === 'APPROVE') {
      if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) return json({ error: 'You are not allowed to approve cash picks.' }, 403);
      const cashPickId = trimText(body?.cashPickId || body?.id, 160);
      if (!cashPickId) return json({ error: 'Cash pick is required.' }, 400);
      const pick = await env.DB.prepare(`SELECT id, amount, status FROM cashPicks WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1`)
        .bind(cashPickId, businessId, branchId)
        .first<any>();
      if (!pick) throw new PolicyError('Cash pick was not found.', 404);
      await env.DB.batch([
        env.DB.prepare(`UPDATE cashPicks SET status = 'APPROVED', updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`)
          .bind(now, cashPickId, businessId, branchId),
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

