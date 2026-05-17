import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const PURCHASE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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

function settingFlag(value: unknown, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return fallback;
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

async function nextPoNumber(db: D1Database, businessId: string, branchId: string) {
  const { results } = await db.prepare(`
    SELECT poNumber
    FROM purchaseOrders
    WHERE businessId = ? AND branchId = ? AND poNumber LIKE 'PO-%'
    ORDER BY orderDate DESC
    LIMIT 500
  `).bind(businessId, branchId).all();
  const max = ((results || []) as any[]).reduce((highest, row) => {
    const match = String(row.poNumber || '').match(/PO-(\d+)/i);
    const num = match ? Number(match[1]) : 0;
    return Number.isFinite(num) && num > highest ? num : highest;
  }, 0);
  return `PO-${String(max + 1).padStart(4, '0')}`;
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !PURCHASE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to save purchase orders.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const supplierId = String(body?.supplierId || '').trim();
    if (!businessId || !branchId || !supplierId) return json({ error: 'Business, branch and supplier are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const supplier = await env.DB.prepare(`
      SELECT id, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first<any>();
    if (!supplier) throw new PolicyError('Supplier was not found.', 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError('Supplier belongs to another branch.', 403);

    const rawItems = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) throw new PolicyError('Add at least one item to the purchase order.', 400);
    const items: any[] = [];
    for (const raw of rawItems.slice(0, 100)) {
      const productId = trimText(raw?.productId, 160);
      const expectedQuantity = asNumber(raw?.expectedQuantity);
      const unitCost = roundMoney(asNumber(raw?.unitCost));
      if (!productId || expectedQuantity <= 0 || unitCost < 0) throw new PolicyError('Purchase order line items are invalid.', 400);
      const product = await env.DB.prepare(`
        SELECT id, name, branchId
        FROM products
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(productId, businessId).first<any>();
      if (!product) throw new PolicyError('Purchase order includes a product that was not found.', 404);
      if (product.branchId && product.branchId !== branchId) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
      items.push({
        productId,
        name: product.name,
        expectedQuantity,
        receivedQuantity: 0,
        unitCost,
      });
    }

    const purchaseOrderId = trimText(body?.purchaseOrderId || body?.id, 160);
    const existing = purchaseOrderId
      ? await env.DB.prepare(`
          SELECT *
          FROM purchaseOrders
          WHERE id = ? AND businessId = ? AND branchId = ?
          LIMIT 1
        `).bind(purchaseOrderId, businessId, branchId).first<any>()
      : null;
    if (purchaseOrderId && !existing) throw new PolicyError('Purchase order was not found.', 404);
    if (existing?.status === 'RECEIVED') throw new PolicyError('Received purchase orders cannot be edited.', 409);

    const settings = await env.DB.prepare(`SELECT ownerModeEnabled, autoApproveOwnerActions FROM settings WHERE businessId = ? LIMIT 1`)
      .bind(businessId)
      .first<any>();
    const canUseOwnerMode = auth.principal.role === 'ADMIN' || auth.principal.role === 'MANAGER' || auth.principal.role === 'ROOT';
    const autoApprove = canUseOwnerMode && settingFlag(settings?.ownerModeEnabled, false) && settingFlag(settings?.autoApproveOwnerActions, true);

    const now = Date.now();
    const id = purchaseOrderId || `po_${businessId}_${branchId}_${crypto.randomUUID()}`;
    const poNumber = existing?.poNumber || await nextPoNumber(env.DB, businessId, branchId);
    const totalAmount = roundMoney(items.reduce((sum, item) => sum + (item.expectedQuantity * item.unitCost), 0));
    const approvalStatus = autoApprove ? 'APPROVED' : 'PENDING';
    const preparedBy = trimText(existing?.preparedBy || body?.preparedBy || auth.principal.userName, 120) || 'Staff';
    const purchaseOrder = {
      id,
      poNumber,
      supplierId,
      items,
      totalAmount,
      status: existing?.status || 'PENDING',
      approvalStatus,
      paymentStatus: existing?.paymentStatus || null,
      paidAmount: existing?.paidAmount || 0,
      orderDate: existing?.orderDate || now,
      expectedDate: existing?.expectedDate || null,
      receivedDate: existing?.receivedDate || null,
      invoiceNumber: existing?.invoiceNumber || null,
      preparedBy,
      approvedBy: autoApprove ? (auth.principal.userName || preparedBy) : existing?.approvedBy || null,
      receivedBy: existing?.receivedBy || null,
      branchId,
      businessId,
      updated_at: now,
    };

    await env.DB.batch([
      env.DB.prepare(`
        INSERT OR REPLACE INTO purchaseOrders (id, supplierId, items, totalAmount, status, approvalStatus, paymentStatus, paidAmount, orderDate, expectedDate, receivedDate, invoiceNumber, poNumber, preparedBy, approvedBy, receivedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        purchaseOrder.id,
        supplierId,
        JSON.stringify(items),
        totalAmount,
        purchaseOrder.status,
        approvalStatus,
        purchaseOrder.paymentStatus,
        purchaseOrder.paidAmount,
        purchaseOrder.orderDate,
        purchaseOrder.expectedDate,
        purchaseOrder.receivedDate,
        purchaseOrder.invoiceNumber,
        poNumber,
        preparedBy,
        purchaseOrder.approvedBy,
        purchaseOrder.receivedBy,
        branchId,
        businessId,
        now,
      ),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        existing ? 'purchase.update' : 'purchase.create',
        'purchaseOrder',
        id,
        autoApprove ? 'INFO' : 'WARN',
        `${existing ? 'Updated' : 'Created'} ${poNumber}.`,
        businessId,
        branchId,
        now,
      ),
    ]);

    return json({ success: true, purchaseOrder, autoApproved: autoApprove });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not save purchase order.' }, status);
  }
};

