import React, { useState } from 'react';
import { Search, CheckCircle2, FileText, RotateCcw, Receipt, ArrowUpRight, ArrowDownLeft, Wallet, Landmark, ClipboardList, CalendarCheck, Activity, ShoppingBag, Clock, SlidersHorizontal, ChevronRight, X, FileSearch, Archive, ShieldCheck } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import AdminApprovals from './AdminApprovals';
import { useStore } from '../../store';
import NestedControlPanel from '../shared/NestedControlPanel';

export default function DocumentsTab() {
  const [docSearch, setDocSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'APPROVALS' | 'SALES' | 'EXPENSES' | 'SUPPLIER_PAYMENTS' | 'INVOICES' | 'SHIFTS' | 'DAILY'>('ALL');
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);

  const activeBranchId = useStore(state => state.activeBranchId);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSupplierPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allPurchaseOrders = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allReports = useLiveQuery(() => activeBranchId ? db.endOfDayReports.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allDailySummaries = useLiveQuery(() => activeBranchId ? db.dailySummaries.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);

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
    await db.transactions.update(t.id, { status: 'PENDING_REFUND' });
    setSelectedRecord(null);
    alert("Refund request sent to Admin for approval.");
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
      
      {/* Archive Header */}
      <div className="px-4 pt-2 mb-6">
        <div className="flex items-center justify-between mb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Digital Archive</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Universal Business Records</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Tools</span>
              </button>
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Archive Controls"
               subtitle="Filter and verify business milestones"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                         <Receipt size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Total Records</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">{unifiedRecords.length}</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                         <Activity size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Approval Flow</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Active</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                         <ShieldCheck size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Audit Status</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Verified</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                         <Archive size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Storage</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Cloud</h3>
                      </div>
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="px-4 mb-6">
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
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
               className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border-2 press ${filterType === type.id ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}
             >
               {type.label}
             </button>
           ))}
        </div>
      </div>

      {filterType !== 'APPROVALS' && (
        <div className="px-4 mb-8">
          <div className="relative group">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Search by ID, reference, or amount..." 
              value={docSearch} 
              onChange={(e) => setDocSearch(e.target.value)}
              className="w-full pl-14 pr-4 py-4.5 bg-white rounded-[1.5rem] border-2 border-slate-100 text-sm font-bold text-slate-800 shadow-sm focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none"
            />
            {docSearch && (
              <button onClick={() => setDocSearch('')} className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {filterType === 'APPROVALS' ? (
         <div className="px-4 animate-in slide-in-from-bottom-4 duration-500">
            <AdminApprovals />
         </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
           {filteredDocs.map(r => {
             const isSale = r.recordType === 'SALE';
             const isExp = r.recordType === 'EXPENSE';
             const isPay = r.recordType === 'SUPPLIER_PAYMENT';
             const isShift = r.recordType === 'CLOSE_DAY_REPORT';
             const isDaily = r.recordType === 'DAILY_SUMMARY';

             return (
              <div 
                key={r.id} 
                onClick={() => setSelectedRecord(r)} 
                className="group bg-white p-5 rounded-[2rem] border-2 border-slate-100 shadow-sm flex flex-col gap-4 hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
              >
                <div className="flex justify-between items-start">
                   <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform ${
                     isSale ? 'bg-emerald-50 text-emerald-600' : 
                     isExp ? 'bg-orange-50 text-orange-600' : 
                     isPay ? 'bg-purple-50 text-purple-600' :
                     isShift ? 'bg-slate-900 text-white' :
                     isDaily ? 'bg-indigo-600 text-white' :
                     'bg-blue-50 text-blue-600'
                   }`}>
                      {isSale ? <Receipt size={24} /> : 
                       isExp ? <Wallet size={24} /> : 
                       isPay ? <Landmark size={24} /> :
                       isShift ? <CalendarCheck size={24} /> :
                       <ClipboardList size={24} />}
                   </div>
                   <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Value</p>
                      <h3 className="text-lg font-black text-slate-900 leading-none">Ksh {(r.total || 0).toLocaleString()}</h3>
                   </div>
                </div>

                <div className="flex-1 min-w-0">
                   <h4 className="text-sm font-black text-slate-900 truncate mb-1">
                     {isSale ? `Receipt #${r.id.split('-')[0].toUpperCase()}` : 
                      isExp ? `Expense: ${r.category}` : 
                      isPay ? 'Supplier Settlement' :
                      isShift ? `Shift Closure` :
                      isDaily ? `Business Summary` :
                      `Invoice #${r.invoiceNumber || r.id.split('-')[0].toUpperCase()}`}
                   </h4>
                   <div className="flex items-center gap-2 mb-4">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(r.timestamp).toLocaleDateString()}</span>
                      <span className="w-1 h-1 rounded-full bg-slate-200" />
                      <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">{r.description || r.reference || 'Automated entry'}</span>
                   </div>
                   
                   <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                      <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-tighter ${
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
                      <ChevronRight size={18} className="text-slate-200 group-hover:text-indigo-400 transition-colors" />
                   </div>
                </div>
              </div>
             );
           })}
           
           {filteredDocs.length === 0 && (
              <div className="col-span-full py-32 text-center flex flex-col items-center">
                 <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner text-slate-200">
                   <Archive size={44} />
                 </div>
                 <p className="text-slate-500 font-black text-lg">No records matched your filter</p>
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
