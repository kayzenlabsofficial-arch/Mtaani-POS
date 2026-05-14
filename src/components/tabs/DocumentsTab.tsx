import React, { useState } from 'react';
import { Search, CheckCircle2, FileText, RotateCcw, Receipt, ArrowUpRight, ArrowDownLeft, Wallet, Landmark, ClipboardList, CalendarCheck, Activity, ShoppingBag, Clock, SlidersHorizontal, ChevronRight, X, FileSearch, Archive, ShieldCheck } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import AdminApprovals from './AdminApprovals';
import { useStore } from '../../store';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { approveRefundTransaction, requestRefundApproval } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { useToast } from '../../context/ToastContext';


export default function DocumentsTab() {
  const [docSearch, setDocSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'APPROVALS' | 'SALES' | 'EXPENSES' | 'SUPPLIER_PAYMENTS' | 'INVOICES' | 'SHIFTS' | 'DAILY'>('ALL');
  const scrollRef = useHorizontalScroll();
  const { success, error } = useToast();

  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSupplierPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allPurchaseOrders = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allReports = useLiveQuery(() => activeBranchId ? db.endOfDayReports.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allDailySummaries = useLiveQuery(() => activeBranchId ? db.dailySummaries.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const businessSettings = useLiveQuery(() => activeBusinessId ? db.settings.get('core') : Promise.resolve(undefined), [activeBusinessId]);

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
           <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Hydrating Ledger...</p>
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
    if (filterType === 'ALL') return true;
    if (filterType === 'SALES' && r.recordType === 'SALE') return true;
    if (filterType === 'EXPENSES' && r.recordType === 'EXPENSE') return true;
    if (filterType === 'SUPPLIER_PAYMENTS' && r.recordType === 'SUPPLIER_PAYMENT') return true;
    if (filterType === 'INVOICES' && r.recordType === 'PURCHASE_ORDER') return true;
    if (filterType === 'SHIFTS' && r.recordType === 'CLOSE_DAY_REPORT') return true;
    if (filterType === 'DAILY' && r.recordType === 'DAILY_SUMMARY') return true;
    return false;
  });

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Digital Archive</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{unifiedRecords.length} records</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">Verified</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Cloud Storage</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div ref={scrollRef} className="mb-6 overflow-x-auto no-scrollbar pb-2">
        <div className="flex gap-2 min-w-max">
           {[
             { id: 'ALL', label: 'Universal Feed' },
             { id: 'APPROVALS', label: 'Pending Approvals' },
             { id: 'SALES', label: 'Sales Orders' },
             { id: 'EXPENSES', label: 'Operational Costs' },
             { id: 'SUPPLIER_PAYMENTS', label: 'Settlements' },
             { id: 'INVOICES', label: 'Vendor Invoices' },
             { id: 'SHIFTS', label: 'Shift Reports' },
             { id: 'DAILY', label: 'Master Summary' }
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
        <div className="mb-6">
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
        </div>
      )}

      {filterType === 'APPROVALS' ? (
         <div className="animate-in slide-in-from-bottom-4 duration-500">
            <AdminApprovals />
         </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
           {filteredDocs.map(r => {
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
                      isPay ? 'Supplier Settlement' :
                      isShift ? `Shift Closure` :
                      isDaily ? `Business Summary` :
                      `Invoice #${r.invoiceNumber || r.id.split('-')[0].toUpperCase()}`}
                   </h4>
                   <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(r.timestamp).toLocaleDateString()}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-200" />
                      <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">{r.description || r.reference || 'Automated entry'}</span>
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
                   isShift ? 'FINALIZED' :
                   isDaily ? 'MASTERED' :
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
