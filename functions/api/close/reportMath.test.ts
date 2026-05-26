import { describe, expect, it } from 'vitest';
import { calculateCloseReportTotals } from '../../../src/utils/reportAnalytics';
import { calculateServerCloseReportTotals, transactionReportMetrics } from './reportMath';

const DAY = new Date(2026, 0, 10).getTime();
const HOUR = 60 * 60 * 1000;
const since = DAY;
const until = DAY + 24 * HOUR - 1;

const transactions = [
  {
    id: 'cash-vat',
    timestamp: DAY + HOUR,
    subtotal: 116,
    tax: 16,
    total: 116,
    status: 'PAID',
    paymentMethod: 'CASH',
    shiftId: 'shift-1',
    items: [{ productId: 'vat-item', name: 'VAT Item', quantity: 2, snapshotPrice: 58, snapshotCost: 30 }],
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
    shiftId: 'shift-1',
    items: [
      { productId: 'returned', name: 'Returned', quantity: 1, returnedQuantity: 1, snapshotPrice: 50, snapshotCost: 20 },
      { productId: 'kept', name: 'Kept', quantity: 1, snapshotPrice: 150, snapshotCost: 90 },
    ],
  },
  {
    id: 'full-refund',
    timestamp: DAY + 3 * HOUR,
    subtotal: 100,
    tax: 10,
    total: 100,
    status: 'REFUNDED',
    paymentMethod: 'CASH',
    shiftId: 'shift-1',
    items: [{ productId: 'refunded', name: 'Refunded', quantity: 1, returnedQuantity: 1, snapshotPrice: 100, snapshotCost: 40 }],
  },
  {
    id: 'split',
    timestamp: DAY + 4 * HOUR,
    subtotal: 100,
    tax: 0,
    total: 100,
    status: 'PAID',
    paymentMethod: 'SPLIT',
    splitPayments: '{"cashAmount":30,"secondaryMethod":"PDQ","secondaryAmount":70}',
    shiftId: 'shift-1',
    items: [{ productId: 'split', name: 'Split', quantity: 1, snapshotPrice: 100, snapshotCost: 50 }],
  },
  {
    id: 'voided',
    timestamp: DAY + 5 * HOUR,
    subtotal: 999,
    tax: 0,
    total: 999,
    status: 'VOIDED',
    paymentMethod: 'CASH',
    shiftId: 'shift-1',
    items: [],
  },
];

const invoices = [
  {
    id: 'invoice-1',
    issueDate: DAY + 6 * HOUR,
    subtotal: 100,
    tax: 16,
    total: 116,
    status: 'SENT',
    shiftId: 'shift-1',
  },
  {
    id: 'cancelled',
    issueDate: DAY + 7 * HOUR,
    subtotal: 999,
    tax: 159.84,
    total: 1158.84,
    status: 'CANCELLED',
    shiftId: 'shift-1',
  },
];

describe('server close report math', () => {
  it('matches frontend close preview totals for the same fixture data', () => {
    const sharedArgs = {
      transactions,
      expenses: [
        { timestamp: DAY + 8 * HOUR, source: 'TILL', status: 'APPROVED', amount: 20, shiftId: 'shift-1' },
        { timestamp: DAY + 8 * HOUR, source: 'ACCOUNT', status: 'APPROVED', amount: 100, shiftId: 'shift-1' },
      ],
      picks: [{ timestamp: DAY + 9 * HOUR, status: 'APPROVED', amount: 25, shiftId: 'shift-1' }],
      refunds: [{ timestamp: DAY + 10 * HOUR, source: 'MIXED', status: 'APPROVED', amount: 20, cashAmount: 15, shiftId: 'shift-1' }],
      supplierPayments: [{ timestamp: DAY + 11 * HOUR, source: 'TILL', amount: 10, shiftId: 'shift-1' }],
      customerPayments: [{ timestamp: DAY + 12 * HOUR, paymentMethod: 'CASH', amount: 40, shiftId: 'shift-1' }],
      openingCash: 50,
      since,
      until,
      shiftId: 'shift-1',
    };
    const frontend = calculateCloseReportTotals({ ...sharedArgs, salesInvoices: invoices });
    const server = calculateServerCloseReportTotals({ ...sharedArgs, invoices });

    expect(server.totalSales).toBe(frontend.totalSales);
    expect(server.grossSales).toBe(frontend.grossSales);
    expect(server.taxTotal).toBe(frontend.taxTotal);
    expect(server.cashSales).toBe(frontend.cashSales);
    expect(server.pdqSales).toBe(frontend.pdqSales);
    expect(server.totalRefunds).toBe(frontend.totalRefunds);
    expect(server.cashRefunds).toBe(frontend.cashRefunds);
    expect(server.expectedBeforePicks).toBe(frontend.expectedBeforePicks);
    expect(server.expectedCash).toBe(frontend.expectedCash);
  });

  it('uses refund-adjusted VAT instead of original VAT for partial and full refunds', () => {
    expect(transactionReportMetrics(transactions[1]).netTax).toBe(18.62);
    expect(transactionReportMetrics(transactions[2]).netTax).toBe(0);
    const server = calculateServerCloseReportTotals({
      transactions,
      invoices,
      openingCash: 0,
      since,
      until,
      shiftId: 'shift-1',
    });

    expect(server.taxTotal).toBe(50.62);
    expect(server.totalSales).toBe(467);
  });
});
