import { describe, expect, it } from 'vitest';
import {
  expenseLifecycleTotals,
  isApprovedExpense,
  normalizeExpenseSource,
  normalizeExpenseStatus,
  shopExpenseProductEligibility,
} from './expenseIntegrity';

describe('expense integrity helpers', () => {
  it('normalizes legacy expense sources and statuses safely', () => {
    expect(normalizeExpenseSource(undefined)).toBe('TILL');
    expect(normalizeExpenseSource('')).toBe('TILL');
    expect(normalizeExpenseSource('PETTY_CASH')).toBe('TILL');
    expect(normalizeExpenseSource('account')).toBe('ACCOUNT');
    expect(normalizeExpenseSource('shop')).toBe('SHOP');

    expect(normalizeExpenseStatus(undefined)).toBe('APPROVED');
    expect(normalizeExpenseStatus('pending')).toBe('PENDING');
    expect(normalizeExpenseStatus('rejected')).toBe('REJECTED');
    expect(isApprovedExpense({ status: 'PENDING' })).toBe(false);
    expect(isApprovedExpense({ status: undefined })).toBe(true);
  });

  it('keeps pending expenses separate from financial totals', () => {
    expect(expenseLifecycleTotals([
      { amount: 100, source: 'TILL', status: 'APPROVED' },
      { amount: 50, source: 'ACCOUNT', status: 'PENDING' },
      { amount: 25, source: 'SHOP', status: 'REJECTED' },
      { amount: 10, source: '', status: 'APPROVED' },
    ])).toEqual({
      approvedTotal: 110,
      pendingTotal: 50,
      rejectedTotal: 25,
      approvedCount: 2,
      pendingCount: 1,
      rejectedCount: 1,
      bySource: {
        TILL: { approved: 110, pending: 0, rejected: 0 },
        ACCOUNT: { approved: 0, pending: 50, rejected: 0 },
        SHOP: { approved: 0, pending: 0, rejected: 25 },
      },
    });
  });

  it('validates shop stock expense product eligibility', () => {
    expect(shopExpenseProductEligibility(null, 1).reason).toBe('MISSING_PRODUCT');
    expect(shopExpenseProductEligibility({ name: 'Bundle', isBundle: 1, stockQuantity: 10, costPrice: 5 }, 1).reason).toBe('BUNDLE_PRODUCT');
    expect(shopExpenseProductEligibility({ name: 'Tea', stockQuantity: 10, costPrice: 5 }, 0).reason).toBe('INVALID_QUANTITY');
    expect(shopExpenseProductEligibility({ name: 'Tea', stockQuantity: 2, costPrice: 5, unit: 'kg' }, 3).reason).toBe('INSUFFICIENT_STOCK');
    expect(shopExpenseProductEligibility({ name: 'Tea', stockQuantity: 2, costPrice: 0 }, 1).reason).toBe('MISSING_COST');
    expect(shopExpenseProductEligibility({ name: 'Tea', stockQuantity: 2, costPrice: 5 }, 1.5)).toMatchObject({
      ok: true,
      amount: 7.5,
      stock: 2,
      unitCost: 5,
    });
  });
});
