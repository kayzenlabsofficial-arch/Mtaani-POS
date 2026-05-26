import { describe, expect, it } from 'vitest';
import {
  buildCashierPerformance,
  buildCategoryPerformance,
  buildHourlySalesData,
  buildProductPerformance,
  buildSalesTrendBuckets,
  buildTenderTotals,
  calculateCloseReportTotals,
  calculateReportPeriodSummary,
  customerStatementCreditAmount,
} from './reportAnalytics';

const DAY = new Date(2026, 0, 10).getTime();
const HOUR = 60 * 60 * 1000;
const bounds = { start: DAY, end: DAY + 24 * HOUR - 1, label: 'Fixture day' };

const products = [
  { id: 'vat-item', name: 'VAT Item', category: 'Groceries', unit: 'pc', stockQuantity: 10, costPrice: 30, reorderPoint: 2 },
  { id: 'kept', name: 'Kept Item', category: 'Household', unit: 'pc', stockQuantity: 8, costPrice: 90, reorderPoint: 2 },
  { id: 'credit-product', name: 'Credit Product', category: 'Credit', unit: 'pc', stockQuantity: 5, costPrice: 40, reorderPoint: 2 },
  { id: 'split-product', name: 'Split Product', category: 'Credit', unit: 'pc', stockQuantity: 4, costPrice: 50, reorderPoint: 2 },
  { id: 'refunded-product', name: 'Refunded Product', category: 'Returns', unit: 'pc', stockQuantity: 3, costPrice: 40, reorderPoint: 2 },
];

const transactions = [
  {
    id: 'cash-vat',
    timestamp: DAY + HOUR,
    subtotal: 116,
    tax: 16,
    total: 116,
    status: 'PAID',
    paymentMethod: 'CASH',
    cashierName: 'Ana',
    items: [{ productId: 'vat-item', name: 'VAT Item', quantity: 2, snapshotPrice: 58, snapshotCost: 30, taxCategory: 'A' }],
  },
  {
    id: 'partial-refund',
    timestamp: DAY + 2 * HOUR,
    subtotal: 200,
    discountAmount: 20,
    tax: 24.83,
    total: 180,
    status: 'PARTIAL_REFUND',
    paymentMethod: 'MPESA',
    cashierName: 'Bo',
    items: [
      { productId: 'returned', name: 'Returned', quantity: 1, returnedQuantity: 1, snapshotPrice: 50, snapshotCost: 20 },
      { productId: 'kept', name: 'Kept Item', quantity: 1, snapshotPrice: 150, snapshotCost: 90 },
    ],
  },
  {
    id: 'full-refund',
    timestamp: DAY + 3 * HOUR,
    subtotal: 100,
    tax: 0,
    total: 100,
    status: 'REFUNDED',
    paymentMethod: 'CASH',
    cashierName: 'Ana',
    items: [{ productId: 'refunded-product', name: 'Refunded Product', quantity: 1, returnedQuantity: 1, snapshotPrice: 100, snapshotCost: 40 }],
  },
  {
    id: 'credit-sale',
    timestamp: DAY + 4 * HOUR,
    subtotal: 100,
    tax: 0,
    total: 100,
    status: 'UNPAID',
    paymentMethod: 'CREDIT',
    cashierName: 'Ana',
    items: [{ productId: 'credit-product', name: 'Credit Product', quantity: 1, snapshotPrice: 100, snapshotCost: 40 }],
  },
  {
    id: 'split-credit',
    timestamp: DAY + 5 * HOUR,
    subtotal: 100,
    tax: 0,
    total: 100,
    status: 'PAID',
    paymentMethod: 'SPLIT',
    splitPayments: '{"cashAmount":30,"secondaryMethod":"CREDIT","secondaryAmount":70}',
    cashierName: 'Bo',
    items: [{ productId: 'split-product', name: 'Split Product', quantity: 1, snapshotPrice: 100, snapshotCost: 50 }],
  },
  {
    id: 'voided',
    timestamp: DAY + 6 * HOUR,
    subtotal: 999,
    tax: 0,
    total: 999,
    status: 'VOIDED',
    paymentMethod: 'CASH',
    cashierName: 'Ana',
    items: [{ productId: 'voided-product', name: 'Voided', quantity: 1, snapshotPrice: 999, snapshotCost: 1 }],
  },
];

const salesInvoices = [
  {
    id: 'invoice-1',
    invoiceNumber: 'INV-1',
    issueDate: DAY + 7 * HOUR,
    status: 'SENT',
    preparedBy: 'Ivy',
    subtotal: 100,
    tax: 16,
    total: 116,
    items: [{ itemType: 'PRODUCT', itemId: 'vat-item', name: 'VAT Item', quantity: 1, unitPrice: 100, taxCategory: 'A' }],
  },
  {
    id: 'invoice-cancelled',
    invoiceNumber: 'INV-X',
    issueDate: DAY + 8 * HOUR,
    status: 'CANCELLED',
    preparedBy: 'Ivy',
    subtotal: 999,
    tax: 159.84,
    total: 1158.84,
    items: [{ itemType: 'PRODUCT', itemId: 'vat-item', name: 'Cancelled', quantity: 1, unitPrice: 999, taxCategory: 'A' }],
  },
];

describe('report analytics integrity helpers', () => {
  it('builds trend buckets from the selected period instead of a fixed last-seven-days window', () => {
    const trend = buildSalesTrendBuckets({
      transactions: [
        ...transactions,
        { id: 'outside', timestamp: DAY - HOUR, subtotal: 500, total: 500, status: 'PAID', paymentMethod: 'CASH', items: [] },
      ],
      salesInvoices,
      bounds,
      rangeHint: 'CUSTOM',
    });

    expect(trend).toHaveLength(1);
    expect(trend[0].revenue).toBe(567);
    expect(trend[0].orders).toBe(5);
  });

  it('keeps refunds, VAT, COGS, and product quantities aligned with P&L rules', () => {
    const rows = buildProductPerformance({ transactions, salesInvoices, products, bounds });
    const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
    const totalTax = rows.reduce((sum, row) => sum + row.tax, 0);
    const totalCogs = rows.reduce((sum, row) => sum + row.cogs, 0);
    const vatItem = rows.find(row => row.id === 'vat-item');
    const kept = rows.find(row => row.id === 'kept');
    const refunded = rows.find(row => row.id === 'refunded-product');

    expect(totalRevenue).toBe(567);
    expect(Math.round(totalTax * 100) / 100).toBe(50.62);
    expect(totalCogs).toBe(270);
    expect(vatItem?.qty).toBe(3);
    expect(vatItem?.revenue).toBe(232);
    expect(vatItem?.profit).toBe(142);
    expect(kept?.qty).toBe(1);
    expect(kept?.revenue).toBe(135);
    expect(refunded?.qty).toBe(0);
    expect(refunded?.revenue).toBe(0);
  });

  it('shows customer collections separately from sales revenue and credit creation', () => {
    const customerPayments = [
      { timestamp: DAY + 9 * HOUR, paymentMethod: 'CASH', amount: 40 },
      { timestamp: DAY + 10 * HOUR, paymentMethod: 'MPESA', amount: 30 },
    ];
    const tenderTotals = buildTenderTotals({ transactions, salesInvoices, customerPayments, bounds });
    const summary = calculateReportPeriodSummary({
      label: 'Fixture day',
      bounds,
      transactions,
      salesInvoices,
      customerPayments,
      products,
    });

    expect(summary.totalRevenue).toBe(567);
    expect(tenderTotals.collectionsTotal).toBe(70);
    expect(tenderTotals.cashSales).toBe(246);
    expect(tenderTotals.mpesaSales).toBe(180);
    expect(tenderTotals.creditSales).toBe(170);
    expect(tenderTotals.invoiceCreditSales).toBe(116);
    expect(tenderTotals.customerCashPayments).toBe(40);
    expect(tenderTotals.customerMpesaPayments).toBe(30);
  });

  it('parses split credit tenders the same from objects and JSON strings', () => {
    const splitObjectSale = {
      total: 100,
      subtotal: 100,
      status: 'PAID',
      paymentMethod: 'SPLIT',
      splitPayments: { cashAmount: 30, secondaryMethod: 'CREDIT', secondaryAmount: 70 },
      items: [{ productId: 'split-product', name: 'Split Product', quantity: 1, snapshotPrice: 100 }],
    };
    const splitJsonSale = { ...splitObjectSale, splitPayments: '{"cashAmount":30,"secondaryMethod":"CREDIT","secondaryAmount":70}' };

    expect(customerStatementCreditAmount(splitObjectSale)).toBe(70);
    expect(customerStatementCreditAmount(splitJsonSale)).toBe(70);
  });

  it('uses the same close report formula for net sales, VAT, tenders, refunds, and expected cash', () => {
    const totals = calculateCloseReportTotals({
      transactions,
      salesInvoices,
      expenses: [
        { timestamp: DAY + 11 * HOUR, source: 'TILL', status: 'APPROVED', amount: 20 },
        { timestamp: DAY + 11 * HOUR, source: 'ACCOUNT', status: 'APPROVED', amount: 100 },
      ],
      picks: [{ timestamp: DAY + 12 * HOUR, status: 'APPROVED', amount: 25 }],
      refunds: [{ timestamp: DAY + 13 * HOUR, source: 'MIXED', status: 'APPROVED', amount: 20, cashAmount: 15 }],
      supplierPayments: [{ timestamp: DAY + 14 * HOUR, source: 'TILL', amount: 10 }],
      customerPayments: [{ timestamp: DAY + 15 * HOUR, paymentMethod: 'CASH', amount: 40 }],
      openingCash: 50,
      since: bounds.start,
      until: bounds.end,
    });

    expect(totals.totalSales).toBe(567);
    expect(totals.grossSales).toBe(566);
    expect(totals.taxTotal).toBe(50.62);
    expect(totals.cashSales).toBe(246);
    expect(totals.totalRefunds).toBe(20);
    expect(totals.cashRefunds).toBe(15);
    expect(totals.remittanceTotal).toBe(30);
    expect(totals.expectedBeforePicks).toBe(291);
    expect(totals.expectedCash).toBe(266);
  });

  it('excludes voided, quote, and cancelled documents from cashier, category, and hourly reports', () => {
    const cashiers = buildCashierPerformance({ transactions, salesInvoices, bounds });
    const categories = buildCategoryPerformance({ transactions, salesInvoices, products, bounds });
    const hourly = buildHourlySalesData({ transactions, salesInvoices, bounds });

    expect(cashiers.map(row => row.name)).toEqual(['Bo', 'Ana', 'Ivy']);
    expect(cashiers.find(row => row.name === 'Ana')?.revenue).toBe(216);
    expect(categories.some(row => row.name === 'Voided')).toBe(false);
    expect(categories.reduce((sum, row) => sum + row.revenue, 0)).toBe(567);
    expect(hourly.reduce((sum, row) => sum + row.revenue, 0)).toBe(567);
  });
});
