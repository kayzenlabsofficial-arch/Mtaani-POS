import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createMainAccountCreditStatements,
  mainAccountCreditId,
  mainAccountId,
  mpesaAmountForTransaction,
  reconcileMpesaMainAccount,
} from './mainAccountPosting';

class FakeStatement {
  private values: any[] = [];

  constructor(private db: FakeD1, private sql: string) {}

  bind(...values: any[]) {
    const statement = new FakeStatement(this.db, this.sql);
    statement.values = values;
    return statement as unknown as D1PreparedStatement;
  }

  async run() {
    return this.db.run(this.sql, this.values);
  }

  async first<T = any>() {
    const rows = await this.db.rows(this.sql, this.values);
    return (rows[0] || null) as T | null;
  }

  async all<T = any>() {
    const rows = await this.db.rows(this.sql, this.values);
    return { results: rows as T[] } as any;
  }
}

class FakeD1 {
  financialAccounts = new Map<string, any>();
  financialAccountAdjustments = new Map<string, any>();
  auditLogs: any[] = [];
  transactions: any[] = [];
  customerPayments: any[] = [];
  mpesaCallbacks: any[] = [];

  prepare(sql: string) {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]) {
    for (const statement of statements) await statement.run();
    return [] as any;
  }

  private accountKey(id: string, businessId: string) {
    return `${businessId}:${id}`;
  }

  private adjustmentKey(id: string, businessId: string) {
    return `${businessId}:${id}`;
  }

  async run(sql: string, values: any[]) {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (text.startsWith('create ') || text.startsWith('alter ') || text.startsWith('create index')) return {} as any;

    if (text.includes('insert or ignore into financialaccounts')) {
      const [id, name, businessId, accountNumber, updatedAt] = values;
      const key = this.accountKey(id, businessId);
      if (!this.financialAccounts.has(key)) {
        this.financialAccounts.set(key, { id, name, type: 'CASH', balance: 0, businessId, accountNumber, updated_at: updatedAt });
      }
      return {} as any;
    }

    if (text.includes('update financialaccounts') && text.includes('set name =')) {
      const [name, accountNumber, updatedAt, id, businessId] = values;
      const key = this.accountKey(id, businessId);
      const account = this.financialAccounts.get(key);
      if (account) Object.assign(account, { name, type: 'CASH', accountNumber, updated_at: updatedAt });
      return {} as any;
    }

    if (text.includes('insert or ignore into financialaccountadjustments')) {
      const [id, amount, , reason, userName, timestamp, businessId, updatedAt, accountId] = values;
      const key = this.adjustmentKey(id, businessId);
      if (this.financialAccountAdjustments.has(key)) return {} as any;
      const account = this.financialAccounts.get(this.accountKey(accountId, businessId));
      if (!account) return {} as any;
      const balanceBefore = Number(account.balance || 0);
      const balanceAfter = Math.round((balanceBefore + Number(amount || 0)) * 100) / 100;
      this.financialAccountAdjustments.set(key, {
        id,
        accountId,
        amount,
        direction: 'IN',
        balanceBefore,
        balanceAfter,
        reason,
        userName,
        timestamp,
        businessId,
        updated_at: updatedAt,
      });
      return {} as any;
    }

    if (text.includes('update financialaccounts') && text.includes('set balance =')) {
      const [adjustmentId, businessId, updatedAt, , accountId] = values;
      const adjustment = this.financialAccountAdjustments.get(this.adjustmentKey(adjustmentId, businessId));
      const account = this.financialAccounts.get(this.accountKey(accountId, businessId));
      if (adjustment && adjustment.updated_at === updatedAt && account) {
        account.balance = adjustment.balanceAfter;
        account.updated_at = updatedAt;
      }
      return {} as any;
    }

    if (text.includes('insert into auditlogs')) {
      const [id, ts, userId, userName, action, entity, entityId, details, businessId, updatedAt, adjustmentId, adjustmentBusinessId, adjustmentUpdatedAt] = values;
      const adjustment = this.financialAccountAdjustments.get(this.adjustmentKey(adjustmentId, adjustmentBusinessId));
      if (adjustment && adjustment.updated_at === adjustmentUpdatedAt) {
        this.auditLogs.push({ id, ts, userId, userName, action, entity, entityId, severity: 'INFO', details, businessId, updated_at: updatedAt });
      }
      return {} as any;
    }

    return {} as any;
  }

  async rows(sql: string, values: any[]) {
    const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (text.includes('from financialaccounts')) {
      const [id, businessId] = values;
      const account = this.financialAccounts.get(this.accountKey(id, businessId));
      return account ? [account] : [];
    }

    if (text.includes('from financialaccountadjustments')) {
      const [id, businessId] = values;
      const adjustment = this.financialAccountAdjustments.get(this.adjustmentKey(id, businessId));
      return adjustment ? [adjustment] : [];
    }

    if (text.includes('from transactions')) {
      const [businessId] = values;
      return this.transactions.filter(row =>
        row.businessId === businessId
        && !['VOIDED', 'QUOTE'].includes(String(row.status || 'PAID').toUpperCase())
        && ['MPESA', 'SPLIT'].includes(String(row.paymentMethod || '').toUpperCase())
      );
    }

    if (text.includes('from customerpayments')) {
      const [businessId] = values;
      return this.customerPayments.filter(row => row.businessId === businessId && String(row.paymentMethod || '').toUpperCase() === 'MPESA');
    }

    if (text.includes('from mpesacallbacks')) {
      const [businessId, marker, ...codes] = values;
      const normalizedCodes = new Set(codes.map(code => String(code || '').toUpperCase()).filter(Boolean));
      return this.mpesaCallbacks
        .filter(row => row.businessId === businessId)
        .filter(row => (
          row.utilizedTransactionId === marker
          || normalizedCodes.has(String(row.receiptNumber || '').toUpperCase())
          || normalizedCodes.has(String(row.checkoutRequestId || '').toUpperCase())
          || normalizedCodes.has(String(row.merchantRequestId || '').toUpperCase())
        ))
        .sort((a, b) => {
          const paidA = Number(a.resultCode) === 0 ? 0 : 1;
          const paidB = Number(b.resultCode) === 0 ? 0 : 1;
          return paidA - paidB || Number(b.timestamp || 0) - Number(a.timestamp || 0);
        })
        .slice(0, 1);
    }

    return [];
  }
}

describe('Main account M-Pesa posting', () => {
  it('calculates full and split M-Pesa sale amounts', () => {
    expect(mpesaAmountForTransaction({ paymentMethod: 'MPESA', total: 500 })).toBe(500);
    expect(mpesaAmountForTransaction({
      paymentMethod: 'SPLIT',
      total: 500,
      splitPayments: { cashAmount: 200, secondaryMethod: 'MPESA', secondaryAmount: 300 },
    })).toBe(300);
    expect(mpesaAmountForTransaction({ paymentMethod: 'CASH', total: 500 })).toBe(0);
  });

  it('credits a M-Pesa sale once with a deterministic adjustment id', async () => {
    const db = new FakeD1() as unknown as D1Database & FakeD1;
    const result = await createMainAccountCreditStatements(db, {
      kind: 'MPESA_SALE',
      businessId: 'biz-1',
      sourceId: 'tx-1',
      amount: 250,
      reference: 'RCP123',
      userName: 'Cashier',
    });

    await db.batch(result.statements);
    expect(db.financialAccounts.get(`biz-1:${mainAccountId('biz-1')}`)?.balance).toBe(250);
    expect(db.financialAccountAdjustments.get(`biz-1:${mainAccountCreditId('MPESA_SALE', 'biz-1', 'tx-1')}`)).toMatchObject({
      amount: 250,
      direction: 'IN',
    });

    const retry = await createMainAccountCreditStatements(db, {
      kind: 'MPESA_SALE',
      businessId: 'biz-1',
      sourceId: 'tx-1',
      amount: 250,
    });
    expect(retry.statements).toHaveLength(0);
    expect(db.financialAccounts.get(`biz-1:${mainAccountId('biz-1')}`)?.balance).toBe(250);
  });

  it('credits a customer M-Pesa repayment using a customer-payment posting id', async () => {
    const db = new FakeD1() as unknown as D1Database & FakeD1;
    const result = await createMainAccountCreditStatements(db, {
      kind: 'MPESA_CUSTOMER_PAYMENT',
      businessId: 'biz-1',
      sourceId: 'pay-1',
      amount: 70,
      customerName: 'Jane',
    });

    await db.batch(result.statements);
    expect(db.financialAccounts.get(`biz-1:${mainAccountId('biz-1')}`)?.balance).toBe(70);
    expect(db.financialAccountAdjustments.has(`biz-1:${mainAccountCreditId('MPESA_CUSTOMER_PAYMENT', 'biz-1', 'pay-1')}`)).toBe(true);
  });

  it('reconciliation backfills linked M-Pesa sales and skips existing postings', async () => {
    const db = new FakeD1() as unknown as D1Database & FakeD1;
    db.transactions.push({ id: 'tx-1', businessId: 'biz-1', status: 'PAID', paymentMethod: 'MPESA', total: 100, mpesaCode: 'RCP1' });
    db.mpesaCallbacks.push({ checkoutRequestId: 'chk-1', receiptNumber: 'RCP1', resultCode: 0, amount: 100, utilizedTransactionId: 'tx-1', businessId: 'biz-1', timestamp: 10 });

    const first = await reconcileMpesaMainAccount(db, 'biz-1', { userName: 'Admin' });
    expect(first.posted).toBe(1);
    expect(first.skipped).toBe(0);
    expect(first.anomalies).toHaveLength(0);
    expect(first.account.balance).toBe(100);

    const second = await reconcileMpesaMainAccount(db, 'biz-1', { userName: 'Admin' });
    expect(second.posted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.account.balance).toBe(100);
  });

  it('does not post a paid but unlinked M-Pesa callback during reconciliation', async () => {
    const db = new FakeD1() as unknown as D1Database & FakeD1;
    db.mpesaCallbacks.push({ checkoutRequestId: 'chk-raw', receiptNumber: 'RAW1', resultCode: 0, amount: 100, businessId: 'biz-1', timestamp: 10 });

    const result = await reconcileMpesaMainAccount(db, 'biz-1', { userName: 'Admin' });
    expect(result.posted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.account.balance).toBe(0);
  });

  it('reports M-Pesa amount anomalies without crediting the Main account', async () => {
    const db = new FakeD1() as unknown as D1Database & FakeD1;
    db.transactions.push({ id: 'tx-1', businessId: 'biz-1', status: 'PAID', paymentMethod: 'MPESA', total: 100, mpesaCode: 'RCP1' });
    db.mpesaCallbacks.push({ checkoutRequestId: 'chk-1', receiptNumber: 'RCP1', resultCode: 0, amount: 90, utilizedTransactionId: 'tx-1', businessId: 'biz-1', timestamp: 10 });

    const result = await reconcileMpesaMainAccount(db, 'biz-1', { userName: 'Admin' });
    expect(result.posted).toBe(0);
    expect(result.anomalies).toHaveLength(1);
    expect(result.account.balance).toBe(0);
  });

  it('reconciliation backfills linked M-Pesa customer repayments', async () => {
    const db = new FakeD1() as unknown as D1Database & FakeD1;
    db.customerPayments.push({ id: 'pay-1', businessId: 'biz-1', paymentMethod: 'MPESA', amount: 80, transactionCode: 'CUST1' });
    db.mpesaCallbacks.push({ checkoutRequestId: 'chk-1', receiptNumber: 'CUST1', resultCode: 0, amount: 80, utilizedTransactionId: 'customer_payment:pay-1', utilizedCustomerName: 'Jane', businessId: 'biz-1', timestamp: 10 });

    const result = await reconcileMpesaMainAccount(db, 'biz-1', { userName: 'Admin' });
    expect(result.posted).toBe(1);
    expect(result.account.balance).toBe(80);
    expect(db.financialAccountAdjustments.has(`biz-1:${mainAccountCreditId('MPESA_CUSTOMER_PAYMENT', 'biz-1', 'pay-1')}`)).toBe(true);
  });

  it('keeps the Main account phone UI independent from the desktop file', async () => {
    const mobile = await readFile('src/components/tabs/MainAccountTabMobile.tsx', 'utf8');
    expect(mobile).not.toContain('MainAccountTabDesktop');
    expect(mobile).not.toContain("from './MainAccountTabDesktop'");
  });
});
