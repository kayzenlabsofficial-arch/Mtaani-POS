import { describe, expect, it } from 'vitest';
import {
  calculateTillCashAvailableForExpenseRows,
  FINANCIAL_ACCOUNTS_NON_NEGATIVE_BALANCE_TRIGGER,
} from './expenseOps';

describe('server expense integrity', () => {
  it('uses close-report cash math and excludes pending expenses from till availability', () => {
    const available = calculateTillCashAvailableForExpenseRows({
      transactions: [
        {
          total: 120,
          subtotal: 120,
          discountAmount: 20,
          status: 'PAID',
          paymentMethod: 'CASH',
          timestamp: 1000,
          shiftId: 'shift-1',
          items: [{ quantity: 1, snapshotPrice: 120, discountAmount: 20 }],
        },
        {
          total: 100,
          status: 'PAID',
          paymentMethod: 'SPLIT',
          splitPayments: '{"cashAmount":30,"secondaryMethod":"MPESA","secondaryAmount":70}',
          timestamp: 1000,
          shiftId: 'shift-1',
        },
      ],
      expenses: [
        { id: 'approved', amount: 25, source: 'TILL', status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' },
        { id: 'pending', amount: 80, source: 'TILL', status: 'PENDING', timestamp: 1000, shiftId: 'shift-1' },
      ],
      picks: [{ amount: 10, status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' }],
      refunds: [{ amount: 15, cashAmount: 15, source: 'TILL', status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' }],
      supplierPayments: [{ amount: 20, source: 'TILL', timestamp: 1000, shiftId: 'shift-1' }],
      customerPayments: [{ amount: 40, paymentMethod: 'CASH', timestamp: 1000, shiftId: 'shift-1' }],
      openingCash: 50,
      since: 0,
      until: 2000,
      shiftId: 'shift-1',
    });

    expect(available).toBe(150);
  });

  it('can exclude the expense being approved without reserving other pending requests as spent cash', () => {
    const available = calculateTillCashAvailableForExpenseRows({
      expenses: [
        { id: 'current', amount: 30, source: 'TILL', status: 'PENDING', timestamp: 1000, shiftId: 'shift-1' },
        { id: 'approved', amount: 10, source: '', status: 'APPROVED', timestamp: 1000, shiftId: 'shift-1' },
      ],
      openingCash: 100,
      since: 0,
      until: 2000,
      shiftId: 'shift-1',
      excludeExpenseId: 'current',
    });

    expect(available).toBe(90);
  });

  it('installs an aborting balance guard for concurrent account debits', () => {
    expect(FINANCIAL_ACCOUNTS_NON_NEGATIVE_BALANCE_TRIGGER).toContain('financialAccounts_non_negative_balance_guard');
    expect(FINANCIAL_ACCOUNTS_NON_NEGATIVE_BALANCE_TRIGGER).toContain('Insufficient account balance.');
  });
});
