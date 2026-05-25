import { describe, expect, it } from 'vitest';
import {
  lineDiscountAmount,
  lineNetAmount,
  lineNetRevenueForTransaction,
  lineTaxForTransaction,
  netItemQuantity,
  paymentAmountForMethod,
  refundedAmountFromReturnedLines,
  transactionExpectedDiscount,
  transactionNetMetrics,
  transactionOriginalNetTotal,
} from './posMoney';

const discountedCashSale = {
  id: 'TEST-CODEX-DISCOUNT',
  subtotal: 100,
  discountAmount: 10,
  total: 100, // Simulates the old broken persisted value.
  tax: 13.79,
  status: 'PAID',
  paymentMethod: 'CASH',
  items: [
    {
      productId: 'eggs',
      name: 'Eggs',
      quantity: 2,
      snapshotPrice: 50,
      snapshotCost: 30,
      discountAmount: 5,
      taxCategory: 'A',
    },
  ],
};

describe('POS money integrity helpers', () => {
  it('uses discounted net line amounts for receipt/report rows', () => {
    const [item] = discountedCashSale.items;

    expect(lineDiscountAmount(item)).toBe(10);
    expect(lineNetAmount(item)).toBe(90);
    expect(transactionExpectedDiscount(discountedCashSale)).toBe(10);
    expect(transactionOriginalNetTotal(discountedCashSale)).toBe(90);
  });

  it('keeps daily/open-shift net sales separate from gross subtotal', () => {
    const metrics = transactionNetMetrics(discountedCashSale);

    expect(metrics.originalGross).toBe(100);
    expect(metrics.netSubtotal).toBe(100);
    expect(metrics.netDiscount).toBe(10);
    expect(metrics.netTotal).toBe(90);
    expect(paymentAmountForMethod(discountedCashSale, 'CASH')).toBe(90);
  });

  it('uses net returned value for partial discounted refunds', () => {
    const partialRefund = {
      ...discountedCashSale,
      status: 'PARTIAL_REFUND',
      total: 90,
      items: [{ ...discountedCashSale.items[0], returnedQuantity: 1 }],
    };

    expect(netItemQuantity(partialRefund, partialRefund.items[0])).toBe(1);
    expect(refundedAmountFromReturnedLines(partialRefund)).toBe(45);
    expect(transactionNetMetrics(partialRefund).netTotal).toBe(45);
  });

  it('allocates transaction-level discounts across product report rows', () => {
    const sale = {
      subtotal: 200,
      discountAmount: 20,
      total: 180,
      tax: 24.83,
      status: 'PAID',
      paymentMethod: 'MPESA',
      items: [
        { productId: 'a', name: 'A', quantity: 1, snapshotPrice: 50, discountAmount: 0 },
        { productId: 'b', name: 'B', quantity: 1, snapshotPrice: 150, discountAmount: 0 },
      ],
    };
    const metrics = transactionNetMetrics(sale);

    expect(lineNetRevenueForTransaction(sale, sale.items[0], metrics)).toBe(45);
    expect(lineNetRevenueForTransaction(sale, sale.items[1], metrics)).toBe(135);
    expect(lineTaxForTransaction(sale, sale.items[0], metrics)).toBe(6.21);
    expect(lineTaxForTransaction(sale, sale.items[1], metrics)).toBe(18.62);
  });

  it('keeps split tenders tied to the sale total without creating extra sales', () => {
    const splitSale = {
      total: 100,
      subtotal: 120,
      discountAmount: 20,
      status: 'PAID',
      paymentMethod: 'SPLIT',
      splitPayments: { cashAmount: 35, secondaryMethod: 'MPESA', secondaryAmount: 65 },
      items: [{ productId: 'flour', name: 'Flour', quantity: 1, snapshotPrice: 120, discountAmount: 20 }],
    };

    expect(transactionOriginalNetTotal(splitSale)).toBe(100);
    expect(paymentAmountForMethod(splitSale, 'CASH')).toBe(35);
    expect(paymentAmountForMethod(splitSale, 'MPESA')).toBe(65);
    expect(paymentAmountForMethod(splitSale, 'CREDIT')).toBe(0);
  });
});
