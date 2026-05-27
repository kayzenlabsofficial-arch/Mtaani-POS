import { describe, expect, it } from 'vitest';
import {
  buildCreditSettlementDraft,
  buildCheckoutDraft,
  buildReportSummary,
  buildStockReceiveLines,
  type ProductRow,
} from './_domain';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const baseProduct: ProductRow = {
  id: 'product_tea',
  name: 'Tea Leaves',
  sku: 'TEA',
  barcode: null,
  sellingPrice: 100,
  costPrice: 60,
  stockQuantity: 10,
  isActive: 1,
};

describe('Smart POS Mini checkout rules', () => {
  it('builds a cash checkout from product records and the default till', () => {
    const draft = buildCheckoutDraft({
      payload: { paymentMethod: 'CASH', items: [{ productId: baseProduct.id, quantity: 2 }] },
      products: [baseProduct],
      cashier: { id: 'user_admin', name: 'Admin' },
      now: 1_700_000_000_000,
    });

    expect(draft.sale.paymentMethod).toBe('CASH');
    expect(draft.sale.tillId).toBe('default_till');
    expect(draft.sale.total).toBe(200);
    expect(draft.sale.cogs).toBe(120);
    expect(draft.sale.status).toBe('PAID');
    expect(draft.items[0]).toMatchObject({ unitPrice: 100, unitCost: 60, lineTotal: 200, lineCost: 120 });
  });

  it('tracks manual M-Pesa as a payment method without split payment', () => {
    const draft = buildCheckoutDraft({
      payload: { paymentMethod: 'MPESA', mpesaReference: 'QWE123', items: [{ productId: baseProduct.id, quantity: 1 }] },
      products: [baseProduct],
      now: 1_700_000_000_000,
    });

    expect(draft.sale.paymentMethod).toBe('MPESA');
    expect(draft.sale.mpesaReference).toBe('QWE123');
    expect(draft.sale.total).toBe(100);
  });

  it('creates customer debt for credit checkout', () => {
    const draft = buildCheckoutDraft({
      payload: {
        paymentMethod: 'CREDIT',
        customer: { name: 'Jane Buyer', phone: '0712345678' },
        items: [{ productId: baseProduct.id, quantity: 3 }],
      },
      products: [baseProduct],
      now: 1_700_000_000_000,
    });

    expect(draft.sale.status).toBe('CREDIT');
    expect(draft.sale.customerName).toBe('Jane Buyer');
    expect(draft.customer).toMatchObject({ name: 'Jane Buyer', phone: '0712345678', balanceIncrease: 300 });
  });

  it('rejects discounts, split payments, and insufficient stock', () => {
    expect(() => buildCheckoutDraft({
      payload: { paymentMethod: 'CASH', discountAmount: 10, items: [{ productId: baseProduct.id, quantity: 1 }] },
      products: [baseProduct],
    })).toThrow(/does not support/i);

    expect(() => buildCheckoutDraft({
      payload: { paymentMethod: 'CASH', splitPayments: [{ method: 'CASH', amount: 50 }], items: [{ productId: baseProduct.id, quantity: 1 }] },
      products: [baseProduct],
    })).toThrow(/does not support/i);

    expect(() => buildCheckoutDraft({
      payload: { paymentMethod: 'CASH', items: [{ productId: baseProduct.id, quantity: 99 }] },
      products: [baseProduct],
    })).toThrow(/insufficient stock/i);
  });
});

describe('Smart POS Mini credit settlement rules', () => {
  it('settles customer credit by Cash or M-Pesa only', () => {
    const mpesa = buildCreditSettlementDraft({ amount: 120, paymentMethod: 'MPESA', reference: 'PAY123' }, 300);
    expect(mpesa).toEqual({ amount: 120, paymentMethod: 'MPESA', reference: 'PAY123', nextBalance: 180 });

    const cash = buildCreditSettlementDraft({ amount: 50, paymentMethod: 'CASH' }, 180);
    expect(cash).toMatchObject({ amount: 50, paymentMethod: 'CASH', nextBalance: 130 });

    expect(() => buildCreditSettlementDraft({ amount: 10, paymentMethod: 'CREDIT' }, 180)).toThrow(/Cash or M-Pesa/i);
    expect(() => buildCreditSettlementDraft({ amount: 999, paymentMethod: 'CASH' }, 180)).toThrow(/exceed/i);
  });
});

describe('Smart POS Mini stock and reports', () => {
  it('prepares manual stock receiving with weighted cost and movement data', () => {
    const [line] = buildStockReceiveLines([baseProduct], {
      note: 'Opening stock',
      items: [{ productId: baseProduct.id, quantity: 10, unitCost: 70 }],
    });

    expect(line.quantity).toBe(10);
    expect(line.lineCost).toBe(700);
    expect(line.nextStockQuantity).toBe(20);
    expect(line.nextCostPrice).toBe(65);
  });

  it('uses sale item snapshot cost for P&L', () => {
    const summary = buildReportSummary({
      sales: [
        { paymentMethod: 'CASH', total: 300, cogs: 180 },
        { paymentMethod: 'MPESA', total: 200, cogs: 120 },
      ],
      saleItems: [
        { productId: 'product_tea', productName: 'Tea Leaves', quantity: 3, lineTotal: 300, lineCost: 180 },
        { productId: 'product_tea', productName: 'Tea Leaves', quantity: 2, lineTotal: 200, lineCost: 120 },
      ],
      customers: [{ balance: 150 }],
      products: [{ stockQuantity: 10, costPrice: 99 }],
      stockReceipts: [{ totalCost: 700 }],
      stockMovements: [{ type: 'RECEIVE', quantity: 10 }],
    });

    expect(summary.revenue).toBe(500);
    expect(summary.cogs).toBe(300);
    expect(summary.grossProfit).toBe(200);
    expect(summary.creditOutstanding).toBe(150);
    expect(summary.stockValue).toBe(990);
    expect(summary.stockAddedCost).toBe(700);
    expect(summary.stockAddedQuantity).toBe(10);
    expect(summary.topProducts[0]).toMatchObject({ productId: 'product_tea', quantity: 5, sales: 500, cogs: 300 });
  });
});

describe('Smart POS Mini isolation', () => {
  it('does not import files from the full Smart POS app', () => {
    const root = process.cwd();
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (['node_modules', 'dist', '.wrangler'].includes(entry)) continue;
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        if (stat.isFile() && /\.(ts|tsx|js|jsx|json|toml|sql|html|css)$/.test(path)) files.push(path);
      }
    };
    walk(root);

    const offenders = files.filter(file => {
      const body = readFileSync(file, 'utf8');
      return /from\s+['"]\.\.\/(?:\.\.\/)*(src|functions)\//.test(body);
    });

    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });
});
