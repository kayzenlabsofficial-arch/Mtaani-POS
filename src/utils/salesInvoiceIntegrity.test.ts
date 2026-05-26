import { describe, expect, it } from 'vitest';
import {
  assertValidSalesInvoiceLines,
  calculateSalesInvoiceTotals,
  nextSalesInvoicePaymentState,
  productInvoiceStockDeductions,
  salesInvoiceReportMetrics,
  salesInvoiceLineSubtotal,
  salesInvoiceLineTax,
  unpaidInvoiceCancellationReversal,
} from './salesInvoiceIntegrity';

describe('sales invoice lifecycle integrity', () => {
  it('calculates service-only invoice totals with VAT and customer debt', () => {
    const lines = [
      { itemType: 'SERVICE', itemId: 'svc-1', quantity: 2, unitPrice: 500, taxCategory: 'A' },
      { itemType: 'CUSTOM', quantity: 1, unitPrice: 250, taxCategory: 'E' },
    ];

    expect(salesInvoiceLineSubtotal(lines[0])).toBe(1000);
    expect(salesInvoiceLineTax(lines[0])).toBe(160);
    expect(calculateSalesInvoiceTotals(lines)).toEqual({ subtotal: 1250, tax: 160, total: 1410 });
  });

  it('rejects invalid line shapes before invoice creation', () => {
    expect(() => assertValidSalesInvoiceLines([])).toThrow(/at least one/i);
    expect(() => assertValidSalesInvoiceLines([{ itemType: 'SERVICE', quantity: 0, unitPrice: 10 }])).toThrow(/quantity/i);
    expect(() => assertValidSalesInvoiceLines([{ itemType: 'CUSTOM', quantity: 1, unitPrice: -1 }])).toThrow(/negative/i);
    expect(() => assertValidSalesInvoiceLines([{ itemType: 'PRODUCT', quantity: 1, unitPrice: 10 }])).toThrow(/product ID/i);
  });

  it('plans product stock deduction and matching stock movement quantities', () => {
    const deductions = productInvoiceStockDeductions([
      { itemType: 'PRODUCT', itemId: 'prod-1', quantity: 1.5, unitPrice: 100, taxCategory: 'E' },
      { itemType: 'SERVICE', itemId: 'svc-1', quantity: 1, unitPrice: 200, taxCategory: 'A' },
      { itemType: 'PRODUCT', itemId: 'prod-1', quantity: 0.5, unitPrice: 100, taxCategory: 'E' },
    ]);

    expect(deductions.get('prod-1')).toBe(2);
    expect(Array.from(deductions.entries())).toEqual([['prod-1', 2]]);
  });

  it('moves invoices through partial and paid status without allowing over-clear', () => {
    const partial = nextSalesInvoicePaymentState({ total: 1000, paidAmount: 0, balance: 1000, status: 'SENT' }, 400);
    expect(partial).toEqual({ paidAmount: 400, balance: 600, status: 'PARTIAL' });

    const paid = nextSalesInvoicePaymentState({ total: 1000, ...partial }, 600);
    expect(paid).toEqual({ paidAmount: 1000, balance: 0, status: 'PAID' });

    expect(() => nextSalesInvoicePaymentState({ total: 1000, paidAmount: 400, balance: 600, status: 'PARTIAL' }, 601)).toThrow(/balance/i);
    expect(() => nextSalesInvoicePaymentState({ total: 1000, balance: 1000, status: 'CANCELLED' }, 1)).toThrow(/cancelled/i);
  });

  it('reverses only unpaid invoice debt on cancellation', () => {
    expect(unpaidInvoiceCancellationReversal({ total: 1410, paidAmount: 0, balance: 1410, status: 'SENT' })).toEqual({
      totalSpentDelta: -1410,
      balanceDelta: -1410,
    });
    expect(() => unpaidInvoiceCancellationReversal({ total: 1410, paidAmount: 10, balance: 1400, status: 'PARTIAL' })).toThrow(/payment/i);
  });

  it('keeps invoice revenue, receivables, and collections as separate report buckets', () => {
    const metrics = salesInvoiceReportMetrics([
      { id: 'inv-1', total: 1000, paidAmount: 1000, balance: 0, status: 'PAID' },
      { id: 'inv-2', total: 500, paidAmount: 100, balance: 400, status: 'PARTIAL' },
      { id: 'inv-3', total: 900, paidAmount: 0, balance: 900, status: 'CANCELLED' },
    ], [
      { amount: 1000, paymentMethod: 'CASH' },
      { amount: 100, paymentMethod: 'MPESA' },
    ]);

    expect(metrics).toEqual({
      revenueCreated: 1500,
      receivableBalance: 400,
      customerCollections: 1100,
    });
  });
});
