type TransactionLike = {
  total?: number;
  timestamp?: number;
  status?: string;
  paymentMethod?: string;
  splitPayments?: { cashAmount?: number } | null;
  splitData?: { cashAmount?: number } | null;
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
  if (transaction.paymentMethod === 'CASH') return Number(transaction.total || 0);
  if (transaction.paymentMethod === 'SPLIT') {
    return Number(transaction.splitPayments?.cashAmount ?? transaction.splitData?.cashAmount ?? 0);
  }
  return 0;
}

function recordInShiftCashScope(record: { timestamp?: number; shiftId?: string }, since: number, shiftId?: string): boolean {
  if (shiftId && record.shiftId) return record.shiftId === shiftId;
  return (record.timestamp || 0) >= since;
}

export function calculateCashDrawer({
  transactions = [],
  expenses = [],
  cashPicks = [],
  supplierPayments = [],
  customerPayments = [],
  since = getTodayStartMs(),
  shiftId,
}: {
  transactions?: TransactionLike[];
  expenses?: ExpenseLike[];
  cashPicks?: CashPickLike[];
  supplierPayments?: SupplierPaymentLike[];
  customerPayments?: CustomerPaymentLike[];
  since?: number;
  shiftId?: string;
}): {
  cashSales: number;
  customerCashPayments: number;
  tillExpenses: number;
  cashPicks: number;
  supplierTillPayments: number;
  actualCashDrawer: number;
} {
  const cashSales = transactions
    .filter(t => recordInShiftCashScope(t, since, shiftId) && t.status === 'PAID')
    .reduce((sum, t) => sum + cashAmountFromTransaction(t), 0);

  const tillExpenses = expenses
    .filter(e => recordInShiftCashScope(e, since, shiftId) && e.source === 'TILL' && e.status !== 'REJECTED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const picked = cashPicks
    .filter(p => recordInShiftCashScope(p, since, shiftId) && p.status !== 'REJECTED')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const supplierTillPayments = supplierPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && p.source === 'TILL')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const customerCashPayments = customerPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && p.paymentMethod === 'CASH')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    cashSales,
    customerCashPayments,
    tillExpenses,
    cashPicks: picked,
    supplierTillPayments,
    actualCashDrawer: cashSales + customerCashPayments - tillExpenses - picked - supplierTillPayments,
  };
}

export function calculateShiftCashFromSales({
  transactions = [],
  expenses = [],
  cashPicks = [],
  supplierPayments = [],
  since = getTodayStartMs(),
  shiftId,
}: {
  transactions?: TransactionLike[];
  expenses?: ExpenseLike[];
  cashPicks?: CashPickLike[];
  supplierPayments?: SupplierPaymentLike[];
  since?: number;
  shiftId?: string;
}): {
  cashSales: number;
  tillExpenses: number;
  cashPicks: number;
  supplierTillPayments: number;
  availableCashSales: number;
} {
  const cashSales = transactions
    .filter(t => recordInShiftCashScope(t, since, shiftId) && t.status === 'PAID')
    .reduce((sum, t) => sum + cashAmountFromTransaction(t), 0);

  const tillExpenses = expenses
    .filter(e => recordInShiftCashScope(e, since, shiftId) && e.source === 'TILL' && e.status !== 'REJECTED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const picked = cashPicks
    .filter(p => recordInShiftCashScope(p, since, shiftId) && p.status !== 'REJECTED')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const supplierTillPayments = supplierPayments
    .filter(p => recordInShiftCashScope(p, since, shiftId) && p.source === 'TILL')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    cashSales,
    tillExpenses,
    cashPicks: picked,
    supplierTillPayments,
    availableCashSales: Math.max(0, cashSales - tillExpenses - picked - supplierTillPayments),
  };
}
