import { db, type Supplier } from '../db';
import { SupplierService } from '../services/suppliers';
import { calculateShiftCashFromSales, getTodayStartMs } from './cashDrawer';
import { reloadBestEffort } from './reloads';

export type SupplierPaymentInput = {
  amount: number;
  method: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE';
  reference: string;
  source: 'TILL' | 'ACCOUNT';
  accountId?: string;
  transactionCode?: string;
  purchaseOrderIds?: string[];
  invoiceAllocations?: { purchaseOrderId: string; amount: number }[];
  creditNoteIds?: string[];
};

export async function settleSupplierPayment({
  supplier,
  payment,
  activeBranchId,
  activeBusinessId,
  preparedBy,
  shiftId,
  shiftStart,
}: {
  supplier: Supplier;
  payment: SupplierPaymentInput;
  activeBranchId: string;
  activeBusinessId: string;
  preparedBy: string;
  shiftId?: string;
  shiftStart?: number;
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
    const drawer = calculateShiftCashFromSales({
      transactions,
      expenses,
      cashPicks,
      supplierPayments,
      shiftId,
      since: shiftStart || getTodayStartMs(),
    }).availableCashSales;
    if (cashAmount > drawer) {
      throw new Error(`Insufficient cash sales in this shift. Available: Ksh ${Math.max(0, drawer).toLocaleString()}.`);
    }
  }

  const creditNotes = [];
  for (const cnId of payment.creditNoteIds || []) {
    const cn = await db.creditNotes.get(cnId);
    if (!cn || cn.supplierId !== freshSupplier.id || (cn.status && cn.status !== 'PENDING')) continue;
    creditNotes.push(cn);
  }

  const creditTotal = creditNotes.reduce((sum, cn) => sum + Number(cn.amount || 0), 0);
  const invoiceAllocationTotal = (payment.invoiceAllocations || []).reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
  if (invoiceAllocationTotal > 0) {
    if (creditTotal > invoiceAllocationTotal + 0.01) {
      throw new Error('Selected credits exceed the invoice amounts.');
    }
    const expectedCashAmount = Math.round(Math.max(0, invoiceAllocationTotal - creditTotal) * 100) / 100;
    if (Math.abs(cashAmount - expectedCashAmount) > 0.01) {
      throw new Error(`Cash amount must be Ksh ${expectedCashAmount.toLocaleString()} for the selected invoices.`);
    }
  }
  const totalDeduction = invoiceAllocationTotal > 0 ? invoiceAllocationTotal : cashAmount + creditTotal;
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

  await reloadBestEffort([
    () => db.supplierPayments.reload(),
    () => db.creditNotes.reload(),
    () => db.purchaseOrders.reload(),
    () => db.suppliers.reload(),
    () => db.financialAccounts.reload(),
  ]);

  return result;
}
