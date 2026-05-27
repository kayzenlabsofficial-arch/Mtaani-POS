import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { DEFAULT_SHOP_ID } from '../inventoryIntegrity';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const SAVE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);
const DELETE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Shop-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizedShopId(value: unknown) {
  return trimText(value, 160) || DEFAULT_SHOP_ID;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      totalSpent REAL,
      balance REAL,
      shopId TEXT,
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
    'ALTER TABLE customers ADD COLUMN phone TEXT',
    'ALTER TABLE customers ADD COLUMN email TEXT',
    'ALTER TABLE customers ADD COLUMN totalSpent REAL',
    'ALTER TABLE customers ADD COLUMN balance REAL',
    'ALTER TABLE customers ADD COLUMN shopId TEXT',
    'ALTER TABLE customers ADD COLUMN businessId TEXT',
    'ALTER TABLE customers ADD COLUMN updated_at INTEGER',
    `UPDATE customers SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
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

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const customerId = trimText(body?.customerId || body?.customer?.id, 160);
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }
    const requestShopId = normalizedShopId(request.headers.get('X-Shop-ID') || body?.shopId || body?.customer?.shopId);

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'DELETE') {
      if (!auth.service && !DELETE_ROLES.has(auth.principal.role)) {
        return json({ error: 'You are not allowed to delete customers.' }, 403);
      }
      if (!customerId) return json({ error: 'Customer is required.' }, 400);
      const customer = await env.DB.prepare(`
        SELECT id, name, balance
        FROM customers
        WHERE id = ?
          AND businessId = ?
          AND COALESCE(NULLIF(shopId, ''), ?) = ?
        LIMIT 1
      `).bind(customerId, businessId, DEFAULT_SHOP_ID, requestShopId).first<any>();
      if (!customer) throw new PolicyError('Customer was not found.', 404);
      if (Number(customer.balance || 0) > 0.01) throw new PolicyError('Customers with an outstanding balance cannot be deleted.', 409);

      const refs = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE customerId = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?) +
          (SELECT COUNT(*) FROM salesInvoices WHERE customerId = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?) +
          (SELECT COUNT(*) FROM customerPayments WHERE customerId = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?) AS count
      `).bind(customerId, businessId, DEFAULT_SHOP_ID, requestShopId, customerId, businessId, DEFAULT_SHOP_ID, requestShopId, customerId, businessId, DEFAULT_SHOP_ID, requestShopId).first<any>();
      if (Number(refs?.count || 0) > 0) throw new PolicyError('Customers with history should be kept for audit records.', 409);

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM customers WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?`).bind(customerId, businessId, DEFAULT_SHOP_ID, requestShopId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'customer.delete', 'customer', customerId, 'WARN', `Deleted customer ${customer.name}.`, businessId, now),
      ]);
      return json({ success: true, customerId });
    }

    if (!auth.service && !SAVE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to save customers.' }, 403);
    }

    const customer = body?.customer || body || {};
    const name = trimText(customer.name, 120);
    if (!name) return json({ error: 'Customer name is required.' }, 400);
    const shopId = normalizedShopId(customer.shopId || body?.shopId || requestShopId);
    const id = customerId || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM customers
      WHERE id = ?
        AND businessId = ?
        AND COALESCE(NULLIF(shopId, ''), ?) = ?
      LIMIT 1
    `).bind(id, businessId, DEFAULT_SHOP_ID, shopId).first<any>();

    const savedCustomer = {
      id,
      name,
      phone: trimText(customer.phone, 40),
      email: trimText(customer.email, 120),
      totalSpent: Number(existing?.totalSpent || 0),
      balance: Number(existing?.balance || 0),
      shopId: existing?.shopId || shopId,
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO customers (id, name, phone, email, totalSpent, balance, shopId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(savedCustomer.id, savedCustomer.name, savedCustomer.phone, savedCustomer.email, savedCustomer.totalSpent, savedCustomer.balance, savedCustomer.shopId, savedCustomer.businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'customer.update' : 'customer.create', 'customer', id, 'INFO', `${existing ? 'Updated' : 'Created'} customer ${name}.`, businessId, now),
    ]);

    return json({ success: true, customer: savedCustomer });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not save customer.' }, status);
  }
};
