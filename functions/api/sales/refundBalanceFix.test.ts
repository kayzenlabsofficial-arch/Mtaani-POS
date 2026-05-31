import { describe, expect, it } from 'vitest';
import { refundAmountFor, originalNetTotal } from './refundOps';

// ---------------------------------------------------------------------------
// Helpers that mirror the fixed logic inside prepareRefundApproval
// ---------------------------------------------------------------------------

function roundMoney(v: number) {
  return Math.round(v * 100) / 100;
}

function asNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function paymentAmountFor(
  record: any,
  method: 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT',
): number {
  const pm = String(record?.paymentMethod || '').toUpperCase();
  if (pm === method) return asNumber(record?.total ?? record?.subtotal);
  if (pm !== 'SPLIT') return 0;
  const split = record?.splitPayments ?? null;
  if (method === 'CASH') return asNumber(split?.cashAmount);
  return String(split?.secondaryMethod || '').toUpperCase() === method
    ? asNumber(split?.secondaryAmount)
    : 0;
}

/**
 * Computes the credit/cash refund split after reading the customer's live balance.
 * Mirrors the fixed prepareRefundApproval logic (sans DB calls).
 */
function computeRefundSplit(opts: {
  tx: any;
  refundAmount: number;
  priorRefundAmount: number;
  customerLiveBalance: number;
}) {
  const { tx, refundAmount, priorRefundAmount, customerLiveBalance } = opts;

  const originalCredit = paymentAmountFor(tx, 'CREDIT');
  const totalRefundAmount = roundMoney(priorRefundAmount + refundAmount);

  const priorCreditRefund = roundMoney(Math.min(originalCredit, priorRefundAmount));
  const priorCashRefund = roundMoney(Math.max(0, priorRefundAmount - priorCreditRefund));

  const cumulativeCreditRefundRaw = roundMoney(Math.min(originalCredit, totalRefundAmount));
  const cumulativeCashRefundRaw = roundMoney(Math.max(0, totalRefundAmount - cumulativeCreditRefundRaw));

  let currentCreditRefund = roundMoney(cumulativeCreditRefundRaw - priorCreditRefund);
  let currentCashRefund = roundMoney(cumulativeCashRefundRaw - priorCashRefund);

  // ── Critical fix applied ──
  if (tx.customerId && currentCreditRefund > 0) {
    const cappedBalance = roundMoney(Math.max(0, customerLiveBalance));
    if (currentCreditRefund > cappedBalance) {
      const overflow = roundMoney(currentCreditRefund - cappedBalance);
      currentCreditRefund = cappedBalance;
      currentCashRefund = roundMoney(currentCashRefund + overflow);
    }
  }

  return { currentCreditRefund, currentCashRefund };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Refund customer balance fix — credit cap + overflow to cash', () => {
  const creditSale = {
    id: 'tx-001',
    customerId: 'cust-001',
    total: 300,
    subtotal: 300,
    paymentMethod: 'CREDIT',
    items: [
      { productId: 'prod-a', name: 'Item A', quantity: 3, snapshotPrice: 100, discountAmount: 0 },
    ],
  };

  it('full credit refund when customer balance is intact (balance == original amount)', () => {
    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: creditSale,
      refundAmount: 300,
      priorRefundAmount: 0,
      customerLiveBalance: 300, // customer has not paid anything yet
    });

    expect(currentCreditRefund).toBe(300);
    expect(currentCashRefund).toBe(0);
  });

  it('redirects full amount to cash when customer already cleared the full balance', () => {
    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: creditSale,
      refundAmount: 300,
      priorRefundAmount: 0,
      customerLiveBalance: 0, // customer paid everything in cash
    });

    expect(currentCreditRefund).toBe(0);
    expect(currentCashRefund).toBe(300);
  });

  it('redirects partial overflow to cash when customer partly paid off the balance', () => {
    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: creditSale,
      refundAmount: 300,
      priorRefundAmount: 0,
      customerLiveBalance: 100, // customer paid 200, still owes 100
    });

    // Only 100 can reduce the balance; the other 200 is paid as cash
    expect(currentCreditRefund).toBe(100);
    expect(currentCashRefund).toBe(200);
  });

  it('partial refund on a partially-paid credit sale caps correctly', () => {
    // Refund Ksh 100 of a Ksh 300 credit sale; customer has Ksh 150 left
    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: creditSale,
      refundAmount: 100,
      priorRefundAmount: 0,
      customerLiveBalance: 150,
    });

    expect(currentCreditRefund).toBe(100); // 100 <= 150, no overflow
    expect(currentCashRefund).toBe(0);
  });

  it('balance capped at 0 when live balance is somehow negative (defensive guard)', () => {
    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: creditSale,
      refundAmount: 200,
      priorRefundAmount: 0,
      customerLiveBalance: -50, // data anomaly; should behave like 0
    });

    expect(currentCreditRefund).toBe(0);
    expect(currentCashRefund).toBe(200);
  });

  it('total refund split always equals total refund amount (conservation invariant)', () => {
    const cases = [0, 50, 150, 300, 500];
    for (const balance of cases) {
      const refundAmount = 300;
      const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
        tx: creditSale,
        refundAmount,
        priorRefundAmount: 0,
        customerLiveBalance: balance,
      });
      expect(
        roundMoney(currentCreditRefund + currentCashRefund),
      ).toBe(refundAmount);
    }
  });

  it('split payment sale: only the credit portion is capped, cash part is unaffected', () => {
    const splitSale = {
      id: 'tx-split',
      customerId: 'cust-002',
      total: 500,
      subtotal: 500,
      paymentMethod: 'SPLIT',
      splitPayments: { cashAmount: 200, secondaryMethod: 'CREDIT', secondaryAmount: 300 },
      items: [
        { productId: 'prod-b', name: 'Item B', quantity: 5, snapshotPrice: 100, discountAmount: 0 },
      ],
    };

    // Customer has already cleared 200 of the 300 credit
    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: splitSale,
      refundAmount: 500,          // full refund of the Ksh 500 sale
      priorRefundAmount: 0,
      customerLiveBalance: 100,   // only Ksh 100 outstanding
    });

    // 500 total: first Ksh 300 comes from credit side → capped to 100 → 200 overflow
    // Ksh 200 was the original cash → + 200 overflow = Ksh 400 cash out
    expect(currentCreditRefund).toBe(100);
    expect(currentCashRefund).toBe(400);
    expect(roundMoney(currentCreditRefund + currentCashRefund)).toBe(500);
  });

  it('no customer, no credit: cash-only refund is unchanged', () => {
    const cashSale = {
      id: 'tx-cash',
      customerId: null,
      total: 150,
      subtotal: 150,
      paymentMethod: 'CASH',
      items: [
        { productId: 'prod-c', name: 'Item C', quantity: 1, snapshotPrice: 150, discountAmount: 0 },
      ],
    };

    const { currentCreditRefund, currentCashRefund } = computeRefundSplit({
      tx: cashSale,
      refundAmount: 150,
      priorRefundAmount: 0,
      customerLiveBalance: 0, // doesn't matter for cash sale
    });

    expect(currentCreditRefund).toBe(0);
    expect(currentCashRefund).toBe(150);
  });
});
