import { db, type Supplier } from '../db';
import { SupplierService } from '../services/suppliers';
import { calculateCashDrawer, getTodayStartMs } from './cashDrawer';

export type SupplierPaymentInput = {
  amount: number;
  method: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE';
  reference: string;
  source: 'TILL' | 'ACCOUNT';
  accountId?: string;
  transactionCode?: string;
  purchaseOrderIds?: string[];
  creditNoteIds?: string[];
};

export async function settleSupplierPayment({
  supplier,
  payment,
  activeBranchId,
  activeBusinessId,
  preparedBy,
  shiftId,
}: {
  supplier: Supplier;
  payment: SupplierPaymentInput;
  activeBranchId: string;
  activeBusinessId: string;
  preparedBy: string;
  shiftId?: string;
}) {
  const cashAmount = Number(payment.amount || 0);
  if (cashAmount < 0) throw new Error('Payment amount cannot be negative.');
  if (!activeBranchId || !activeBusinessId) throw new Error('Branch and business are required.');

  const freshSupplier = await db.suppliers.get(supplier.id);
  if (!freshSupplier) throw new Error('Supplier was not found.');

  if (payment.source === 'ACCOUNT' && cashAmount > 0) {
    if (!payment.accountId) throw new Error('Select the funding account.');
    const account = await db.financialAccounts.get(payment.accountId);
    if (!account) throw new Error('Selected account was not found.');
    if ((account.balance || 0) < cashAmount) {
      throw new Error(`Insufficient funds in "${account.name}". Balance: Ksh ${(account.balance || 0).toLocaleString()}`);
    }
  }

  if (payment.source === 'TILL' && cashAmount > 0) {
    const [transactions, expenses, cashPicks, supplierPayments] = await Promise.all([
      db.transactions.where('branchId').equals(activeBranchId).toArray(),
      db.expenses.where('branchId').equals(activeBranchId).toArray(),
      db.cashPicks.where('branchId').equals(activeBranchId).toArray(),
      db.supplierPayments.where('branchId').equals(activeBranchId).toArray(),
    ]);
    const drawer = calculateCashDrawer({
      transactions,
      expenses,
      cashPicks,
      supplierPayments,
      since: getTodayStartMs(),
    }).actualCashDrawer;
    if (cashAmount > drawer) {
      throw new Error(`Insufficient till cash. Drawer has Ksh ${Math.max(0, drawer).toLocaleString()}.`);
    }
  }

  const creditNotes = [];
  for (const cnId of payment.creditNoteIds || []) {
    const cn = await db.creditNotes.get(cnId);
    if (!cn || cn.supplierId !== freshSupplier.id || (cn.status && cn.status !== 'PENDING')) continue;
    creditNotes.push(cn);
  }

  const creditTotal = creditNotes.reduce((sum, cn) => sum + Number(cn.amount || 0), 0);
  const totalDeduction = cashAmount + creditTotal;
  if (totalDeduction <= 0) throw new Error('Select an invoice, credit note, or enter an amount.');
  if (totalDeduction > (freshSupplier.balance || 0) + 0.01) {
    throw new Error(`Payment exceeds supplier balance by Ksh ${(totalDeduction - (freshSupplier.balance || 0)).toLocaleString()}.`);
  }

  const result = await SupplierService.settlePayment({
    supplier: freshSupplier,
    payment,
    activeBranchId,
    activeBusinessId,
    preparedBy,
    shiftId,
  });

  await Promise.allSettled([
    db.supplierPayments.reload(),
    db.creditNotes.reload(),
    db.purchaseOrders.reload(),
    db.suppliers.reload(),
    db.financialAccounts.reload(),
  ]);

  return result;
}
