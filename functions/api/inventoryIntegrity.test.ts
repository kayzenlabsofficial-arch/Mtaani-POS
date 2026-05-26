import { describe, expect, it } from 'vitest';
import {
  approvedStockAdjustmentState,
  DEFAULT_SHOP_ID,
  inventoryShopIdFromRequest,
  isBundleInventoryRow,
} from './inventoryIntegrity';

describe('server inventory integrity helpers', () => {
  it('defaults legacy command writes to the single-shop scope', () => {
    const request = new Request('https://example.test/api/stock/restock', { method: 'POST' });

    expect(inventoryShopIdFromRequest(request, {})).toBe(DEFAULT_SHOP_ID);
    expect(inventoryShopIdFromRequest(request, { shopId: 'shop-a' })).toBe('shop-a');
    expect(inventoryShopIdFromRequest(new Request('https://example.test', { headers: { 'X-Shop-ID': 'shop-b' } }), {})).toBe('shop-b');
  });

  it('blocks direct bundle stock changes', () => {
    expect(isBundleInventoryRow({ isBundle: true })).toBe(true);
    expect(isBundleInventoryRow({ isBundle: '1' })).toBe(true);
    expect(isBundleInventoryRow({ isBundle: 0 })).toBe(false);
  });

  it('approves stock adjustments only against the requested old quantity', () => {
    expect(approvedStockAdjustmentState(10, 10, 7)).toEqual({ ok: true, stockQuantity: 7, delta: -3 });
    expect(approvedStockAdjustmentState(8, 10, 7)).toEqual({ ok: false, reason: 'STALE_STOCK' });
    expect(approvedStockAdjustmentState(10, 10, -1)).toEqual({ ok: false, reason: 'NEGATIVE_TARGET' });
  });
});
