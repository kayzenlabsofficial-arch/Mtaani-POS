import { db, type Expense, type Transaction } from '../db';
import { ExpenseService } from '../services/expenses';
import { SalesService } from '../services/sales';

interface ApprovalContext {
  approvedBy: string;
  activeBranchId: string;
  activeBusinessId: string;
}

type RefundLine = { productId: string; quantity: number };

export async function ensureExpenseCanBeApproved(expense: Expense): Promise<void> {
  if (expense.source === 'ACCOUNT') {
    if (!expense.accountId) throw new Error('Select the account paying this expense.');
    const account = await db.financialAccounts.get(expense.accountId);
    if (!account) throw new Error('Selected payment account was not found.');
    if ((account.balance || 0) < (Number(expense.amount) || 0)) {
      throw new Error(`Insufficient funds in ${account.name}.`);
    }
  }

  if (expense.source === 'SHOP') {
    if (!(expense as any).productId) throw new Error('Select the stock item being expensed.');
    const product = await db.products.get((expense as any).productId);
    if (!product) throw new Error('Selected shop item was not found.');
  }
}

export async function applyApprovedExpenseEffects(expense: Expense, context: ApprovalContext): Promise<void> {
  await ExpenseService.approve({
    expenseId: expense.id,
    businessId: context.activeBusinessId,
    branchId: context.activeBranchId,
    approvedBy: context.approvedBy,
  });
  await Promise.allSettled([
    db.expenses.reload(),
    db.financialAccounts.reload(),
    db.products.reload(),
    db.stockMovements.reload(),
  ]);
}

export async function submitExpenseRecord(expense: Expense | any): Promise<void> {
  await ExpenseService.submit(expense);
  await Promise.allSettled([
    db.expenses.reload(),
    db.financialAccounts.reload(),
    db.products.reload(),
    db.stockMovements.reload(),
  ]);
}

export async function approveExpenseRequest(expense: Expense, context: ApprovalContext): Promise<void> {
  await ExpenseService.approve({
    expenseId: expense.id,
    businessId: context.activeBusinessId,
    branchId: context.activeBranchId,
    approvedBy: context.approvedBy,
  });
  await Promise.allSettled([
    db.expenses.reload(),
    db.financialAccounts.reload(),
    db.products.reload(),
    db.stockMovements.reload(),
  ]);
}

function refundLinesFor(transaction: Transaction, itemsToReturn?: RefundLine[]): RefundLine[] {
  const lines = itemsToReturn?.length
    ? itemsToReturn
    : transaction.pendingRefundItems?.length
      ? transaction.pendingRefundItems
      : transaction.items.map(item => ({
          productId: item.productId,
          quantity: Math.max(0, item.quantity - (item.returnedQuantity || 0))
        }));

  return lines
    .map(line => ({
      productId: line.productId,
      quantity: Math.max(0, Number(line.quantity) || 0)
    }))
    .filter(line => line.quantity > 0);
}

function refundAmountFor(transaction: Transaction, lines: RefundLine[]): number {
  const amount = lines.reduce((sum, line) => {
    const item = transaction.items.find(row => row.productId === line.productId);
    return sum + ((item?.snapshotPrice || 0) * line.quantity);
  }, 0);

  return Math.min(transaction.total || 0, amount || transaction.total || 0);
}

export async function requestRefundApproval(
  transaction: Transaction,
  itemsToReturn?: RefundLine[]
): Promise<void> {
  await SalesService.requestRefund({
    transactionId: transaction.id,
    businessId: transaction.businessId,
    branchId: transaction.branchId,
    itemsToReturn,
  });
  await db.transactions.reload();
}

export async function approveRefundTransaction(
  transaction: Transaction,
  itemsToReturn: RefundLine[] | undefined,
  context: ApprovalContext
): Promise<void> {
  await SalesService.approveRefund({
    transactionId: transaction.id,
    businessId: context.activeBusinessId,
    branchId: context.activeBranchId,
    itemsToReturn,
    approvedBy: context.approvedBy,
  });
  await Promise.allSettled([
    db.transactions.reload(),
    db.financialAccounts.reload(),
    db.products.reload(),
    db.stockMovements.reload(),
  ]);
}
