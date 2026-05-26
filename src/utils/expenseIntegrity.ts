export type ExpenseSource = 'TILL' | 'ACCOUNT' | 'SHOP';
export type ExpenseStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type ExpenseLike = {
  amount?: number | string | null;
  category?: string | null;
  timestamp?: number | string | null;
  source?: string | null;
  status?: string | null;
};

export type ExpenseProductLike = {
  id?: string | null;
  name?: string | null;
  stockQuantity?: number | string | null;
  costPrice?: number | string | null;
  isBundle?: boolean | number | string | null;
  unit?: string | null;
};

export type ExpenseProductEligibility = {
  ok: boolean;
  amount: number;
  stock: number;
  unitCost: number;
  reason?: 'MISSING_PRODUCT' | 'BUNDLE_PRODUCT' | 'INVALID_QUANTITY' | 'INSUFFICIENT_STOCK' | 'MISSING_COST';
  message?: string;
};

export type ExpenseLifecycleTotals = {
  approvedTotal: number;
  pendingTotal: number;
  rejectedTotal: number;
  approvedCount: number;
  pendingCount: number;
  rejectedCount: number;
  bySource: Record<ExpenseSource, { approved: number; pending: number; rejected: number }>;
};

export function expenseNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundExpenseMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function normalizeExpenseSource(value: unknown): ExpenseSource {
  const source = String(value || '').trim().toUpperCase();
  if (source === 'ACCOUNT') return 'ACCOUNT';
  if (source === 'SHOP') return 'SHOP';
  return 'TILL';
}

export function normalizeExpenseStatus(value: unknown): ExpenseStatus {
  const status = String(value || '').trim().toUpperCase();
  if (status === 'PENDING') return 'PENDING';
  if (status === 'REJECTED') return 'REJECTED';
  return 'APPROVED';
}

export function isApprovedExpense(expense: Pick<ExpenseLike, 'status'> | null | undefined): boolean {
  return normalizeExpenseStatus(expense?.status) === 'APPROVED';
}

export function expenseAmount(expense: Pick<ExpenseLike, 'amount'> | null | undefined): number {
  return Math.max(0, expenseNumber(expense?.amount));
}

export function expenseInPeriod(expense: Pick<ExpenseLike, 'timestamp'> | null | undefined, start: number, end: number): boolean {
  const timestamp = expenseNumber(expense?.timestamp);
  return timestamp >= start && timestamp <= end;
}

export function expenseLifecycleTotals(expenses: ExpenseLike[] | null | undefined): ExpenseLifecycleTotals {
  const initialSourceTotals = {
    TILL: { approved: 0, pending: 0, rejected: 0 },
    ACCOUNT: { approved: 0, pending: 0, rejected: 0 },
    SHOP: { approved: 0, pending: 0, rejected: 0 },
  };

  return (expenses || []).reduce<ExpenseLifecycleTotals>((totals, expense) => {
    const amount = expenseAmount(expense);
    const source = normalizeExpenseSource(expense?.source);
    const status = normalizeExpenseStatus(expense?.status);
    if (status === 'APPROVED') {
      totals.approvedTotal = roundExpenseMoney(totals.approvedTotal + amount);
      totals.approvedCount += 1;
      totals.bySource[source].approved = roundExpenseMoney(totals.bySource[source].approved + amount);
    } else if (status === 'PENDING') {
      totals.pendingTotal = roundExpenseMoney(totals.pendingTotal + amount);
      totals.pendingCount += 1;
      totals.bySource[source].pending = roundExpenseMoney(totals.bySource[source].pending + amount);
    } else {
      totals.rejectedTotal = roundExpenseMoney(totals.rejectedTotal + amount);
      totals.rejectedCount += 1;
      totals.bySource[source].rejected = roundExpenseMoney(totals.bySource[source].rejected + amount);
    }
    return totals;
  }, {
    approvedTotal: 0,
    pendingTotal: 0,
    rejectedTotal: 0,
    approvedCount: 0,
    pendingCount: 0,
    rejectedCount: 0,
    bySource: initialSourceTotals,
  });
}

export function isBundleExpenseProduct(product: ExpenseProductLike | null | undefined): boolean {
  if (!product) return false;
  if (product.isBundle === true || product.isBundle === 1) return true;
  const text = String(product.isBundle ?? '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

export function shopExpenseProductEligibility(
  product: ExpenseProductLike | null | undefined,
  quantityValue: unknown,
): ExpenseProductEligibility {
  if (!product) {
    return { ok: false, amount: 0, stock: 0, unitCost: 0, reason: 'MISSING_PRODUCT', message: 'Select the product being expensed.' };
  }
  const quantity = Math.max(0, expenseNumber(quantityValue));
  const stock = Math.max(0, expenseNumber(product.stockQuantity));
  const unitCost = Math.max(0, expenseNumber(product.costPrice));
  const unit = product.unit || 'pcs';
  const name = product.name || 'selected product';

  if (isBundleExpenseProduct(product)) {
    return { ok: false, amount: 0, stock, unitCost, reason: 'BUNDLE_PRODUCT', message: 'Bundle stock is derived from ingredients and cannot be expensed directly.' };
  }
  if (quantity <= 0) {
    return { ok: false, amount: 0, stock, unitCost, reason: 'INVALID_QUANTITY', message: 'Enter a valid quantity.' };
  }
  if (quantity > stock) {
    return {
      ok: false,
      amount: 0,
      stock,
      unitCost,
      reason: 'INSUFFICIENT_STOCK',
      message: `Only ${stock.toLocaleString()} ${unit} available.`,
    };
  }
  if (unitCost <= 0) {
    return {
      ok: false,
      amount: 0,
      stock,
      unitCost,
      reason: 'MISSING_COST',
      message: `Set a cost price for ${name} before expensing it from stock.`,
    };
  }

  return {
    ok: true,
    amount: roundExpenseMoney(unitCost * quantity),
    stock,
    unitCost,
  };
}
