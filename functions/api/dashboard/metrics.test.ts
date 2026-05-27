import { describe, expect, it } from 'vitest';
import { dashboardLowStockCountFromRows } from './metrics';

describe('dashboard metric helpers', () => {
  it('counts only products that are positive and at or below reorder point', () => {
    expect(dashboardLowStockCountFromRows([
      { id: 'ok', stockQuantity: 10, reorderPoint: 5 },
      { id: 'low', stockQuantity: 3, reorderPoint: 5 },
      { id: 'zero', stockQuantity: 0, reorderPoint: 5 },
      { id: 'default-low', stockQuantity: 4 },
    ], [])).toBe(2);
  });

  it('uses ingredient availability for bundles instead of stored bundle stock', () => {
    const products = [
      { id: 'flour', stockQuantity: 10, reorderPoint: 5 },
      { id: 'sugar', stockQuantity: 4, reorderPoint: 5 },
      { id: 'cake', stockQuantity: 999, reorderPoint: 3, isBundle: 1 },
    ];
    const ingredients = [
      { productId: 'cake', ingredientProductId: 'flour', quantity: 2 },
      { productId: 'cake', ingredientProductId: 'sugar', quantity: 2 },
    ];

    expect(dashboardLowStockCountFromRows(products, ingredients)).toBe(2);
  });

  it('falls back to JSON components for legacy bundle rows', () => {
    const products = [
      { id: 'beans', stockQuantity: 6, reorderPoint: 5 },
      { id: 'rice', stockQuantity: 10, reorderPoint: 5 },
      {
        id: 'meal',
        stockQuantity: 0,
        reorderPoint: 3,
        isBundle: '1',
        components: JSON.stringify([
          { productId: 'beans', quantity: 2 },
          { productId: 'rice', quantity: 5 },
        ]),
      },
    ];

    expect(dashboardLowStockCountFromRows(products, [])).toBe(1);
  });
});
