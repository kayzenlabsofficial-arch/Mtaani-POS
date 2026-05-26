export const DEFAULT_SHOP_ID = 'single-shop';

export const PRODUCTS_NON_NEGATIVE_STOCK_TRIGGER = `
  CREATE TRIGGER IF NOT EXISTS products_non_negative_stock_guard
  BEFORE UPDATE OF stockQuantity ON products
  WHEN NEW.stockQuantity < -0.0001
  BEGIN
    SELECT RAISE(ABORT, 'Insufficient stock.');
  END
`;

export function asInventoryNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function trimInventoryText(value: unknown, max = 160): string {
  return String(value ?? '').trim().slice(0, max);
}

export function inventoryShopIdFromRequest(request: Request, body?: any): string {
  return trimInventoryText(request.headers.get('X-Shop-ID') || body?.shopId || DEFAULT_SHOP_ID, 160) || DEFAULT_SHOP_ID;
}

export function isTruthyInventoryFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

export function isBundleInventoryRow(row: { isBundle?: unknown } | null | undefined): boolean {
  return isTruthyInventoryFlag(row?.isBundle);
}

export function staleStockAdjustmentError(productName: string): string {
  return `Stock changed for ${productName}. Refresh the item and submit a new adjustment request.`;
}

export function approvedStockAdjustmentState(currentQty: unknown, oldQty: unknown, newQty: unknown, tolerance = 0.0001) {
  const current = asInventoryNumber(currentQty);
  const oldValue = asInventoryNumber(oldQty);
  const nextValue = asInventoryNumber(newQty);
  if (nextValue < 0) return { ok: false as const, reason: 'NEGATIVE_TARGET' as const };
  if (Math.abs(current - oldValue) > tolerance) return { ok: false as const, reason: 'STALE_STOCK' as const };
  return {
    ok: true as const,
    stockQuantity: nextValue,
    delta: nextValue - oldValue,
  };
}

const INVENTORY_SCHEMA_STATEMENTS = [
  'ALTER TABLE products ADD COLUMN shopId TEXT',
  'ALTER TABLE stockMovements ADD COLUMN shopId TEXT',
  'ALTER TABLE stockMovements ADD COLUMN expiryDate INTEGER',
  'ALTER TABLE stockAdjustmentRequests ADD COLUMN shopId TEXT',
  'ALTER TABLE purchaseOrders ADD COLUMN shopId TEXT',
  'ALTER TABLE creditNotes ADD COLUMN shopId TEXT',
  'ALTER TABLE refunds ADD COLUMN shopId TEXT',
  'ALTER TABLE expenses ADD COLUMN shopId TEXT',
  'CREATE INDEX IF NOT EXISTS idx_products_business_shop ON products(businessId, shopId)',
  'CREATE INDEX IF NOT EXISTS idx_stockmovements_business_shop_product ON stockMovements(businessId, shopId, productId)',
  'CREATE INDEX IF NOT EXISTS idx_stockadjustments_business_shop ON stockAdjustmentRequests(businessId, shopId)',
  'CREATE INDEX IF NOT EXISTS idx_purchaseorders_business_shop ON purchaseOrders(businessId, shopId)',
  'CREATE INDEX IF NOT EXISTS idx_creditnotes_business_shop ON creditNotes(businessId, shopId)',
  'CREATE INDEX IF NOT EXISTS idx_expenses_business_shop_timestamp ON expenses(businessId, shopId, timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_expenses_business_status_timestamp ON expenses(businessId, status, timestamp)',
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchaseOrders_business_poNumber ON purchaseOrders(businessId, poNumber) WHERE poNumber IS NOT NULL AND poNumber != ''",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_purchaseOrders_supplier_invoice ON purchaseOrders(businessId, supplierId, invoiceNumber) WHERE invoiceNumber IS NOT NULL AND invoiceNumber != ''",
  PRODUCTS_NON_NEGATIVE_STOCK_TRIGGER,
];

const INVENTORY_BACKFILL_STATEMENTS = [
  `UPDATE products SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
  `UPDATE stockMovements
     SET shopId = COALESCE((SELECT NULLIF(products.shopId, '') FROM products WHERE products.id = stockMovements.productId LIMIT 1), '${DEFAULT_SHOP_ID}')
     WHERE COALESCE(shopId, '') = ''`,
  `UPDATE stockAdjustmentRequests SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
  `UPDATE purchaseOrders SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
  `UPDATE creditNotes SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
  `UPDATE refunds SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
  `UPDATE expenses SET shopId = '${DEFAULT_SHOP_ID}' WHERE COALESCE(shopId, '') = ''`,
];

export async function ensureInventoryIntegritySchema(db: D1Database): Promise<void> {
  for (const sql of INVENTORY_SCHEMA_STATEMENTS) {
    try { await db.prepare(sql).run(); } catch {}
  }
  for (const sql of INVENTORY_BACKFILL_STATEMENTS) {
    try { await db.prepare(sql).run(); } catch {}
  }
}
