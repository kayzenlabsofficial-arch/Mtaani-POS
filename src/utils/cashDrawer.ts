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

type CustomerPaymentLike = {
  amount?: number;
  timestamp?: number;
  paymentMethod?: string;
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
  customerPayments = [],
  since = getTodayStartMs(),
}: {
  transactions?: TransactionLike[];
  expenses?: ExpenseLike[];
  cashPicks?: CashPickLike[];
  supplierPayments?: SupplierPaymentLike[];
  customerPayments?: CustomerPaymentLike[];
  since?: number;
}): {
  cashSales: number;
  customerCashPayments: number;
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

  const customerCashPayments = customerPayments
    .filter(p => (p.timestamp || 0) >= since && p.paymentMethod === 'CASH')
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
