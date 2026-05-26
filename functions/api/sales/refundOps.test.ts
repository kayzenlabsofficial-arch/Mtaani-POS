import { describe, expect, it } from 'vitest';
import { originalNetTotal, refundAmountFor } from './refundOps';

describe('server refund money rules', () => {
  it('refunds the discounted net value when a receipt-level discount was applied', () => {
    const sale = {
      subtotal: 200,
      discountAmount: 20,
      total: 180,
      status: 'PAID',
      paymentMethod: 'CASH',
      items: [
        { productId: 'a', name: 'A', quantity: 1, snapshotPrice: 50, discountAmount: 0 },
        { productId: 'b', name: 'B', quantity: 1, snapshotPrice: 150, discountAmount: 0 },
      ],
    };

    expect(originalNetTotal(sale)).toBe(180);
    expect(refundAmountFor(sale, [{ productId: 'a', quantity: 1 }])).toBe(45);
    expect(refundAmountFor(sale, [{ productId: 'b', quantity: 1 }])).toBe(135);
    expect(refundAmountFor(sale, [
      { productId: 'a', quantity: 1 },
      { productId: 'b', quantity: 1 },
    ])).toBe(180);
  });

  it('keeps per-line discounted refunds on the line net amount', () => {
    const sale = {
      subtotal: 100,
      discountAmount: 10,
      total: 90,
      status: 'PAID',
      paymentMethod: 'CASH',
      items: [
        { productId: 'eggs', name: 'Eggs', quantity: 2, snapshotPrice: 50, discountAmount: 5 },
      ],
    };

    expect(refundAmountFor(sale, [{ productId: 'eggs', quantity: 1 }])).toBe(45);
    expect(refundAmountFor(sale, [{ productId: 'eggs', quantity: 2 }])).toBe(90);
  });
});
