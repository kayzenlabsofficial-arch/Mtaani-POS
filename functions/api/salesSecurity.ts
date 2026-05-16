import type { Principal } from './authUtils';

export class PolicyError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type ProductRow = {
  id: string;
  name: string;
  category?: string;
  sellingPrice?: number;
  costPrice?: number;
  taxCategory?: string;
  unit?: string;
  isBundle?: number | boolean | string;
  components?: unknown;
  stockQuantity?: number;
};

type HardenOptions = {
  db: D1Database;
  businessId: string;
  branchId: string;
  principal: Principal;
  service: boolean;
  sourceLabel?: string;
};

const SALE_STATUSES = new Set(['PAID', 'UNPAID']);
const CASHIER_ALLOWED_STATUSES = new Set(['PAID', 'UNPAID', 'QUOTE', 'PENDING_REFUND']);
const STAFF_ALLOWED_METHODS = new Set(['CASH', 'MPESA', 'PDQ', 'CREDIT', 'SPLIT']);

function deserializeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function trimText(value: unknown, max = 160): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function isBundle(product: ProductRow): boolean {
  return product.isBundle === 1 || product.isBundle === true || product.isBundle === '1';
}

async function loadProducts(db: D1Database, businessId: string, ids: string[]): Promise<Map<string, ProductRow>> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const products = new Map<string, ProductRow>();
  if (uniqueIds.length === 0) return products;

  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT id, name, category, sellingPrice, costPrice, taxCategory, unit, isBundle, components, stockQuantity
       FROM products
       WHERE businessId = ? AND id IN (${placeholders})`
    ).bind(businessId, ...chunk).all();
    (results as any[]).forEach((row) => {
      const clean = deserializeRow(row) as ProductRow;
      products.set(clean.id, clean);
    });
  }
  return products;
}

async function loadExistingTransactions(db: D1Database, businessId: string, branchId: string, ids: string[]) {
  const existing = new Map<string, Record<string, any>>();
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return existing;

  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT *
       FROM transactions
       WHERE businessId = ? AND branchId = ? AND id IN (${placeholders})`
    ).bind(businessId, branchId, ...chunk).all();
    (results as any[]).forEach((row) => {
      const clean = deserializeRow(row);
      existing.set(String(clean.id), clean);
    });
  }
  return existing;
}

async function loadIngredients(db: D1Database, businessId: string, bundleIds: string[]) {
  const ingredients = new Map<string, { productId: string; quantity: number }[]>();
  const uniqueIds = Array.from(new Set(bundleIds.filter(Boolean)));
  if (uniqueIds.length === 0) return ingredients;

  const CHUNK_SIZE = 80;
  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const { results } = await db.prepare(
      `SELECT productId, ingredientProductId, quantity
       FROM productIngredients
       WHERE businessId = ? AND productId IN (${placeholders})`
    ).bind(businessId, ...chunk).all();
    (results as any[]).forEach((row) => {
      const rows = ingredients.get(row.productId) || [];
      rows.push({ productId: row.ingredientProductId, quantity: asNumber(row.quantity) });
      ingredients.set(row.productId, rows);
    });
  }

  return ingredients;
}

function componentsFromProduct(product: ProductRow): { productId: string; quantity: number }[] {
  return asArray(product.components)
    .map((component) => ({
      productId: String(component?.productId || component?.ingredientProductId || '').trim(),
      quantity: asNumber(component?.quantity),
    }))
    .filter((component) => component.productId && component.quantity > 0);
}

function statusNeedsStock(status: unknown): boolean {
  return SALE_STATUSES.has(String(status || '').toUpperCase());
}

function creditAmountFor(tx: Record<string, any>, total: number): number {
  const method = String(tx.paymentMethod || '').toUpperCase();
  if (method === 'CREDIT') return total;

  const splitPayments = typeof tx.splitPayments === 'string'
    ? (() => {
        try { return JSON.parse(tx.splitPayments); } catch { return null; }
      })()
    : tx.splitPayments;
  if (method === 'SPLIT' && String(splitPayments?.secondaryMethod || '').toUpperCase() === 'CREDIT') {
    return roundMoney(clamp(asNumber(splitPayments?.secondaryAmount), 0, total));
  }
  return 0;
}

function addDeduction(deductions: Map<string, number>, productId: string, quantity: number) {
  if (!productId || quantity <= 0) return;
  deductions.set(productId, (deductions.get(productId) || 0) + quantity);
}

export async function hardenTransactionBatch(options: HardenOptions, transactions: any[]): Promise<D1PreparedStatement[]> {
  const { db, businessId, branchId, principal, service, sourceLabel = 'Sale' } = options;
  if (transactions.length > 100) throw new PolicyError('Too many sales in one request. Send fewer at a time.', 413);

  const now = Date.now();
  const transactionIds = transactions.map((tx) => String(tx?.id || '').trim()).filter(Boolean);
  const existing = await loadExistingTransactions(db, businessId, branchId, transactionIds);

  const saleProductIds: string[] = [];
  for (const tx of transactions) {
    const items = asArray(tx?.items);
    if (items.length > 100) throw new PolicyError('A sale has too many items.', 413);
    for (const item of items) {
      const productId = String(item?.productId || item?.id || '').trim();
      if (productId) saleProductIds.push(productId);
    }
  }

  const products = await loadProducts(db, businessId, saleProductIds);
  const bundleIds = Array.from(products.values()).filter(isBundle).map((product) => product.id);
  const ingredientRows = await loadIngredients(db, businessId, bundleIds);

  const componentProductIds: string[] = [];
  for (const bundleId of bundleIds) {
    const product = products.get(bundleId);
    if (!product) continue;
    const components = ingredientRows.get(bundleId) || componentsFromProduct(product);
    components.forEach((component) => componentProductIds.push(component.productId));
  }
  const componentProducts = await loadProducts(db, businessId, componentProductIds);
  componentProducts.forEach((product, productId) => products.set(productId, product));

  const plannedDeductions = new Map<string, number>();
  const sideEffects: D1PreparedStatement[] = [];

  for (const tx of transactions) {
    const txId = String(tx?.id || crypto.randomUUID()).trim();
    tx.id = txId;
    const previous = existing.get(txId);
    const desiredStatus = String(tx?.status || previous?.status || 'PAID').toUpperCase();

    if (!service && principal.role === 'CASHIER') {
      if (!CASHIER_ALLOWED_STATUSES.has(desiredStatus)) {
        throw new PolicyError('Cashier accounts cannot make that sale change.', 403);
      }
      if (previous && desiredStatus !== 'PENDING_REFUND') {
        throw new PolicyError('Cashier accounts cannot edit completed sales.', 403);
      }
    }

    tx.businessId = businessId;
    tx.branchId = branchId;
    tx.status = desiredStatus;
    tx.timestamp = clamp(asNumber(tx.timestamp, now), 0, now + 5 * 60 * 1000);
    tx.updated_at = now;

    if (!service && principal.role !== 'ROOT') {
      tx.cashierId = principal.userId;
      tx.cashierName = principal.userName;
    } else {
      tx.cashierName = trimText(tx.cashierName, 120) || principal.userName || 'System';
    }

    tx.customerId = trimText(tx.customerId, 120);
    tx.customerName = trimText(tx.customerName, 160);
    tx.mpesaReference = trimText(tx.mpesaReference, 80);
    tx.mpesaCode = trimText(tx.mpesaCode, 80);
    tx.mpesaCustomer = trimText(tx.mpesaCustomer, 160);
    tx.mpesaCheckoutRequestId = trimText(tx.mpesaCheckoutRequestId, 120);
    tx.discountReason = trimText(tx.discountReason, 200);

    if (desiredStatus === 'PENDING_REFUND' && previous) {
      tx.items = previous.items;
      tx.subtotal = previous.subtotal;
      tx.tax = previous.tax;
      tx.discountAmount = previous.discountAmount;
      tx.total = previous.total;
      tx.paymentMethod = previous.paymentMethod;
      tx.amountTendered = previous.amountTendered;
      tx.changeGiven = previous.changeGiven;
      tx.pendingRefundItems = asArray(tx.pendingRefundItems)
        .slice(0, 50)
        .map((item) => ({
          productId: String(item?.productId || item?.id || '').trim(),
          quantity: clamp(asNumber(item?.quantity), 0, 1_000_000),
        }))
        .filter((item) => item.productId && item.quantity > 0);
      continue;
    }

    const rawItems = asArray(tx.items);
    if (rawItems.length === 0) throw new PolicyError('A sale must include at least one item.');

    const normalizedItems = rawItems.map((item) => {
      const productId = String(item?.productId || item?.id || '').trim();
      const product = productId ? products.get(productId) : null;
      if (!product) throw new PolicyError('Sale includes an item that does not exist.', 400);
      const quantity = clamp(asNumber(item?.quantity ?? item?.cartQuantity), 0, 1_000_000);
      if (quantity <= 0) throw new PolicyError('Sale item quantity must be more than zero.');
      return {
        productId,
        name: product.name,
        quantity,
        snapshotPrice: roundMoney(asNumber(product.sellingPrice)),
        snapshotCost: roundMoney(asNumber(product.costPrice)),
        category: product.category || 'General',
        taxCategory: product.taxCategory || 'A',
        unit: product.unit || undefined,
      };
    });

    const subtotal = roundMoney(normalizedItems.reduce((sum, item) => sum + (item.snapshotPrice * item.quantity), 0));
    const discountAmount = roundMoney(clamp(asNumber(tx.discountAmount ?? tx.discount), 0, subtotal));
    const tax = 0;
    const total = roundMoney(Math.max(0, subtotal + tax - discountAmount));
    const paymentMethod = String(tx.paymentMethod || '').toUpperCase();

    tx.items = normalizedItems;
    tx.subtotal = subtotal;
    tx.discountAmount = discountAmount;
    tx.discount = discountAmount;
    tx.tax = tax;
    tx.total = total;
    tx.paymentMethod = STAFF_ALLOWED_METHODS.has(paymentMethod) ? paymentMethod : null;
    tx.amountTendered = tx.amountTendered === undefined ? null : roundMoney(Math.max(0, asNumber(tx.amountTendered)));
    tx.changeGiven = tx.changeGiven === undefined ? null : roundMoney(Math.max(0, asNumber(tx.changeGiven)));

    if (tx.paymentMethod === 'CASH' && tx.amountTendered !== null) {
      tx.changeGiven = roundMoney(Math.max(0, Number(tx.amountTendered) - total));
    }

    const alreadyCounted = previous && statusNeedsStock(previous.status);
    if (statusNeedsStock(desiredStatus) && !alreadyCounted) {
      if (tx.customerId) {
        sideEffects.push(
          db.prepare(
            `UPDATE customers
             SET totalSpent = COALESCE(totalSpent, 0) + ?,
                 balance = COALESCE(balance, 0) + ?,
                 updated_at = ?
             WHERE id = ? AND businessId = ?`
          ).bind(total, creditAmountFor(tx, total), now, tx.customerId, businessId)
        );
      }

      const txDeductions = new Map<string, number>();
      for (const item of normalizedItems) {
        const product = products.get(item.productId);
        if (!product) continue;

        if (isBundle(product)) {
          const components = ingredientRows.get(product.id) || componentsFromProduct(product);
          if (components.length === 0) throw new PolicyError(`${product.name} has no ingredients configured.`);
          for (const component of components) {
            addDeduction(txDeductions, component.productId, component.quantity * item.quantity);
          }
        } else {
          addDeduction(txDeductions, item.productId, item.quantity);
        }
      }

      for (const [productId, quantity] of txDeductions.entries()) {
        const product = products.get(productId);
        if (!product) throw new PolicyError('Sale refers to a stock item that does not exist.');
        const alreadyPlanned = plannedDeductions.get(productId) || 0;
        if (asNumber(product.stockQuantity) < alreadyPlanned + quantity) {
          throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);
        }
        plannedDeductions.set(productId, alreadyPlanned + quantity);

        const txRef = txId.split('-')[0].toUpperCase();
        sideEffects.push(
          db.prepare(`UPDATE products SET stockQuantity = MAX(0, stockQuantity - ?), updated_at = ? WHERE id = ? AND businessId = ?`)
            .bind(quantity, now, productId, businessId)
        );
        sideEffects.push(
          db.prepare(
            `INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            productId,
            'OUT',
            -quantity,
            tx.timestamp,
            `${sourceLabel} #${txRef}`,
            branchId,
            businessId,
            tx.shiftId || null,
            now,
          )
        );
      }
    }
  }

  return sideEffects;
}
