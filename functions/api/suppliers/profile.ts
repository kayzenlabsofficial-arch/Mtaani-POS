import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const SUPPLIER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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
    if (!auth.service && !SUPPLIER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to manage suppliers.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const supplierId = trimText(body?.supplierId || body?.supplier?.id, 160);
    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'DELETE') {
      if (!supplierId) return json({ error: 'Supplier is required.' }, 400);
      const supplier = await env.DB.prepare(`
        SELECT id, company, balance, branchId
        FROM suppliers
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(supplierId, businessId).first<any>();
      if (!supplier) throw new PolicyError('Supplier was not found.', 404);
      if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError('Supplier belongs to another branch.', 403);
      if (Number(supplier.balance || 0) > 0.01) throw new PolicyError('Suppliers with an outstanding balance cannot be deleted.', 409);
      const refs = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM purchaseOrders WHERE supplierId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM supplierPayments WHERE supplierId = ? AND businessId = ?) +
          (SELECT COUNT(*) FROM creditNotes WHERE supplierId = ? AND businessId = ?) AS count
      `).bind(supplierId, businessId, supplierId, businessId, supplierId, businessId).first<any>();
      if (Number(refs?.count || 0) > 0) throw new PolicyError('Suppliers with history should be kept for audit records.', 409);

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM suppliers WHERE id = ? AND businessId = ?`).bind(supplierId, businessId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'supplier.delete', 'supplier', supplierId, 'WARN', `Deleted supplier ${supplier.company}.`, businessId, branchId, now),
      ]);
      return json({ success: true, supplierId });
    }

    const supplier = body?.supplier || body || {};
    const company = trimText(supplier.company, 120);
    if (!company) return json({ error: 'Supplier company is required.' }, 400);
    const id = supplierId || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(id, businessId).first<any>();
    if (existing?.branchId && existing.branchId !== branchId) throw new PolicyError('Supplier belongs to another branch.', 403);

    const savedSupplier = {
      id,
      name: trimText(supplier.name, 120) || company,
      company,
      phone: trimText(supplier.phone, 40),
      email: trimText(supplier.email, 120),
      address: trimText(supplier.address, 240),
      kraPin: trimText(supplier.kraPin, 40),
      balance: Number(existing?.balance || 0),
      branchId: existing?.branchId || branchId,
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO suppliers (id, name, company, phone, email, address, kraPin, balance, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(savedSupplier.id, savedSupplier.name, savedSupplier.company, savedSupplier.phone, savedSupplier.email, savedSupplier.address, savedSupplier.kraPin, savedSupplier.balance, savedSupplier.branchId, savedSupplier.businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'supplier.update' : 'supplier.create', 'supplier', id, 'INFO', `${existing ? 'Updated' : 'Created'} supplier ${company}.`, businessId, branchId, now),
    ]);

    return json({ success: true, supplier: savedSupplier });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not save supplier.' }, status);
  }
};

