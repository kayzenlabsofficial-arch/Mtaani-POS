import { describe, expect, it } from 'vitest';
import { normalizeBusinessSettingsInput, normalizeSalesTills } from './business';

describe('business settings normalization', () => {
  it('pins the canonical settings row and normalizes unsafe fields', () => {
    const rows = Array.from({ length: 14 }, (_, index) => ({
      id: `till-${index + 1}`,
      name: `Till ${index + 1}`,
      isActive: true,
    }));

    const { saved, tills } = normalizeBusinessSettingsInput({
      id: 'custom-settings-id',
      storeName: '  Smart POS Main  ',
      location: ' Nairobi '.repeat(40),
      ownerModeEnabled: 'yes',
      autoApproveOwnerActions: '0',
      cashSweepEnabled: true,
      cashDrawerLimit: -100,
      defaultOpeningFloat: 100_000_000,
      accessControl: {
        CASHIER: {
          'sale.checkout': 'locked',
          'unknown.feature': 'LOCKED',
        },
        ROOT: {
          'expense.delete': 'LOCKED',
        },
      },
      salesTills: JSON.stringify(rows),
    }, {
      ownerModeEnabled: 1,
      cashDrawerLimit: 7000,
    }, 'biz-1', 1234);

    expect(saved.id).toBe('core_biz-1');
    expect(saved.storeName).toBe('Smart POS Main');
    expect(saved.ownerModeEnabled).toBe(1);
    expect(saved.autoApproveOwnerActions).toBe(0);
    expect(saved.cashSweepEnabled).toBe(1);
    expect(saved.cashDrawerLimit).toBe(0);
    expect(saved.defaultOpeningFloat).toBe(50_000_000);
    expect(JSON.parse(saved.accessControl)).toEqual({ CASHIER: { 'sale.checkout': 'LOCKED' } });
    expect(tills).toHaveLength(12);
    expect(tills[0].id).toBe('biz-1-till-1');
  });

  it('preserves old inactive tills outside the active settings payload', () => {
    const tills = normalizeSalesTills(JSON.stringify([
      { id: 'biz-1-till-1', name: 'Main', isActive: true },
      { id: 'biz-1-till-old', name: 'Old', isActive: false },
    ]), 'biz-1');

    expect(tills).toEqual([{ id: 'biz-1-till-1', name: 'Main', isActive: true }]);
  });

  it('limits to twelve active tills instead of counting inactive rows against the cap', () => {
    const inactiveRows = Array.from({ length: 8 }, (_, index) => ({
      id: `old-${index + 1}`,
      name: `Old ${index + 1}`,
      isActive: false,
    }));
    const activeRows = Array.from({ length: 14 }, (_, index) => ({
      id: `till-${index + 1}`,
      name: `Active ${index + 1}`,
      isActive: true,
    }));

    const tills = normalizeSalesTills(JSON.stringify([...inactiveRows, ...activeRows]), 'biz-2');

    expect(tills).toHaveLength(12);
    expect(tills[0]).toEqual({ id: 'biz-2-till-1', name: 'Active 1', isActive: true });
    expect(tills[11]).toEqual({ id: 'biz-2-till-12', name: 'Active 12', isActive: true });
  });
});
