import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const SAVE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);
const DELETE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const customerId = trimText(body?.customerId || body?.customer?.id, 160);
    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'DELETE') {
      if (!auth.service && !DELETE_ROLES.has(auth.principal.role)) {
        return json({ error: 'You are not allowed to delete customers.' }, 403);
      }
      if (!customerId) return json({ error: 'Customer is required.' }, 400);
      const customer = await env.DB.prepare(`
        SELECT id, name, balance, branchId
        FROM customers
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(customerId, businessId).first<any>();
      if (!customer) throw new PolicyError('Customer was not found.', 404);
      if (customer.branchId && customer.branchId !== branchId) throw new PolicyError('Customer belongs to another branch.', 403);
      if (Number(customer.balance || 0) > 0.01) throw new PolicyError('Customers with an outstanding balance cannot be deleted.', 409);

      const refs = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE customerId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM salesInvoices WHERE customerId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM customerPayments WHERE customerId = ? AND businessId = ?) AS count
      `).bind(customerId, businessId, customerId, businessId, customerId, businessId).first<any>();
      if (Number(refs?.count || 0) > 0) throw new PolicyError('Customers with history should be kept for audit records.', 409);

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM customers WHERE id = ? AND businessId = ?`).bind(customerId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'customer.delete', 'customer', customerId, 'WARN', `Deleted customer ${customer.name}.`, businessId, branchId, now),
      ]);
      return json({ success: true, customerId });
    }

    if (!auth.service && !SAVE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to save customers.' }, 403);
    }

    const customer = body?.customer || body || {};
    const name = trimText(customer.name, 120);
    if (!name) return json({ error: 'Customer name is required.' }, 400);
    const id = customerId || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM customers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(id, businessId).first<any>();
    if (existing?.branchId && existing.branchId !== branchId) throw new PolicyError('Customer belongs to another branch.', 403);

    const savedCustomer = {
      id,
      name,
      phone: trimText(customer.phone, 40),
      email: trimText(customer.email, 120),
      totalSpent: Number(existing?.totalSpent || 0),
      balance: Number(existing?.balance || 0),
      branchId: existing?.branchId || branchId,
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO customers (id, name, phone, email, totalSpent, balance, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(savedCustomer.id, savedCustomer.name, savedCustomer.phone, savedCustomer.email, savedCustomer.totalSpent, savedCustomer.balance, savedCustomer.branchId, savedCustomer.businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'customer.update' : 'customer.create', 'customer', id, 'INFO', `${existing ? 'Updated' : 'Created'} customer ${name}.`, businessId, branchId, now),
    ]);

    return json({ success: true, customer: savedCustomer });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not save customer.' }, status);
  }
};

