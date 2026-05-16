import React, { useEffect, useState } from 'react';
import { Search, CheckCircle2, FileText, RotateCcw, Receipt, ArrowUpRight, ArrowDownLeft, Wallet, Landmark, ClipboardList, CalendarCheck, Activity, ShoppingBag, Clock, SlidersHorizontal, ChevronRight, X, FileSearch, Archive, ShieldCheck, ChevronLeft, ChevronRight as NextIcon, CalendarDays, Smartphone, Loader2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import AdminApprovals from './AdminApprovals';
import { useStore } from '../../store';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { approveRefundTransaction, requestRefundApproval } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { useToast } from '../../context/ToastContext';
import { getBusinessSettings } from '../../utils/settings';
import { MpesaService, type MpesaLedgerRow } from '../../services/mpesa';


export default function DocumentsTab() {
  const [docSearch, setDocSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'APPROVALS' | 'SALES' | 'EXPENSES' | 'SUPPLIER_PAYMENTS' | 'INVOICES' | 'SHIFTS' | 'DAILY' | 'MPESA'>('ALL');
  const todayInput = new Date().toISOString().split('T')[0];
  const [dateMode, setDateMode] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [dateStart, setDateStart] = useState(todayInput);
  const [dateEnd, setDateEnd] = useState(todayInput);
  const [page, setPage] = useState(1);
  const [mpesaRows, setMpesaRows] = useState<MpesaLedgerRow[]>([]);
  const [isMpesaLoading, setIsMpesaLoading] = useState(false);
  const [mpesaError, setMpesaError] = useState('');
  const pageSize = 50;
  const scrollRef = useHorizontalScroll();
  const { success, error } = useToast();

  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const allTransactions = useLiveQuery(() => activeBusinessId && activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).and(t => t.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  const allExpenses = useLiveQuery(() => activeBusinessId && activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).and(e => e.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []);
  const allSupplierPayments = useLiveQuery(() => activeBusinessId && activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []);
  const allPurchaseOrders = useLiveQuery(() => activeBusinessId && activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).and(po => po.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []);
  const allReports = useLiveQuery(() => activeBusinessId && activeBranchId ? db.endOfDayReports.where('branchId').equals(activeBranchId).and(r => r.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []);
  const allDailySummaries = useLiveQuery(() => activeBusinessId && activeBranchId ? db.dailySummaries.where('branchId').equals(activeBranchId).and(ds => ds.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []);
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);

  const unifiedRecords: any[] = [
    ...(allTransactions || []).map(t => ({ ...t, recordType: 'SALE' as const })),
    ...(allExpenses || []).map(e => ({ ...e, recordType: 'EXPENSE' as const, total: e.amount })),
    ...(allSupplierPayments || []).map(p => ({ ...p, recordType: 'SUPPLIER_PAYMENT' as const, total: p.amount })),
    ...(allPurchaseOrders || []).filter(po => po.status === 'RECEIVED').map(po => ({ ...po, recordType: 'PURCHASE_ORDER' as const, total: po.totalAmount, timestamp: po.receivedDate || po.orderDate })),
    ...(allReports || []).map(r => ({ ...r, recordType: 'CLOSE_DAY_REPORT' as const, total: r.totalSales || 0, timestamp: r.timestamp || Date.now() })),
    ...(allDailySummaries || []).map(ds => ({ ...ds, recordType: 'DAILY_SUMMARY' as const, total: ds.totalSales || 0, timestamp: ds.timestamp || Date.now() }))
  ].sort((a, b) => ((Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)));

  if (!allTransactions || !allExpenses || !allSupplierPayments || !allPurchaseOrders || !allReports || !allDailySummaries) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
           <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
              <FileSearch size={32} className="text-slate-300" />
           </div>
           <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading records...</p>
        </div>
      );
  }

  const handleRefund = async (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => {
    if (t.status !== 'PAID' && t.status !== 'PARTIAL_REFUND') return;
    const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
    try {
      if (autoApprove && activeBranchId && activeBusinessId) {
        await approveRefundTransaction(t, itemsToReturn, {
          approvedBy: currentUser?.name || 'Owner',
          activeBranchId,
          activeBusinessId
        });
      } else {
        await requestRefundApproval(t, itemsToReturn);
      }
      setSelectedRecord(null);
      success(autoApprove ? "Refund processed and stock returned." : "Refund request sent to Admin for approval.");
    } catch (err: any) {
      error(err.message || 'Refund failed.');
    }
  };

  const filteredDocs = unifiedRecords.filter(r => {
    const id = r.id?.toString() || "";
    const matchesSearch = id.toLowerCase().includes(docSearch.toLowerCase()) || 
                          (r.description?.toLowerCase().includes(docSearch.toLowerCase())) ||
                          (r.reference?.toLowerCase().includes(docSearch.toLowerCase()));
    
    if (!matchesSearch) return false;
    if (dateMode === 'CUSTOM') {
      const start = new Date(dateStart || todayInput);
      start.setHours(0, 0, 0, 0);
      const end = new Date(dateEnd || dateStart || todayInput);
      end.setHours(23, 59, 59, 999);
      const ts = Number(r.timestamp) || 0;
      if (ts < start.getTime() || ts > end.getTime()) return false;
    }
    if (filterType === 'ALL') return true;
    if (filterType === 'SALES' && r.recordType === 'SALE') return true;
    if (filterType === 'EXPENSES' && r.recordType === 'EXPENSE') return true;
    if (filterType === 'SUPPLIER_PAYMENTS' && r.recordType === 'SUPPLIER_PAYMENT') return true;
    if (filterType === 'INVOICES' && r.recordType === 'PURCHASE_ORDER') return true;
    if (filterType === 'SHIFTS' && r.recordType === 'CLOSE_DAY_REPORT') return true;
    if (filterType === 'DAILY' && r.recordType === 'DAILY_SUMMARY') return true;
    return false;
  });
  const totalPages = Math.max(1, Math.ceil(filteredDocs.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedDocs = filteredDocs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const mpesaTotalPages = Math.max(1, Math.ceil(mpesaRows.length / pageSize));
  const mpesaCurrentPage = Math.min(page, mpesaTotalPages);
  const pagedMpesaRows = mpesaRows.slice((mpesaCurrentPage - 1) * pageSize, mpesaCurrentPage * pageSize);
  const visibleCount = filterType === 'MPESA' ? mpesaRows.length : filteredDocs.length;
  const visibleCurrentPage = filterType === 'MPESA' ? mpesaCurrentPage : currentPage;
  const visibleTotalPages = filterType === 'MPESA' ? mpesaTotalPages : totalPages;

  useEffect(() => {
    setPage(1);
  }, [docSearch, filterType, dateMode, dateStart, dateEnd]);

  useEffect(() => {
    if (filterType !== 'MPESA' || !activeBusinessId || !activeBranchId) return;
    let cancelled = false;
    const loadMpesaRows = async () => {
      setIsMpesaLoading(true);
      setMpesaError('');
      try {
        let from = 0;
        let to = 0;
        if (dateMode === 'CUSTOM') {
          const start = new Date(dateStart || todayInput);
          start.setHours(0, 0, 0, 0);
          const end = new Date(dateEnd || dateStart || todayInput);
          end.setHours(23, 59, 59, 999);
          from = start.getTime();
          to = end.getTime();
        }
        const res = await MpesaService.listTransactions({
          businessId: activeBusinessId,
          branchId: activeBranchId,
          from,
          to,
          search: docSearch,
          limit: 500,
        });
        if (cancelled) return;
        setMpesaRows(res.rows || []);
        setMpesaError(res.error || '');
      } finally {
        if (!cancelled) setIsMpesaLoading(false);
      }
    };
    loadMpesaRows();
    return () => { cancelled = true; };
  }, [filterType, activeBusinessId, activeBranchId, dateMode, dateStart, dateEnd, docSearch, todayInput]);

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Documents</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{unifiedRecords.length} records</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">Saved</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Online backup</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div ref={scrollRef} className="mb-6 overflow-x-auto no-scrollbar pb-2">
        <div className="flex gap-2 min-w-max">
           {[
             { id: 'ALL', label: 'All Documents' },
             { id: 'APPROVALS', label: 'Pending Approvals' },
             { id: 'SALES', label: 'Sales Receipts' },
             { id: 'MPESA', label: 'M-Pesa Payments' },
             { id: 'EXPENSES', label: 'Expenses' },
             { id: 'SUPPLIER_PAYMENTS', label: 'Supplier Payments' },
             { id: 'INVOICES', label: 'Supplier Bills' },
             { id: 'SHIFTS', label: 'Shift Reports' },
             { id: 'DAILY', label: 'Daily Summary' }
           ].map(type => (
             <button 
               key={type.id} 
               onClick={() => setFilterType(type.id as any)}
               className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${filterType === type.id ? 'bg-slate-900 text-white border-slate-900 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
             >
               {type.label}
             </button>
           ))}
        </div>
      </div>

      {filterType !== 'APPROVALS' && (
        <div className="mb-6 space-y-3">
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
            <input
              type="text"
              placeholder="Search by ID, reference, or amount..."
              value={docSearch}
              onChange={(e) => setDocSearch(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
            />
            {docSearch && (
              <button onClick={() => setDocSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDateMode('ALL')}
                className={`h-10 px-4 rounded-xl border text-[10px] font-black uppercase tracking-widest ${dateMode === 'ALL' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
              >
                All Dates
              </button>
              <button
                type="button"
                onClick={() => setDateMode('CUSTOM')}
                className={`h-10 px-4 rounded-xl border text-[10px] font-black uppercase tracking-widest flex items-center gap-2 ${dateMode === 'CUSTOM' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-600 border-slate-200'}`}
              >
                <CalendarDays size={14} /> Custom
              </button>
              {dateMode === 'CUSTOM' && (
                <>
                  <input
                    type="date"
                    value={dateStart}
                    onChange={event => setDateStart(event.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                  <input
                    type="date"
                    value={dateEnd}
                    onChange={event => setDateEnd(event.target.value)}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </>
              )}
            </div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Showing {visibleCount === 0 ? 0 : ((visibleCurrentPage - 1) * pageSize) + 1}-{Math.min(visibleCurrentPage * pageSize, visibleCount)} of {visibleCount}
            </p>
          </div>
        </div>
      )}

      {filterType === 'APPROVALS' ? (
         <div className="animate-in slide-in-from-bottom-4 duration-500">
            <AdminApprovals />
         </div>
      ) : filterType === 'MPESA' ? (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
          {isMpesaLoading && (
            <div className="px-5 py-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-blue-600 border-b border-slate-100">
              <Loader2 size={14} className="animate-spin" /> Loading M-Pesa transactions
            </div>
          )}
          {mpesaError && (
            <div className="px-5 py-4 text-[11px] font-bold text-rose-600 bg-rose-50 border-b border-rose-100">
              {mpesaError}
            </div>
          )}
          {pagedMpesaRows.map(row => {
            const utilized = row.utilizationStatus === 'UTILIZED';
            const paid = row.paymentStatus === 'PAID';
            const linkedTx = row.linkedTransactionId ? allTransactions?.find(tx => tx.id === row.linkedTransactionId) : null;
            return (
              <button
                key={row.checkoutRequestId}
                type="button"
                onClick={() => {
                  if (linkedTx) setSelectedRecord({ ...linkedTx, recordType: 'SALE' });
                }}
                className="w-full text-left px-3 sm:px-5 py-3 flex items-center gap-3 hover:bg-blue-50/40 transition-colors group border-b border-slate-100 last:border-b-0"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${paid ? 'bg-emerald-50 text-emerald-600' : row.paymentStatus === 'PENDING' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                  <Smartphone size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-black text-slate-900 truncate">
                    {row.receiptNumber || row.checkoutRequestId}
                  </h4>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(row.timestamp || Date.now()).toLocaleString()}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-200" />
                    <span className="text-[10px] font-bold text-slate-400">{row.phoneNumber || 'No phone'}</span>
                    {row.linkedCustomerName && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-slate-200" />
                        <span className="text-[10px] font-bold text-blue-600 truncate max-w-[140px]">{row.linkedCustomerName}</span>
                      </>
                    )}
                  </div>
                  {utilized && row.linkedReceiptNumber && (
                    <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      Used on receipt #{row.linkedReceiptNumber}
                    </p>
                  )}
                </div>
                <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${utilized ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                    {utilized ? 'Used' : 'Unused'}
                  </span>
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${paid ? 'bg-emerald-50 text-emerald-700' : row.paymentStatus === 'PENDING' ? 'bg-slate-100 text-slate-600' : 'bg-rose-50 text-rose-700'}`}>
                    {row.paymentStatus === 'PAID' ? 'Paid' : row.paymentStatus === 'PENDING' ? 'Waiting' : 'Failed'}
                  </span>
                </div>
                <div className="text-right shrink-0 min-w-[90px]">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Amount</p>
                  <h3 className="text-sm font-black text-slate-900 leading-none tabular-nums">Ksh {(row.amount || 0).toLocaleString()}</h3>
                </div>
                <ChevronRight size={18} className={`transition-colors shrink-0 ${linkedTx ? 'text-slate-300 group-hover:text-blue-500' : 'text-transparent'}`} />
              </button>
            );
          })}
          {!isMpesaLoading && mpesaRows.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center">
              <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
                <Smartphone size={36} />
              </div>
              <p className="text-slate-500 font-black text-base">No M-Pesa transactions found</p>
              <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Adjust search or date filters</p>
            </div>
          )}
          {mpesaRows.length > pageSize && (
            <div className="px-4 sm:px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={mpesaCurrentPage <= 1}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 flex items-center gap-2"
              >
                <ChevronLeft size={14} /> Previous 50
              </button>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Page {mpesaCurrentPage} of {mpesaTotalPages}</span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(mpesaTotalPages, p + 1))}
                disabled={mpesaCurrentPage >= mpesaTotalPages}
                className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 flex items-center gap-2"
              >
                Next 50 <NextIcon size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
           {pagedDocs.map(r => {
             const isSale = r.recordType === 'SALE';
             const isExp = r.recordType === 'EXPENSE';
             const isPay = r.recordType === 'SUPPLIER_PAYMENT';
             const isShift = r.recordType === 'CLOSE_DAY_REPORT';
             const isDaily = r.recordType === 'DAILY_SUMMARY';

             return (
              <button 
                key={r.id} 
                type="button"
                onClick={() => setSelectedRecord(r)} 
                className="w-full text-left px-3 sm:px-5 py-3 flex items-center gap-3 hover:bg-indigo-50/40 transition-colors group border-b border-slate-100 last:border-b-0"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isSale ? 'bg-emerald-50 text-emerald-600' : 
                  isExp ? 'bg-orange-50 text-orange-600' : 
                  isPay ? 'bg-purple-50 text-purple-600' :
                  isShift ? 'bg-slate-900 text-white' :
                  isDaily ? 'bg-indigo-600 text-white' :
                  'bg-blue-50 text-blue-600'
                }`}>
                   {isSale ? <Receipt size={18} /> : 
                    isExp ? <Wallet size={18} /> : 
                    isPay ? <Landmark size={18} /> :
                    isShift ? <CalendarCheck size={18} /> :
                    <ClipboardList size={18} />}
                </div>
                <div className="flex-1 min-w-0">
                   <h4 className="text-sm font-black text-slate-900 truncate">
                     {isSale ? `Receipt #${r.id.split('-')[0].toUpperCase()}` : 
                      isExp ? `Expense: ${r.category}` : 
                      isPay ? 'Supplier Payment' :
                      isShift ? `Shift Report` :
                      isDaily ? `Daily Summary` :
                      `Invoice #${r.invoiceNumber || r.id.split('-')[0].toUpperCase()}`}
                   </h4>
                   <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(r.timestamp).toLocaleDateString()}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-200" />
                      <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">{r.description || r.reference || 'Saved record'}</span>
                   </div>
                </div>
                <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-tighter shrink-0 ${
                  isSale ? 'bg-slate-100 text-slate-600' : 
                  isExp ? 'bg-orange-50 text-orange-600' : 
                  isPay ? 'bg-purple-50 text-purple-600' :
                  'bg-blue-50 text-blue-600'
                }`}>
                  {isSale ? r.status : 
                   r.recordType === 'PURCHASE_ORDER' ? (r.paymentStatus || 'UNPAID') :
                   isShift ? 'Closed' :
                   isDaily ? 'Done' :
                   r.recordType.replace('_', ' ')}
                </span>
                <div className="text-right shrink-0 min-w-[100px]">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Value</p>
                  <h3 className="text-sm font-black text-slate-900 leading-none tabular-nums">Ksh {(r.total || 0).toLocaleString()}</h3>
                </div>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
              </button>
             );
           })}
           
           {filteredDocs.length === 0 && (
              <div className="py-20 text-center flex flex-col items-center">
                 <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
                   <Archive size={36} />
                 </div>
                 <p className="text-slate-500 font-black text-base">No records matched your filter</p>
                 <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Adjust search or filter parameters</p>
              </div>
           )}
           {filteredDocs.length > pageSize && (
             <div className="px-4 sm:px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
               <button
                 type="button"
                 onClick={() => setPage(p => Math.max(1, p - 1))}
                 disabled={currentPage <= 1}
                 className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 flex items-center gap-2"
               >
                 <ChevronLeft size={14} /> Previous 50
               </button>
               <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Page {currentPage} of {totalPages}</span>
               <button
                 type="button"
                 onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                 disabled={currentPage >= totalPages}
                 className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 flex items-center gap-2"
               >
                 Next 50 <NextIcon size={14} />
               </button>
             </div>
           )}
        </div>
      )}

      <DocumentDetailsModal 
        selectedRecord={selectedRecord} 
        setSelectedRecord={setSelectedRecord} 
        handleRefund={handleRefund} 
      />
    </div>
  );
}
