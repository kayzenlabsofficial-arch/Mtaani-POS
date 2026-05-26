import { describe, expect, it } from 'vitest';
import {
  calculateCreditCollections,
  calculateProfitLossPeriod,
  creditSalesAmountForTransaction,
  transactionItemUnitCost,
} from './profitLoss';

const DAY = 1_700_000_000_000;
const bounds = { start: DAY, end: DAY + 86_400_000 };

describe('profit and loss integrity helpers', () => {
  it('keeps sales, VAT, COGS, expenses, refunds, invoices, and credit collections in their correct lanes', () => {
    const transactions = [
      {
        id: 'cash-vat',
        timestamp: DAY + 1,
        subtotal: 116,
        tax: 16,
        total: 116,
        status: 'PAID',
        paymentMethod: 'CASH',
        items: [{ productId: 'vat-item', name: 'VAT item', quantity: 1, snapshotPrice: 116, snapshotCost: 60, taxCategory: 'A' }],
      },
      {
        id: 'partial-refund',
        timestamp: DAY + 2,
        subtotal: 200,
        discountAmount: 20,
        tax: 24.83,
        total: 180,
        status: 'PARTIAL_REFUND',
        paymentMethod: 'MPESA',
        items: [
          { productId: 'returned', name: 'Returned', quantity: 1, returnedQuantity: 1, snapshotPrice: 50, snapshotCost: 20 },
          { productId: 'kept', name: 'Kept', quantity: 1, snapshotPrice: 150, snapshotCost: 90 },
        ],
      },
      {
        id: 'credit-sale',
        timestamp: DAY + 3,
        subtotal: 100,
        tax: 0,
        total: 100,
        status: 'UNPAID',
        paymentMethod: 'CREDIT',
        items: [{ productId: 'credit-product', name: 'Credit product', quantity: 2, snapshotPrice: 50, snapshotCost: 20 }],
      },
      {
        id: 'split-credit',
        timestamp: DAY + 4,
        subtotal: 100,
        tax: 0,
        total: 100,
        status: 'PAID',
        paymentMethod: 'SPLIT',
        splitPayments: JSON.stringify({ cashAmount: 30, secondaryMethod: 'CREDIT', secondaryAmount: 70 }),
        items: [{ productId: 'split-product', name: 'Split product', quantity: 1, snapshotPrice: 100, snapshotCost: 50 }],
      },
      {
        id: 'voided',
        timestamp: DAY + 5,
        subtotal: 999,
        tax: 0,
        total: 999,
        status: 'VOIDED',
        paymentMethod: 'CASH',
        items: [{ productId: 'voided-product', name: 'Voided', quantity: 1, snapshotPrice: 999, snapshotCost: 1 }],
      },
    ];
    const salesInvoices = [
      {
        id: 'invoice-1',
        issueDate: DAY + 6,
        status: 'SENT',
        subtotal: 100,
        tax: 16,
        total: 116,
        items: [{ itemType: 'PRODUCT', itemId: 'invoice-product', name: 'Invoice product', quantity: 1, unitPrice: 100, taxCategory: 'A' }],
      },
      {
        id: 'invoice-cancelled',
        issueDate: DAY + 7,
        status: 'CANCELLED',
        subtotal: 500,
        tax: 80,
        total: 580,
        items: [{ itemType: 'PRODUCT', itemId: 'invoice-product', name: 'Cancelled', quantity: 1, unitPrice: 500, taxCategory: 'A' }],
      },
    ];
    const expenses = [
      { timestamp: DAY + 8, status: 'APPROVED', category: 'Rent', amount: 30 },
      { timestamp: DAY + 9, status: 'PENDING', category: 'Rent', amount: 999 },
    ];
    const products = [{ id: 'invoice-product', costPrice: 40 }];

    const period = calculateProfitLossPeriod({
      label: 'Fixture day',
      bounds,
      transactions,
      salesInvoices,
      expenses,
      products,
      deductTaxInPL: true,
    });

    expect(period.grossSales).toBe(566);
    expect(period.discounts).toBe(15);
    expect(period.totalRevenue).toBe(567);
    expect(period.tax).toBe(50.62);
    expect(period.cogs).toBe(280);
    expect(period.grossProfitWithVat).toBe(287);
    expect(period.grossProfitWithoutVat).toBe(236.38);
    expect(period.expenses).toBe(30);
    expect(period.netProfitWithVat).toBe(257);
    expect(period.netProfitWithoutVat).toBe(206.38);
    expect(period.netProfit).toBe(206.38);
    expect(period.creditSales).toBe(286);
    expect(period.orderCount).toBe(5);
    expect(period.expenseBreakdown).toEqual([{ name: 'Rent', value: 30 }]);

    const collections = calculateCreditCollections([
      { paymentMethod: 'CASH', amount: 20 },
      { paymentMethod: 'MPESA', amount: 30 },
      { paymentMethod: 'PDQ', amount: 40 },
      { paymentMethod: 'BANK', amount: 50 },
      { paymentMethod: 'CHEQUE', amount: 60 },
    ]);
    expect(collections.total).toBe(200);
    expect(collections.byMethod.CASH).toBe(20);
    expect(collections.byMethod.MPESA).toBe(30);
    expect(collections.byMethod.PDQ).toBe(40);
    expect(collections.byMethod.BANK).toBe(50);
    expect(collections.byMethod.CHEQUE).toBe(60);
  });

  it('uses snapshot cost first, then product cost, then dated purchase cost', () => {
    expect(transactionItemUnitCost({ productId: 'p1', snapshotPrice: 100, snapshotCost: 0 })).toBe(0);
    expect(transactionItemUnitCost({ productId: 'p1', snapshotPrice: 100 }, { products: [{ id: 'p1', costPrice: 42 }] })).toBe(42);
    expect(transactionItemUnitCost(
      { productId: 'p1', snapshotPrice: 100 },
      {
        products: [],
        timestamp: DAY + 5,
        purchaseOrders: [
          { receivedDate: DAY + 10, items: [{ productId: 'p1', unitCost: 90 }] },
          { receivedDate: DAY + 2, items: [{ productId: 'p1', unitCost: 35 }] },
        ],
      },
    )).toBe(35);
  });

  it('parses split credit tenders stored as JSON strings', () => {
    expect(creditSalesAmountForTransaction({
      subtotal: 100,
      total: 100,
      status: 'PAID',
      paymentMethod: 'SPLIT',
      splitPayments: '{"cashAmount":25,"secondaryMethod":"CREDIT","secondaryAmount":75}',
      items: [{ productId: 'p1', quantity: 1, snapshotPrice: 100 }],
    })).toBe(75);
  });
});
