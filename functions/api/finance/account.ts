import { authorizeRequest, canAccessBusiness } from '../authUtils';

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
}

async function ensurePickedCashAccount(db: D1Database, businessId: string) {
  const id = pickedCashAccountId(businessId);
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
    VALUES (?, 'Picked cash account', 'CASH', 0, ?, 'PICKED-CASH', ?)
  `).bind(id, businessId || null, now).run();
  await db.prepare(`
    UPDATE financialAccounts
    SET name = 'Picked cash account', type = 'CASH', accountNumber = 'PICKED-CASH', updated_at = ?
    WHERE id = ? AND businessId = ?
  `).bind(now, id, businessId).run();
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
      return json({ error: 'You are not allowed to manage the picked cash account.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureSchema(env.DB);
    const account = await ensurePickedCashAccount(env.DB, businessId);

    if (action === 'SAVE') {
      return json({ success: true, account });
    }

    if (action === 'DELETE') {
      return json({ error: 'The picked cash account is built in and cannot be deleted.' }, 409);
    }

    if (action === 'DEPOSIT' || action === 'WITHDRAW') {
      return json({ error: 'Picked cash balance is changed by cash picks and account-funded payments only.' }, 409);
    }

    return json({ error: 'Unsupported finance action.' }, 400);
  } catch (err: any) {
    return json({ error: err?.message || 'Could not update picked cash account.' }, 500);
  }
};
