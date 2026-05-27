import { describe, expect, it } from 'vitest';
import { hardenTransactionBatch } from './salesSecurity';

function fakeDb(rows: { products?: any[]; shifts?: any[]; customers?: any[] } = {}) {
  return {
    prepare(sql: string) {
      const statement = {
        sql,
        binds: [] as any[],
        bind(...binds: any[]) {
          statement.binds = binds;
          return statement;
        },
        async all() {
          if (sql.includes('FROM transactions')) return { results: [] };
          if (sql.includes('FROM products')) return { results: rows.products || [] };
          if (sql.includes('FROM productIngredients')) return { results: [] };
          return { results: [] };
        },
        async first() {
          if (sql.includes('FROM shifts')) {
            const [shiftId, businessId, defaultShopId, shopId] = statement.binds;
            const shift = (rows.shifts || []).find(row =>
              row.id === shiftId
              && row.businessId === businessId
              && String(row.shopId || defaultShopId) === shopId
            );
            return shift || null;
          }
          if (sql.includes('FROM customers')) {
            const [customerId, businessId, defaultShopId, shopId] = statement.binds;
            const customer = (rows.customers || []).find(row =>
              row.id === customerId
              && row.businessId === businessId
              && String(row.shopId || defaultShopId) === shopId
            );
            return customer || null;
          }
          return null;
        },
      };
      return statement;
    },
  } as any;
}

const principal = {
  userId: 'cashier-1',
  userName: 'Cashier One',
  role: 'CASHIER',
  businessId: 'biz-1',
  exp: Math.floor(Date.now() / 1000) + 3600,
} as const;

function sale(overrides: Record<string, any> = {}) {
  return {
    id: 'sale-1',
    status: 'PAID',
    paymentMethod: 'CASH',
    amountTendered: 100,
    timestamp: 1000,
    shiftId: 'shift-1',
    shopId: 'shop-1',
    items: [{ productId: 'prod-1', quantity: 1 }],
    ...overrides,
  };
}

describe('sales checkout integrity', () => {
  it('rejects products from another shop even when the business matches', async () => {
    const db = fakeDb({
      products: [{ id: 'prod-1', name: 'Other Shop Item', sellingPrice: 100, stockQuantity: 5, shopId: 'shop-2' }],
    });

    await expect(hardenTransactionBatch({ db, businessId: 'biz-1', principal, service: false }, [sale()]))
      .rejects.toThrow('Sale includes an item from another shop.');
  });

  it('rejects checkout on a shift from another shop', async () => {
    const db = fakeDb({
      products: [{ id: 'prod-1', name: 'Shop Item', sellingPrice: 100, stockQuantity: 5, shopId: 'shop-1' }],
      shifts: [{ id: 'shift-1', businessId: 'biz-1', status: 'OPEN', cashierId: 'cashier-1', shopId: 'shop-2', startTime: 1 }],
    });

    await expect(hardenTransactionBatch({ db, businessId: 'biz-1', principal, service: false }, [sale()]))
      .rejects.toThrow('The selected till shift was not found.');
  });

  it('rejects credit sales for customers from another shop', async () => {
    const db = fakeDb({
      products: [{ id: 'prod-1', name: 'Shop Item', sellingPrice: 100, stockQuantity: 5, shopId: 'shop-1' }],
      shifts: [{ id: 'shift-1', businessId: 'biz-1', status: 'OPEN', cashierId: 'cashier-1', shopId: 'shop-1', startTime: 1 }],
      customers: [{ id: 'cust-1', businessId: 'biz-1', name: 'Other Shop Customer', shopId: 'shop-2' }],
    });

    await expect(hardenTransactionBatch({ db, businessId: 'biz-1', principal, service: false }, [
      sale({ paymentMethod: 'CREDIT', customerId: 'cust-1', amountTendered: undefined }),
    ])).rejects.toThrow('Selected customer was not found.');
  });
});
