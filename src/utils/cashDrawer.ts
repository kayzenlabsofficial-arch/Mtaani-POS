type TransactionLike = {
  total?: number;
  timestamp?: number;
  status?: string;
  paymentMethod?: string;
  splitPayments?: { cashAmount?: number } | null;
  splitData?: { cashAmount?: number } | null;
};

type ExpenseLike = {
  amount?: number;
  timestamp?: number;
  source?: string;
  status?: string;
};

type CashPickLike = {
  amount?: number;
  timestamp?: number;
  status?: string;
};

type SupplierPaymentLike = {
  amount?: number;
  timestamp?: number;
  source?: string;
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

export function calculateCashDrawer({
  transactions = [],
  expenses = [],
  cashPicks = [],
  supplierPayments = [],
  since = getTodayStartMs(),
}: {
  transactions?: TransactionLike[];
  expenses?: ExpenseLike[];
  cashPicks?: CashPickLike[];
  supplierPayments?: SupplierPaymentLike[];
  since?: number;
}): {
  cashSales: number;
  tillExpenses: number;
  cashPicks: number;
  supplierTillPayments: number;
  actualCashDrawer: number;
} {
  const cashSales = transactions
    .filter(t => (t.timestamp || 0) >= since && t.status === 'PAID')
    .reduce((sum, t) => sum + cashAmountFromTransaction(t), 0);

  const tillExpenses = expenses
    .filter(e => (e.timestamp || 0) >= since && e.source === 'TILL' && e.status !== 'REJECTED')
    .reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const picked = cashPicks
    .filter(p => (p.timestamp || 0) >= since && p.status !== 'REJECTED')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const supplierTillPayments = supplierPayments
    .filter(p => (p.timestamp || 0) >= since && p.source === 'TILL')
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    cashSales,
    tillExpenses,
    cashPicks: picked,
    supplierTillPayments,
    actualCashDrawer: cashSales - tillExpenses - picked - supplierTillPayments,
  };
}
