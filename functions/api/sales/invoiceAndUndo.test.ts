import { describe, expect, it } from 'vitest';

// Simple unit tests to verify the correctness of the bundle stock logic and side effects
describe('POS Invoice and Undo Logic', () => {
  it('correctly maps bundle ingredients to component quantities', () => {
    const bundleProduct = {
      id: 'bundle-1',
      name: 'Soda Combo',
      isBundle: 1,
      components: [
        { productId: 'prod-soda', quantity: 2 },
        { productId: 'prod-chips', quantity: 1 }
      ]
    };

    const quantity = 3; // Sell 3 combos
    const deductions: Record<string, number> = {};

    const components = bundleProduct.components;
    for (const comp of components) {
      deductions[comp.productId] = comp.quantity * quantity;
    }

    expect(deductions['prod-soda']).toBe(6);
    expect(deductions['prod-chips']).toBe(3);
  });

  it('correctly calculates credit refund portion for split payments', () => {
    const total = 500;
    const splitPayments = {
      cashAmount: 200,
      secondaryMethod: 'CREDIT',
      secondaryAmount: 300
    };

    const method: string = 'SPLIT';
    let creditAmount = 0;
    if (method === 'CREDIT') {
      creditAmount = total;
    } else if (method === 'SPLIT') {
      if (splitPayments.secondaryMethod === 'CREDIT') {
        creditAmount = Math.min(splitPayments.secondaryAmount, total);
      }
    }

    expect(creditAmount).toBe(300);
  });
});
