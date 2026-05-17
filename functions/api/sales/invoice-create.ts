import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const INVOICE_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

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

function lineAmount(line: { quantity: number; unitPrice: number }) {
  return roundMoney(line.quantity * line.unitPrice);
}

function lineVat(line: { quantity: number; unitPrice: number; taxCategory?: string }) {
  return line.taxCategory === 'A' ? roundMoney(lineAmount(line) * 0.16) : 0;
}

function parseMaybeJson(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
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
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}

async function nextInvoiceNumber(db: D1Database, businessId: string, branchId: string) {
  const { results } = await db.prepare(`
    SELECT invoiceNumber
    FROM salesInvoices
    WHERE businessId = ? AND branchId = ? AND invoiceNumber LIKE 'INV-%'
    ORDER BY issueDate DESC
    LIMIT 500
  `).bind(businessId, branchId).all();
  const max = ((results || []) as any[]).reduce((highest, row) => {
    const match = String(row.invoiceNumber || '').match(/INV-(\d+)/i);
    const num = match ? Number(match[1]) : 0;
    return Number.isFinite(num) && num > highest ? num : highest;
  }, 0);
  return `INV-${String(max + 1).padStart(4, '0')}`;
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !INVOICE_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to create sales invoices.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const customerId = String(body?.customerId || '').trim();
    if (!businessId || !branchId || !customerId) return json({ error: 'Business, branch and customer are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    const rawItems = parseMaybeJson(body?.items);
    if (rawItems.length === 0) throw new PolicyError('Add at least one item or service.', 400);
    if (rawItems.length > 100) throw new PolicyError('Invoice has too many line items.', 413);

    await ensureSchema(env.DB);

    const customer = await env.DB.prepare(`
      SELECT id, name, phone, email, totalSpent, balance, branchId
      FROM customers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(customerId, businessId).first<any>();
    if (!customer) throw new PolicyError('Customer was not found.', 404);
    if (customer.branchId && customer.branchId !== branchId) throw new PolicyError('Customer belongs to another branch.', 403);

    const normalizedItems: any[] = [];
    const stockDeductions = new Map<string, { name: string; quantity: number }>();
    for (const raw of rawItems) {
      const itemType = String(raw?.itemType || 'CUSTOM').toUpperCase();
      const quantity = asNumber(raw?.quantity);
      const unitPrice = roundMoney(asNumber(raw?.unitPrice));
      if (quantity <= 0) throw new PolicyError('Invoice quantity must be more than zero.', 400);
      if (unitPrice < 0) throw new PolicyError('Invoice amount cannot be negative.', 400);

      if (itemType === 'PRODUCT') {
        const itemId = String(raw?.itemId || '').trim();
        if (!itemId) throw new PolicyError('Product line is missing the product ID.', 400);
        const product = await env.DB.prepare(`
          SELECT id, name, sellingPrice, taxCategory, stockQuantity, branchId
          FROM products
          WHERE id = ? AND businessId = ?
          LIMIT 1
        `).bind(itemId, businessId).first<any>();
        if (!product) throw new PolicyError('Invoice includes a product that was not found.', 404);
        if (product.branchId && product.branchId !== branchId) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
        const planned = stockDeductions.get(product.id)?.quantity || 0;
        if (asNumber(product.stockQuantity) < planned + quantity) throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);
        stockDeductions.set(product.id, { name: product.name, quantity: planned + quantity });
        normalizedItems.push({
          itemType: 'PRODUCT',
          itemId: product.id,
          name: product.name,
          quantity,
          unitPrice,
          taxCategory: product.taxCategory === 'A' ? 'A' : 'E',
        });
        continue;
      }

      if (itemType === 'SERVICE') {
        const itemId = String(raw?.itemId || '').trim();
        const service = itemId
          ? await env.DB.prepare(`
              SELECT id, name, taxCategory
              FROM serviceItems
              WHERE id = ? AND businessId = ?
              LIMIT 1
            `).bind(itemId, businessId).first<any>()
          : null;
        normalizedItems.push({
          itemType: 'SERVICE',
          itemId: service?.id || itemId || undefined,
          name: trimText(raw?.name || service?.name, 160) || 'Service',
          quantity,
          unitPrice,
          taxCategory: (service?.taxCategory || raw?.taxCategory) === 'A' ? 'A' : 'E',
        });
        continue;
      }

      normalizedItems.push({
        itemType: 'CUSTOM',
        name: trimText(raw?.name, 160) || 'Custom item',
        quantity,
        unitPrice,
        taxCategory: raw?.taxCategory === 'A' ? 'A' : 'E',
      });
    }

    const subtotal = roundMoney(normalizedItems.reduce((sum, item) => sum + lineAmount(item), 0));
    const tax = roundMoney(normalizedItems.reduce((sum, item) => sum + lineVat(item), 0));
    const total = roundMoney(subtotal + tax);
    const now = Date.now();
    const invoiceId = trimText(body?.invoiceId, 160) || `sales_invoice_${businessId}_${branchId}_${crypto.randomUUID()}`;
    const invoiceNumber = trimText(body?.invoiceNumber, 80) || await nextInvoiceNumber(env.DB, businessId, branchId);

    const existing = await env.DB.prepare(`
      SELECT *
      FROM salesInvoices
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(invoiceId, businessId, branchId).first<any>();
    if (existing) {
      return json({ success: true, invoice: { ...existing, items: parseMaybeJson(existing.items) }, idempotent: true });
    }

    const invoice = {
      id: invoiceId,
      invoiceNumber,
      customerId,
      customerName: customer.name,
      customerPhone: customer.phone || undefined,
      customerEmail: customer.email || undefined,
      items: normalizedItems,
      subtotal,
      tax,
      total,
      paidAmount: 0,
      balance: total,
      status: 'SENT',
      issueDate: now,
      dueDate: body?.dueDate ? asNumber(body.dueDate) : null,
      notes: trimText(body?.notes, 500) || null,
      preparedBy: trimText(body?.preparedBy || auth.principal.userName, 120) || 'Staff',
      branchId,
      businessId,
      updated_at: now,
    };

    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO salesInvoices (id, invoiceNumber, customerId, customerName, customerPhone, customerEmail, items, subtotal, tax, total, paidAmount, balance, status, issueDate, dueDate, notes, preparedBy, branchId, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        invoice.id,
        invoice.invoiceNumber,
        invoice.customerId,
        invoice.customerName,
        invoice.customerPhone || null,
        invoice.customerEmail || null,
        JSON.stringify(invoice.items),
        invoice.subtotal,
        invoice.tax,
        invoice.total,
        invoice.paidAmount,
        invoice.balance,
        invoice.status,
        invoice.issueDate,
        invoice.dueDate,
        invoice.notes,
        invoice.preparedBy,
        branchId,
        businessId,
        now,
      ),
      env.DB.prepare(`
        UPDATE customers
        SET totalSpent = COALESCE(totalSpent, 0) + ?,
            balance = COALESCE(balance, 0) + ?,
            updated_at = ?
        WHERE id = ? AND businessId = ?
      `).bind(total, total, now, customerId, businessId),
    ];

    for (const [productId, deduction] of stockDeductions.entries()) {
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = MAX(0, COALESCE(stockQuantity, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(deduction.quantity, now, productId, businessId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          crypto.randomUUID(),
          productId,
          'OUT',
          deduction.quantity,
          now,
          `Invoice ${invoiceNumber}`,
          branchId,
          businessId,
          body?.shiftId || null,
          now,
        )
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'sales.invoice.create',
        'salesInvoice',
        invoice.id,
        'INFO',
        `Created ${invoiceNumber} for Ksh ${total.toLocaleString()}.`,
        businessId,
        branchId,
        now,
      )
    );

    await env.DB.batch(statements);
    return json({ success: true, invoice });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not create sales invoice.' }, status);
  }
};

