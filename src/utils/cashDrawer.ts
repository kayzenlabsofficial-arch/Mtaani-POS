import { cashRefundAmount, paymentAmountForMethod } from './posMoney';

type TransactionLike = {
  total?: number;
  timestamp?: number;
  status?: string;
  paymentMethod?: string;
  splitPayments?: { cashAmount?: number } | null;
  splitData?: { cashAmount?: number; splitPayments?: { cashAmount?: number } } | null;
  shiftId?: string;
};

type ExpenseLike = {
  amount?: number;
  timestamp?: number;
  source?: string;
  status?: string;
  shiftId?: string;
};

type CashPickLike = {
  amount?: number;
  timestamp?: number;
  status?: string;
  shiftId?: string;
};

type RefundLike = {
  amount?: number;
  cashAmount?: number;
  timestamp?: number;
  source?: string;
  status?: string;
  shiftId?: string;
};

type SupplierPaymentLike = {
  amount?: number;
  timestamp?: number;
  source?: string;
  shiftId?: string;
};

type CustomerPaymentLike = {
  amount?: number;
  timestamp?: number;
  paymentMethod?: string;
  shiftId?: string;
};

export function getTodayStartMs(now = new Date()): number {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  return todayStart.getTime();
}

export function cashAmountFromTransaction(transaction: TransactionLike): number {
  return paymentAmountForMethod(transaction, 'CASH');
}

function recordInShiftCashScope(record: { timestamp?: number; shiftId?: string }, since: number, shiftId?: string): boolean {
  if (shiftId && record.shiftId) return record.shiftId === shiftId;
  return (record.timestamp || 0) >= since;
}

function cashAmountFromRefund(refund: RefundLike): number {
  return cashRefundAmount(refund);
}

export function calculateCashDrawer({
  transactions = [],
  expenses = [],
  cashPicks = [],
  refunds = [],
  supplierPayments = [],
  customerPayments = [],
  openingCash = 0,
  since = getTodayStartMs(),
  shiftId,
}: {
  transactions?: TransactionLike[];
  expenses?: ExpenseLike[];
  cashPicks?: CashPickLike[];
  refunds?: RefundLike[];
  supplierPayments?: SupplierPaymentLike[];
  customerPayments?: CustomerPaymentLike[];
  openingCash?: number;
  since?: number;
  shiftId?: string;
}): {
  openingCash: number;
  cashSales: number;
  customerCashPayments: number;
  tillExpenses: number;
  cashPicks: number;
  cashRefunds: number;
  supplierTillPayments: number;
  actualCashDrawer: number;
} {
  const cashSales = transactions
    .filter(t => recordInShiftCashScope(t, since, shiftId) && String(t.status || '').toUpperCase() === 'PAID')
    .reduce((sum, t) => sum + cashAmountFromTransaction(t), 0);

  const tillExpenses = expenses
    .filter(e => recordInShiftCashScope(e, since, shiftId) && String(e.source || '').toUpperCase() === 'TILL' && String(e.status || '').toUpperCase() !== 'REJECTED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const picked = cashPicks
    .filter(p => recordInShiftCashScope(p, since, shiftId) && String(p.status || '').toUpperCase() !== 'REJECTED')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const cashRefunds = refunds
    .filter(r => recordInShiftCashScope(r, since, shiftId))
    .reduce((sum, r) => sum + cashAmountFromRefund(r), 0);

  const supplierTillPayments = supplierPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && String(p.source || '').toUpperCase() === 'TILL')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const customerCashPayments = customerPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && String(p.paymentMethod || '').toUpperCase() === 'CASH')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    openingCash: Number(openingCash || 0),
    cashSales,
    customerCashPayments,
    tillExpenses,
    cashPicks: picked,
    cashRefunds,
    supplierTillPayments,
    actualCashDrawer: Number(openingCash || 0) + cashSales + customerCashPayments - tillExpenses - picked - supplierTillPayments - cashRefunds,
  };
}

export function calculateShiftCashFromSales({
  transactions = [],
  expenses = [],
  cashPicks = [],
  refunds = [],
  supplierPayments = [],
  customerPayments = [],
  openingCash = 0,
  since = getTodayStartMs(),
  shiftId,
}: {
  transactions?: TransactionLike[];
  expenses?: ExpenseLike[];
  cashPicks?: CashPickLike[];
  refunds?: RefundLike[];
  supplierPayments?: SupplierPaymentLike[];
  customerPayments?: CustomerPaymentLike[];
  openingCash?: number;
  since?: number;
  shiftId?: string;
}): {
  openingCash: number;
  cashSales: number;
  customerCashPayments: number;
  tillExpenses: number;
  cashPicks: number;
  cashRefunds: number;
  supplierTillPayments: number;
  availableCashSales: number;
} {
  const cashSales = transactions
    .filter(t => recordInShiftCashScope(t, since, shiftId) && String(t.status || '').toUpperCase() === 'PAID')
    .reduce((sum, t) => sum + cashAmountFromTransaction(t), 0);

  const tillExpenses = expenses
    .filter(e => recordInShiftCashScope(e, since, shiftId) && String(e.source || '').toUpperCase() === 'TILL' && String(e.status || '').toUpperCase() !== 'REJECTED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const picked = cashPicks
    .filter(p => recordInShiftCashScope(p, since, shiftId) && String(p.status || '').toUpperCase() !== 'REJECTED')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const cashRefunds = refunds
    .filter(r => recordInShiftCashScope(r, since, shiftId))
    .reduce((sum, r) => sum + cashAmountFromRefund(r), 0);

  const supplierTillPayments = supplierPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && String(p.source || '').toUpperCase() === 'TILL')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const customerCashPayments = customerPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && String(p.paymentMethod || '').toUpperCase() === 'CASH')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    openingCash: Number(openingCash || 0),
    cashSales,
    customerCashPayments,
    tillExpenses,
    cashPicks: picked,
    cashRefunds,
    supplierTillPayments,
    availableCashSales: Math.max(0, Number(openingCash || 0) + cashSales + customerCashPayments - tillExpenses - picked - supplierTillPayments - cashRefunds),
  };
}
