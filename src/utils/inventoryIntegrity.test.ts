import { describe, expect, it } from 'vitest';
import {
  belongsToShop,
  DEFAULT_SHOP_ID,
  inventoryReorderPoint,
  isLowStockProduct,
  normalizeExpiryTimestamp,
  normalizedShopId,
  stockMovementDelta,
  stockMovementTotals,
} from './inventoryIntegrity';

describe('inventory integrity helpers', () => {
  it('interprets stock movement direction from type, not quantity sign alone', () => {
    expect(stockMovementDelta({ type: 'IN', quantity: 5 })).toBe(5);
    expect(stockMovementDelta({ type: 'RETURN', quantity: 2 })).toBe(2);
    expect(stockMovementDelta({ type: 'OUT', quantity: 3 })).toBe(-3);
    expect(stockMovementDelta({ type: 'ADJUST', quantity: -4 })).toBe(-4);

    expect(stockMovementTotals([
      { type: 'IN', quantity: 10 },
      { type: 'OUT', quantity: 3 },
      { type: 'RETURN', quantity: 1 },
      { type: 'ADJUST', quantity: -2 },
    ])).toEqual({ in: 11, out: 5, net: 6 });
  });

  it('uses reorderPoint consistently for low-stock checks', () => {
    expect(inventoryReorderPoint({ reorderPoint: 0 })).toBe(0);
    expect(inventoryReorderPoint({ reorderPoint: undefined })).toBe(5);
    expect(isLowStockProduct({ stockQuantity: 4, reorderPoint: 5 })).toBe(true);
    expect(isLowStockProduct({ stockQuantity: 4, reorderPoint: 3 })).toBe(false);
    expect(isLowStockProduct({ stockQuantity: 0, reorderPoint: 5 })).toBe(false);
  });

  it('treats legacy rows without shopId as single-shop rows', () => {
    expect(normalizedShopId('')).toBe(DEFAULT_SHOP_ID);
    expect(belongsToShop({ shopId: undefined }, DEFAULT_SHOP_ID)).toBe(true);
    expect(belongsToShop({ shopId: 'shop-2' }, DEFAULT_SHOP_ID)).toBe(false);
  });

  it('normalizes expiry timestamps without inventing dates', () => {
    expect(normalizeExpiryTimestamp(null)).toBeNull();
    expect(normalizeExpiryTimestamp('')).toBeNull();
    expect(normalizeExpiryTimestamp(0)).toBeNull();
    expect(normalizeExpiryTimestamp('1710000000000')).toBe(1710000000000);
  });
});
