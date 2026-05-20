import React, { useState } from 'react';
import { X, Truck, FileText, DollarSign, Plus, Calendar, ChevronRight, CheckCircle2, AlertCircle, Ban, Receipt, Printer, Edit, Loader2, Share2, Trash2, Package } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product, type Supplier } from '../../db';
import { useToast } from '../../context/ToastContext';
import { shareDocument } from '../../utils/shareUtils';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SupplierService } from '../../services/suppliers';
import { useStore } from '../../store';
import { reloadBestEffort } from '../../utils/reloads';
import { productsForSupplier } from '../../utils/supplierProducts';

interface SupplierLedgerModalProps {
  supplier: Supplier | null;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
  onPay: (s: Supplier) => void;
  shiftId?: string;
  products?: Product[];
}

const sentenceValue = (value: unknown, fallback = '') => {
  const text = String(value || fallback).replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

const money = (value: number) => Math.round(Number(value) || 0).toLocaleString();
const roundMoney = (value: number) => Math.round(value * 100) / 100;
const productUnitCost = (product?: Product | null) => {
  const cost = Number(product?.costPrice || 0);
  return roundMoney(Math.max(0, cost > 0 ? cost : Number(product?.sellingPrice || 0)));
};

type CreditNoteReturnItem = {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  amount: number;
  unit?: string;
  stockQuantity?: number;
};

const parseCreditNoteItems = (value: unknown): CreditNoteReturnItem[] => {
  const raw = typeof value === 'string' ? (() => {
    try { return JSON.parse(value); } catch { return []; }
  })() : value;
  return Array.isArray(raw) ? raw.filter(item => item?.productId) : [];
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
  const [creditNoteForm, setCreditNoteForm] = useState({ reference: '', reason: '', productId: '', quantity: '1' });
  const [creditNoteItems, setCreditNoteItems] = useState<CreditNoteReturnItem[]>([]);
  const [isSavingCreditNote, setIsSavingCreditNote] = useState(false);
  const [deletingCreditNoteId, setDeletingCreditNoteId] = useState<string | null>(null);
  const currentUser = useStore(state => state.currentUser);
  const { success, error } = useToast();
  const canDeleteCreditNotes = currentUser?.role === 'ADMIN' || currentUser?.role === 'ROOT';

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

  const supplierPurchaseOrders = useLiveQuery(
    () => supplier ? db.purchaseOrders.where('supplierId').equals(supplier.id).toArray() : [],
    [supplier],
    []
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
  const inventoryProducts = productsForSupplier(products || [], supplierPurchaseOrders || [], supplier.id);
  const selectedCreditProduct = inventoryProducts.find(product => product.id === creditNoteForm.productId);
  const selectedCreditQuantity = Number(creditNoteForm.quantity) || 0;
  const selectedCreditUnitCost = productUnitCost(selectedCreditProduct);
  const selectedCreditAmount = roundMoney(selectedCreditQuantity * selectedCreditUnitCost);
  const creditNoteTotal = roundMoney(creditNoteItems.reduce((sum, item) => sum + item.amount, 0));

  const resetCreditNoteForm = () => {
    setCreditNoteForm({ reference: '', reason: '', productId: '', quantity: '1' });
    setCreditNoteItems([]);
  };

  const handleAddCreditNoteItem = () => {
    if (!selectedCreditProduct) return error("Select a product first.");
    if (selectedCreditQuantity <= 0) return error("Return quantity must be greater than zero.");
    if (selectedCreditQuantity > Number(selectedCreditProduct.stockQuantity || 0)) {
      return error(`Cannot return more than available stock (${selectedCreditProduct.stockQuantity || 0}).`);
    }
    if (selectedCreditUnitCost <= 0) return error(`Set a cost price for ${selectedCreditProduct.name} before making a credit note.`);
    setCreditNoteItems(prev => {
      const existing = prev.find(item => item.productId === selectedCreditProduct.id);
      const existingQty = existing?.quantity || 0;
      const combinedQty = roundMoney(existingQty + selectedCreditQuantity);
      if (combinedQty > Number(selectedCreditProduct.stockQuantity || 0)) {
        error(`Cannot return more than available stock (${selectedCreditProduct.stockQuantity || 0}).`);
        return prev;
      }
      const nextItem: CreditNoteReturnItem = {
        productId: selectedCreditProduct.id,
        name: selectedCreditProduct.name,
        quantity: combinedQty,
        unitCost: selectedCreditUnitCost,
        amount: roundMoney(combinedQty * selectedCreditUnitCost),
        unit: selectedCreditProduct.unit || 'pcs',
        stockQuantity: selectedCreditProduct.stockQuantity,
      };
      return existing
        ? prev.map(item => item.productId === selectedCreditProduct.id ? nextItem : item)
        : [...prev, nextItem];
    });
    setCreditNoteForm(prev => ({ ...prev, productId: '', quantity: '1' }));
  };

  const handleAddCreditNote = async () => {
    if (isSavingCreditNote) return;
    if (creditNoteItems.length === 0) return error("Add at least one product to the credit note.");
    if (creditNoteTotal <= 0) return error("Credit note amount must be more than zero.");
    setIsSavingCreditNote(true);
    try {
      await SupplierService.recordCreditNote({
        supplierId: supplier.id,
        amount: creditNoteTotal,
        reference: creditNoteForm.reference,
        reason: creditNoteForm.reason,
        items: creditNoteItems.map(item => ({ productId: item.productId, quantity: item.quantity })),
        shiftId,
        branchId: supplier.branchId,
        businessId: supplier.businessId,
      });

      await reloadBestEffort([
        () => db.creditNotes.reload(),
        () => db.products.reload(),
        () => db.stockMovements.reload(),
      ]);

      success("Credit note recorded as PENDING and stock adjusted.");
      setIsAddCreditNoteOpen(false);
      resetCreditNoteForm();
    } catch (err: any) {
      error(err?.message || "Failed to record credit note.");
    } finally {
      setIsSavingCreditNote(false);
    }
  };

  const handleDeleteCreditNote = async (cn: any) => {
    if (!canDeleteCreditNotes || deletingCreditNoteId) return;
    if (cn.status === 'ALLOCATED') return error("Allocated credit notes cannot be deleted.");
    if (!confirm(`Delete credit note ${cn.reference || cn.id}? Stock will be restored.`)) return;
    setDeletingCreditNoteId(cn.id);
    try {
      await SupplierService.deleteCreditNote({
        creditNoteId: cn.id,
        businessId: supplier.businessId,
        branchId: supplier.branchId,
      });
      await reloadBestEffort([
        () => db.creditNotes.reload(),
        () => db.products.reload(),
        () => db.stockMovements.reload(),
      ]);
      success("Credit note deleted and stock restored.");
    } catch (err: any) {
      error(err?.message || "Failed to delete credit note.");
    } finally {
      setDeletingCreditNoteId(null);
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
                        Pay balance
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
                            <button data-testid="supplier-credit-open" onClick={() => { resetCreditNoteForm(); setIsAddCreditNoteOpen(true); }} className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-all">
                                <Plus size={14} /> New credit note
                            </button>
                        </div>
                        {filteredCreditNotes.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 flex flex-col items-center">
                                <Ban size={40} className="mb-3 opacity-20" />
                                <p className="text-sm font-bold">No credit notes found.</p>
                            </div>
                        ) : (
                            pagedCreditNotes.map(cn => {
                              const noteItems = parseCreditNoteItems((cn as any).items);
                              const itemSummary = noteItems.length
                                ? noteItems.map(item => `${item.quantity} ${item.unit || 'pcs'} ${item.name || 'item'}`).join(', ')
                                : cn.productId
                                  ? `${cn.quantity || 0} pcs returned`
                                  : '';
                              return (
                                <div key={cn.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-slate-300 transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cn.status === 'ALLOCATED' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
                                            <AlertCircle size={20} />
                                        </div>
                                        <div>
                                            <p className="text-sm font-black text-slate-900">{cn.reference || 'Credit note'}</p>
                                            <p className="text-[10px] font-bold text-slate-400 ">{new Date(cn.timestamp).toLocaleDateString()} • {cn.reason}</p>
                                            {itemSummary && <p className="text-[10px] font-bold text-blue-500 mt-0.5 line-clamp-1">{itemSummary}</p>}
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
                                            <div className="mt-1 flex items-center justify-end gap-1.5">
                                                <button
                                                    onClick={() => onPay(supplier)}
                                                    className="text-[9px] font-black text-blue-600 border border-blue-200 px-2 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all"
                                                >
                                                    Apply during payment
                                                </button>
                                                {canDeleteCreditNotes && (
                                                    <button
                                                        onClick={() => handleDeleteCreditNote(cn)}
                                                        disabled={deletingCreditNoteId === cn.id}
                                                        className="w-7 h-7 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all disabled:opacity-50"
                                                        title="Delete credit note"
                                                    >
                                                        {deletingCreditNoteId === cn.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-[9px] font-bold text-slate-400 mt-0.5 italic">Balance updated</p>
                                        )}
                                    </div>
                                </div>
                              );
                            })
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
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => { setIsAddCreditNoteOpen(false); resetCreditNoteForm(); }} />
            <div className="bg-white w-full max-w-lg max-h-[92dvh] overflow-hidden rounded-t-2xl sm:rounded-2xl shadow-elevated relative z-10 flex flex-col animate-in zoom-in-95">
                <div className="p-6 pb-4 border-b border-slate-100">
                    <h3 className="text-lg font-black text-slate-900 flex items-center gap-2"><div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><AlertCircle size={18}/></div> Create Credit</h3>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">Select returned products and pieces</p>
                </div>
                <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-5">
                    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 space-y-3">
                        <label className="block text-xs font-semibold text-blue-700 ml-1">Product returned</label>
                        <SearchableSelect
                          value={creditNoteForm.productId}
                          onChange={(v) => setCreditNoteForm({ ...creditNoteForm, productId: v })}
                          placeholder="Select product..."
                          options={inventoryProducts.map(p => ({
                            value: p.id,
                            label: `${p.name} (${p.stockQuantity} ${p.unit || 'pcs'} left)`,
                            keywords: `${p.name} ${p.barcode || ''} ${p.category || ''}`,
                            disabled: Number(p.stockQuantity || 0) <= 0,
                          }))}
                          size="sm"
                          buttonClassName="bg-white border-blue-100 text-slate-900 focus:border-blue-500"
                          searchInputClassName="bg-white"
                          dataTestId="supplier-credit-product"
                        />
                        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
                            <div className="rounded-xl bg-white border border-blue-100 px-3 py-2">
                                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Line amount</p>
                                <p className="text-sm font-black text-blue-700">Ksh {money(selectedCreditAmount)}</p>
                                {selectedCreditProduct && <p className="text-[9px] font-bold text-slate-400">Cost: Ksh {money(selectedCreditUnitCost)} each</p>}
                            </div>
                            <div>
                                <label className="block text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1 ml-1">Pcs</label>
                                <input data-testid="supplier-credit-quantity" type="number" min="0" step="any" value={creditNoteForm.quantity} onChange={e => setCreditNoteForm({...creditNoteForm, quantity: e.target.value})} className="w-full bg-white border border-blue-100 rounded-xl px-3 py-3 text-sm font-black text-center outline-none focus:border-blue-500" />
                            </div>
                        </div>
                        <button data-testid="supplier-credit-add-product" onClick={handleAddCreditNoteItem} disabled={!creditNoteForm.productId || selectedCreditQuantity <= 0} className="w-full py-3 bg-blue-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50 shadow-blue flex items-center justify-center gap-2">
                            <Plus size={14} /> Add product
                        </button>
                    </div>

                    {creditNoteItems.length > 0 && (
                        <div className="space-y-2">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Products in this credit</h4>
                            {creditNoteItems.map(item => (
                                <div key={item.productId} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                                    <div className="min-w-0 flex items-center gap-3">
                                        <span className="w-9 h-9 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shrink-0"><Package size={16} /></span>
                                        <div className="min-w-0">
                                            <p className="text-sm font-black text-slate-900 truncate">{item.name}</p>
                                            <p className="text-[10px] font-bold text-slate-400">{item.quantity} {item.unit || 'pcs'} x Ksh {money(item.unitCost)}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <p className="text-sm font-black text-blue-700">Ksh {money(item.amount)}</p>
                                        <button onClick={() => setCreditNoteItems(prev => prev.filter(row => row.productId !== item.productId))} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all">
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                            <div className="flex items-center justify-between rounded-2xl bg-slate-950 px-4 py-4 text-white">
                                <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">Credit total</span>
                                <span className="text-xl font-black">Ksh {money(creditNoteTotal)}</span>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Reference #</label>
                        <input data-testid="supplier-credit-reference" type="text" value={creditNoteForm.reference} onChange={e => setCreditNoteForm({...creditNoteForm, reference: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="CRN-XXX" />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Reason for credit</label>
                        <textarea data-testid="supplier-credit-reason" value={creditNoteForm.reason} onChange={e => setCreditNoteForm({...creditNoteForm, reason: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium h-20" placeholder="e.g. Returned broken stock" />
                    </div>
                </div>
                <div className="flex gap-2 p-6 border-t border-slate-100 bg-white">
                    <button data-testid="supplier-credit-cancel" onClick={() => { setIsAddCreditNoteOpen(false); resetCreditNoteForm(); }} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl text-xs  ">Cancel</button>
                    <button data-testid="supplier-credit-save" onClick={handleAddCreditNote} disabled={creditNoteItems.length === 0 || creditNoteTotal <= 0 || isSavingCreditNote} className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl text-xs active:scale-95 transition-all disabled:opacity-50 shadow-blue flex items-center justify-center gap-2">
                        {isSavingCreditNote && <Loader2 size={14} className="animate-spin" />}
                        {isSavingCreditNote ? 'Saving...' : 'Save credit note'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}
