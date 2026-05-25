import { describe, expect, it } from 'vitest';
import { calculateCashDrawer, calculateShiftCashFromSales } from './cashDrawer';

const baseRows = {
  transactions: [
    {
      id: 'cash-discount',
      status: 'PAID',
      paymentMethod: 'CASH',
      subtotal: 120,
      discountAmount: 20,
      total: 120, // Simulates old gross total; drawer must still use net 100.
      timestamp: 1000,
      shiftId: 'shift-1',
      items: [{ quantity: 1, snapshotPrice: 120, discountAmount: 20 }],
    },
    {
      id: 'split',
      status: 'PAID',
      paymentMethod: 'SPLIT',
      total: 100,
      timestamp: 1000,
      shiftId: 'shift-1',
      splitPayments: { cashAmount: 40, secondaryMethod: 'MPESA', secondaryAmount: 60 },
    },
    {
      id: 'mpesa-direct',
      status: 'PAID',
      paymentMethod: 'MPESA',
      total: 80,
      timestamp: 1000,
      shiftId: 'shift-1',
    },
  ],
  expenses: [{ amount: 10, source: 'TILL', status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' }],
  cashPicks: [{ amount: 15, status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' }],
  refunds: [
    { amount: 30, cashAmount: 30, source: 'TILL', status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' },
    { amount: 999, cashAmount: 999, source: 'TILL', status: 'REJECTED', timestamp: 1000, shiftId: 'shift-1' },
  ],
  supplierPayments: [{ amount: 20, source: 'TILL', timestamp: 1000, shiftId: 'shift-1' }],
  customerPayments: [
    { amount: 25, paymentMethod: 'CASH', timestamp: 1000, shiftId: 'shift-1' },
    { amount: 70, paymentMethod: 'MPESA', timestamp: 1000, shiftId: 'shift-1' },
  ],
  openingCash: 100,
  since: 0,
  shiftId: 'shift-1',
};

describe('cash drawer integrity', () => {
  it('matches the till cash rule used by refunds, picks, supplier payments, and shift close', () => {
    const drawer = calculateCashDrawer(baseRows);

    expect(drawer.openingCash).toBe(100);
    expect(drawer.cashSales).toBe(140);
    expect(drawer.customerCashPayments).toBe(25);
    expect(drawer.tillExpenses).toBe(10);
    expect(drawer.cashPicks).toBe(15);
    expect(drawer.supplierTillPayments).toBe(20);
    expect(drawer.cashRefunds).toBe(30);
    expect(drawer.actualCashDrawer).toBe(190);
  });

  it('uses the same available cash number before cash-only refund approval', () => {
    const available = calculateShiftCashFromSales(baseRows);

    expect(available.availableCashSales).toBe(190);
  });

  it('keeps M-Pesa credit collections out of cash sales and direct M-Pesa sales', () => {
    const drawer = calculateCashDrawer(baseRows);
    const directMpesaSales = baseRows.transactions
      .filter(tx => tx.paymentMethod === 'MPESA')
      .reduce((sum, tx) => sum + Number(tx.total || 0), 0);
    const mpesaCreditCollections = baseRows.customerPayments
      .filter(payment => payment.paymentMethod === 'MPESA')
      .reduce((sum, payment) => sum + payment.amount, 0);

    expect(drawer.cashSales).toBe(140);
    expect(directMpesaSales).toBe(80);
    expect(mpesaCreditCollections).toBe(70);
  });
});
