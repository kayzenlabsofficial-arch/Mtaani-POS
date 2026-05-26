export type StockMovementLike = {
  type?: string | null;
  quantity?: number | string | null;
};

export type StockThresholdLike = {
  stockQuantity?: number | string | null;
  reorderPoint?: number | string | null;
};

export type ShopScopedLike = {
  shopId?: string | null;
};

export const DEFAULT_SHOP_ID = 'single-shop';

export function inventoryNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function inventoryReorderPoint(product: StockThresholdLike | null | undefined): number {
  return Math.max(0, inventoryNumber(product?.reorderPoint, 5));
}

export function isLowStockProduct(product: StockThresholdLike | null | undefined): boolean {
  const stock = inventoryNumber(product?.stockQuantity);
  return stock > 0 && stock <= inventoryReorderPoint(product);
}

export function stockMovementDelta(movement: StockMovementLike | null | undefined): number {
  const quantity = inventoryNumber(movement?.quantity);
  const absQuantity = Math.abs(quantity);
  const type = String(movement?.type || '').toUpperCase();

  if (type === 'OUT') return -absQuantity;
  if (type === 'IN' || type === 'RETURN') return absQuantity;
  if (type === 'ADJUST') return quantity;
  return quantity;
}

export function stockMovementTotals(movements: StockMovementLike[] | null | undefined) {
  return (movements || []).reduce(
    (totals, movement) => {
      const delta = stockMovementDelta(movement);
      if (delta > 0) totals.in += delta;
      if (delta < 0) totals.out += Math.abs(delta);
      totals.net += delta;
      return totals;
    },
    { in: 0, out: 0, net: 0 },
  );
}

export function normalizedShopId(value: unknown): string {
  const id = String(value ?? '').trim();
  return id || DEFAULT_SHOP_ID;
}

export function belongsToShop(row: ShopScopedLike | null | undefined, activeShopId?: string | null): boolean {
  const target = String(activeShopId || '').trim();
  if (!target) return true;
  return normalizedShopId(row?.shopId) === target;
}

export function normalizeExpiryTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
