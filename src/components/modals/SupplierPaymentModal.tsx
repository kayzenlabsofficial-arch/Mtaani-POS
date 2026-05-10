import React, { useState, useEffect } from 'react';
import { DollarSign, Save, X, CreditCard, Banknote, Building2, Receipt, FileText, ChevronDown, Loader2, CheckCircle2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier, type PurchaseOrder } from '../../db';
import { SearchableSelect } from '../shared/SearchableSelect';

interface SupplierPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier: Supplier | null;
  onSave: (payment: { amount: number, method: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE', reference: string, source: 'TILL' | 'ACCOUNT', accountId?: string, transactionCode?: string, purchaseOrderId?: string, purchaseOrderIds?: string[] }) => Promise<void>;
  financialAccounts: any[];
  shiftId?: string;
}

export default function SupplierPaymentModal({ isOpen, onClose, supplier, onSave, financialAccounts }: SupplierPaymentModalProps) {
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'CASH' as 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE',
    reference: '',
    transactionCode: '',
    purchaseOrderId: '',
    source: 'TILL' as 'TILL' | 'ACCOUNT',
    accountId: ''
  });
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
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
      .filter(cn => cn.status === 'PENDING').toArray() : [],
    [supplier]
  ) || [];

  useEffect(() => {
    const selectedInvoices = outstandingInvoices.filter(inv => selectedInvoiceIds.includes(inv.id));
    const invTotal = selectedInvoices.reduce((acc, inv) => acc + (inv.totalAmount - (inv.paidAmount || 0)), 0);
    
    const selectedCNs = pendingCreditNotes.filter(cn => selectedCreditNoteIds.includes(cn.id));
    const cnTotal = selectedCNs.reduce((acc, cn) => acc + cn.amount, 0);
    
    const finalAmount = Math.max(0, invTotal - cnTotal);
    
    const invRefs = selectedInvoices.map(inv => inv.invoiceNumber || inv.id.split('-')[0].toUpperCase());
    const cnRefs = selectedCNs.map(cn => cn.reference || 'CR');
    
    let refStr = "";
    if (invRefs.length > 0) refStr += `Payment against ${invRefs.length} invoice(s)`;
    if (cnRefs.length > 0) refStr += (refStr ? ' | ' : '') + `Less Credit: ${cnRefs.join(', ')}`;
    
    setPaymentForm(prev => ({ 
        ...prev, 
        amount: finalAmount.toString(), 
        reference: refStr 
    }));
  }, [selectedInvoiceIds, selectedCreditNoteIds]);

  const toggleInvoice = (id: string) => {
    setSelectedInvoiceIds(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleCreditNote = (id: string) => {
    setSelectedCreditNoteIds(prev => 
        prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  if (!isOpen || !supplier) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(paymentForm.amount);
    // Allow zero amount if credit notes cover the full invoice
    if (amount < 0 || isSaving) return;
    
    setIsSaving(true);
    try {
      await onSave({
        amount,
        method: paymentForm.method,
        reference: paymentForm.reference,
        transactionCode: paymentForm.transactionCode,
        source: paymentForm.source,
        accountId: paymentForm.source === 'ACCOUNT' ? paymentForm.accountId : undefined,
        purchaseOrderIds: selectedInvoiceIds.length > 0 ? selectedInvoiceIds : undefined,
        creditNoteIds: selectedCreditNoteIds.length > 0 ? selectedCreditNoteIds : undefined
      } as any);
      
      setPaymentForm({ amount: '', method: 'CASH', reference: '', transactionCode: '', purchaseOrderId: '', source: 'TILL', accountId: '' });
      setSelectedInvoiceIds([]);
      setSelectedCreditNoteIds([]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pb-safe">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-elevated relative z-10 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 pb-0 flex justify-between items-center">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <DollarSign className="text-green-600" size={18} /> Pay Supplier
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-5 pt-4">
          <div className="bg-slate-50 rounded-2xl p-3.5 mb-4 border border-slate-100 flex justify-between items-center gap-3">
             <div className="min-w-0">
                <p className="text-[9px] text-slate-400 font-black   mb-0.5">Paying To</p>
                <p className="text-xs font-black text-slate-900 truncate">{supplier.company}</p>
             </div>
             <div className="text-right shrink-0">
                <p className="text-[9px] text-slate-400 font-black   mb-0.5">Total Bal</p>
                <p className="text-xs font-black text-red-600">Ksh {supplier.balance.toLocaleString()}</p>
             </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              {/* Invoices Selection */}
              <div>
                <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1">
                    Select Invoices {selectedInvoiceIds.length > 0 && `(${selectedInvoiceIds.length})`}
                </label>
                <div className="space-y-1 max-h-[160px] overflow-y-auto no-scrollbar pr-1">
                    {outstandingInvoices.length === 0 ? (
                        <div className="text-[10px] text-slate-400 italic bg-slate-50 p-2.5 rounded-xl border border-dashed border-slate-200">
                            No outstanding invoices.
                        </div>
                    ) : (
                        outstandingInvoices.map(inv => (
                            <div 
                                key={inv.id} 
                                onClick={() => toggleInvoice(inv.id)}
                                className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all cursor-pointer ${selectedInvoiceIds.includes(inv.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                            >
                                <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${selectedInvoiceIds.includes(inv.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200'}`}>
                                    {selectedInvoiceIds.includes(inv.id) && <Save size={10} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[11px] font-bold text-slate-900 leading-none truncate">#{inv.invoiceNumber || inv.id.split('-')[0].toUpperCase()}</p>
                                    <p className="text-[9px] text-slate-500 font-medium mt-0.5">Due: Ksh {(inv.totalAmount - (inv.paidAmount || 0)).toLocaleString()}</p>
                                </div>
                            </div>
                        ))
                    )}
                </div>
              </div>

              {/* Credit Notes Selection */}
              {pendingCreditNotes.length > 0 && (
                <div>
                  <label className="block text-[9px] font-black text-orange-500   mb-1.5 ml-1">
                      Apply Credits {selectedCreditNoteIds.length > 0 && `(${selectedCreditNoteIds.length})`}
                  </label>
                  <div className="space-y-1 max-h-[120px] overflow-y-auto no-scrollbar pr-1">
                      {pendingCreditNotes.map(cn => (
                          <div 
                              key={cn.id} 
                              onClick={() => toggleCreditNote(cn.id)}
                              className={`flex items-center gap-2 p-2.5 rounded-xl border-2 transition-all cursor-pointer ${selectedCreditNoteIds.includes(cn.id) ? 'bg-orange-50 border-orange-200' : 'bg-white border-slate-100 hover:border-slate-200'}`}
                          >
                              <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${selectedCreditNoteIds.includes(cn.id) ? 'bg-orange-600 border-orange-600 text-white' : 'border-slate-200'}`}>
                                  {selectedCreditNoteIds.includes(cn.id) && <Save size={10} />}
                              </div>
                              <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-bold text-slate-900 leading-none truncate">{cn.reference || 'Credit Note'}</p>
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
                <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1">Payment Amount</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-3 text-slate-400 font-black text-xs">Ksh</span>
                  <input 
                    type="number" 
                    required
                    value={paymentForm.amount} 
                    onChange={e => setPaymentForm({...paymentForm, amount: e.target.value})} 
                    className="w-full bg-slate-100 border-2 border-transparent rounded-xl pl-10 pr-4 py-2.5 text-lg font-black text-slate-900 focus:outline-none focus:border-green-500 focus:bg-white transition-all" 
                    placeholder="0" 
                  />
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1">Method</label>
                <div className="grid grid-cols-4 gap-1.5">
                   {[
                     { id: 'CASH', icon: Banknote },
                     { id: 'MPESA', icon: CreditCard },
                     { id: 'BANK', icon: Building2 },
                     { id: 'CHEQUE', icon: Receipt }
                   ].map(m => (
                     <button 
                       key={m.id}
                       type="button"
                       onClick={() => setPaymentForm({...paymentForm, method: m.id as any})}
                       className={`flex flex-col items-center justify-center p-2 rounded-lg border-2 transition-all ${paymentForm.method === m.id ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-400'}`}
                     >
                       <m.icon size={14} />
                       <span className="text-[7px] font-black mt-1 ">{m.id}</span>
                     </button>
                   ))}
                </div>
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1">Payment Source</label>
                <div className="flex gap-2">
                   <button 
                    type="button"
                    onClick={() => setPaymentForm({...paymentForm, source: 'TILL'})}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black border transition-all ${paymentForm.source === 'TILL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500'}`}
                   >
                     Till (Cash Drawer)
                   </button>
                   <button 
                    type="button"
                    onClick={() => setPaymentForm({...paymentForm, source: 'ACCOUNT'})}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black border transition-all ${paymentForm.source === 'ACCOUNT' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-200 text-slate-500'}`}
                   >
                     Direct Account
                   </button>
                </div>
              </div>

              {paymentForm.source === 'ACCOUNT' && (
                <div className="animate-in slide-in-from-top-2">
                   <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1 text-blue-600 font-black">Funding Account</label>
                   <SearchableSelect
                     value={paymentForm.accountId || ''}
                     onChange={(v) => setPaymentForm({ ...paymentForm, accountId: v })}
                     placeholder="Select Account..."
                     options={(financialAccounts || []).map(acc => ({
                       value: acc.id,
                       label: `${acc.name} (${acc.type})`,
                       keywords: `${acc.name} ${acc.type}`,
                     }))}
                     size="sm"
                     buttonClassName="bg-blue-50 border-blue-200 text-blue-900 focus:border-blue-500"
                     searchInputClassName="bg-white"
                   />
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1">Transaction Ref / Cheque #</label>
                <input 
                  type="text" 
                  value={paymentForm.transactionCode} 
                  onChange={e => setPaymentForm({...paymentForm, transactionCode: e.target.value})} 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-[11px] font-bold text-slate-900 focus:outline-none focus:border-slate-500" 
                  placeholder="Reference number" 
                />
              </div>

              <div>
                <label className="block text-[9px] font-black text-slate-400   mb-1.5 ml-1">Internal Reference</label>
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
              <button type="button" onClick={onClose} className="flex-1 px-4 py-3.5 bg-slate-100 text-slate-500 font-black text-[9px]   rounded-xl">Cancel</button>
              <button type="submit" disabled={!paymentForm.amount || Number(paymentForm.amount) < 0 || isSaving} className="flex-[2] bg-green-600 text-white py-3.5 font-black text-[9px]   rounded-xl shadow-lg shadow-green-600/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {isSaving ? 'Processing...' : 'Confirm & Pay'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

