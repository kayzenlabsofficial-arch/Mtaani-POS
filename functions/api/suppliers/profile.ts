import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { DEFAULT_SHOP_ID } from '../inventoryIntegrity';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const SUPPLIER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      kraPin TEXT,
      balance REAL DEFAULT 0,
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

  const supplierColumns = [
    'address TEXT',
    'kraPin TEXT',
    'balance REAL DEFAULT 0',
    'shopId TEXT',
    'businessId TEXT',
    'updated_at INTEGER',
  ];
  for (const column of supplierColumns) {
    try { await db.prepare(`ALTER TABLE suppliers ADD COLUMN ${column}`).run(); } catch {}
  }
  try { await db.prepare(`UPDATE suppliers SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`).run(); } catch {}
  try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_suppliers_business_shop ON suppliers(businessId, shopId)').run(); } catch {}
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
    const supplierId = trimText(body?.supplierId || body?.supplier?.id, 160);
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }
    const requestShopId = normalizedShopId(request.headers.get('X-Shop-ID') || body?.shopId || body?.supplier?.shopId);

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'DELETE') {
      if (!supplierId) return json({ error: 'Supplier is required.' }, 400);
      const supplier = await env.DB.prepare(`
        SELECT id, company, balance
        FROM suppliers
        WHERE id = ?
          AND businessId = ?
          AND COALESCE(NULLIF(shopId, ''), ?) = ?
        LIMIT 1
      `).bind(supplierId, businessId, DEFAULT_SHOP_ID, requestShopId).first<any>();
      if (!supplier) throw new PolicyError('Supplier was not found.', 404);
      if (Number(supplier.balance || 0) > 0.01) throw new PolicyError('Suppliers with an outstanding balance cannot be deleted.', 409);
      const refs = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM purchaseOrders WHERE supplierId = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?) +
          (SELECT COUNT(*) FROM supplierPayments WHERE supplierId = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?) +
          (SELECT COUNT(*) FROM creditNotes WHERE supplierId = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?) AS count
      `).bind(supplierId, businessId, DEFAULT_SHOP_ID, requestShopId, supplierId, businessId, DEFAULT_SHOP_ID, requestShopId, supplierId, businessId, DEFAULT_SHOP_ID, requestShopId).first<any>();
      if (Number(refs?.count || 0) > 0) throw new PolicyError('Suppliers with history should be kept for audit records.', 409);

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM suppliers WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?`).bind(supplierId, businessId, DEFAULT_SHOP_ID, requestShopId),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, 'supplier.delete', 'supplier', supplierId, 'WARN', `Deleted supplier ${supplier.company}.`, businessId, now),
      ]);
      return json({ success: true, supplierId });
    }

    const supplier = body?.supplier || body || {};
    const company = trimText(supplier.company, 120);
    if (!company) return json({ error: 'Supplier company is required.' }, 400);
    const shopId = normalizedShopId(supplier.shopId || body?.shopId || requestShopId);
    const id = supplierId || crypto.randomUUID();
    const existing = await env.DB.prepare(`
      SELECT *
      FROM suppliers
      WHERE id = ?
        AND businessId = ?
        AND COALESCE(NULLIF(shopId, ''), ?) = ?
      LIMIT 1
    `).bind(id, businessId, DEFAULT_SHOP_ID, shopId).first<any>();

    const savedSupplier = {
      id,
      name: trimText(supplier.name, 120) || company,
      company,
      phone: trimText(supplier.phone, 40),
      email: trimText(supplier.email, 120),
      address: trimText(supplier.address, 240),
      kraPin: trimText(supplier.kraPin, 40),
      balance: Number(existing?.balance || 0),
      shopId: existing?.shopId || shopId,
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO suppliers (id, name, company, phone, email, address, kraPin, balance, shopId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(savedSupplier.id, savedSupplier.name, savedSupplier.company, savedSupplier.phone, savedSupplier.email, savedSupplier.address, savedSupplier.kraPin, savedSupplier.balance, savedSupplier.shopId, savedSupplier.businessId, now),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'supplier.update' : 'supplier.create', 'supplier', id, 'INFO', `${existing ? 'Updated' : 'Created'} supplier ${company}.`, businessId, now),
    ]);

    return json({ success: true, supplier: savedSupplier });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not save supplier.' }, status);
  }
};
