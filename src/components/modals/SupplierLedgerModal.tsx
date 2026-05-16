import React, { useState } from 'react';
import { X, Truck, FileText, DollarSign, Plus, Calendar, ChevronRight, CheckCircle2, AlertCircle, Ban, Receipt, Printer, Edit, Loader2, Share2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier, type PurchaseOrder, type CreditNote } from '../../db';
import { useToast } from '../../context/ToastContext';
import { shareDocument } from '../../utils/shareUtils';
import { SearchableSelect } from '../shared/SearchableSelect';

interface SupplierLedgerModalProps {
  supplier: Supplier | null;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
  onPay: (s: Supplier) => void;
  shiftId?: string;
  products?: any[];
}

const sentenceValue = (value: unknown, fallback = '') => {
  const text = String(value || fallback).replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

export default function SupplierLedgerModal({ supplier, onClose, onEdit, onPay, shiftId, products }: SupplierLedgerModalProps) {
  const [activeTab, setActiveTab] = useState<'INVOICES' | 'PAYMENTS' | 'CREDIT_NOTES'>('INVOICES');
  const [isAddCreditNoteOpen, setIsAddCreditNoteOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const todayInput = new Date().toISOString().split('T')[0];
  const [dateMode, setDateMode] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [dateStart, setDateStart] = useState(todayInput);
  const [dateEnd, setDateEnd] = useState(todayInput);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [creditNoteForm, setCreditNoteForm] = useState({ amount: '', reference: '', reason: '', productId: '', quantity: '1' });
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

  React.useEffect(() => {
    setPage(1);
  }, [activeTab, dateMode, dateStart, dateEnd]);

  if (!supplier) return null;

  const inDateRange = (timestamp?: number) => {
    if (dateMode === 'ALL') return true;
    const start = new Date(dateStart || todayInput);
    start.setHours(0, 0, 0, 0);
    const end = new Date(dateEnd || dateStart || todayInput);
    end.setHours(23, 59, 59, 999);
    const ts = Number(timestamp) || 0;
    return ts >= start.getTime() && ts <= end.getTime();
  };

  const filteredInvoices = (invoices || []).filter(inv => inDateRange(inv.receivedDate || inv.orderDate));
  const filteredPayments = (payments || []).filter(payment => inDateRange(payment.timestamp));
  const filteredCreditNotes = (creditNotes || []).filter(note => inDateRange(note.timestamp));
  const activeRows = activeTab === 'INVOICES' ? filteredInvoices : activeTab === 'PAYMENTS' ? filteredPayments : filteredCreditNotes;
  const tabLabels: Record<'INVOICES' | 'PAYMENTS' | 'CREDIT_NOTES', string> = {
    INVOICES: 'Invoices',
    PAYMENTS: 'Payments',
    CREDIT_NOTES: 'Credit notes',
  };
  const totalPages = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedInvoices = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagedPayments = filteredPayments.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pagedCreditNotes = filteredCreditNotes.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleAddCreditNote = async () => {
    try {
      const amount = Number(creditNoteForm.amount);
      if (amount <= 0) return;
      const qty = Number(creditNoteForm.quantity) || 0;
      if (creditNoteForm.productId && qty <= 0) {
        error("Return quantity must be greater than zero.");
        return;
      }

      const cnId = crypto.randomUUID();
      const linkedProduct = creditNoteForm.productId ? await db.products.get(creditNoteForm.productId) : null;
      if (creditNoteForm.productId && !linkedProduct) {
        error("Selected product was not found.");
        return;
      }
      if (linkedProduct && qty > (linkedProduct.stockQuantity || 0)) {
        error(`Cannot return more than available stock (${linkedProduct.stockQuantity || 0}).`);
        return;
      }

      const cn: CreditNote = {
        id: cnId,
        supplierId: supplier.id,
        amount,
        reference: creditNoteForm.reference,
        reason: creditNoteForm.reason,
        status: 'PENDING',
        timestamp: Date.now(),
        productId: linkedProduct?.id,
        quantity: linkedProduct ? qty : undefined,
        shiftId,
        branchId: supplier.branchId,
        businessId: supplier.businessId
      };
      
      await db.creditNotes.add(cn);

      // If a product was returned, deduct stock
      if (linkedProduct) {
            await db.products.update(linkedProduct.id, {
               stockQuantity: (linkedProduct.stockQuantity || 0) - qty,
               updated_at: Date.now(),
            });
            await db.stockMovements.add({
               id: crypto.randomUUID(),
               productId: linkedProduct.id,
               type: 'OUT',
               quantity: -qty,
               timestamp: Date.now(),
               reference: `Supplier Return: ${creditNoteForm.reference || cnId.split('-')[0].toUpperCase()}`,
               branchId: supplier.branchId,
               businessId: supplier.businessId,
               shiftId
            });
      }

      success("Credit Note recorded as PENDING and stock adjusted.");
      setIsAddCreditNoteOpen(false);
      setCreditNoteForm({ amount: '', reference: '', reason: '', productId: '', quantity: '1' });
    } catch (err) {
      error("Failed to record credit note.");
    }
  };

  const handlePrintStatement = async () => {
    if (!supplier) return;
    setIsSharing(true);
    try {
      const { generateAndDownloadStatement } = await import('../../utils/shareUtils');
      await generateAndDownloadStatement(supplier, filteredInvoices, filteredPayments, filteredCreditNotes);
      success("Statement created.");
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
      
      <div className="bg-white w-full max-w-2xl h-full sm:h-[85vh] sm:rounded-2xl shadow-elevated relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
         
         {/* Statement Header */}
         <div id="printable-content" className="print-document-a4 h-full flex flex-col">
            <div className="p-6 sm:p-8 pb-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                    <div className="w-12 h-12 sm:w-16 sm:h-16 rounded-[18px] sm:rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-lg shrink-0 no-print">
                        <Truck size={24} className="sm:hidden" />
                        <Truck size={32} className="hidden sm:block" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">{supplier.company}</h2>
                        <p className="text-xs sm:text-sm font-bold text-slate-500 flex items-center gap-2 truncate">
                           {supplier.name} <span className="hidden sm:inline">•</span> {supplier.phone}
                        </p>
                        <div className="flex gap-2 mt-3 no-print overflow-x-auto no-scrollbar">
                           <button onClick={() => onEdit(supplier)} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black   flex items-center gap-1 hover:bg-slate-200 transition-all shrink-0">
                              <Edit size={12} /> Edit supplier
                           </button>
                           <button 
                            onClick={handlePrintStatement} 
                            disabled={isSharing}
                            className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black   flex items-center gap-1 hover:bg-slate-200 transition-all disabled:opacity-50 shrink-0"
                           >
                              {isSharing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
                              {isSharing ? 'Making...' : 'Statement'}
                           </button>
                        </div>
                    </div>
                </div>
                <div className="sm:text-right w-full sm:w-auto">
                    <p className="text-xs font-medium text-slate-500 mb-1">Current balance</p>
                    <h3 className={`text-2xl sm:text-4xl font-black tabular-nums break-words ${supplier.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        Ksh {supplier.balance.toLocaleString()}
                    </h3>
                    <button onClick={() => onPay(supplier)} className="mt-3 bg-green-600 text-white px-5 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-green-600/20 active:scale-95 transition-all no-print w-full sm:w-auto">
                        Clear balance
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="px-8 flex border-b border-slate-100 no-print">
                {(['INVOICES', 'PAYMENTS', 'CREDIT_NOTES'] as const).map(tab => (
                    <button 
                        key={tab} 
                        onClick={() => setActiveTab(tab)}
                        className={`py-4 px-6 text-sm font-bold transition-all relative ${activeTab === tab ? 'text-slate-900 border-b-2 border-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                        {tabLabels[tab]}
                        {tab === 'INVOICES' && invoices && invoices.length > 0 && <span className="ml-2 bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">{invoices.length}</span>}
                    </button>
                ))}
            </div>

            <div className="px-6 sm:px-8 py-3 border-b border-slate-100 no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => setDateMode('ALL')} className={`h-9 px-3 rounded-xl border text-xs font-bold ${dateMode === 'ALL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>All dates</button>
                    <button onClick={() => setDateMode('CUSTOM')} className={`h-9 px-3 rounded-xl border text-xs font-bold ${dateMode === 'CUSTOM' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-600 border-slate-200'}`}>Custom</button>
                    {dateMode === 'CUSTOM' && (
                        <>
                            <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} className="h-9 rounded-xl border border-slate-200 px-2 text-xs font-bold outline-none focus:border-blue-500" />
                            <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)} className="h-9 rounded-xl border border-slate-200 px-2 text-xs font-bold outline-none focus:border-blue-500" />
                        </>
                    )}
                </div>
                <p className="text-xs font-medium text-slate-500">
                  Showing {activeRows.length === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, activeRows.length)} of {activeRows.length}
                </p>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-8 print:p-0">
                {activeTab === 'INVOICES' && (
                    <div className="space-y-3">
                        <div className="hidden print:block mb-8">
                           <h3 className="text-lg font-black border-b pb-2">Supplier bills statement</h3>
                        </div>
                        {filteredInvoices.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <FileText size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No purchase invoices found.</p>
                            </div>
                        ) : (
                            pagedInvoices.map(inv => (
                                <div key={inv.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${inv.paymentStatus === 'PAID' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                                            <Receipt size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">Inv #{inv.invoiceNumber || inv.id.split('-')[0].toUpperCase()}</p>
                                            <p className="text-[10px] font-bold text-slate-400 ">
                                               {new Date(inv.orderDate).toLocaleDateString()} • {sentenceValue(inv.status)}
                                               {inv.preparedBy && <span className="ml-2 text-blue-500 font-black">@{inv.preparedBy}</span>}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-slate-900">Ksh {inv.totalAmount.toLocaleString()}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg   border ${inv.paymentStatus === 'PAID' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-700 border-red-100'}`}>
                                                {sentenceValue(inv.paymentStatus, 'UNPAID')}
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
                         {filteredPayments.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <DollarSign size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No payments recorded.</p>
                            </div>
                        ) : (
                            pagedPayments.map(pay => (
                                <div key={pay.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                                            <CheckCircle2 size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">{pay.reference || 'Supplier payment'}</p>
                                            <p className="text-[10px] font-bold text-slate-400 ">
                                               {new Date(pay.timestamp).toLocaleDateString()} • paid by {pay.paymentMethod === 'MPESA' ? 'M-Pesa' : pay.paymentMethod}
                                               {pay.preparedBy && <span className="ml-2 text-purple-500 font-black">@{pay.preparedBy}</span>}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-purple-600">Ksh {pay.amount.toLocaleString()}</p>
                                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{pay.transactionCode || 'No ref'}</p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'CREDIT_NOTES' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center no-print">
                            <h3 className="text-sm font-bold text-slate-600">Available credits</h3>
                            <button data-testid="supplier-credit-open" onClick={() => setIsAddCreditNoteOpen(true)} className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-all">
                                <Plus size={14} /> New credit note
                            </button>
                        </div>
                        {filteredCreditNotes.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <Ban size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No credit notes found.</p>
                            </div>
                        ) : (
                            pagedCreditNotes.map(cn => (
                                <div key={cn.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cn.status === 'ALLOCATED' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                                            <AlertCircle size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">{cn.reference || 'Credit note'}</p>
                                            <p className="text-[10px] font-bold text-slate-400 ">{new Date(cn.timestamp).toLocaleDateString()} • {cn.reason}</p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={`text-[8px] font-black px-1.5 py-0.5 rounded-md   border ${cn.status === 'ALLOCATED' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
                                                    {sentenceValue(cn.status, 'PENDING')}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-black text-blue-600">Ksh {cn.amount.toLocaleString()}</p>
                                        {cn.status !== 'ALLOCATED' ? (
                                            <button
                                                onClick={() => onPay(supplier)}
                                                className="mt-1 text-[9px] font-black text-blue-600 border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all"
                                            >
                                                Apply during payment
                                            </button>
                                        ) : (
                                            <p className="text-[9px] font-bold text-slate-400 mt-0.5 italic">Balance updated</p>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
            {activeRows.length > pageSize && (
              <div className="px-6 sm:px-8 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3 no-print">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 disabled:opacity-40">Previous 50</button>
                <span className="text-xs font-medium text-slate-500">Page {currentPage} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages} className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-600 disabled:opacity-40">Next 50</button>
              </div>
            )}
         </div>

         {/* Close Button Mobile */}
         <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-slate-100 text-slate-400 rounded-full hover:text-slate-600 transition-all no-print">
            <X size={20} />
         </button>
      </div>

      {/* Add Credit Note Form Over Modal */}
      {isAddCreditNoteOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setIsAddCreditNoteOpen(false)} />
            <div className="bg-white w-full max-w-xs max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-elevated relative z-10 p-6 animate-in zoom-in-95">
                <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-2"><div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><AlertCircle size={18}/></div> Create Credit</h3>
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Credit amount</label>
                        <input data-testid="supplier-credit-amount" type="number" value={creditNoteForm.amount} onChange={e => setCreditNoteForm({...creditNoteForm, amount: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-black" placeholder="Ksh 0.00" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Reference #</label>
                        <input data-testid="supplier-credit-reference" type="text" value={creditNoteForm.reference} onChange={e => setCreditNoteForm({...creditNoteForm, reference: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="CRN-XXX" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Reason for credit</label>
                        <textarea data-testid="supplier-credit-reason" value={creditNoteForm.reason} onChange={e => setCreditNoteForm({...creditNoteForm, reason: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium h-20" placeholder="e.g. Returned broken stock" />
                    </div>
                    <div className="border-t border-slate-100 pt-4">
                        <label className="block text-xs font-semibold text-blue-600 mb-2 ml-1">Link to inventory return (optional)</label>
                        <div className="space-y-3">
                           <SearchableSelect
                             value={creditNoteForm.productId}
                             onChange={(v) => setCreditNoteForm({ ...creditNoteForm, productId: v })}
                             placeholder="No stock return..."
                             options={(products || []).map(p => ({
                               value: p.id,
                               label: `${p.name} (${p.stockQuantity} ${p.unit} left)`,
                               keywords: `${p.name} ${p.barcode || ''} ${p.category || ''}`,
                             }))}
                             size="sm"
                             buttonClassName="bg-blue-50 border-blue-100 text-slate-900 focus:border-blue-500"
                             searchInputClassName="bg-white"
                             dataTestId="supplier-credit-product"
                           />
                           {creditNoteForm.productId && (
                             <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-slate-600">Qty to return:</label>
                                <input data-testid="supplier-credit-quantity" type="number" step="any" value={creditNoteForm.quantity} onChange={e => setCreditNoteForm({...creditNoteForm, quantity: e.target.value})} className="w-20 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-center" />
                             </div>
                           )}
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button data-testid="supplier-credit-cancel" onClick={() => setIsAddCreditNoteOpen(false)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs  ">Cancel</button>
                    <button data-testid="supplier-credit-save" onClick={handleAddCreditNote} disabled={!creditNoteForm.amount} className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl text-xs active:scale-95 transition-all disabled:opacity-50 shadow-blue">Save credit note</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

