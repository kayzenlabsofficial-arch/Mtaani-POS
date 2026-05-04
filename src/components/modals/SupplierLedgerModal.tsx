import React, { useState } from 'react';
import { X, Truck, FileText, DollarSign, Plus, Calendar, ChevronRight, CheckCircle2, AlertCircle, Ban, Receipt, Printer, Edit, Loader2, Share2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier, type PurchaseOrder, type CreditNote } from '../../db';
import { useToast } from '../../context/ToastContext';
import { shareDocument } from '../../utils/shareUtils';

interface SupplierLedgerModalProps {
  supplier: Supplier | null;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
  onPay: (s: Supplier) => void;
}

export default function SupplierLedgerModal({ supplier, onClose, onEdit, onPay }: SupplierLedgerModalProps) {
  const [activeTab, setActiveTab] = useState<'INVOICES' | 'PAYMENTS' | 'CREDIT_NOTES'>('INVOICES');
  const [isAddCreditNoteOpen, setIsAddCreditNoteOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState({ amount: '', reference: '', reason: '' });
  const { success, error } = useToast();

  const invoices = useLiveQuery(
    () => supplier ? db.purchaseOrders.where('supplierId').equals(supplier.id).reverse().sortBy('orderDate') : [],
    [supplier]
  );

  const payments = useLiveQuery(
    () => supplier ? db.supplierPayments.where('supplierId').equals(supplier.id).reverse().sortBy('timestamp') : [],
    [supplier]
  );

  const creditNotes = useLiveQuery(
    () => supplier ? db.creditNotes.where('supplierId').equals(supplier.id).reverse().sortBy('timestamp') : [],
    [supplier]
  );

  if (!supplier) return null;

  const handleAddCreditNote = async () => {
    try {
      const amount = Number(creditNoteForm.amount);
      if (amount <= 0) return;

      const cn: CreditNote = {
        id: crypto.randomUUID(),
        supplierId: supplier.id,
        amount,
        reference: creditNoteForm.reference,
        reason: creditNoteForm.reason,
        status: 'PENDING',
        timestamp: Date.now()
      };
      await db.creditNotes.add(cn);
      success("Credit Note recorded as PENDING.");
      setIsAddCreditNoteOpen(false);
      setCreditNoteForm({ amount: '', reference: '', reason: '' });
    } catch (err) {
      error("Failed to record credit note.");
    }
  };

  const handleAllocateCreditNote = async (cn: CreditNote) => {
    if (cn.status === 'ALLOCATED') return;
    try {
      await db.creditNotes.update(cn.id, { status: 'ALLOCATED' });
      await db.suppliers.update(supplier.id, {
        balance: Math.max(0, supplier.balance - cn.amount)
      });
      success(`Ksh ${cn.amount.toLocaleString()} allocated and deducted from balance.`);
    } catch (err) {
      error("Allocation failed.");
    }
  };

  const handlePrintStatement = async () => {
    if (!supplier) return;
    setIsSharing(true);
    try {
      const { generateAndDownloadStatement } = await import('../../utils/shareUtils');
      await generateAndDownloadStatement(supplier, invoices || [], payments || [], creditNotes || []);
      success("Statement generated successfully.");
    } catch (err) {
      console.error('Sharing failed', err);
      error("Failed to generate statement.");
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 pb-safe">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md no-print" onClick={onClose} />
      
      <div className="bg-white w-full max-w-2xl h-full sm:h-[85vh] sm:rounded-[32px] shadow-2xl relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
         
         {/* Ledger Header */}
         <div id="printable-content" className="print-document-a4 h-full flex flex-col">
            <div className="p-6 sm:p-8 pb-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[18px] sm:rounded-[24px] bg-slate-900 text-white flex items-center justify-center shadow-lg shrink-0 no-print">
                        <Truck size={24} className="sm:hidden" />
                        <Truck size={32} className="hidden sm:block" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">{supplier.company}</h2>
                        <p className="text-xs sm:text-sm font-bold text-slate-500 flex items-center gap-2 truncate">
                           {supplier.name} <span className="hidden sm:inline">•</span> {supplier.phone}
                        </p>
                        <div className="flex gap-2 mt-3 no-print overflow-x-auto no-scrollbar">
                           <button onClick={() => onEdit(supplier)} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 hover:bg-slate-200 transition-all shrink-0">
                              <Edit size={12} /> Edit Profile
                           </button>
                           <button 
                            onClick={handlePrintStatement} 
                            disabled={isSharing}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1 hover:bg-slate-200 transition-all disabled:opacity-50 shrink-0"
                           >
                              {isSharing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                              {isSharing ? 'Generating...' : 'Statement'}
                           </button>
                        </div>
                    </div>
                </div>
                <div className="sm:text-right w-full sm:w-auto">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Current Ledger Balance</p>
                    <h3 className={`text-2xl sm:text-4xl font-black tabular-nums break-words ${supplier.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Ksh {supplier.balance.toLocaleString()}
                    </h3>
                    <button onClick={() => onPay(supplier)} className="mt-3 bg-green-600 text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-green-600/20 active:scale-95 transition-all no-print w-full sm:w-auto">
                        Make a Payment
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="px-8 flex border-b border-slate-100 no-print">
                {(['INVOICES', 'PAYMENTS', 'CREDIT_NOTES'] as const).map(tab => (
                    <button 
                        key={tab} 
                        onClick={() => setActiveTab(tab)}
                        className={`py-4 px-6 text-[10px] font-black uppercase tracking-widest transition-all relative ${activeTab === tab ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {tab.replace('_', ' ')}
                        {tab === 'INVOICES' && invoices && invoices.length > 0 && <span className="ml-2 bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">{invoices.length}</span>}
                    </button>
                ))}
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-8 print:p-0">
                {activeTab === 'INVOICES' && (
                    <div className="space-y-3">
                        <div className="hidden print:block mb-8">
                           <h3 className="text-lg font-black uppercase tracking-widest border-b pb-2">Purchase Invoices Statement</h3>
                        </div>
                        {invoices?.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <FileText size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No purchase invoices found.</p>
                            </div>
                        ) : (
                            invoices?.map(inv => (
                                <div key={inv.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${inv.paymentStatus === 'PAID' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                            <Receipt size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">Inv #{inv.invoiceNumber || inv.id.split('-')[0].toUpperCase()}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">
                                               {new Date(inv.orderDate).toLocaleDateString()} • {inv.status}
                                               {inv.preparedBy && <span className="ml-2 text-blue-500 font-black">@{inv.preparedBy}</span>}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-slate-900">Ksh {inv.totalAmount.toLocaleString()}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg uppercase tracking-widest border ${inv.paymentStatus === 'PAID' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                                {inv.paymentStatus || 'UNPAID'}
                                            </span>
                                            {inv.paymentStatus === 'PARTIAL' && <span className="text-[9px] font-bold text-slate-400 italic">Due: Ksh {(inv.totalAmount - (inv.paidAmount || 0)).toLocaleString()}</span>}
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'PAYMENTS' && (
                    <div className="space-y-3">
                         {payments?.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <DollarSign size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No payments recorded.</p>
                            </div>
                        ) : (
                            payments?.map(pay => (
                                <div key={pay.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                                            <CheckCircle2 size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">{pay.reference || 'Vendor Payment'}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">
                                               {new Date(pay.timestamp).toLocaleDateString()} • via {pay.paymentMethod}
                                               {pay.preparedBy && <span className="ml-2 text-purple-500 font-black">@{pay.preparedBy}</span>}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-purple-600">Ksh {pay.amount.toLocaleString()}</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">{pay.transactionCode || 'No Ref'}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'CREDIT_NOTES' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center no-print">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Available Credits</h3>
                            <button onClick={() => setIsAddCreditNoteOpen(true)} className="flex items-center gap-1.5 text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-all">
                                <Plus size={14} /> New Credit Note
                            </button>
                        </div>
                        {creditNotes?.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <Ban size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No credit notes found.</p>
                            </div>
                        ) : (
                            creditNotes?.map(cn => (
                                <div key={cn.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cn.status === 'ALLOCATED' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                                            <AlertCircle size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">{cn.reference || 'Credit Note'}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase">{new Date(cn.timestamp).toLocaleDateString()} • {cn.reason}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-widest border ${cn.status === 'ALLOCATED' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                                                    {cn.status || 'PENDING'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-blue-600">Ksh {cn.amount.toLocaleString()}</p>
                                        {cn.status !== 'ALLOCATED' ? (
                                            <button 
                                                onClick={() => handleAllocateCreditNote(cn)}
                                                className="mt-1 text-[9px] font-black text-blue-600 uppercase tracking-widest border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all"
                                            >
                                                Allocate Credit
                                            </button>
                                        ) : (
                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 italic">Balance Updated</p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
         </div>

         {/* Close Button Mobile */}
         <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-slate-100 text-slate-400 rounded-full hover:text-slate-600 transition-all no-print">
            <X size={20} />
         </button>
      </div>

      {/* Add Credit Note Form Over Modal */}
      {isAddCreditNoteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setIsAddCreditNoteOpen(false)} />
            <div className="bg-white w-full max-w-xs rounded-[28px] shadow-2xl relative z-10 p-6 animate-in zoom-in-95">
                <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-2"><div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><AlertCircle size={18}/></div> Create Credit</h3>
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Credit Amount</label>
                        <input type="number" value={creditNoteForm.amount} onChange={e => setCreditNoteForm({...creditNoteForm, amount: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-black" placeholder="Ksh 0.00" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Reference #</label>
                        <input type="text" value={creditNoteForm.reference} onChange={e => setCreditNoteForm({...creditNoteForm, reference: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="CRN-XXX" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Reason for Credit</label>
                        <textarea value={creditNoteForm.reason} onChange={e => setCreditNoteForm({...creditNoteForm, reason: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium h-20" placeholder="e.g. Returned broken stock" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setIsAddCreditNoteOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs uppercase tracking-widest">Cancel</button>
                    <button onClick={handleAddCreditNote} disabled={!creditNoteForm.amount} className="flex-[2] py-3 bg-blue-600 text-white font-black rounded-xl text-xs uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 shadow-blue">Apply Credit</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
