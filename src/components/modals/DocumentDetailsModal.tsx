import React, { useState } from 'react';
import { ReceiptText, RotateCcw, Minus, Plus, Wallet, Landmark, DollarSign, Calendar, User, Hash, FileText, CheckCircle2, CreditCard, Banknote, ClipboardList, PackagePlus, Printer, Link, Loader2, Share2, CheckSquare } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction, type Expense, type SupplierPayment, type CashPick } from '../../db';
import { generateAndShareDocument } from '../../utils/shareUtils';
import { CalendarCheck, AlertTriangle, ArrowRight, TrendingUp, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import AdminVerificationModal from './AdminVerificationModal';
import { useToast } from '../../context/ToastContext';

interface DocumentDetailsModalProps {
  selectedRecord: any | null; // Can be Transaction, Expense, or SupplierPayment
  setSelectedRecord: (record: any | null) => void;
  handleRefund: (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => Promise<void>;
  onApprove?: (record: any) => Promise<void>;
  onReject?: (record: any) => Promise<void>;
  onReceive?: (record: any) => void;
}

export default function DocumentDetailsModal({ selectedRecord, setSelectedRecord, handleRefund, onApprove, onReject, onReceive }: DocumentDetailsModalProps) {
  const [returnQuantities, setReturnQuantities] = useState<{ [productId: string]: number }>({});
  const [isReturnMode, setIsReturnMode] = useState(false);
  const [isAdminVerifying, setIsAdminVerifying] = useState(false);
  const { success, error: toastError } = useToast();
  const isAdmin = useStore(state => state.isAdmin);
  const [isSharing, setIsSharing] = useState(false);
  const [isSavingPDF, setIsSavingPDF] = useState(false);

  const businessSettings = useLiveQuery(() => db.settings.get('core'), []);
  const storeName = businessSettings?.storeName || 'MTAANI POS';
  const storeLocation = businessSettings?.location || 'Nairobi, Kenya';

  // Fetch contextual data based on record type
  const supplier = useLiveQuery(
    () => (selectedRecord?.recordType === 'SUPPLIER_PAYMENT' || selectedRecord?.recordType === 'PURCHASE_ORDER') 
      ? db.suppliers.get(selectedRecord.supplierId) 
      : null,
    [selectedRecord]
  );
  
  const linkedInvoice = useLiveQuery(
    () => (selectedRecord?.recordType === 'SUPPLIER_PAYMENT' && selectedRecord.purchaseOrderId) ? db.purchaseOrders.get(selectedRecord.purchaseOrderId) : null,
    [selectedRecord]
  );

  const reportPicks = useLiveQuery(
    async () => {
      if (selectedRecord?.recordType !== 'CLOSE_DAY_REPORT') return [];
      const reportDate = new Date(selectedRecord.timestamp);
      reportDate.setHours(0,0,0,0);
      const nextDay = new Date(reportDate);
      nextDay.setDate(nextDay.getDate() + 1);
      
      return db.cashPicks
        .where('timestamp')
        .between(reportDate.getTime(), nextDay.getTime())
        .toArray();
    },
    [selectedRecord]
  );
  
  const paymentAllocations = useLiveQuery(
    async () => {
        if (selectedRecord?.recordType !== 'SUPPLIER_PAYMENT') return [];
        const ids = selectedRecord.purchaseOrderIds || (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []);
        if (ids.length === 0) return [];
        return db.purchaseOrders.bulkGet(ids);
    },
    [selectedRecord]
  );

  const creditNoteAllocations = useLiveQuery(
    async () => {
        if (selectedRecord?.recordType !== 'SUPPLIER_PAYMENT' || !selectedRecord.creditNoteIds) return [];
        return db.creditNotes.bulkGet(selectedRecord.creditNoteIds);
    },
    [selectedRecord]
  );

  if (!selectedRecord) return null;

  const isSale = selectedRecord.recordType === 'SALE';
  const isExpense = selectedRecord.recordType === 'EXPENSE';
  const isPayment = selectedRecord.recordType === 'SUPPLIER_PAYMENT';
  const isPO = selectedRecord.recordType === 'PURCHASE_ORDER';
  const isReport = selectedRecord.recordType === 'CLOSE_DAY_REPORT';
  const isDailySummary = selectedRecord.recordType === 'DAILY_SUMMARY';

  const updateReturnQty = (productId: string, delta: number, max: number) => {
     const current = returnQuantities[productId] || 0;
     const next = Math.max(0, Math.min(max, current + delta));
     setReturnQuantities({ ...returnQuantities, [productId]: next });
  }

  const onInitiateRefund = () => {
      const itemsToReturn = Object.entries(returnQuantities).filter(([_, qty]) => (qty as number) > 0);
      if (itemsToReturn.length === 0 && isReturnMode) return;
      onConfirmRefund();
  };

  const onConfirmRefund = () => {
      const itemsToReturn = Object.entries(returnQuantities)
          .filter(([_, qty]) => (qty as number) > 0)
          .map(([productId, quantity]) => ({ productId, quantity: quantity as number }));
      
      if (itemsToReturn.length === 0 && isReturnMode) return;
      
      handleRefund(selectedRecord, isReturnMode ? itemsToReturn : undefined);
      setIsReturnMode(false);
      setReturnQuantities({});
      setIsAdminVerifying(false);
  };

  const handleShare = async () => {
    if (!selectedRecord) return;
    setIsSharing(true);
    try {
      const typeLabel = isSale ? 'Receipt' : isExpense ? 'Expense' : isPayment ? 'Remittance' : isPO ? 'Invoice' : isReport ? 'Z-Report' : 'Summary';
      const filename = `${typeLabel}-${String(selectedRecord.id || '').split('-')[0].toUpperCase()}`;
      
      const recordWithDetails = { ...selectedRecord };
      if (isPayment) {
        const pIds = selectedRecord.purchaseOrderIds || (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []);
        const pos = await db.purchaseOrders.bulkGet(pIds);
        recordWithDetails.invoiceDetails = pos.filter(Boolean).map(p => ({ 
          date: p.orderDate, 
          ref: p.invoiceNumber || String(p.id || '').split('-')[0], 
          amount: p.totalAmount 
        }));
        
        if (selectedRecord.creditNoteIds?.length > 0) {
          const cns = await db.creditNotes.bulkGet(selectedRecord.creditNoteIds);
          recordWithDetails.creditNoteDetails = cns.filter(Boolean).map(c => ({ date: c.timestamp, ref: c.reference || 'CRN', amount: c.amount }));
        } else {
          const cnsByAlloc = await db.creditNotes.where('allocatedTo').equals(selectedRecord.id).toArray();
          if (cnsByAlloc.length > 0) {
            recordWithDetails.creditNoteDetails = cnsByAlloc.map(c => ({ date: c.timestamp, ref: c.reference || 'CRN', amount: c.amount }));
          }
        }
      }

      await generateAndShareDocument(recordWithDetails, filename, supplier, false, storeName, storeLocation);
      success('PDF ready!');
    } catch (err) {
      console.error('Share failed:', err);
      toastError('Could not share — try Save PDF instead.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleSavePDF = async () => {
    if (!selectedRecord) return;
    setIsSavingPDF(true);
    try {
      const typeLabel = isSale ? 'Receipt' : isExpense ? 'Expense' : isPayment ? 'Remittance' : isPO ? 'Invoice' : isReport ? 'Z-Report' : 'Summary';
      const filename = `${typeLabel}-${String(selectedRecord.id || '').split('-')[0].toUpperCase()}`;

      const recordWithDetails = { ...selectedRecord };
      if (isPayment) {
        const pIds = selectedRecord.purchaseOrderIds || (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []);
        const pos = await db.purchaseOrders.bulkGet(pIds);
        recordWithDetails.invoiceDetails = pos.filter(Boolean).map(p => ({ 
          date: p.orderDate, 
          ref: p.invoiceNumber || String(p.id || '').split('-')[0], 
          amount: p.totalAmount 
        }));
        
        if (selectedRecord.creditNoteIds?.length > 0) {
          const cns = await db.creditNotes.bulkGet(selectedRecord.creditNoteIds);
          recordWithDetails.creditNoteDetails = cns.filter(Boolean).map(c => ({ 
            date: c.timestamp, 
            ref: c.reference || 'CRN', 
            amount: c.amount 
          }));
        }
      }

      await generateAndShareDocument(recordWithDetails, filename, supplier, true, storeName, storeLocation);
      success('PDF saved successfully!');
    } catch (err) {
      console.error('Save PDF failed:', err);
      toastError('PDF generation failed. Please try again.');
    } finally {
      setIsSavingPDF(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setSelectedRecord(null)} />
      <div className="bg-white w-full max-w-2xl h-full sm:h-[90vh] sm:rounded-[32px] shadow-2xl relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
         
         {/* Scrollable Content Area */}
         <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div id="printable-content" className={isSale ? "print-receipt-80mm" : "print-document-a4"}>
              {/* Header */}
              <div className={`p-8 border-b flex flex-col items-center text-center ${
                 isSale ? 'bg-green-50/50 border-green-100' : 
                 isExpense ? 'bg-orange-50/50 border-orange-100' : 
                 isPayment ? 'bg-purple-50/50 border-purple-100' :
                 'bg-blue-50/50 border-blue-100'
              } print:bg-white print:border-slate-300`}>
                  <div className={`w-14 h-14 rounded-3xl flex items-center justify-center mb-4 no-print ${
                     isSale ? 'bg-green-100 text-green-600' : 
                     isExpense ? 'bg-orange-100 text-orange-600' : 
                     isPayment ? 'bg-purple-100 text-purple-600' :
                     isReport ? 'bg-slate-900 text-white' :
                     isDailySummary ? 'bg-blue-600 text-white' :
                     'bg-blue-100 text-blue-600'
                  }`}>
                     {isSale ? <ReceiptText size={28} /> : isExpense ? <Wallet size={28} /> : isPayment ? <DollarSign size={28} /> : isReport ? <CalendarCheck size={28} /> : isDailySummary ? <PackagePlus size={28} /> : <ClipboardList size={28} />}
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight ">
                     {isSale ? `Sales receipt` : 
                      isExpense ? `Expense Document` : 
                      isPayment ? 'Supplier Remittance Advice' :
                      isReport ? 'End of Shift Z-Reading' :
                      isDailySummary ? 'Daily Business Audit' :
                      (isPO && selectedRecord.approvalStatus === 'PENDING') ? 'Pending LPO' :
                      isPO ? 'Purchase Order' :
                      `Procurement Document`}
                  </h2>
                  <p className="text-xs font-bold text-slate-500  tracking-[0.2em] mt-1">
                      Reference: {selectedRecord.invoiceNumber || (String(selectedRecord.id || '').startsWith('PO-') ? selectedRecord.id : String(selectedRecord.id || '').split('-')[0].toUpperCase())}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 mt-2  ">
                     <Calendar size={12} /> {new Date(selectedRecord.orderDate || selectedRecord.timestamp || Date.now()).toLocaleString('en-KE')}
                  </div>
                  <div className="flex flex-col items-center gap-2 mt-4 bg-slate-50/50 p-3 rounded-2xl border border-slate-100/50 min-w-[200px]">
                      <div className="text-[10px] font-black text-slate-600 flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                             <User size={10} />
                          </div>
                          <span className=" ">Prepared by:</span>
                          <span className="text-blue-600 font-bold">{selectedRecord.preparedBy || selectedRecord.cashierName || selectedRecord.userName || 'Authorized Staff'}</span>
                       </div>

                     {(isPO || isExpense || selectedRecord.recordType === 'STOCK_ADJUSTMENT') && (
                        <div className="text-[10px] font-black text-slate-600 flex items-center gap-2">
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedRecord.approvedBy ? 'bg-blue-50 border-blue-100 text-blue-500' : 'bg-slate-100 border-slate-200 text-slate-400'}`}>
                               <CheckSquare size={10} />
                            </div>
                            <span className=" ">Approved by:</span>
                            <span className={selectedRecord.approvedBy ? "text-blue-600 font-bold" : "text-slate-400 italic"}>{selectedRecord.approvedBy || 'Pending Admin'}</span>
                         </div>
                     )}
                  </div>
                  {isSale && (
                     <span className={`mt-4 text-[10px] font-black px-3 py-1 rounded-full   no-print ${
                         selectedRecord.status === 'PAID' ? 'bg-green-100 text-green-700' : 
                         selectedRecord.status === 'REFUNDED' ? 'bg-orange-100 text-orange-700' : 
                         'bg-blue-100 text-blue-700'
                     }`}>
                         {selectedRecord.status}
                     </span>
                  )}
              </div>

              {/* Content */}
              <div className="p-6 space-y-5">
                 
                 {/* Sales Items */}
                 {isSale && (
                     <>
                         <div className="space-y-4">
                             {selectedRecord.items.map((item: any, idx: number) => {
                                 const alreadyReturned = item.returnedQuantity || 0;
                                 const availableToReturn = item.quantity - alreadyReturned;
                                 return (
                                     <div key={idx} className="flex justify-between items-center text-sm">
                                         <div className="flex-1">
                                             <p className="font-bold text-slate-900">{item.name}</p>
                                             <p className="text-[11px] text-slate-500 font-medium">
                                                 {item.quantity} units @ Ksh {item.snapshotPrice.toLocaleString()} 
                                                 {alreadyReturned > 0 && <span className="text-orange-600 ml-1">({alreadyReturned} returned)</span>}
                                             </p>
                                         </div>
                                         {isReturnMode ? (
                                             <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1 border border-slate-200">
                                                 <button onClick={() => updateReturnQty(item.productId, -1, availableToReturn)} className="p-1 hover:bg-slate-200 rounded text-slate-600"><Minus size={12} /></button>
                                                 <span className="w-5 text-center font-black text-xs">{returnQuantities[item.productId] || 0}</span>
                                                 <button onClick={() => updateReturnQty(item.productId, 1, availableToReturn)} className="p-1 hover:bg-slate-200 rounded text-slate-600"><Plus size={12} /></button>
                                             </div>
                                         ) : (
                                             <span className="font-black text-slate-900">Ksh {(item.quantity * item.snapshotPrice).toLocaleString()}</span>
                                         )}
                                     </div>
                                 );
                             })}
                         </div>
                         {!isReturnMode && (
                             <div className="pt-4 border-t border-dashed border-slate-200 space-y-2">
                                  <div className="flex justify-between text-xs font-bold text-slate-500  tracking-tight">
                                     <span>Subtotal</span>
                                     <span>Ksh {selectedRecord.subtotal.toLocaleString()}</span>
                                  </div>
                                  {selectedRecord.discountAmount > 0 && (
                                     <div className="flex justify-between text-xs font-bold text-orange-600  tracking-tight">
                                         <span>Discount</span>
                                         <span>-Ksh {selectedRecord.discountAmount.toLocaleString()}</span>
                                     </div>
                                  )}
                                  <div className="flex justify-between text-xs font-bold text-slate-500  tracking-tight">
                                     <span>Tax (16%)</span>
                                     <span>Ksh {selectedRecord.tax.toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between items-end pt-2">
                                     <span className="text-sm font-black text-slate-400  ">Total Paid</span>
                                     <span className="text-2xl font-black text-slate-900">Ksh {(selectedRecord.total || 0).toLocaleString()}</span>
                                  </div>
                                  {selectedRecord.amountTendered && selectedRecord.amountTendered > selectedRecord.total && (
                                     <div className="flex justify-between items-center text-green-700 bg-green-50 p-2 rounded-xl border border-green-100 mt-2">
                                         <span className="text-[10px] font-black  ">Change given</span>
                                         <span className="text-lg font-black italic">Ksh {(selectedRecord.amountTendered - selectedRecord.total).toLocaleString()}</span>
                                     </div>
                                  )}
                             </div>
                         )}
                     </>
                 )}

                 {/* Expense Details */}
                 {isExpense && (
                     <div className="space-y-4">
                         <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <p className="text-[10px] font-black text-slate-400   mb-2">Description</p>
                              <p className="text-sm font-bold text-slate-700 leading-relaxed">{selectedRecord.description || 'No description provided.'}</p>
                         </div>
                         <div className="flex items-center justify-between px-4">
                             <span className="text-sm font-black text-slate-400  ">Amount Spent</span>
                             <span className="text-2xl font-black text-orange-600">Ksh {selectedRecord.amount.toLocaleString()}</span>
                         </div>
                     </div>
                 )}

                 {/* Supplier Payment Details */}
                 {isPayment && (
                     <div className="space-y-4">
                         <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500"><User size={16} /></div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400  tracking-tight">Supplier</p>
                                      <p className="text-sm font-bold text-slate-900">{supplier?.company || 'Loading...'}</p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500">
                                     {selectedRecord.paymentMethod === 'MPESA' ? <CreditCard size={16} /> : 
                                      selectedRecord.paymentMethod === 'BANK' ? <Landmark size={16} /> : 
                                      <Banknote size={16} />}
                                  </div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400  tracking-tight">Method</p>
                                      <p className="text-sm font-bold text-slate-900">{selectedRecord.paymentMethod}</p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500"><Hash size={16} /></div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400  tracking-tight">Reference</p>
                                      <p className="text-sm font-bold text-slate-900">{selectedRecord.reference || 'None'}</p>
                                  </div>
                              </div>
                              {linkedInvoice && (
                                  <div className="flex items-center gap-3 pt-2 border-t border-slate-200">
                                      <div className="w-8 h-8 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center text-green-600"><FileText size={16} /></div>
                                      <div>
                                          <p className="text-[9px] font-black text-green-500  tracking-tight">Linked Invoice</p>
                                          <p className="text-sm font-bold text-slate-900">#{linkedInvoice.invoiceNumber || String(linkedInvoice.id || '').split('-')[0].toUpperCase()}</p>
                                      </div>
                                  </div>
                              )}
                         </div>
                         
                         {/* Payment Allocations Section */}
                         {paymentAllocations && paymentAllocations.length > 0 && (
                             <div className="space-y-3 mt-6">
                                 <p className="text-[10px] font-black text-slate-400   flex items-center gap-2">
                                     <Link size={10} /> Paid Invoices
                                 </p>
                                 <div className="space-y-2">
                                     {paymentAllocations.map((po: any, idx) => po && (
                                         <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-2 h-2 rounded-full bg-blue-500" />
                                                 <span className="font-bold text-slate-700">Inv #{po.invoiceNumber || String(po.id || '').split('-')[0].toUpperCase()}</span>
                                             </div>
                                             <span className="font-black text-slate-900 tabular-nums">Ksh {po.totalAmount.toLocaleString()}</span>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         )}

                         {/* Credit Note Allocations Section */}
                         {creditNoteAllocations && creditNoteAllocations.length > 0 && (
                             <div className="space-y-3 mt-4">
                                 <p className="text-[10px] font-black text-orange-500   flex items-center gap-2">
                                     <RotateCcw size={10} /> Applied Credits
                                 </p>
                                 <div className="space-y-2">
                                     {creditNoteAllocations.map((cn: any, idx) => cn && (
                                         <div key={idx} className="bg-white p-3 rounded-xl border border-orange-100 flex justify-between items-center text-xs">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-2 h-2 rounded-full bg-orange-500" />
                                                 <span className="font-bold text-slate-700">{cn.reference || 'Credit Note'}</span>
                                             </div>
                                             <span className="font-black text-orange-600 tabular-nums">- Ksh {cn.amount.toLocaleString()}</span>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         )}

                         <div className="flex items-center justify-between px-4 pt-4">
                             <span className="text-sm font-black text-slate-400  ">Total Remitted</span>
                             <span className="text-2xl font-black text-purple-600 tabular-nums">Ksh {(selectedRecord.amount || 0).toLocaleString()}</span>
                         </div>
                     </div>
                 )}

                 {/* Purchase Order Details */}
                 {isPO && (
                     <div className="space-y-4">
                         <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 mb-4">
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500"><User size={16} /></div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400  tracking-tight">Supplier</p>
                                      <p className="text-sm font-bold text-slate-900">{supplier?.company || 'Loading...'}</p>
                                  </div>
                              </div>
                         </div>
                         
                         <div className="space-y-3">
                             <p className="text-[10px] font-black text-slate-400   ml-1">
                                 Items
                             </p>
                             {selectedRecord.items.map((item: any, idx: number) => {
                                 const qty = selectedRecord.status === 'RECEIVED' ? item.receivedQuantity : item.expectedQuantity;
                                 return (
                                     <div key={idx} className="flex justify-between items-center text-sm bg-white p-3 rounded-xl border border-slate-100">
                                         <div className="flex-1">
                                             <p className="font-bold text-slate-900">{item.name}</p>
                                             <p className="text-[11px] text-slate-500 font-medium">
                                                 {qty} units @ Ksh {(item.unitCost || 0).toLocaleString()}
                                             </p>
                                         </div>
                                         <span className="font-black text-slate-900">Ksh {(Number(qty * item.unitCost) || 0).toLocaleString()}</span>
                                     </div>
                                 );
                             })}
                         </div>

                         <div className="pt-4 border-t border-dashed border-slate-200 space-y-2 px-1">
                             <div className="flex justify-between items-center">
                                 <span className="text-xs font-bold text-slate-400  ">Paid Amount</span>
                                 <span className="text-sm font-bold text-slate-900">Ksh {(selectedRecord.paidAmount || 0).toLocaleString()}</span>
                             </div>
                             <div className="flex justify-between items-end pt-1">
                                 <span className="text-sm font-black text-slate-400  ">Grand Total</span>
                                 <span className="text-2xl font-black text-blue-600">Ksh {selectedRecord.totalAmount.toLocaleString()}</span>
                             </div>
                         </div>
                     </div>
                 )}

                 {/* Shift Report Details (Z-Report) */}
                 {isReport && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                       {/* Fiscal Header Style */}
                       <div className="text-center py-4 border-b border-dashed border-slate-200">
                          <p className="text-[10px] font-black  tracking-[0.2em] text-slate-400 mb-1">Official Z-Reading</p>
                          <p className="text-xs font-bold text-slate-600">Shift ID: {selectedRecord.shiftId || 'N/A'}</p>
                          <p className="text-xs font-bold text-slate-600">Cashier: {selectedRecord.cashierName}</p>
                       </div>

                       <div className="space-y-3">
                          <div className="flex justify-between text-sm font-bold text-slate-700">
                             <span>Opening Float</span>
                             <span>Ksh {(Number(selectedRecord.openingFloat) || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold text-slate-700">
                             <span>Total Sales (Gross)</span>
                             <span>Ksh {(Number(selectedRecord.grossSales) || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold text-slate-400 italic">
                             <span>- M-Pesa Sales</span>
                             <span>Ksh {(Number(selectedRecord.mpesaSales) || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold text-red-600">
                             <span>Total Expenses</span>
                             <span>- Ksh {(Number(selectedRecord.totalExpenses) || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-sm font-bold text-slate-600">
                             <span>Confirmed Bankings</span>
                             <span>- Ksh {(Number(selectedRecord.totalPicks) || 0).toLocaleString()}</span>
                          </div>
                       </div>

                       <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl space-y-1">
                          <div className="flex justify-between items-center opacity-60 text-[10px] font-black  ">
                             <span>Expected Cash</span>
                             <span>Reported Cash</span>
                          </div>
                          <div className="flex justify-between items-center">
                             <span className="text-lg font-black tracking-tight">Ksh {(Number(selectedRecord.expectedCash) || 0).toLocaleString()}</span>
                             <span className="text-lg font-black tracking-tight underline italic small-caps leading-none px-2 py-1 bg-white/10 rounded">Ksh {(Number(selectedRecord.reportedCash) || 0).toLocaleString()}</span>
                          </div>
                       </div>

                       {/* VARIANCE SECTION */}
                       <div className={`p-5 rounded-[24px] border-2 ${(Number(selectedRecord.difference) || 0) === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                          <div className="flex items-center gap-3 mb-2">
                             <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${(Number(selectedRecord.difference) || 0) === 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                {(Number(selectedRecord.difference) || 0) === 0 ? <CheckCircle2 size={24}/> : <AlertTriangle size={24}/>}
                             </div>
                             <div>
                                <p className="text-[10px] font-black   text-slate-400">Cashier Variance</p>
                                <h4 className={`text-xl font-black ${(Number(selectedRecord.difference) || 0) === 0 ? 'text-green-700' : 'text-red-700'}`}>
                                   Ksh {(Number(selectedRecord.difference) || 0).toLocaleString()}
                                </h4>
                             </div>
                          </div>
                          {(Number(selectedRecord.difference) || 0) !== 0 && (
                             <p className="text-[11px] font-bold text-red-600 leading-relaxed bg-white/50 p-3 rounded-xl border border-red-100 italic">
                                * This discrepancy of Ksh {Math.abs(Number(selectedRecord.difference) || 0).toLocaleString()} has been logged and will be charged to the cashier account for reconciliation.
                             </p>
                          )}
                       </div>

                       <div className="pt-4 border-t border-dashed border-slate-200">
                          <div className="flex justify-between text-[11px] font-black text-slate-400  ">
                             <span>e-TIMS Tax Compliance</span>
                             <span>Total Tax (16%)</span>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                             <span className="text-xs text-slate-500 font-bold italic">Standard VAT Collected</span>
                             <span className="text-sm font-black text-slate-900">Ksh {(Number(selectedRecord.taxTotal) || 0).toLocaleString()}</span>
                          </div>
                       </div>
                    </div>
                 )}
                 {/* Master Daily Summary View */}
                 {isDailySummary && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                       <div className="bg-blue-600 -mx-6 -mt-6 p-8 text-white text-center rounded-b-[40px] shadow-lg">
                          <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-4 border border-white/30 backdrop-blur-md">
                             <TrendingUp size={32} />
                          </div>
                          <h3 className="text-2xl font-black">Daily Performance</h3>
                          <p className="text-blue-100 text-xs font-bold  tracking-[0.2em] mt-2">Overall Store Summary</p>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 text-center">
                             <p className="text-[10px] font-black text-slate-400   mb-1">Total Net Sales</p>
                             <p className="text-2xl font-black text-slate-900">Ksh {(Number(selectedRecord.totalSales) || 0).toLocaleString()}</p>
                          </div>
                          <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 text-center">
                             <p className="text-[10px] font-black text-slate-400   mb-1">Staff Variance</p>
                             <p className={`text-2xl font-black ${(Number(selectedRecord.totalVariance) || 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                Ksh {(Number(selectedRecord.totalVariance) || 0).toLocaleString()}
                             </p>
                          </div>
                       </div>

                       <div className="space-y-4">
                          <div className="flex items-center justify-between px-2">
                             <p className="text-[10px] font-black text-slate-400  tracking-[0.2em]">Expenses & Banking</p>
                             <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{selectedRecord.shiftIds?.length || 0} Shifts Included</span>
                          </div>
                          
                          <div className="space-y-3">
                             <div className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                                <div className="flex gap-3 items-center">
                                   <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center"><Wallet size={20}/></div>
                                   <span className="text-sm font-bold text-slate-700">Daily Expenses</span>
                                </div>
                                <span className="text-sm font-black text-red-600">- Ksh {(Number(selectedRecord.totalExpenses) || 0).toLocaleString()}</span>
                             </div>
                             <div className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                                <div className="flex gap-3 items-center">
                                   <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center"><Banknote size={20}/></div>
                                   <span className="text-sm font-bold text-slate-700">Bank Deposits</span>
                                </div>
                                <span className="text-sm font-black text-slate-900">- Ksh {(Number(selectedRecord.totalPicks) || 0).toLocaleString()}</span>
                             </div>
                          </div>
                       </div>

                       <div className="pt-6 border-t border-dashed border-slate-200">
                          <div className="flex justify-between items-end border-b border-slate-100 pb-4">
                             <div>
                                <p className="text-[10px] font-black text-slate-400   mb-1">Tax Audit</p>
                                <h4 className="text-sm font-bold text-slate-500">e-TIMS 16% VAT Summary</h4>
                             </div>
                             <div className="text-right">
                                <p className="text-2xl font-black text-blue-600">Ksh {selectedRecord.taxTotal.toLocaleString()}</p>
                                <p className="text-[9px] font-black text-blue-400  ">Total VAT Collected</p>
                             </div>
                          </div>
                          
                          <div className="flex flex-col items-center justify-center py-6 gap-2 opacity-30 italic">
                              <ShieldCheck className="text-slate-400" size={24} />
                              <p className="text-[10px] font-bold text-slate-500 text-center">Verified Daily Business Closure Record. All shifts confirmed and ledger entries finalized.</p>
                          </div>
                       </div>
                    </div>
                 )}
             </div>
            </div>
         </div>

         {/* Footer Actions - Sticky at bottom */}
          <div className="p-4 flex flex-col gap-2 bg-white border-t border-slate-100 no-print shadow-[0_-4px_12px_rgba(0,0,0,0.03)] relative z-20">
            {/* LPO Receiving Action */}
            {onReceive && isPO && selectedRecord.approvalStatus === 'APPROVED' && selectedRecord.status === 'PENDING' && (
               <button
                 onClick={() => { onReceive(selectedRecord); setSelectedRecord(null); }}
                 className="w-full py-3.5 bg-blue-600 text-white font-black text-xs   rounded-xl transition-colors active:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
               >
                 <PackagePlus size={16} /> Receive Items
               </button>
            )}

            {/* Approval Actions */}
            {isAdmin && onApprove && onReject && (
              (selectedRecord?.recordType === 'PURCHASE_ORDER' && selectedRecord?.approvalStatus === 'PENDING') ||
              (selectedRecord?.recordType === 'EXPENSE' && selectedRecord?.status === 'PENDING') ||
              (selectedRecord?.recordType === 'SALE' && selectedRecord?.status === 'PENDING_REFUND')
            ) && (
              <div className="flex gap-2">
                <button
                  onClick={async () => { await onApprove(selectedRecord); setSelectedRecord(null); }}
                  className="flex-1 py-3.5 bg-green-600 text-white font-black text-xs   rounded-xl transition-colors active:bg-green-700 flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                >
                  <CheckCircle2 size={16} /> Approve
                </button>
                <button
                  onClick={async () => { await onReject(selectedRecord); setSelectedRecord(null); }}
                  className="flex-1 py-3.5 bg-red-600 text-white font-black text-xs   rounded-xl transition-colors active:bg-red-700 flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
                >
                  <AlertTriangle size={16} /> Reject
                </button>
              </div>
            )}

            {/* Share via native share sheet (WhatsApp, Gmail on Android/iOS) */}
            <button
              onClick={handleShare}
              disabled={isSharing || isSavingPDF}
              className="w-full py-3.5 bg-slate-900 text-white font-bold text-[10px]   rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
            >
              {isSharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              {isSharing ? 'Generating PDF...' : 'Share PDF  (WhatsApp / Gmail)'}
            </button>

            <div className="flex gap-2">
              {/* Save PDF — direct download */}
              <button
                onClick={handleSavePDF}
                disabled={isSharing || isSavingPDF}
                className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold text-[10px]   rounded-xl flex items-center justify-center gap-2 transition-colors active:bg-slate-100 disabled:opacity-50"
              >
                {isSavingPDF ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                {isSavingPDF ? 'Saving...' : 'Save PDF'}
              </button>

              <button
                onClick={() => { setIsReturnMode(false); setSelectedRecord(null); }}
                className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold text-[10px]   rounded-xl transition-colors active:bg-slate-100"
              >
                {isReturnMode ? 'Cancel' : 'Close'}
              </button>
            </div>
            
            {isSale && (
                isReturnMode ? (
                  <button 
                    onClick={onInitiateRefund}
                    disabled={Object.values(returnQuantities).every(q => q === 0)}
                    className="col-span-2 py-3.5 bg-red-600 text-white font-black text-xs   rounded-xl disabled:opacity-50 transition-colors active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-red-600/20"
                   >
                     <CheckCircle2 size={16} /> Confirm {isAdmin ? 'Return' : 'Request'}
                   </button>
                ) : (
                  <button 
                    onClick={() => setIsReturnMode(true)} 
                    disabled={selectedRecord.status !== 'PAID' && selectedRecord.status !== 'PARTIAL_REFUND'}
                    className="col-span-2 py-3.5 bg-orange-600 text-white font-black text-xs   rounded-xl disabled:opacity-50 transition-colors active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-orange-600/20"
                  >
                    <RotateCcw size={16} /> {isAdmin ? 'Process Return' : 'Request Return'}
                  </button>
                )
            )}
         </div>
       </div>

      {isAdminVerifying && (
         <AdminVerificationModal 
            actionDescription={`Authorize Refund for Receipt #${String(selectedRecord.id || '').split('-')[0].toUpperCase()}`}
            onSuccess={onConfirmRefund}
            onCancel={() => setIsAdminVerifying(false)}
         />
      )}
    </div>
  );
}
