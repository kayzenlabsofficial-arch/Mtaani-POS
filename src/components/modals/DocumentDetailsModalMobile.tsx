import React, { useState } from 'react';
import { ReceiptText, RotateCcw, Minus, Plus, Wallet, Landmark, DollarSign, Calendar, User, Hash, FileText, CheckCircle2, CreditCard, Banknote, ClipboardList, PackagePlus, Printer, Link, Loader2, Share2, CheckSquare } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { generateAndShareDocument } from '../../utils/shareUtils';
import { getAssignedHardware, printReceiptViaAssignedPrinter } from '../../utils/hardware';
import { CalendarCheck, AlertTriangle, ArrowRight, TrendingUp, ShieldCheck } from 'lucide-react';
import { useStore } from '../../store';
import AdminVerificationModal from './AdminVerificationModalMobile';
import { useToast } from '../../context/ToastContext';
import { getBusinessSettings } from '../../utils/settings';

interface DocumentDetailsModalProps {
  selectedRecord: any | null; // Can be Transaction, Expense, or SupplierPayment
  setSelectedRecord: (record: any | null) => void;
  handleRefund: (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => Promise<void>;
  onApprove?: (record: any) => Promise<void>;
  onReject?: (record: any) => Promise<void>;
  onReceive?: (record: any) => void;
}

const moneyText = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

const sentenceValue = (value: unknown, fallback = '') => {
  const text = String(value || fallback).replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
};

const parseList = (value: any): any[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const reportValue = (record: any, key: string) => {
  if (key === 'remittanceTotal') {
    const rawRemittance = Number(record?.remittanceTotal ?? ((Number(record?.supplierPaymentsTotal) || 0) + (Number(record?.totalExpenses) || 0))) || 0;
    return Math.min(Number(record?.cashSales) || 0, rawRemittance);
  }
  return Number(record?.[key]) || 0;
};

const reportShiftLabel = (record: any, index: number) => {
  const cashier = String(record?.cashierName || '').trim();
  if (cashier) return cashier;
  const id = String(record?.shiftId || record?.id || '').split('-')[0].slice(0, 8).toUpperCase();
  return id || `Shift ${index + 1}`;
};

export default function DocumentDetailsModalMobile({ selectedRecord, setSelectedRecord, handleRefund, onApprove, onReject, onReceive }: DocumentDetailsModalProps) {
  const [returnQuantities, setReturnQuantities] = useState<{ [productId: string]: number }>({});
  const [isReturnMode, setIsReturnMode] = useState(false);
  const [isAdminVerifying, setIsAdminVerifying] = useState(false);
  const { success, error: toastError } = useToast();
  const isAdmin = useStore(state => state.isAdmin);
  const [isSharing, setIsSharing] = useState(false);
  const [isSavingPDF, setIsSavingPDF] = useState(false);
  const [isHardwarePrinting, setIsHardwarePrinting] = useState(false);
  const [isApprovalActionRunning, setIsApprovalActionRunning] = useState(false);

  const activeBusinessId = useStore(state => state.activeBusinessId);
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const storeName = businessSettings?.storeName || 'Mtaani POS';
  const storeLocation = businessSettings?.location || 'Nairobi, Kenya';
  // Fetch contextual data based on record type
  const supplier = useLiveQuery(
    () => (selectedRecord?.recordType === 'SUPPLIER_PAYMENT' || selectedRecord?.recordType === 'PURCHASE_ORDER' || selectedRecord?.recordType === 'CREDIT_NOTE') 
      ? db.suppliers.get(selectedRecord.supplierId) 
      : null,
    [selectedRecord]
  );
  
  const linkedInvoice = useLiveQuery(
    () => (selectedRecord?.recordType === 'SUPPLIER_PAYMENT' && selectedRecord.purchaseOrderId) ? db.purchaseOrders.get(selectedRecord.purchaseOrderId) : null,
    [selectedRecord]
  );

  const paymentAllocations = useLiveQuery(
    async () => {
        if (selectedRecord?.recordType !== 'SUPPLIER_PAYMENT') return [];
        const invoiceAllocations = parseList(selectedRecord.invoiceAllocations);
        const allocatedIds = invoiceAllocations.map((allocation: any) => String(allocation.purchaseOrderId || '').trim()).filter(Boolean);
        const ids = allocatedIds.length > 0
          ? allocatedIds
          : (parseList(selectedRecord.purchaseOrderIds).length > 0 ? parseList(selectedRecord.purchaseOrderIds) : (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []));
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
  const isRefund = selectedRecord.recordType === 'REFUND';
  const isExpense = selectedRecord.recordType === 'EXPENSE';
  const isPayment = selectedRecord.recordType === 'SUPPLIER_PAYMENT';
  const isCreditNote = selectedRecord.recordType === 'CREDIT_NOTE';
  const isSalesInvoice = selectedRecord.recordType === 'SALES_INVOICE';
  const isPO = selectedRecord.recordType === 'PURCHASE_ORDER';
  const isReport = selectedRecord.recordType === 'CLOSE_DAY_REPORT';
  const isDailySummary = selectedRecord.recordType === 'DAILY_SUMMARY';
  const reportRows: Array<{ label: string; key: string; negative?: boolean; highlight?: boolean; total?: boolean }> = [
    { label: 'Cash Sale', key: 'cashSales' },
    { label: 'M-Pesa Sales', key: 'mpesaSales' },
    { label: 'PDQ Sales', key: 'pdqSales' },
    { label: 'Refunds', key: 'totalRefunds', negative: true },
    { label: 'Remittance (Supplier payments + Expenses)', key: 'remittanceTotal', negative: true },
    { label: 'Cash Picked', key: 'totalPicks' },
    { label: 'Cashier Variance', key: 'difference', highlight: true },
    { label: 'Gross Sales', key: 'grossSales', total: true },
    { label: 'VAT', key: 'taxTotal', total: true },
  ];
  const dailyShiftReports = parseList(selectedRecord.shiftReports);
  const recordTimestamp = Number(selectedRecord.issueDate || selectedRecord.orderDate || selectedRecord.timestamp || Date.now());
  const recordDate = new Date(recordTimestamp);
  const saleReference = String(selectedRecord.receiptNumber || selectedRecord.invoiceNumber || selectedRecord.reference || selectedRecord.id || 'SALE').split('-')[0].toUpperCase();
  const shopName = String(selectedRecord.shopName || storeName || 'Main shop');
  const businessAddress = selectedRecord.businessAddress || storeLocation;
  const tillNumber = selectedRecord.tillNumber || businessSettings?.tillNumber || 'N/A';
  const receiptFooter = selectedRecord.receiptFooter || businessSettings?.receiptFooter || 'Thank you for shopping!';
  const cashierName = selectedRecord.cashierName || selectedRecord.preparedBy || selectedRecord.userName || 'Staff';
  const shiftNumber = selectedRecord.shiftId ? String(selectedRecord.shiftId).replace(/^shift_/, '').slice(-16).toUpperCase() : 'N/A';
  const paymentType = (method: unknown) => {
    const value = String(method || 'CASH').toUpperCase();
    if (value === 'MPESA') return 'M-Pesa';
    if (value === 'PDQ') return 'Card';
    if (value === 'SPLIT') return 'Split';
    if (value === 'CREDIT') return 'Credit';
    return 'Cash';
  };
  const withReceiptDetails = (record: any) => ({
    ...record,
    shopName: record.shopName || storeName,
    tillNumber: record.tillNumber || businessSettings?.tillNumber,
    businessAddress: record.businessAddress || storeLocation,
    receiptFooter: record.receiptFooter || receiptFooter,
  });
  const supplierInvoiceAllocations = parseList(selectedRecord.invoiceAllocations);
  const supplierInvoiceAllocationAmount = new Map(
    supplierInvoiceAllocations
      .map((allocation: any) => [String(allocation.purchaseOrderId || '').trim(), Number(allocation.amount || 0)] as const)
      .filter(([id, amount]) => id && amount > 0)
  );
  const creditNoteItems = parseList(selectedRecord.items);
  const refundItems = parseList(selectedRecord.items);

  const runApprovalAction = async (action: (record: any) => Promise<void>) => {
    if (isApprovalActionRunning) return;
    setIsApprovalActionRunning(true);
    try {
      await action(selectedRecord);
      setSelectedRecord(null);
    } finally {
      setIsApprovalActionRunning(false);
    }
  };

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
      const typeLabel = isSale ? 'Receipt' : isRefund ? 'Refund' : isExpense ? 'Expense' : isPayment ? 'Supplier-Payment' : isCreditNote ? 'Credit-Note' : isSalesInvoice ? 'Invoice' : isPO ? 'LPO' : isReport ? 'Shift-Report' : 'Summary';
      const filename = `${typeLabel}-${String(selectedRecord.id || '').split('-')[0].toUpperCase()}`;
      
      const recordWithDetails = withReceiptDetails(selectedRecord);
      if (isPayment) {
        const invoiceAllocations = parseList(selectedRecord.invoiceAllocations);
        const allocationAmountById = new Map(invoiceAllocations.map((allocation: any) => [String(allocation.purchaseOrderId || '').trim(), Number(allocation.amount || 0)] as const));
        const pIds = invoiceAllocations.length > 0
          ? invoiceAllocations.map((allocation: any) => allocation.purchaseOrderId).filter(Boolean)
          : (parseList(selectedRecord.purchaseOrderIds).length > 0 ? parseList(selectedRecord.purchaseOrderIds) : (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []));
        const pos = await db.purchaseOrders.bulkGet(pIds);
        recordWithDetails.invoiceDetails = pos.filter(Boolean).map(p => ({ 
          date: p.orderDate, 
          ref: p.invoiceNumber || String(p.id || '').split('-')[0], 
          amount: allocationAmountById.get(p.id) || p.totalAmount 
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
      const typeLabel = isSale ? 'Receipt' : isRefund ? 'Refund' : isExpense ? 'Expense' : isPayment ? 'Supplier-Payment' : isCreditNote ? 'Credit-Note' : isSalesInvoice ? 'Invoice' : isPO ? 'LPO' : isReport ? 'Shift-Report' : 'Summary';
      const filename = `${typeLabel}-${String(selectedRecord.id || '').split('-')[0].toUpperCase()}`;

      const recordWithDetails = withReceiptDetails(selectedRecord);
      if (isPayment) {
        const invoiceAllocations = parseList(selectedRecord.invoiceAllocations);
        const allocationAmountById = new Map(invoiceAllocations.map((allocation: any) => [String(allocation.purchaseOrderId || '').trim(), Number(allocation.amount || 0)] as const));
        const pIds = invoiceAllocations.length > 0
          ? invoiceAllocations.map((allocation: any) => allocation.purchaseOrderId).filter(Boolean)
          : (parseList(selectedRecord.purchaseOrderIds).length > 0 ? parseList(selectedRecord.purchaseOrderIds) : (selectedRecord.purchaseOrderId ? [selectedRecord.purchaseOrderId] : []));
        const pos = await db.purchaseOrders.bulkGet(pIds);
        recordWithDetails.invoiceDetails = pos.filter(Boolean).map(p => ({ 
          date: p.orderDate, 
          ref: p.invoiceNumber || String(p.id || '').split('-')[0], 
          amount: allocationAmountById.get(p.id) || p.totalAmount 
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

  const handleHardwarePrint = async () => {
    if (!selectedRecord || !isSale) return;
    setIsHardwarePrinting(true);
    try {
      const assignedPrinter = getAssignedHardware('RECEIPT_PRINTER');
      if (!assignedPrinter || assignedPrinter.transport === 'BROWSER_PRINT') {
        window.print();
        success('Choose a printer in Chrome.');
        return;
      }

      const recordWithDetails = withReceiptDetails(selectedRecord);
      const result = await printReceiptViaAssignedPrinter(recordWithDetails, {
        storeName,
        location: storeLocation,
      });
      result.ok ? success(result.message) : toastError(result.message);
    } catch (err: any) {
      toastError(err?.message || 'Could not print receipt.');
    } finally {
      setIsHardwarePrinting(false);
    }
  };

  const handleBrowserPrint = () => {
    window.print();
    success('Choose a printer in Chrome.');
  };


  return (
    <div className={`mobile-vv-overlay fixed inset-0 z-50 flex items-center justify-center ${isSale ? 'p-0 sm:p-4' : 'p-4'}`}>
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setSelectedRecord(null)} />
      <div className={`mobile-vv-panel bg-white w-full ${isSale ? 'max-w-5xl h-full sm:h-[94vh]' : 'max-w-2xl h-full sm:h-[90vh]'} sm:rounded-2xl shadow-elevated relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-300`}>
         
         {/* Scrollable Content Area */}
         <div className={`modal-scroll-padding flex-1 overflow-y-auto custom-scrollbar ${isSale ? 'bg-slate-100' : ''}`}>
            <div id="printable-content" className={isSale ? "print-receipt-80mm mx-auto my-4 w-full max-w-[380px] bg-white shadow-xl ring-1 ring-slate-200 sm:my-8 print:my-0 print:shadow-none print:ring-0" : "print-document-a4"}>
              {/* Header */}
              <div className={`p-8 border-b flex flex-col items-center text-center ${
                 isSale ? 'bg-green-50/50 border-green-100' : 
                 isRefund ? 'bg-rose-50/50 border-rose-100' :
                 isExpense ? 'bg-orange-50/50 border-orange-100' : 
                 isPayment ? 'bg-purple-50/50 border-purple-100' :
                 isCreditNote ? 'bg-blue-50/50 border-blue-100' :
                 'bg-blue-50/50 border-blue-100'
              } print:bg-white print:border-slate-300`}>
                  <div className={`w-14 h-14 rounded-3xl flex items-center justify-center mb-4 no-print ${
                     isSale ? 'bg-green-100 text-green-600' : 
                     isRefund ? 'bg-rose-100 text-rose-600' :
                     isExpense ? 'bg-orange-100 text-orange-600' : 
                     isPayment ? 'bg-purple-100 text-purple-600' :
                     isCreditNote ? 'bg-blue-100 text-blue-600' :
                     isSalesInvoice ? 'bg-blue-100 text-blue-600' :
                     isReport ? 'bg-slate-900 text-white' :
                     isDailySummary ? 'bg-blue-600 text-white' :
                     'bg-blue-100 text-blue-600'
                  }`}>
                     {isSale ? <ReceiptText size={28} /> : isRefund ? <RotateCcw size={28} /> : isExpense ? <Wallet size={28} /> : isPayment ? <DollarSign size={28} /> : isCreditNote ? <RotateCcw size={28} /> : isSalesInvoice ? <FileText size={28} /> : isReport ? <CalendarCheck size={28} /> : isDailySummary ? <PackagePlus size={28} /> : <ClipboardList size={28} />}
                  </div>
                  <h2 className={`${isSale ? 'text-xl print:text-[12pt]' : 'text-2xl'} font-black text-slate-900 tracking-tight`}>
                     {isSale ? storeName : 
                      isRefund ? 'Refund document' :
                      isExpense ? `Expense document` : 
                      isPayment ? 'Supplier payment note' :
                      isCreditNote ? 'Supplier credit note' :
                      isSalesInvoice ? 'Customer invoice' :
                      isReport ? 'End of shift report' :
                      isDailySummary ? 'Daily close report' :
                      (isPO && selectedRecord.approvalStatus === 'PENDING') ? 'LPO waiting approval' :
                      isPO ? 'Local purchase order' :
                      `Purchase document`}
                  </h2>
                  {isSale && (
                    <div className="mt-1 space-y-0.5 text-[11px] font-bold text-slate-600 print:text-[8pt]">
                      <p>{businessAddress}</p>
                      <p>{shopName}</p>
                    </div>
                  )}
                  <p className="text-xs font-bold text-slate-500  tracking-[0.2em] mt-1">
                      {isSale ? 'Receipt' : isRefund ? 'Original receipt' : 'Reference'}: {isSale ? saleReference : isRefund ? (selectedRecord.receiptNumber || String(selectedRecord.originalTransactionId || '').split('-')[0].toUpperCase()) : (selectedRecord.reference || selectedRecord.invoiceNumber || (String(selectedRecord.id || '').startsWith('PO-') ? selectedRecord.id : String(selectedRecord.id || '').split('-')[0].toUpperCase()))}
                  </p>
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 mt-2  ">
                     <Calendar size={12} /> {recordDate.toLocaleString('en-KE')}
                  </div>
                  <div className="flex flex-col items-center gap-2 mt-4 bg-slate-50/50 p-3 rounded-2xl border border-slate-100/50 min-w-[200px]">
                      <div className="text-[10px] font-black text-slate-600 flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                             <User size={10} />
                          </div>
                          <span className=" ">{isSale ? 'Cashier:' : isRefund ? 'Processed by:' : 'Prepared by:'}</span>
                          <span className="text-blue-600 font-bold">{cashierName}</span>
                       </div>

                     {(isPO || isExpense || selectedRecord.recordType === 'STOCK_ADJUSTMENT') && (
                        <div className="text-[10px] font-black text-slate-600 flex items-center gap-2">
                            <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${selectedRecord.approvedBy ? 'bg-blue-50 border-blue-100 text-blue-500' : 'bg-slate-100 border-slate-200 text-slate-400'}`}>
                               <CheckSquare size={10} />
                            </div>
                            <span className=" ">Approved by:</span>
                            <span className={selectedRecord.approvedBy ? "text-blue-600 font-bold" : "text-slate-400 italic"}>{selectedRecord.approvedBy || 'Pending admin'}</span>
                        </div>
                     )}
                  </div>
                  {isSale && (
                    <div className="mt-3 grid w-full max-w-sm grid-cols-2 gap-2 text-left print:max-w-none print:gap-1">
                      {[
                        { label: 'Date', value: recordDate.toLocaleDateString('en-KE') },
                        { label: 'Time', value: recordDate.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }) },
                        { label: 'Payment', value: paymentType(selectedRecord.paymentMethod) },
                        { label: 'Till', value: tillNumber },
                        { label: 'Shift', value: shiftNumber },
                        { label: 'Receipt', value: saleReference },
                      ].map(item => (
                        <div key={item.label} className="rounded-xl border border-slate-100 bg-white px-2 py-1.5 print:border-0 print:p-0">
                          <p className="text-[8px] font-black uppercase tracking-widest text-slate-400 print:text-[6pt]">{item.label}</p>
                          <p className="mt-0.5 break-words text-[10px] font-black text-slate-800 print:text-[7pt]">{item.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {isSale && (
                     <span className={`mt-4 text-[10px] font-black px-3 py-1 rounded-full   no-print ${
                         selectedRecord.status === 'PAID' ? 'bg-green-100 text-green-700' : 
                         selectedRecord.status === 'REFUNDED' ? 'bg-orange-100 text-orange-700' : 
                         'bg-blue-100 text-blue-700'
                     }`}>
                         {selectedRecord.status === 'PAID' ? 'Paid' : selectedRecord.status === 'REFUNDED' ? 'Refunded' : selectedRecord.status === 'PARTIAL_REFUND' ? 'Part refund' : selectedRecord.status}
                     </span>
                  )}
                  {isSalesInvoice && (
                     <span className={`mt-4 text-[10px] font-black px-3 py-1 rounded-full no-print ${
                         selectedRecord.status === 'PAID' ? 'bg-green-100 text-green-700' :
                         selectedRecord.status === 'PARTIAL' ? 'bg-amber-100 text-amber-700' :
                         selectedRecord.status === 'CANCELLED' ? 'bg-slate-100 text-slate-500' :
                         'bg-blue-100 text-blue-700'
                     }`}>
                         {selectedRecord.status === 'SENT' ? 'Unpaid' : selectedRecord.status === 'PAID' ? 'Paid' : selectedRecord.status === 'PARTIAL' ? 'Part cleared' : selectedRecord.status === 'CANCELLED' ? 'Cancelled' : selectedRecord.status}
                     </span>
                  )}
                  {isCreditNote && (
                     <span className={`mt-4 text-[10px] font-black px-3 py-1 rounded-full no-print ${
                         selectedRecord.status === 'ALLOCATED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                     }`}>
                         {sentenceValue(selectedRecord.status, 'PENDING')}
                     </span>
                  )}
                  {isRefund && (
                     <span className="mt-4 text-[10px] font-black px-3 py-1 rounded-full no-print bg-rose-100 text-rose-700">
                         {sentenceValue(selectedRecord.status, 'APPROVED')}
                     </span>
                  )}
              </div>

              {/* Content */}
              <div className={isSale ? "p-5 space-y-4 print:p-2 print:space-y-2" : "p-6 space-y-5"}>
                 
                 {/* Refund Details */}
                 {isRefund && (
                    <div className="space-y-5">
                       <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Original receipt', value: selectedRecord.receiptNumber || String(selectedRecord.originalTransactionId || '').split('-')[0].toUpperCase() },
                            { label: 'Payment source', value: sentenceValue(selectedRecord.source || selectedRecord.paymentMethod, 'TILL') },
                            { label: 'Shift', value: shiftNumber },
                            { label: 'Approved by', value: selectedRecord.approvedBy || 'Admin' },
                          ].map(item => (
                            <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                              <p className="mt-1 break-words text-sm font-black text-slate-900">{item.value}</p>
                            </div>
                          ))}
                       </div>

                       <div className="space-y-3">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Refunded items</p>
                          {refundItems.length > 0 ? refundItems.map((item: any, idx: number) => (
                            <div key={`${item.productId || idx}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white p-3 text-sm">
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-bold text-slate-900">{item.name || 'Returned item'}</p>
                                <p className="text-[11px] font-medium text-slate-500">{Number(item.quantity || 0).toLocaleString()} units</p>
                              </div>
                              <span className="font-black tabular-nums text-rose-700">{moneyText(item.amount || 0)}</span>
                            </div>
                          )) : (
                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm font-bold text-slate-500">
                              Item details were not captured for this refund.
                            </div>
                          )}
                       </div>

                       <div className="border-t border-dashed border-slate-200 pt-4 space-y-2">
                          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                            <span>Original payment</span>
                            <span>{paymentType(selectedRecord.paymentMethod)}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                            <span>Cash deducted from drawer</span>
                            <span>{moneyText(selectedRecord.cashAmount || 0)}</span>
                          </div>
                          <div className="flex items-end justify-between pt-2">
                            <span className="text-sm font-black text-slate-400">Refund total</span>
                            <span className="text-2xl font-black text-rose-700">{moneyText(selectedRecord.amount || 0)}</span>
                          </div>
                       </div>
                    </div>
                 )}

                 {/* Sales Items */}
                 {isSale && (
                     <>
                         <div className="space-y-4">
                             {selectedRecord.items.map((item: any, idx: number) => {
                                 const alreadyReturned = item.returnedQuantity || 0;
                                 const availableToReturn = item.quantity - alreadyReturned;
                                 return (
                                     <div key={idx} className="flex justify-between items-center gap-3 text-sm print:text-[8pt]">
                                         <div className="flex-1">
                                             <p className="font-bold text-slate-900">{item.name}</p>
                                             <p className="text-[11px] text-slate-500 font-medium">
                                                 {item.quantity} units @ Ksh {item.snapshotPrice.toLocaleString()} 
                                                 {alreadyReturned > 0 && <span className="text-orange-600 ml-1">({alreadyReturned} returned)</span>}
                                             </p>
                                             {Number(item.discountAmount || 0) > 0 && (
                                                <p className="text-[10px] font-black text-rose-500">
                                                  Discount: -Ksh {(Number(item.discountAmount || 0) * Number(item.quantity || 0)).toLocaleString()}
                                                </p>
                                             )}
                                         </div>
                                         {isReturnMode ? (
                                             <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1 border border-slate-200">
                                                 <button onClick={() => updateReturnQty(item.productId, -1, availableToReturn)} className="p-1 hover:bg-slate-200 rounded text-slate-600"><Minus size={12} /></button>
                                                 <span className="w-5 text-center font-black text-xs">{returnQuantities[item.productId] || 0}</span>
                                                 <button onClick={() => updateReturnQty(item.productId, 1, availableToReturn)} className="p-1 hover:bg-slate-200 rounded text-slate-600"><Plus size={12} /></button>
                                             </div>
                                         ) : (
                                             <span className="shrink-0 font-black text-slate-900">Ksh {(item.quantity * item.snapshotPrice).toLocaleString()}</span>
                                         )}
                                     </div>
                                 );
                             })}
                         </div>
                         {!isReturnMode && (
                             <div className="pt-4 border-t border-dashed border-slate-200 space-y-2">
                                  <div className="flex justify-between text-xs font-bold text-slate-500  tracking-tight">
                                     <span>Payment</span>
                                     <span>{paymentType(selectedRecord.paymentMethod)}</span>
                                  </div>
                                  <div className="flex justify-between text-xs font-bold text-slate-500  tracking-tight">
                                     <span>Subtotal</span>
                                     <span>Ksh {selectedRecord.subtotal.toLocaleString()}</span>
                                  </div>
                                  {selectedRecord.discountAmount > 0 && (
                                     <div className="flex justify-between text-xs font-bold text-orange-600  tracking-tight">
                                         <span>Total discount</span>
                                         <span>-Ksh {selectedRecord.discountAmount.toLocaleString()}</span>
                                     </div>
                                  )}
                                  <div className="flex justify-between text-xs font-bold text-slate-500  tracking-tight">
                                     <span>Tax (16%)</span>
                                     <span>Ksh {selectedRecord.tax.toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between items-end pt-2">
                                     <span className="text-sm font-black text-slate-400  ">{selectedRecord.debtBalance !== undefined ? 'Sale total' : 'Total paid'}</span>
                                     <span className="text-2xl font-black text-slate-900">Ksh {(selectedRecord.total || 0).toLocaleString()}</span>
                                  </div>
                                  {selectedRecord.amountTendered && (
                                     <div className="flex justify-between text-xs font-bold text-slate-500  tracking-tight">
                                        <span>Cash received</span>
                                        <span>Ksh {(selectedRecord.amountTendered || 0).toLocaleString()}</span>
                                     </div>
                                  )}
                                  {selectedRecord.debtBalance !== undefined && (
                                    <div className="grid grid-cols-2 gap-2 pt-2">
                                      <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3">
                                        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Credit paid</p>
                                        <p className="text-sm font-black text-emerald-700">Ksh {(selectedRecord.debtPaidAmount || 0).toLocaleString()}</p>
                                      </div>
                                      <div className="rounded-xl bg-rose-50 border border-rose-100 p-3 text-right">
                                        <p className="text-[9px] font-black text-rose-600 uppercase tracking-widest">Outstanding</p>
                                        <p className="text-sm font-black text-rose-700">Ksh {(selectedRecord.debtBalance || 0).toLocaleString()}</p>
                                      </div>
                                    </div>
                                  )}
                                  {selectedRecord.amountTendered && selectedRecord.amountTendered > selectedRecord.total && (
                                     <div className="flex justify-between items-center text-green-700 bg-green-50 p-2 rounded-xl border border-green-100 mt-2">
                                         <span className="text-[10px] font-black  ">Change given</span>
                                         <span className="text-lg font-black italic">Ksh {(selectedRecord.amountTendered - selectedRecord.total).toLocaleString()}</span>
                                     </div>
                                  )}
                                  <div className="border-t border-dashed border-slate-200 pt-4 text-center text-[11px] font-bold text-slate-500 print:pt-2 print:text-[7pt]">
                                    <p>{receiptFooter}</p>
                                    <p className="mt-1">Keep this receipt for returns</p>
                                  </div>
                             </div>
                         )}
                     </>
                 )}

                 {isSalesInvoice && (
                    <div className="space-y-4">
                       <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <p className="text-[10px] font-black text-slate-400 mb-2">Customer</p>
                          <p className="text-sm font-bold text-slate-900">{selectedRecord.customerName}</p>
                          <p className="text-xs font-bold text-slate-500">{selectedRecord.customerPhone || 'No phone'}</p>
                       </div>
                       <div className="space-y-3">
                          {selectedRecord.items.map((item: any, idx: number) => {
                            const amount = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
                            const tax = item.taxCategory === 'A' ? amount * 0.16 : 0;
                            return (
                              <div key={idx} className="flex justify-between items-center text-sm bg-white p-3 rounded-xl border border-slate-100">
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-slate-900 truncate">{item.name}</p>
                                  <p className="text-[11px] text-slate-500 font-medium">{item.quantity} x Ksh {(item.unitPrice || 0).toLocaleString()} {item.taxCategory === 'A' ? '+ VAT' : ''}</p>
                                </div>
                                <span className="font-black text-slate-900">Ksh {(amount + tax).toLocaleString()}</span>
                              </div>
                            );
                          })}
                       </div>
                       <div className="pt-4 border-t border-dashed border-slate-200 space-y-2">
                          <div className="flex justify-between text-xs font-bold text-slate-500">
                            <span>Before VAT</span>
                            <span>Ksh {(selectedRecord.subtotal || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-xs font-bold text-slate-500">
                            <span>VAT</span>
                            <span>Ksh {(selectedRecord.tax || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-xs font-bold text-emerald-600">
                            <span>Paid</span>
                            <span>Ksh {(selectedRecord.paidAmount || 0).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-end pt-2">
                            <span className="text-sm font-black text-slate-400">Balance</span>
                            <span className="text-2xl font-black text-blue-600">Ksh {(selectedRecord.balance || 0).toLocaleString()}</span>
                          </div>
                       </div>
                    </div>
                 )}

                 {/* Expense Details */}
                 {isExpense && (
                     <div className="space-y-4">
                         <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                              <p className="text-[10px] font-black text-slate-400   mb-2">Description</p>
                              <p className="text-sm font-bold text-slate-700 leading-relaxed">{selectedRecord.description || 'No description provided.'}</p>
                         </div>
                         <div className="flex items-center justify-between px-4">
                             <span className="text-sm font-black text-slate-400  ">Amount spent</span>
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
                                          <p className="text-[9px] font-black text-green-500  tracking-tight">Linked invoice</p>
                                          <p className="text-sm font-bold text-slate-900">#{linkedInvoice.invoiceNumber || String(linkedInvoice.id || '').split('-')[0].toUpperCase()}</p>
                                      </div>
                                  </div>
                              )}
                         </div>
                         
                         {/* Payment Allocations Section */}
                         {paymentAllocations && paymentAllocations.length > 0 && (
                             <div className="space-y-3 mt-6">
                                 <p className="text-[10px] font-black text-slate-400   flex items-center gap-2">
                                     <Link size={10} /> Paid invoices
                                 </p>
                                 <div className="space-y-2">
                                     {paymentAllocations.map((po: any, idx) => po && (
                                         <div key={idx} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center text-xs">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-2 h-2 rounded-full bg-blue-500" />
                                                 <span className="font-bold text-slate-700">Inv #{po.invoiceNumber || String(po.id || '').split('-')[0].toUpperCase()}</span>
                                             </div>
                                             <span className="font-black text-slate-900 tabular-nums">Ksh {(supplierInvoiceAllocationAmount.get(po.id) || po.totalAmount).toLocaleString()}</span>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         )}

                         {/* Credit Note Allocations Section */}
                         {creditNoteAllocations && creditNoteAllocations.length > 0 && (
                             <div className="space-y-3 mt-4">
                                 <p className="text-[10px] font-black text-orange-500   flex items-center gap-2">
                                     <RotateCcw size={10} /> Applied credits
                                 </p>
                                 <div className="space-y-2">
                                     {creditNoteAllocations.map((cn: any, idx) => cn && (
                                         <div key={idx} className="bg-white p-3 rounded-xl border border-orange-100 flex justify-between items-center text-xs">
                                             <div className="flex items-center gap-2">
                                                 <div className="w-2 h-2 rounded-full bg-orange-500" />
                                                 <span className="font-bold text-slate-700">{cn.reference || 'Credit note'}</span>
                                             </div>
                                             <span className="font-black text-orange-600 tabular-nums">- Ksh {cn.amount.toLocaleString()}</span>
                                         </div>
                                     ))}
                                 </div>
                             </div>
                         )}

                         <div className="flex items-center justify-between px-4 pt-4">
                             <span className="text-sm font-black text-slate-400  ">Total remitted</span>
                             <span className="text-2xl font-black text-purple-600 tabular-nums">Ksh {(selectedRecord.amount || 0).toLocaleString()}</span>
                         </div>
                     </div>
                 )}

                 {/* Supplier Credit Note Details */}
                 {isCreditNote && (
                     <div className="space-y-4">
                         <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-3">
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500"><User size={16} /></div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400 tracking-tight">Supplier</p>
                                      <p className="text-sm font-bold text-slate-900">{supplier?.company || 'Loading...'}</p>
                                  </div>
                              </div>
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500"><Hash size={16} /></div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400 tracking-tight">Status</p>
                                      <p className="text-sm font-bold text-slate-900">{sentenceValue(selectedRecord.status, 'PENDING')}</p>
                                  </div>
                              </div>
                              <div className="flex items-start gap-3">
                                  <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0"><FileText size={16} /></div>
                                  <div>
                                      <p className="text-[9px] font-black text-slate-400 tracking-tight">Reason</p>
                                      <p className="text-sm font-bold text-slate-900">{selectedRecord.reason || 'Supplier return credit'}</p>
                                  </div>
                              </div>
                         </div>

                         <div className="space-y-3">
                             <p className="text-[10px] font-black text-slate-400 ml-1">Returned products</p>
                             {creditNoteItems.length > 0 ? creditNoteItems.map((item: any, idx: number) => (
                                 <div key={`${item.productId || idx}`} className="flex justify-between items-center text-sm bg-white p-3 rounded-xl border border-slate-100">
                                     <div className="flex-1 min-w-0">
                                         <p className="font-bold text-slate-900 truncate">{item.name || 'Returned item'}</p>
                                         <p className="text-[11px] text-slate-500 font-medium">
                                             {Number(item.quantity || 0).toLocaleString()} {item.unit || 'pcs'} @ Ksh {(Number(item.unitCost || 0)).toLocaleString()}
                                         </p>
                                     </div>
                                     <span className="font-black text-blue-600">Ksh {(Number(item.amount || 0)).toLocaleString()}</span>
                                 </div>
                             )) : (
                                 <div className="flex justify-between items-center text-sm bg-white p-3 rounded-xl border border-slate-100">
                                     <div className="flex-1 min-w-0">
                                         <p className="font-bold text-slate-900 truncate">Returned stock</p>
                                         <p className="text-[11px] text-slate-500 font-medium">{Number(selectedRecord.quantity || 0).toLocaleString()} pcs</p>
                                     </div>
                                     <span className="font-black text-blue-600">Ksh {(Number(selectedRecord.amount || 0)).toLocaleString()}</span>
                                 </div>
                             )}
                         </div>

                         <div className="pt-4 border-t border-dashed border-slate-200 flex items-end justify-between px-1">
                             <span className="text-sm font-black text-slate-400">Credit note total</span>
                             <span className="text-2xl font-black text-blue-600">Ksh {(Number(selectedRecord.amount || 0)).toLocaleString()}</span>
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
                                 <span className="text-xs font-bold text-slate-400  ">Paid amount</span>
                                 <span className="text-sm font-bold text-slate-900">Ksh {(selectedRecord.paidAmount || 0).toLocaleString()}</span>
                             </div>
                             <div className="flex justify-between items-end pt-1">
                                 <span className="text-sm font-black text-slate-400  ">Grand total</span>
                                 <span className="text-2xl font-black text-blue-600">Ksh {selectedRecord.totalAmount.toLocaleString()}</span>
                             </div>
                         </div>
                     </div>
                 )}

                 {/* Shift Report Details */}
                 {isReport && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                       <div className="text-center py-4 border-b border-dashed border-slate-200">
                          <p className="text-[10px] font-black tracking-[0.2em] text-slate-400 mb-1">Shift report</p>
                          <p className="text-xs font-bold text-slate-600">Shift ID: {selectedRecord.shiftId || 'N/A'}</p>
                          <p className="text-xs font-bold text-slate-600">Cashier: {selectedRecord.cashierName}</p>
                       </div>

                       <div className="overflow-hidden rounded-xl border border-slate-200">
                          {reportRows.map((row, index) => {
                            const value = reportValue(selectedRecord, row.key);
                            const isVariance = row.key === 'difference';
                            const valueClass = isVariance
                              ? value === 0 ? 'text-green-700' : 'text-red-700'
                              : row.negative ? 'text-red-600' : 'text-slate-900';
                            return (
                              <div
                                key={row.key}
                                className={`flex justify-between gap-4 px-4 py-3 text-sm border-b border-slate-100 last:border-b-0 ${
                                  row.highlight ? 'bg-blue-50 font-black' : row.total ? 'bg-slate-50 font-black' : index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                                }`}
                              >
                                <span className="font-bold text-slate-700">{row.label}</span>
                                <span className={`font-black tabular-nums text-right ${valueClass}`}>{row.negative && value > 0 ? '- ' : ''}{moneyText(value)}</span>
                              </div>
                            );
                          })}
                       </div>

                       <div className={`p-5 rounded-xl border-2 ${(Number(selectedRecord.difference) || 0) === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                          <div className="flex items-center gap-3">
                             <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${(Number(selectedRecord.difference) || 0) === 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                {(Number(selectedRecord.difference) || 0) === 0 ? <CheckCircle2 size={24}/> : <AlertTriangle size={24}/>}
                             </div>
                             <div>
                                <p className="text-[10px] font-black text-slate-400">Cashier variance</p>
                                <h4 className={`text-xl font-black ${(Number(selectedRecord.difference) || 0) === 0 ? 'text-green-700' : 'text-red-700'}`}>
                                   {moneyText(selectedRecord.difference)}
                                </h4>
                             </div>
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
                          <h3 className="text-2xl font-black">Daily close report</h3>
                          <p className="text-blue-100 text-xs font-bold  tracking-[0.2em] mt-2">One close per business day</p>
                       </div>

                       <div className="grid grid-cols-2 gap-4">
                          <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 text-center">
                             <p className="text-[10px] font-black text-slate-400   mb-1">Total net sales</p>
                             <p className="text-2xl font-black text-slate-900">Ksh {(Number(selectedRecord.totalSales) || 0).toLocaleString()}</p>
                          </div>
                          <div className="bg-slate-50 p-5 rounded-3xl border border-slate-100 text-center">
                             <p className="text-[10px] font-black text-slate-400   mb-1">Staff cash difference</p>
                             <p className={`text-2xl font-black ${(Number(selectedRecord.totalVariance) || 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                Ksh {(Number(selectedRecord.totalVariance) || 0).toLocaleString()}
                             </p>
                          </div>
                       </div>

                       <div className="space-y-4">
                          <div className="flex items-center justify-between px-2">
                             <p className="text-[10px] font-black text-slate-400 tracking-[0.2em]">Closed shift summary</p>
                             <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{dailyShiftReports.length || selectedRecord.shiftIds?.length || 0} shifts included</span>
                          </div>

                          {dailyShiftReports.length > 0 ? (
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                              <table className="w-full min-w-[640px] text-xs">
                                <thead className="bg-slate-900 text-white">
                                  <tr>
                                    <th className="text-left px-3 py-2 font-black">Line item</th>
                                    {dailyShiftReports.map((report, index) => (
                                      <th key={report.id || report.shiftId || index} className="text-right px-3 py-2 font-black">{reportShiftLabel(report, index)}</th>
                                    ))}
                                    <th className="text-right px-3 py-2 font-black">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {reportRows.map((row, rowIndex) => {
                                    const total = dailyShiftReports.reduce((sum, report) => sum + reportValue(report, row.key), 0);
                                    return (
                                      <tr key={row.key} className={`${row.highlight ? 'bg-blue-50' : row.total ? 'bg-slate-50' : rowIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} border-b border-slate-100 last:border-b-0`}>
                                        <td className="px-3 py-2 font-bold text-slate-700">{row.label}</td>
                                        {dailyShiftReports.map((report, index) => {
                                          const value = reportValue(report, row.key);
                                          return (
                                            <td key={`${report.id || report.shiftId || index}-${row.key}`} className={`px-3 py-2 text-right font-black tabular-nums ${value < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                              {row.negative && value > 0 ? '- ' : ''}{moneyText(value)}
                                            </td>
                                          );
                                        })}
                                        <td className={`px-3 py-2 text-right font-black tabular-nums ${total < 0 ? 'text-red-600' : 'text-slate-900'}`}>{row.negative && total > 0 ? '- ' : ''}{moneyText(total)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="space-y-3">
                               <div className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                                  <div className="flex gap-3 items-center">
                                     <div className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl flex items-center justify-center"><Wallet size={20}/></div>
                                     <span className="text-sm font-bold text-slate-700">Daily expenses</span>
                                  </div>
                                  <span className="text-sm font-black text-red-600">- {moneyText(selectedRecord.totalExpenses)}</span>
                               </div>
                               <div className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                                  <div className="flex gap-3 items-center">
                                     <div className="w-10 h-10 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center"><RotateCcw size={20}/></div>
                                     <span className="text-sm font-bold text-slate-700">Refunds</span>
                                  </div>
                                  <span className="text-sm font-black text-rose-600">- {moneyText(selectedRecord.totalRefunds)}</span>
                               </div>
                               <div className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                                  <div className="flex gap-3 items-center">
                                     <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center"><Banknote size={20}/></div>
                                     <span className="text-sm font-bold text-slate-700">Cash picked</span>
                                  </div>
                                  <span className="text-sm font-black text-slate-900">{moneyText(selectedRecord.totalPicks)}</span>
                               </div>
                            </div>
                          )}
                       </div>

                       <div className="pt-6 border-t border-dashed border-slate-200">
                          <div className="flex justify-between items-end border-b border-slate-100 pb-4">
                             <div>
                                <p className="text-[10px] font-black text-slate-400   mb-1">Tax check</p>
                                <h4 className="text-sm font-bold text-slate-500">e-TIMS 16% VAT summary</h4>
                             </div>
                             <div className="text-right">
                                <p className="text-2xl font-black text-blue-600">{moneyText(selectedRecord.taxTotal)}</p>
                                <p className="text-[9px] font-black text-blue-400  ">Total VAT collected</p>
                             </div>
                          </div>
                          
                          <div className="flex flex-col items-center justify-center py-6 gap-2 opacity-30 italic">
                              <ShieldCheck className="text-slate-400" size={24} />
                              <p className="text-[10px] font-bold text-slate-500 text-center">Day closed. All shifts are saved.</p>
                          </div>
                       </div>
                    </div>
                 )}
             </div>
            </div>
         </div>

         {/* Footer Actions - Sticky at bottom */}
          <div className="p-4 flex flex-col gap-2 bg-white border-t border-slate-100 no-print shadow-[0_-4px_12px_rgba(0,0,0,0.03)] relative z-20">
            {/* Receive Goods Action */}
            {onReceive && isPO && selectedRecord.approvalStatus === 'APPROVED' && selectedRecord.status === 'PENDING' && (
               <button
                 onClick={() => { onReceive(selectedRecord); setSelectedRecord(null); }}
                 data-testid="document-receive-items"
                 className="w-full py-3.5 bg-blue-600 text-white font-black text-xs   rounded-xl transition-colors active:bg-blue-700 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
               >
                 <PackagePlus size={16} /> Receive items
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
                  onClick={() => runApprovalAction(onApprove)}
                  disabled={isApprovalActionRunning}
                  aria-busy={isApprovalActionRunning}
                  data-busy={isApprovalActionRunning ? 'true' : undefined}
                  className="flex-1 py-3.5 bg-green-600 text-white font-black text-xs   rounded-xl transition-colors active:bg-green-700 flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                >
                  {isApprovalActionRunning ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  {isApprovalActionRunning ? 'Working...' : 'Approve'}
                </button>
                <button
                  onClick={() => runApprovalAction(onReject)}
                  disabled={isApprovalActionRunning}
                  aria-busy={isApprovalActionRunning}
                  data-busy={isApprovalActionRunning ? 'true' : undefined}
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
              aria-busy={isSharing}
              data-busy={isSharing ? 'true' : undefined}
              className="w-full py-3.5 bg-slate-900 text-white font-bold text-[10px]   rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
            >
              {isSharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              {isSharing ? 'Generating PDF...' : isPO ? 'Share LPO PDF' : 'Share PDF  (WhatsApp / Gmail)'}
            </button>

            <div className="flex gap-2">
              {(isSale || isCreditNote) && (
                <button
                  onClick={isSale ? handleHardwarePrint : handleBrowserPrint}
                  disabled={isSharing || isSavingPDF || (isSale && isHardwarePrinting)}
                  aria-busy={isHardwarePrinting}
                  data-busy={isHardwarePrinting ? 'true' : undefined}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold text-[10px]   rounded-xl flex items-center justify-center gap-2 transition-colors active:bg-indigo-700 disabled:opacity-50"
                >
                  {isHardwarePrinting ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                  {isHardwarePrinting ? 'Printing...' : isCreditNote ? 'Print credit note' : 'Print receipt'}
                </button>
              )}
              {/* Save PDF — direct download */}
              <button
                onClick={handleSavePDF}
                disabled={isSharing || isSavingPDF}
                aria-busy={isSavingPDF}
                data-busy={isSavingPDF ? 'true' : undefined}
                className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold text-[10px]   rounded-xl flex items-center justify-center gap-2 transition-colors active:bg-slate-100 disabled:opacity-50"
              >
                {isSavingPDF ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                {isSavingPDF ? 'Saving...' : isPO ? 'Save LPO' : 'Save PDF'}
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
                    <RotateCcw size={16} /> {isAdmin ? 'Return items' : 'Ask to return'}
                  </button>
                )
            )}
         </div>
       </div>

      {isAdminVerifying && (
         <AdminVerificationModal 
            actionDescription={`Authorize refund for receipt #${String(selectedRecord.id || '').split('-')[0].toUpperCase()}`}
            onSuccess={onConfirmRefund}
            onCancel={() => setIsAdminVerifying(false)}
         />
      )}
    </div>
  );
}
