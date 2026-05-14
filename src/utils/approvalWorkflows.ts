import { db, type Expense, type Transaction } from '../db';

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
  if (expense.source === 'ACCOUNT' && expense.accountId) {
    const account = await db.financialAccounts.get(expense.accountId);
    if (!account) throw new Error('Selected payment account was not found.');
    if ((account.balance || 0) < (Number(expense.amount) || 0)) {
      throw new Error(`Insufficient funds in ${account.name}.`);
    }
    await db.financialAccounts.update(account.id, {
      balance: (account.balance || 0) - (Number(expense.amount) || 0),
      updated_at: Date.now()
    });
  }

  if (expense.source === 'SHOP' && (expense as any).productId) {
    const product = await db.products.get((expense as any).productId);
    if (!product) throw new Error('Selected shop item was not found.');

    const qty = Number((expense as any).quantity) || 1;
    await db.products.update(product.id, {
      stockQuantity: Math.max(0, (product.stockQuantity || 0) - qty)
    });
    await db.stockMovements.add({
      id: crypto.randomUUID(),
      productId: product.id,
      type: 'OUT',
      quantity: -qty,
      timestamp: Date.now(),
      reference: `Expense: ${expense.description || 'Shop Use'}`,
      branchId: context.activeBranchId,
      businessId: context.activeBusinessId,
      shiftId: expense.shiftId
    });
  }
}

export async function approveExpenseRequest(expense: Expense, context: ApprovalContext): Promise<void> {
  const freshExpense = await db.expenses.get(expense.id);
  if (!freshExpense || freshExpense.status !== 'PENDING') {
    throw new Error('This expense has already been processed.');
  }

  await ensureExpenseCanBeApproved(freshExpense);
  await db.expenses.update(freshExpense.id, {
    status: 'APPROVED',
    approvedBy: context.approvedBy
  });

  try {
    await applyApprovedExpenseEffects(freshExpense, context);
  } catch (err) {
    await db.expenses.update(freshExpense.id, { status: 'PENDING', approvedBy: undefined });
    throw err;
  }
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
  const lines = refundLinesFor(transaction, itemsToReturn);
  await db.transactions.update(transaction.id, {
    status: 'PENDING_REFUND',
    pendingRefundItems: lines.length ? lines : undefined
  });
}

export async function approveRefundTransaction(
  transaction: Transaction,
  itemsToReturn: RefundLine[] | undefined,
  context: ApprovalContext
): Promise<void> {
  const lines = refundLinesFor(transaction, itemsToReturn);
  if (lines.length === 0) throw new Error('No refundable items selected.');

  const refundAmount = refundAmountFor(transaction, lines);

  if (transaction.paymentMethod === 'CASH' && transaction.branchId) {
    const cashAccount = await db.financialAccounts.where('branchId').equals(transaction.branchId)
      .and(acc => acc.type === 'CASH')
      .first();
    if (cashAccount) {
      await db.financialAccounts.update(cashAccount.id, {
        balance: (cashAccount.balance || 0) - refundAmount,
        updated_at: Date.now()
      });
    }
  }

  const updatedItems = transaction.items.map(item => ({ ...item }));
  for (const line of lines) {
    const product = await db.products.get(line.productId);
    if (product) {
      await db.products.update(line.productId, {
        stockQuantity: (product.stockQuantity || 0) + line.quantity
      });
      await db.stockMovements.add({
        id: crypto.randomUUID(),
        productId: line.productId,
        type: 'RETURN',
        quantity: line.quantity,
        timestamp: Date.now(),
        reference: `Return #${transaction.id.split('-')[0].toUpperCase()}`,
        branchId: context.activeBranchId,
        businessId: context.activeBusinessId,
        shiftId: transaction.shiftId
      });
    }

    const txItem = updatedItems.find(item => item.productId === line.productId);
    if (txItem) txItem.returnedQuantity = (txItem.returnedQuantity || 0) + line.quantity;
  }

  const allReturned = updatedItems.every(item => (item.returnedQuantity || 0) >= item.quantity);
  await db.transactions.update(transaction.id, {
    status: allReturned ? 'REFUNDED' : 'PARTIAL_REFUND',
    items: updatedItems,
    pendingRefundItems: undefined,
    approvedBy: context.approvedBy
  });
}
