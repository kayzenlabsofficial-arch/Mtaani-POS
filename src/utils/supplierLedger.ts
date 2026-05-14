import { db, type Supplier, type SupplierPayment } from '../db';
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

  const paymentId = crypto.randomUUID();
  const paymentRecord: SupplierPayment = {
    id: paymentId,
    supplierId: freshSupplier.id,
    purchaseOrderIds: payment.purchaseOrderIds,
    creditNoteIds: payment.creditNoteIds,
    amount: cashAmount,
    paymentMethod: payment.method,
    transactionCode: payment.transactionCode,
    reference: payment.reference || 'Supplier payment',
    source: payment.source,
    accountId: payment.source === 'ACCOUNT' ? payment.accountId : undefined,
    timestamp: Date.now(),
    preparedBy,
    branchId: activeBranchId,
    businessId: activeBusinessId,
    shiftId,
  };

  await db.supplierPayments.add(paymentRecord);

  for (const cn of creditNotes) {
    await db.creditNotes.update(cn.id, {
      status: 'ALLOCATED',
      allocatedTo: paymentId,
      updated_at: Date.now(),
    });
  }

  let invoicesToAllocate = [];
  if (payment.purchaseOrderIds?.length) {
    for (const poId of payment.purchaseOrderIds) {
      const po = await db.purchaseOrders.get(poId);
      if (po && po.supplierId === freshSupplier.id && po.status === 'RECEIVED' && po.paymentStatus !== 'PAID') {
        invoicesToAllocate.push(po);
      }
    }
  } else {
    invoicesToAllocate = await db.purchaseOrders
      .where('supplierId').equals(freshSupplier.id)
      .filter(po => po.status === 'RECEIVED' && po.paymentStatus !== 'PAID')
      .toArray();
    invoicesToAllocate.sort((a, b) => (a.receivedDate || a.orderDate || 0) - (b.receivedDate || b.orderDate || 0));
  }

  let remainingPool = totalDeduction;
  for (const inv of invoicesToAllocate) {
    if (remainingPool <= 0) break;
    const due = Math.max(0, Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0));
    const paymentForThisInv = Math.min(due, remainingPool);
    const newPaidAmount = Number(inv.paidAmount || 0) + paymentForThisInv;
    await db.purchaseOrders.update(inv.id, {
      paidAmount: newPaidAmount,
      paymentStatus: newPaidAmount >= Number(inv.totalAmount || 0) - 0.01 ? 'PAID' : 'PARTIAL',
      updated_at: Date.now(),
    });
    remainingPool -= paymentForThisInv;
  }

  await db.suppliers.update(freshSupplier.id, {
    balance: Math.max(0, Number(freshSupplier.balance || 0) - totalDeduction),
    updated_at: Date.now(),
  });

  if (payment.source === 'ACCOUNT' && payment.accountId && cashAmount > 0) {
    const account = await db.financialAccounts.get(payment.accountId);
    if (account) {
      await db.financialAccounts.update(account.id, {
        balance: Number(account.balance || 0) - cashAmount,
        updated_at: Date.now(),
      });
    }
  }

  return {
    paymentId,
    cashAmount,
    creditTotal,
    totalDeduction,
    allocatedInvoiceCount: invoicesToAllocate.length,
  };
}
