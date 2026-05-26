import { describe, expect, it } from 'vitest';
import { canPerformServerAction, canReadServerFeature, normalizeAccessControlConfig } from './settingsPolicy';

function dbWithAccessControl(accessControl: unknown): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ accessControl }),
      }),
    }),
  } as unknown as D1Database;
}

describe('settings access policy', () => {
  it('normalizes roles, features, and modes while discarding unknown keys', () => {
    expect(normalizeAccessControlConfig({
      CASHIER: {
        'sale.checkout': 'locked',
        'expense.create': 'OPEN',
        'bad.feature': 'LOCKED',
      },
      MANAGER: {
        'expense.delete': 'blurred',
      },
      ROOT: {
        'sale.checkout': 'LOCKED',
      },
    })).toEqual({
      CASHIER: {
        'sale.checkout': 'LOCKED',
        'expense.create': 'OPEN',
      },
      MANAGER: {
        'expense.delete': 'BLURRED',
      },
    });
  });

  it('blocks locked cashier actions on the server', async () => {
    const db = dbWithAccessControl(JSON.stringify({
      CASHIER: {
        'sale.checkout': 'LOCKED',
      },
    }));

    await expect(canPerformServerAction(
      db,
      'biz-1',
      { role: 'CASHIER', userId: 'cashier-1', userName: 'Cashier' },
      false,
      'sale.checkout',
    )).resolves.toBe(false);
  });

  it('keeps admin and root actions open regardless of staff policy', async () => {
    const db = dbWithAccessControl(JSON.stringify({
      CASHIER: {
        'sale.checkout': 'LOCKED',
      },
    }));

    await expect(canPerformServerAction(
      db,
      'biz-1',
      { role: 'ADMIN', userId: 'admin-1', userName: 'Admin' },
      false,
      'sale.checkout',
    )).resolves.toBe(true);
  });

  it('applies default server read policy for tab-level features', async () => {
    const db = dbWithAccessControl('');

    await expect(canReadServerFeature(
      db,
      'biz-1',
      { role: 'CASHIER', userId: 'cashier-1', userName: 'Cashier' },
      false,
      'tab.customers',
    )).resolves.toBe(true);

    await expect(canReadServerFeature(
      db,
      'biz-1',
      { role: 'CASHIER', userId: 'cashier-1', userName: 'Cashier' },
      false,
      'tab.suppliers',
    )).resolves.toBe(false);
  });
});
