import type { Principal } from './authUtils';
import { DEFAULT_SHOP_ID, trimInventoryText } from './inventoryIntegrity';

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
  discountType?: string;
  discountValue?: number;
  taxCategory?: string;
  unit?: string;
  isBundle?: number | boolean | string;
  components?: unknown;
  stockQuantity?: number;
  shopId?: string | null;
};

type HardenOptions = {
  db: D1Database;
  businessId: string;
  principal: Principal;
  service: boolean;
  sourceLabel?: string;
  allowClosedShiftWindow?: boolean;
};

type ShiftRow = {
  id: string;
  status?: string;
  cashierId?: string;
  cashierName?: string;
  startTime?: number;
  endTime?: number;
  shopId?: string | null;
};

const SALE_STATUSES = new Set(['PAID', 'UNPAID']);
const CASHIER_ALLOWED_STATUSES = new Set(['PAID', 'UNPAID', 'QUOTE', 'PENDING_REFUND']);
const STAFF_ALLOWED_METHODS = new Set(['CASH', 'MPESA', 'PDQ', 'CREDIT', 'SPLIT']);
const SPLIT_SECONDARY_METHODS = new Set(['MPESA', 'PDQ', 'CREDIT']);

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

function productUnitDiscount(product: ProductRow): number {
  const price = Math.max(0, asNumber(product.sellingPrice));
  const value = Math.max(0, asNumber(product.discountValue));
  const type = String(product.discountType || '').toUpperCase();
  if (price <= 0 || value <= 0) return 0;
  if (type === 'PERCENT') return roundMoney(Math.min(price, price * Math.min(value, 100) / 100));
  if (type === 'FIXED') return roundMoney(Math.min(price, value));
  return 0;
}

function trimText(value: unknown, max = 160): string | undefined {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function normalizedShopId(value: unknown): string {
  return trimInventoryText(value, 160) || DEFAULT_SHOP_ID;
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
      `SELECT id, name, category, sellingPrice, costPrice, discountType, discountValue, taxCategory, unit, isBundle, components, stockQuantity, shopId
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

async function loadExistingTransactions(db: D1Database, businessId: string, ids: string[]) {
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
       WHERE businessId = ? AND id IN (${placeholders})`
    ).bind(businessId, ...chunk).all();
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

function parseSplitPayments(value: unknown): any {
  if (!value) return null;
  const parsed = typeof value === 'string'
    ? (() => { try { return JSON.parse(value); } catch { return null; } })()
    : value;
  return parsed?.splitPayments || parsed;
}

function normaliseSplitPayments(value: unknown, total: number) {
  const split = parseSplitPayments(value);
  if (!split || typeof split !== 'object') {
    throw new PolicyError('Split payment details are required.', 400);
  }

  const cashAmount = roundMoney(clamp(asNumber(split.cashAmount), 0, total));
  const secondaryAmount = roundMoney(clamp(asNumber(split.secondaryAmount), 0, total));
  const secondaryMethod = String(split.secondaryMethod || '').toUpperCase();
  const secondaryReference = trimText(split.secondaryReference, 120);

  if (!SPLIT_SECONDARY_METHODS.has(secondaryMethod)) {
    throw new PolicyError('Split payment secondary method is invalid.', 400);
  }
  if (total > 0 && cashAmount <= 0) {
    throw new PolicyError('Split payment must include the cash amount paid.', 400);
  }
  if (total > 0 && secondaryAmount <= 0) {
    throw new PolicyError('Split payment must include the second payment amount.', 400);
  }
  if (Math.abs(roundMoney(cashAmount + secondaryAmount) - total) > 0.01) {
    throw new PolicyError('Split payment amounts must equal the sale total.', 400);
  }

  return {
    cashAmount,
    secondaryAmount,
    secondaryMethod,
    secondaryReference,
  };
}

function addDeduction(deductions: Map<string, number>, productId: string, quantity: number) {
  if (!productId || quantity <= 0) return;
  deductions.set(productId, (deductions.get(productId) || 0) + quantity);
}

async function requireValidShift(options: HardenOptions, tx: any, timestamp: number) {
  const shiftId = trimText(tx.shiftId, 180);
  if (!shiftId) throw new PolicyError('Open a till shift before completing a sale.', 409);

  const shift = await options.db.prepare(`
    SELECT id, status, cashierId, cashierName, startTime, endTime, shopId
    FROM shifts
    WHERE id = ?
      AND businessId = ?
      AND COALESCE(NULLIF(shopId, ''), ?) = ?
    LIMIT 1
  `).bind(shiftId, options.businessId, DEFAULT_SHOP_ID, normalizedShopId(tx.shopId)).first<ShiftRow>();

  if (!shift) throw new PolicyError('The selected till shift was not found.', 409);

  const status = String(shift.status || '').toUpperCase();
  const isOpen = status === 'OPEN';
  const startTime = asNumber(shift.startTime, 0);
  const endTime = asNumber(shift.endTime, 0);
  const withinClosedWindow = !!options.allowClosedShiftWindow
    && status === 'CLOSED'
    && startTime > 0
    && timestamp >= startTime
    && (!endTime || timestamp <= endTime);

  if (!isOpen && !withinClosedWindow) {
    throw new PolicyError('Only an open till shift can complete a sale.', 409);
  }

  const expectedCashierId = String(options.service ? tx.cashierId || '' : options.principal.userId || '').trim();
  const expectedCashierName = String(options.service ? tx.cashierName || '' : options.principal.userName || '').trim().toLowerCase();
  const shiftCashierId = String(shift.cashierId || '').trim();
  const shiftCashierName = String(shift.cashierName || '').trim().toLowerCase();

  if (shiftCashierId && expectedCashierId && shiftCashierId !== expectedCashierId) {
    throw new PolicyError('This till shift belongs to another cashier.', 403);
  }
  if (!shiftCashierId && shiftCashierName && expectedCashierName && shiftCashierName !== expectedCashierName) {
    throw new PolicyError('This till shift belongs to another cashier.', 403);
  }

  tx.shiftId = shift.id;
}

export async function hardenTransactionBatch(options: HardenOptions, transactions: any[]): Promise<D1PreparedStatement[]> {
  const { db, businessId, principal, service, sourceLabel = 'Sale' } = options;
  if (transactions.length > 100) throw new PolicyError('Too many sales in one request. Send fewer at a time.', 413);

  const now = Date.now();
  const transactionIds = transactions.map((tx) => String(tx?.id || '').trim()).filter(Boolean);
  const existing = await loadExistingTransactions(db, businessId, transactionIds);

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
    tx.shopId = normalizedShopId(tx.shopId);
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
      if (normalizedShopId(product.shopId) !== tx.shopId) {
        throw new PolicyError('Sale includes an item from another shop.', 403);
      }
      const quantity = clamp(asNumber(item?.quantity ?? item?.cartQuantity), 0, 1_000_000);
      if (quantity <= 0) throw new PolicyError('Sale item quantity must be more than zero.');
      return {
        productId,
        name: product.name,
        quantity,
        snapshotPrice: roundMoney(asNumber(product.sellingPrice)),
        snapshotCost: roundMoney(asNumber(product.costPrice)),
        discountAmount: productUnitDiscount(product),
        category: product.category || 'General',
        taxCategory: product.taxCategory || 'A',
        unit: product.unit || undefined,
      };
    });

    let calculatedTax = 0;
    const subtotal = roundMoney(normalizedItems.reduce((sum, item) => {
      const lineTotal = item.snapshotPrice * item.quantity;
      if (item.taxCategory === 'A') {
        calculatedTax += lineTotal * (16 / 116);
      }
      return sum + lineTotal;
    }, 0));
    
    const discountAmount = roundMoney(clamp(normalizedItems.reduce((sum, item) => sum + (asNumber((item as any).discountAmount) * item.quantity), 0), 0, subtotal));
    const discountRatio = subtotal > 0 ? (discountAmount / subtotal) : 0;
    const tax = roundMoney(calculatedTax * (1 - discountRatio));
    const total = roundMoney(Math.max(0, subtotal - discountAmount));
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

    if (statusNeedsStock(desiredStatus) && !tx.paymentMethod) {
      throw new PolicyError('Choose a valid payment method before completing the sale.', 400);
    }
    if (tx.paymentMethod === 'SPLIT') {
      tx.splitPayments = normaliseSplitPayments(tx.splitPayments ?? tx.splitData, total);
    }
    const creditAmount = creditAmountFor(tx, total);
    let selectedCustomer: any = null;
    if (tx.customerId) {
      selectedCustomer = await db.prepare(`
        SELECT id, name
        FROM customers
        WHERE id = ?
          AND businessId = ?
          AND COALESCE(NULLIF(shopId, ''), ?) = ?
        LIMIT 1
      `).bind(tx.customerId, businessId, DEFAULT_SHOP_ID, tx.shopId).first<any>();
      if (!selectedCustomer) {
        throw new PolicyError('Selected customer was not found.', 404);
      }
      tx.customerName = tx.customerName || trimText(selectedCustomer.name, 160);
    }
    if (creditAmount > 0 && !selectedCustomer) {
      throw new PolicyError('Select a customer before selling on credit.', 400);
    }
    if (statusNeedsStock(desiredStatus) && tx.paymentMethod === 'CASH') {
      if (tx.amountTendered === null) {
        throw new PolicyError('Enter the cash amount received before completing the sale.', 400);
      }
      if (tx.amountTendered + 0.01 < total) {
        throw new PolicyError('Cash received must cover the sale total.', 400);
      }
      tx.changeGiven = roundMoney(Math.max(0, Number(tx.amountTendered) - total));
    }

    if (statusNeedsStock(desiredStatus)) {
      await requireValidShift(options, tx, tx.timestamp);
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
             WHERE id = ?
               AND businessId = ?
               AND COALESCE(NULLIF(shopId, ''), ?) = ?`
          ).bind(total, creditAmount, now, tx.customerId, businessId, DEFAULT_SHOP_ID, tx.shopId)
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
        if (normalizedShopId(product.shopId) !== tx.shopId) {
          throw new PolicyError('Sale refers to a stock item from another shop.', 403);
        }
        const alreadyPlanned = plannedDeductions.get(productId) || 0;
        if (asNumber(product.stockQuantity) < alreadyPlanned + quantity) {
          throw new PolicyError(`Insufficient stock for ${product.name}.`, 409);
        }
        plannedDeductions.set(productId, alreadyPlanned + quantity);

        const txRef = txId.split('-')[0].toUpperCase();
        sideEffects.push(
          db.prepare(`UPDATE products SET stockQuantity = COALESCE(stockQuantity, 0) - ?, updated_at = ? WHERE id = ? AND businessId = ? AND COALESCE(NULLIF(shopId, ''), ?) = ?`)
            .bind(quantity, now, productId, businessId, DEFAULT_SHOP_ID, tx.shopId)
        );
        sideEffects.push(
          db.prepare(
            `INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, businessId, shiftId, shopId, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            productId,
            'OUT',
            quantity,  // Positive value — type='OUT' already conveys the direction
            tx.timestamp,
            `${sourceLabel} #${txRef}`,
            businessId,
            tx.shiftId || null,
            tx.shopId,
            now,
          )
        );
      }
    }
  }

  return sideEffects;
}
