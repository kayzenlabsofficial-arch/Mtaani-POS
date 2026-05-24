import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  History,
  Landmark,
  Loader2,
  ReceiptText,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import { settleSupplierPayment, type SupplierPaymentInput } from '../../utils/supplierLedger';
import { belongsToActiveShop } from '../../utils/shopScope';
import { getCurrentShiftId, getCurrentShiftStart } from '../../utils/shiftSession';
import { getTodayStartMs } from '../../utils/cashDrawer';
import { MAIN_ACCOUNT_NAME } from '../../utils/financeAccount';

type PaySource = 'TILL' | 'ACCOUNT';
type InvoiceAllocation = { purchaseOrderId: string; amount: number };

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const moneyInput = (value: number) => {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
};
const invoiceDue = (invoice: any) => roundMoney(Math.max(0, Number(invoice.totalAmount || 0) - Number(invoice.paidAmount || 0)));
const invoiceRef = (invoice: any) => invoice.invoiceNumber || invoice.poNumber || invoice.id?.split('-')?.[0]?.toUpperCase() || 'Invoice';
const paymentMethodLabel = (method: string, source?: string) => {
  if (source === 'ACCOUNT' || method === 'BANK') return MAIN_ACCOUNT_NAME;
  if (method === 'CASH') return 'Till cash';
  return method === 'MPESA' ? 'M-Pesa' : method || 'Payment';
};

export default function SupplierPaymentsTabDesktop({ financialAccounts }: { financialAccounts: any[] }) {
  const [paySearch, setPaySearch] = useState('');
  const [activeHistoryTab, setActiveHistoryTab] = useState<'PAYMENTS' | 'CREDITS'>('PAYMENTS');
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [invoiceAmounts, setInvoiceAmounts] = useState<Record<string, string>>({});
  const [selectedCreditNoteIds, setSelectedCreditNoteIds] = useState<string[]>([]);
  const [manualAmount, setManualAmount] = useState('');
  const [paySource, setPaySource] = useState<PaySource>('TILL');
  const [reference, setReference] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { success, error } = useToast();

  const paymentSupplierId = useStore(state => state.paymentSupplierId);
  const setPaymentSupplierId = useStore(state => state.setPaymentSupplierId);
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShift = useStore(state => state.activeShift);
  const currentUser = useStore(state => state.currentUser);
  const pickedAccount = financialAccounts?.[0] || null;

  const allSuppliers = useLiveQuery(
    () => activeBusinessId
      ? db.suppliers.where('businessId').equals(activeBusinessId).filter(s => belongsToActiveShop(s, activeShopId)).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const allPayments = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.supplierPayments.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const allCreditNotes = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.creditNotes.where('shopId').equals(activeShopId).and(cn => cn.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const outstandingInvoices = useLiveQuery(
    () => selectedSupplier && activeBusinessId
      ? db.purchaseOrders
        .where('supplierId')
        .equals(selectedSupplier.id)
        .filter(po => po.businessId === activeBusinessId && po.status === 'RECEIVED' && po.paymentStatus !== 'PAID')
        .toArray()
      : Promise.resolve([]),
    [selectedSupplier?.id, activeBusinessId],
    []
  );
  const pendingCreditNotes = useLiveQuery(
    () => selectedSupplier && activeBusinessId
      ? db.creditNotes
        .where('supplierId')
        .equals(selectedSupplier.id)
        .filter(cn => cn.businessId === activeBusinessId && (!cn.status || cn.status === 'PENDING'))
        .toArray()
      : Promise.resolve([]),
    [selectedSupplier?.id, activeBusinessId],
    []
  );

  useEffect(() => {
    if (!paymentSupplierId || allSuppliers.length === 0) return;
    const supplier = allSuppliers.find(s => s.id === paymentSupplierId);
    if (supplier) setSelectedSupplier(supplier);
    setPaymentSupplierId(null);
  }, [paymentSupplierId, allSuppliers, setPaymentSupplierId]);

  useEffect(() => {
    setSelectedInvoiceIds([]);
    setInvoiceAmounts({});
    setSelectedCreditNoteIds([]);
    setManualAmount('');
    setPaySource('TILL');
    setReference('');
  }, [selectedSupplier?.id]);

  const suppliersOwed = allSuppliers.filter(s => Number(s.balance || 0) > 0);
  const totalDebt = suppliersOwed.reduce((sum, s) => sum + Number(s.balance || 0), 0);
  const pendingCredits = allCreditNotes.filter(cn => !cn.status || cn.status === 'PENDING');
  const totalPendingCredit = pendingCredits.reduce((sum, cn) => sum + Number(cn.amount || 0), 0);
  const filteredOwed = suppliersOwed.filter(s => {
    const needle = paySearch.trim().toLowerCase();
    if (!needle) return true;
    return String(s.company || '').toLowerCase().includes(needle) || String(s.name || '').toLowerCase().includes(needle);
  });
  const sortedPayments = [...allPayments].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  const sortedCredits = [...allCreditNotes].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  const selectedInvoices = useMemo(
    () => outstandingInvoices.filter(invoice => selectedInvoiceIds.includes(invoice.id)),
    [outstandingInvoices, selectedInvoiceIds]
  );
  const selectedCredits = useMemo(
    () => pendingCreditNotes.filter(note => selectedCreditNoteIds.includes(note.id)),
    [pendingCreditNotes, selectedCreditNoteIds]
  );
  const invoiceAllocations = useMemo<InvoiceAllocation[]>(
    () => selectedInvoices
      .map(invoice => ({
        purchaseOrderId: invoice.id,
        amount: roundMoney(Math.max(0, Number(invoiceAmounts[invoice.id] || 0))),
      }))
      .filter(allocation => allocation.amount > 0),
    [selectedInvoices, invoiceAmounts]
  );
  const invoiceTotal = roundMoney(invoiceAllocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const creditTotal = roundMoney(selectedCredits.reduce((sum, note) => sum + Number(note.amount || 0), 0));
  const hasInvoiceSelection = selectedInvoiceIds.length > 0;
  const manualCashAmount = roundMoney(Math.max(0, Number(manualAmount || 0)));
  const cashToPay = hasInvoiceSelection ? roundMoney(Math.max(0, invoiceTotal - creditTotal)) : manualCashAmount;
  const totalDeduction = hasInvoiceSelection ? invoiceTotal : roundMoney(manualCashAmount + creditTotal);
  const hasInvalidInvoiceAmount = selectedInvoices.some(invoice => {
    const amount = Number(invoiceAmounts[invoice.id] || 0);
    return amount < 0 || amount > invoiceDue(invoice) + 0.01;
  });
  const creditExceedsInvoices = hasInvoiceSelection && creditTotal > invoiceTotal + 0.01;
  const balanceExceeded = !!selectedSupplier && totalDeduction > Number(selectedSupplier.balance || 0) + 0.01;
  const canSubmit = !!selectedSupplier
    && !isSaving
    && !!activeBusinessId
    && !!activeShopId
    && totalDeduction > 0
    && !hasInvalidInvoiceAmount
    && !creditExceedsInvoices
    && !balanceExceeded;

  const toggleInvoice = (invoice: any) => {
    const isSelected = selectedInvoiceIds.includes(invoice.id);
    if (isSelected) {
      setSelectedInvoiceIds(prev => prev.filter(id => id !== invoice.id));
      setInvoiceAmounts(prev => {
        const next = { ...prev };
        delete next[invoice.id];
        return next;
      });
      return;
    }
    setSelectedInvoiceIds(prev => [...prev, invoice.id]);
    setInvoiceAmounts(prev => ({ ...prev, [invoice.id]: moneyInput(invoiceDue(invoice)) }));
  };

  const toggleCredit = (creditNoteId: string) => {
    setSelectedCreditNoteIds(prev => (
      prev.includes(creditNoteId)
        ? prev.filter(id => id !== creditNoteId)
        : [...prev, creditNoteId]
    ));
  };

  const handleProcessPayment = async () => {
    if (!selectedSupplier || !canSubmit || isSaving) return;

    setIsSaving(true);
    try {
      const cleanReference = reference.trim();
      const generatedReference = hasInvoiceSelection
        ? `Payment for ${selectedInvoiceIds.length} invoice${selectedInvoiceIds.length === 1 ? '' : 's'}`
        : 'Supplier payment';
      const payment: SupplierPaymentInput = {
        amount: cashToPay,
        method: paySource === 'ACCOUNT' ? 'BANK' : 'CASH',
        reference: cleanReference || generatedReference,
        transactionCode: cleanReference || undefined,
        source: paySource,
        accountId: paySource === 'ACCOUNT' ? pickedAccount?.id : undefined,
        purchaseOrderIds: invoiceAllocations.length ? invoiceAllocations.map(allocation => allocation.purchaseOrderId) : undefined,
        invoiceAllocations: invoiceAllocations.length ? invoiceAllocations : undefined,
        creditNoteIds: selectedCreditNoteIds.length ? selectedCreditNoteIds : undefined,
      };

      await settleSupplierPayment({
        supplier: selectedSupplier,
        payment,
        activeShopId,
        activeBusinessId,
        preparedBy: currentUser?.name || 'Staff',
        shiftId: getCurrentShiftId(activeShift, activeShopId, currentUser?.id),
        shiftStart: getCurrentShiftStart(activeShift, getTodayStartMs()),
      });

      success('Supplier payment recorded.');
      setSelectedSupplier(null);
    } catch (err: any) {
      error(err?.message ? `Failed to save payment: ${err.message}` : 'Failed to save payment.');
    } finally {
      setIsSaving(false);
    }
  };

  const methodIcon = (method: string, source?: string) => (
    source === 'ACCOUNT' || method === 'BANK' ? <Landmark size={18} /> : <Banknote size={18} />
  );

  if (selectedSupplier) {
    return (
      <div className="w-full animate-in fade-in pb-28">
        <div className="mb-4 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <button
            type="button"
            onClick={() => setSelectedSupplier(null)}
            className="mb-4 flex h-10 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 text-xs font-black text-slate-700 hover:border-blue-300 hover:bg-blue-50"
          >
            <ArrowLeft size={16} /> Back
          </button>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Process supplier payment</p>
              <h2 className="mt-1 stable-title text-2xl font-black text-slate-950">{selectedSupplier.company}</h2>
              <p className="mt-1 stable-title text-sm font-semibold text-slate-600">{selectedSupplier.name || 'Supplier'} {selectedSupplier.phone ? `/ ${selectedSupplier.phone}` : ''}</p>
            </div>
            <div className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 md:min-w-48 md:text-right">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Balance due</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{money(selectedSupplier.balance)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <section className="rounded-lg border-2 border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-black text-slate-950">
                    <ReceiptText size={18} className="text-blue-700" /> Unpaid invoices
                  </h3>
                  <p className="text-[11px] font-semibold text-slate-500">Select what this payment should clear</p>
                </div>
                <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600">{outstandingInvoices.length}</span>
              </div>
              <div className="divide-y divide-slate-200">
                {outstandingInvoices.length > 0 ? outstandingInvoices.map(invoice => {
                  const due = invoiceDue(invoice);
                  const isSelected = selectedInvoiceIds.includes(invoice.id);
                  const enteredAmount = Number(invoiceAmounts[invoice.id] || 0);
                  const invalidAmount = isSelected && (enteredAmount < 0 || enteredAmount > due + 0.01);
                  return (
                    <div key={invoice.id} className={`p-4 transition-colors sm:p-5 ${isSelected ? 'bg-blue-50/60' : 'bg-white'}`}>
                      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleInvoice(invoice)}
                          className="mt-1 h-5 w-5 rounded border-2 border-slate-300 text-blue-700 focus:ring-blue-600 sm:mt-0"
                        />
                        <button type="button" onClick={() => toggleInvoice(invoice)} className="min-w-0 text-left">
                          <p className="stable-title text-sm font-black text-slate-950">{invoiceRef(invoice)}</p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500">
                            {new Date(Number(invoice.receivedDate || invoice.orderDate || Date.now())).toLocaleDateString()} / Due {money(due)}
                          </p>
                        </button>
                        <p className="col-span-2 text-left text-sm font-black tabular-nums text-slate-950 sm:col-span-1 sm:text-right">{money(due)}</p>
                      </div>

                      {isSelected && (
                        <div className="mt-3 grid gap-2 pl-8 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                          <input
                            type="number"
                            min="0"
                            max={due}
                            step="0.01"
                            value={invoiceAmounts[invoice.id] || ''}
                            onChange={event => setInvoiceAmounts(prev => ({ ...prev, [invoice.id]: event.target.value }))}
                            className={`h-11 rounded-lg border-2 bg-white px-3 text-sm font-bold tabular-nums text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${invalidAmount ? 'border-rose-400' : 'border-slate-300'}`}
                          />
                          <button type="button" onClick={() => setInvoiceAmounts(prev => ({ ...prev, [invoice.id]: moneyInput(due / 2) }))} className="h-11 rounded-lg border-2 border-slate-200 bg-white px-4 text-xs font-black text-slate-700">
                            Half
                          </button>
                          <button type="button" onClick={() => setInvoiceAmounts(prev => ({ ...prev, [invoice.id]: moneyInput(due) }))} className="h-11 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-xs font-black text-white">
                            Full
                          </button>
                          {invalidAmount && <p className="text-[11px] font-bold text-rose-600 sm:col-span-3">Amount cannot be above the invoice balance.</p>}
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  <div className="p-10 text-center">
                    <FileText size={36} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-bold text-slate-500">No unpaid invoices</p>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-lg border-2 border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
                <div>
                  <h3 className="flex items-center gap-2 text-base font-black text-slate-950">
                    <ArrowUpRight size={18} className="text-blue-700" /> Credits
                  </h3>
                  <p className="text-[11px] font-semibold text-slate-500">Apply returns or supplier credits</p>
                </div>
                <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600">{pendingCreditNotes.length}</span>
              </div>
              <div className="divide-y divide-slate-200">
                {pendingCreditNotes.length > 0 ? pendingCreditNotes.map(note => {
                  const isSelected = selectedCreditNoteIds.includes(note.id);
                  return (
                    <label key={note.id} className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 transition-colors sm:p-5 ${isSelected ? 'bg-blue-50/60' : 'bg-white'}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleCredit(note.id)}
                        className="h-5 w-5 rounded border-2 border-slate-300 text-blue-700 focus:ring-blue-600"
                      />
                      <span className="min-w-0">
                        <span className="stable-title block text-sm font-black text-slate-950">{note.reference || 'Credit note'}</span>
                        <span className="stable-title mt-1 block text-[11px] font-semibold text-slate-500">{note.reason || new Date(Number(note.timestamp || Date.now())).toLocaleDateString()}</span>
                      </span>
                      <span className="text-sm font-black tabular-nums text-slate-950">-{money(note.amount)}</span>
                    </label>
                  );
                }) : (
                  <div className="p-8 text-center">
                    <CheckCircle2 size={32} className="mx-auto mb-3 text-slate-300" />
                    <p className="text-sm font-bold text-slate-500">No pending credits</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="h-fit rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4 sm:p-5">
            <h3 className="text-base font-black text-slate-950">Payment summary</h3>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Invoices</span>
                <span className="text-sm font-black tabular-nums text-slate-950">{money(invoiceTotal)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Credits</span>
                <span className="text-sm font-black tabular-nums text-slate-950">-{money(creditTotal)}</span>
              </div>
              {!hasInvoiceSelection && (
                <div>
                  <label className="mb-2 mt-4 block text-[10px] font-black uppercase tracking-widest text-slate-500">Amount to pay</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={manualAmount}
                    onChange={event => setManualAmount(event.target.value)}
                    className="h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-4 text-lg font-black tabular-nums text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    placeholder="0"
                  />
                </div>
              )}
              <div className="rounded-lg border-2 border-slate-900 bg-slate-950 px-4 py-4 text-white">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">Net amount to pay</p>
                <p className="mt-1 text-3xl font-black tabular-nums">{money(cashToPay)}</p>
                <p className="mt-2 text-[11px] font-bold text-blue-100">Balance reduction: {money(totalDeduction)}</p>
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Pay from</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaySource('TILL')}
                  className={`h-12 rounded-lg border-2 px-2 text-xs font-black ${paySource === 'TILL' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  <Wallet size={16} className="mx-auto mb-0.5" /> Till cash
                </button>
                <button
                  type="button"
                  onClick={() => setPaySource('ACCOUNT')}
                  className={`h-12 rounded-lg border-2 px-2 text-xs font-black ${paySource === 'ACCOUNT' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                >
                  <Landmark size={16} className="mx-auto mb-0.5" /> Main account
                </button>
              </div>
              {paySource === 'ACCOUNT' && (
                <div className="mt-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{MAIN_ACCOUNT_NAME}</p>
                  <p className="mt-1 text-sm font-black tabular-nums text-slate-950">{money(pickedAccount?.balance)}</p>
                </div>
              )}
            </div>

            <div className="mt-5">
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Reference</label>
              <input
                type="text"
                value={reference}
                onChange={event => setReference(event.target.value)}
                className="h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                placeholder="Receipt, cheque, or note"
              />
            </div>

            {(creditExceedsInvoices || hasInvalidInvoiceAmount || balanceExceeded) && (
              <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">
                {creditExceedsInvoices && 'Credits cannot be more than the selected invoice amounts.'}
                {hasInvalidInvoiceAmount && 'Check invoice allocation amounts.'}
                {balanceExceeded && 'This payment is more than the supplier balance.'}
              </div>
            )}

            <div className="sticky bottom-0 mt-5 bg-white pt-3 pb-safe lg:static lg:pb-0">
              <button
                type="button"
                onClick={handleProcessPayment}
                disabled={!canSubmit}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white transition-colors hover:bg-blue-800 disabled:border-slate-300 disabled:bg-slate-300 disabled:text-white"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                {isSaving ? 'Processing' : 'Process payment'}
              </button>
            </div>
          </aside>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in pb-24">
      <div className="mb-4 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Money out</p>
        <h2 className="mt-1 text-2xl font-black text-slate-950">Supplier payments</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">To pay</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-950">{money(totalDebt)}</p>
          </div>
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Credits</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-950">{money(totalPendingCredit)}</p>
          </div>
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Suppliers</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-950">{suppliersOwed.length}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-lg border-2 border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h3 className="text-base font-black text-slate-950">Suppliers to pay</h3>
              <p className="text-[11px] font-semibold text-slate-500">Choose a supplier to start payment</p>
            </div>
            <div className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Search supplier..."
                value={paySearch}
                onChange={event => setPaySearch(event.target.value)}
                className="h-11 w-full rounded-lg border-2 border-slate-300 bg-white pl-9 pr-9 text-sm font-bold text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              {paySearch && (
                <button type="button" onClick={() => setPaySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="divide-y divide-slate-200">
            {filteredOwed.length > 0 ? filteredOwed.map(supplier => (
              <div key={supplier.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 sm:p-5">
                <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
                    <Building2 size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="stable-title text-sm font-black text-slate-950">{supplier.company}</p>
                    <p className="stable-title mt-1 text-[11px] font-semibold text-slate-500">{supplier.name || 'Supplier'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="hidden text-right sm:block">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Due</p>
                    <p className="text-sm font-black tabular-nums text-slate-950">{money(supplier.balance)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedSupplier(supplier)}
                    className="h-10 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-xs font-black text-white hover:bg-blue-800"
                  >
                    Pay
                  </button>
                </div>
              </div>
            )) : (
              <div className="p-12 text-center">
                <CheckCircle2 size={40} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-500">No supplier debt</p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border-2 border-slate-200 bg-white shadow-sm">
          <div className="flex border-b border-slate-200 bg-slate-50 p-1.5">
            {(['PAYMENTS', 'CREDITS'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveHistoryTab(tab)}
                className={`h-10 flex-1 rounded-md text-xs font-black ${activeHistoryTab === tab ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
              >
                {tab === 'PAYMENTS' ? 'Payments' : `Credits ${pendingCredits.length ? `(${pendingCredits.length})` : ''}`}
              </button>
            ))}
          </div>
          <div className="max-h-[620px] space-y-2 overflow-y-auto p-3">
            {activeHistoryTab === 'PAYMENTS' ? sortedPayments.map(payment => {
              const supplier = allSuppliers.find(s => s.id === payment.supplierId);
              return (
                <div key={payment.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
                    {methodIcon(payment.paymentMethod, payment.source)}
                  </span>
                  <div className="min-w-0">
                    <p className="stable-title text-[12px] font-black text-slate-950">{supplier?.company || 'Unknown supplier'}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">{new Date(Number(payment.timestamp || Date.now())).toLocaleDateString()} / {paymentMethodLabel(payment.paymentMethod, payment.source)}</p>
                  </div>
                  <p className="text-right text-xs font-black tabular-nums text-slate-950">{money(payment.amount)}</p>
                </div>
              );
            }) : sortedCredits.map(credit => {
              const supplier = allSuppliers.find(s => s.id === credit.supplierId);
              return (
                <div key={credit.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
                    <ArrowUpRight size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="stable-title text-[12px] font-black text-slate-950">{supplier?.company || 'Unknown supplier'}</p>
                    <p className="mt-1 text-[10px] font-bold text-slate-500">{credit.status || 'Pending'}</p>
                  </div>
                  <p className="text-right text-xs font-black tabular-nums text-slate-950">{money(credit.amount)}</p>
                </div>
              );
            })}

            {(activeHistoryTab === 'PAYMENTS' ? sortedPayments : sortedCredits).length === 0 && (
              <div className="p-10 text-center">
                <History size={36} className="mx-auto mb-3 text-slate-300" />
                <p className="text-sm font-bold text-slate-500">No records found</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
