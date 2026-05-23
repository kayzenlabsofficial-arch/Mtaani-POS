import React, { useState, useEffect } from 'react';
import { DollarSign, Save, X, Wallet, Landmark, Loader2, CheckCircle2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { PICKED_CASH_ACCOUNT_NAME } from '../../utils/financeAccount';

type InvoiceAllocation = { purchaseOrderId: string; amount: number };

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const moneyInput = (value: number) => {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
};

interface SupplierPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier: Supplier | null;
  onSave: (payment: { amount: number, method: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE', reference: string, source: 'TILL' | 'ACCOUNT', accountId?: string, transactionCode?: string, purchaseOrderIds?: string[], invoiceAllocations?: InvoiceAllocation[], creditNoteIds?: string[] }) => Promise<void>;
  financialAccounts: any[];
  shiftId?: string;
}

export default function SupplierPaymentModal({ isOpen, onClose, supplier, onSave, financialAccounts }: SupplierPaymentModalProps) {
  const pickedAccount = financialAccounts?.[0] || null;
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    reference: '',
    transactionCode: '',
    purchaseOrderId: '',
    source: 'TILL' as 'TILL' | 'ACCOUNT',
    accountId: ''
  });
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [invoiceAmounts, setInvoiceAmounts] = useState<Record<string, string>>({});
  const [selectedCreditNoteIds, setSelectedCreditNoteIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch outstanding invoices for this supplier
  const outstandingInvoices = useLiveQuery(
    () => supplier ? db.purchaseOrders
      .where('supplierId').equals(supplier.id)
      .filter(po => po.status === 'RECEIVED' && po.paymentStatus !== 'PAID').toArray() : [],
    [supplier]
  ) || [];

  const pendingCreditNotes = useLiveQuery(
    () => supplier ? db.creditNotes
      .where('supplierId').equals(supplier.id)
      .filter(cn => !cn.status || cn.status === 'PENDING').toArray() : [],
    [supplier]
  ) || [];

  const invoiceDue = (inv: any) => roundMoney(Math.max(0, Number(inv.totalAmount || 0) - Number(inv.paidAmount || 0)));
  const selectedInvoices = React.useMemo(
    () => outstandingInvoices.filter(inv => selectedInvoiceIds.includes(inv.id)),
    [outstandingInvoices, selectedInvoiceIds]
  );
  const selectedCreditNotes = React.useMemo(
    () => pendingCreditNotes.filter(cn => selectedCreditNoteIds.includes(cn.id)),
    [pendingCreditNotes, selectedCreditNoteIds]
  );
  const invoiceAllocations = React.useMemo<InvoiceAllocation[]>(
    () => selectedInvoices
      .map(inv => ({
        purchaseOrderId: inv.id,
        amount: roundMoney(Math.max(0, Number(invoiceAmounts[inv.id] || 0))),
      }))
      .filter(allocation => allocation.amount > 0),
    [selectedInvoices, invoiceAmounts]
  );
  const invoiceAllocationTotal = roundMoney(invoiceAllocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const creditTotal = roundMoney(selectedCreditNotes.reduce((sum, cn) => sum + Number(cn.amount || 0), 0));
  const calculatedCashAmount = roundMoney(Math.max(0, invoiceAllocationTotal - creditTotal));
  const hasInvoiceSelection = selectedInvoiceIds.length > 0;
  const hasAllocationSelection = hasInvoiceSelection || selectedCreditNoteIds.length > 0;
  const hasInvalidInvoiceAmount = selectedInvoices.some(inv => {
    const amount = Number(invoiceAmounts[inv.id] || 0);
    return amount < 0 || amount > invoiceDue(inv) + 0.01;
  });
  const creditExceedsInvoices = hasInvoiceSelection && creditTotal > invoiceAllocationTotal + 0.01;

  useEffect(() => {
    const invRefs = selectedInvoices.map(inv => inv.invoiceNumber || inv.id.split('-')[0].toUpperCase());
    const cnRefs = selectedCreditNotes.map(cn => cn.reference || 'CR');
    
    let refStr = "";
    if (invRefs.length > 0) refStr += `Payment for ${invRefs.length} bill(s)`;
    if (cnRefs.length > 0) refStr += (refStr ? ' | ' : '') + `Less Credit: ${cnRefs.join(', ')}`;

    if (!hasAllocationSelection) {
      setPaymentForm(prev => prev.reference ? { ...prev, amount: '', reference: '' } : prev);
      return;
    }
    
    setPaymentForm(prev => ({ 
        ...prev, 
        amount: moneyInput(calculatedCashAmount), 
        reference: refStr 
    }));
  }, [selectedInvoices, selectedCreditNotes, calculatedCashAmount, hasAllocationSelection]);

  useEffect(() => {
    if (!isOpen) return;
    setPaymentForm({
      amount: '',
      reference: '',
      transactionCode: '',
      purchaseOrderId: '',
      source: 'TILL',
      accountId: ''
    });
    setSelectedInvoiceIds([]);
    setInvoiceAmounts({});
    setSelectedCreditNoteIds([]);
  }, [isOpen, supplier?.id]);

  useEffect(() => {
    if (!isOpen || paymentForm.source !== 'ACCOUNT' || paymentForm.accountId || !pickedAccount?.id) return;
    setPaymentForm(prev => ({ ...prev, accountId: pickedAccount.id }));
  }, [isOpen, paymentForm.source, paymentForm.accountId, pickedAccount?.id]);

  const toggleInvoice = (id: string) => {
    const invoice = outstandingInvoices.find(inv => inv.id === id);
    if (selectedInvoiceIds.includes(id)) {
      setSelectedInvoiceIds(prev => prev.filter(i => i !== id));
      setInvoiceAmounts(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setSelectedInvoiceIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setInvoiceAmounts(current => ({ ...current, [id]: moneyInput(invoice ? invoiceDue(invoice) : 0) }));
  };

  const setInvoiceAmount = (id: string, value: string) => {
    setInvoiceAmounts(prev => ({ ...prev, [id]: value }));
  };

  const setInvoiceQuickAmount = (id: string, amount: number) => {
    setInvoiceAmounts(prev => ({ ...prev, [id]: moneyInput(amount) }));
  };

  const toggleCreditNote = (id: string) => {
    setSelectedCreditNoteIds(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  if (!isOpen || !supplier) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = roundMoney(Number(paymentForm.amount || 0));
    // Allow zero amount if credit notes cover the full invoice
    if (amount < 0 || isSaving) return;
    if (hasInvoiceSelection && invoiceAllocations.length === 0) return;
    if (hasInvalidInvoiceAmount || creditExceedsInvoices) return;
    
    setIsSaving(true);
    try {
      await onSave({
        amount,
        method: 'CASH',
        reference: paymentForm.reference,
        transactionCode: paymentForm.transactionCode,
        source: paymentForm.source,
        accountId: paymentForm.source === 'ACCOUNT' ? pickedAccount?.id || paymentForm.accountId : undefined,
        purchaseOrderIds: invoiceAllocations.length > 0 ? invoiceAllocations.map(allocation => allocation.purchaseOrderId) : undefined,
        invoiceAllocations: invoiceAllocations.length > 0 ? invoiceAllocations : undefined,
        creditNoteIds: selectedCreditNoteIds.length > 0 ? selectedCreditNoteIds : undefined
      } as any);
      
      setPaymentForm({ amount: '', reference: '', transactionCode: '', purchaseOrderId: '', source: 'TILL', accountId: '' });
      setSelectedInvoiceIds([]);
      setInvoiceAmounts({});
      setSelectedCreditNoteIds([]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const submitDisabled = isSaving
    || paymentForm.amount === ''
    || Number(paymentForm.amount) < 0
    || (hasInvoiceSelection && invoiceAllocations.length === 0)
    || hasInvalidInvoiceAmount
    || creditExceedsInvoices;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4 pb-safe">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-sm rounded-t-2xl sm:rounded-2xl shadow-elevated relative z-10 flex flex-col max-h-[92dvh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 pb-0 flex justify-between items-center">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <DollarSign className="text-green-600" size={18} /> Pay supplier balance
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-5 pt-4">
          <div className="bg-slate-50 rounded-2xl p-3.5 mb-4 border border-slate-100 flex justify-between items-center gap-3">
             <div className="min-w-0">
                <p className="text-xs text-slate-500 font-medium mb-0.5">Supplier</p>
                <p className="text-xs font-black text-slate-900 truncate">{supplier.company}</p>
             </div>
             <div className="text-right shrink-0">
                <p className="text-xs text-slate-500 font-medium mb-0.5">Total balance</p>
                <p className="text-xs font-black text-red-600">Ksh {supplier.balance.toLocaleString()}</p>
             </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              {/* Invoices Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 ml-1">
                    Select invoices {selectedInvoiceIds.length > 0 && `(${selectedInvoiceIds.length})`}
                </label>
                <div className="space-y-1 max-h-[240px] overflow-y-auto no-scrollbar pr-1">
                    {outstandingInvoices.length === 0 ? (
                        <div className="text-[10px] text-slate-400 italic bg-slate-50 p-2.5 rounded-xl border border-dashed border-slate-200">
                            No outstanding invoices.
                        </div>
                    ) : (
                        outstandingInvoices.map(inv => {
                            const due = invoiceDue(inv);
                            const isSelected = selectedInvoiceIds.includes(inv.id);
                            const enteredAmount = Number(invoiceAmounts[inv.id] || 0);
                            const isInvalid = isSelected && (enteredAmount < 0 || enteredAmount > due + 0.01);
                            return (
                              <div 
                                  key={inv.id} 
                                  data-testid={`supplier-payment-invoice-${inv.id}`}
                                  onClick={() => toggleInvoice(inv.id)}
                                  className={`space-y-2 p-2.5 rounded-xl border-2 transition-all cursor-pointer ${isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                              >
                                  <div className="flex items-center gap-2">
                                      <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200'}`}>
                                          {isSelected && <Save size={10} />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <p className="text-[11px] font-bold text-slate-900 leading-none truncate">#{inv.invoiceNumber || inv.id.split('-')[0].toUpperCase()}</p>
                                          <p className="text-[9px] text-slate-500 font-medium mt-0.5">Due: Ksh {due.toLocaleString()}</p>
                                      </div>
                                  </div>
                                  {isSelected && (
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1.5 items-center pl-6" onClick={e => e.stopPropagation()}>
                                      <div className="relative">
                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">Ksh</span>
                                        <input
                                          type="number"
                                          min="0"
                                          max={due}
                                          step="0.01"
                                          value={invoiceAmounts[inv.id] || ''}
                                          onChange={e => setInvoiceAmount(inv.id, e.target.value)}
                                          data-testid={`supplier-payment-invoice-amount-${inv.id}`}
                                          className={`w-full rounded-lg border bg-white py-2 pl-9 pr-2 text-[11px] font-black tabular-nums outline-none focus:border-blue-500 ${isInvalid ? 'border-rose-300 text-rose-600' : 'border-blue-100 text-slate-900'}`}
                                          placeholder="0"
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => setInvoiceQuickAmount(inv.id, due / 2)}
                                        className="h-9 px-2.5 rounded-lg bg-white border border-blue-100 text-[9px] font-black text-blue-700 hover:bg-blue-100"
                                      >
                                        Half
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setInvoiceQuickAmount(inv.id, due)}
                                        className="h-9 px-2.5 rounded-lg bg-blue-600 text-[9px] font-black text-white hover:bg-blue-700"
                                      >
                                        Full
                                      </button>
                                    </div>
                                  )}
                                  {isInvalid && (
                                    <p className="pl-6 text-[9px] font-bold text-rose-600">Amount cannot be above the invoice balance.</p>
                                  )}
                              </div>
                            );
                        })
                    )}
                </div>
              </div>

              {/* Credit Notes Selection */}
              {pendingCreditNotes.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-orange-600 mb-1.5 ml-1">
                      Apply credits {selectedCreditNoteIds.length > 0 && `(${selectedCreditNoteIds.length})`}
                  </label>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto no-scrollbar pr-1">
                      {pendingCreditNotes.map(cn => (
                          <div 
                              key={cn.id} 
                              data-testid={`supplier-payment-credit-${cn.id}`}
                              onClick={() => toggleCreditNote(cn.id)}
                              className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all cursor-pointer ${selectedCreditNoteIds.includes(cn.id) ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                          >
                              <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${selectedCreditNoteIds.includes(cn.id) ? 'bg-orange-600 border-orange-600 text-white' : 'border-slate-200'}`}>
                                  {selectedCreditNoteIds.includes(cn.id) && <Save size={10} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-bold text-slate-900 leading-none truncate">{cn.reference || 'Credit note'}</p>
                                  <p className="text-[9px] text-orange-600 font-black mt-0.5">- Ksh {cn.amount.toLocaleString()}</p>
                              </div>
                          </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Amount & Method */}
            <div className="grid grid-cols-1 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 ml-1">
                  {hasAllocationSelection ? 'Cash to pay after credits' : 'Amount to pay'}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-slate-400 font-black text-xs">Ksh</span>
                  <input 
                    type="number" 
                    required
                    value={paymentForm.amount} 
                    onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} 
                    readOnly={hasAllocationSelection}
                    data-testid="supplier-payment-amount"
                    className={`w-full border-2 border-transparent rounded-xl pl-10 pr-4 py-2.5 text-lg font-black text-slate-900 focus:outline-none focus:border-green-500 transition-all ${hasAllocationSelection ? 'bg-slate-100' : 'bg-white'}`}
                    placeholder="0" 
                  />
                </div>
                {hasAllocationSelection && (
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-lg bg-blue-50 px-2 py-2">
                      <p className="text-[8px] font-black text-blue-500">Invoices</p>
                      <p className="text-[10px] font-black text-slate-900 tabular-nums">Ksh {invoiceAllocationTotal.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-orange-50 px-2 py-2">
                      <p className="text-[8px] font-black text-orange-500">Credits</p>
                      <p className="text-[10px] font-black text-slate-900 tabular-nums">Ksh {creditTotal.toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 px-2 py-2">
                      <p className="text-[8px] font-black text-emerald-600">Cash</p>
                      <p className="text-[10px] font-black text-slate-900 tabular-nums">Ksh {calculatedCashAmount.toLocaleString()}</p>
                    </div>
                  </div>
                )}
                {creditExceedsInvoices && (
                  <p className="mt-2 text-[10px] font-bold text-rose-600">Selected credits are more than the selected invoice amounts.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 ml-1">Pay from</label>
                <div className="flex gap-2">
                   <button 
                    type="button"
                    data-testid="supplier-payment-source-till"
                    onClick={() => setPaymentForm({...paymentForm, source: 'TILL', accountId: ''})}
                    className={`flex-1 py-3 rounded-xl text-[10px] font-black border transition-all flex items-center justify-center gap-2 ${paymentForm.source === 'TILL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}
                   >
                     <Wallet size={14} />
                     Till cash drawer
                   </button>
                   <button 
                    type="button"
                    data-testid="supplier-payment-source-account"
                    onClick={() => setPaymentForm({...paymentForm, source: 'ACCOUNT', accountId: pickedAccount?.id || paymentForm.accountId})}
                    className={`flex-1 py-3 rounded-xl text-[10px] font-black border transition-all flex items-center justify-center gap-2 ${paymentForm.source === 'ACCOUNT' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}
                   >
                     <Landmark size={14} />
                     Picked account
                   </button>
                </div>
              </div>

              {paymentForm.source === 'ACCOUNT' && (
                <div className="animate-in slide-in-from-top-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                   <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{PICKED_CASH_ACCOUNT_NAME}</p>
                   <p className="text-sm font-black text-slate-900">Ksh {Number(pickedAccount?.balance || 0).toLocaleString()}</p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 ml-1">Reference</label>
                <input 
                  type="text" 
                  value={paymentForm.transactionCode} 
                  onChange={e => setPaymentForm({...paymentForm, transactionCode: e.target.value})} 
                  data-testid="supplier-payment-transaction-code"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-slate-900 focus:outline-none focus:border-slate-500" 
                  placeholder="Reference number" 
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 ml-1">Note</label>
                <input 
                  type="text" 
                  value={paymentForm.reference} 
                  onChange={e => setPaymentForm({...paymentForm, reference: e.target.value})} 
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-[9px] font-bold text-slate-500 focus:outline-none" 
                  readOnly 
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2 sticky bottom-0 bg-white pb-2 mt-auto">
              <button type="button" data-testid="supplier-payment-cancel" onClick={onClose} className="flex-1 px-4 py-3.5 bg-slate-100 text-slate-500 font-bold text-sm rounded-xl">Cancel</button>
              <button type="submit" data-testid="supplier-payment-submit" disabled={submitDisabled} className="flex-[2] bg-green-600 text-white py-3.5 font-bold text-sm rounded-xl shadow-lg shadow-green-600/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {isSaving ? 'Saving...' : 'Save payment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
