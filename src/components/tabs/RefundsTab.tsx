import React, { useState } from 'react';
import { Search, Plus, RotateCcw, SlidersHorizontal, ChevronRight, X, ArrowLeftRight, Clock, ShieldCheck, Activity } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';
import NestedControlPanel from '../shared/NestedControlPanel';

interface RefundsTabProps {
  setActiveTab: (tab: any) => void;
}

export default function RefundsTab({ setActiveTab }: RefundsTabProps) {
  const [refundSearch, setRefundSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { success, error } = useToast();

  const activeBranchId = useStore(state => state.activeBranchId);
  const currentUser = useStore(state => state.currentUser);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  
  if (!allTransactions) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
            <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                <RotateCcw size={32} className="text-slate-300" />
            </div>
            <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Auditing Returns...</p>
        </div>
    );
  }

  const sortedTransactions = [...(allTransactions || [])].sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  const refundedTransactions = sortedTransactions.filter(t => 
    (t.status === 'REFUNDED' || t.status === 'PARTIAL_REFUND') && 
    (t.id.toLowerCase().includes(refundSearch.toLowerCase()) || (t.cashierName?.toLowerCase().includes(refundSearch.toLowerCase())))
  ).map(t => ({ ...t, recordType: 'SALE' as const }));

  const totalRefundedValue = refundedTransactions.reduce((sum, t) => sum + (t.total || 0), 0);
  const pendingRequests = sortedTransactions.filter(t => t.status === 'PENDING_REFUND').length;

  const handleRefund = async (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => {
    if (t.status !== 'PAID' && t.status !== 'PARTIAL_REFUND') return;
    if (isSaving) return;
    if (!canPerform(currentUser, 'sale.refund.request')) {
      error("You do not have permission to request refunds.");
      return;
    }

    setIsSaving(true);
    try {
        await db.transactions.update(t.id, { 
            status: 'PENDING_REFUND'
        });
        recordAuditEvent({
          userId: currentUser?.id,
          userName: currentUser?.name,
          action: 'sale.refund.request',
          entity: 'transaction',
          entityId: t.id,
          severity: 'WARN',
          details: `Refund request submitted for Ksh ${(t.total || 0).toLocaleString()}`,
        });
        
        setSelectedRecord(null);
        success("Refund request sent to Admin for approval.");
    } catch (err: any) {
        error("Failed to request refund: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Returns Header */}
      <div className="px-4 pt-2 mb-6">
        <div className="flex items-center justify-between mb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Returns & Refunds</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Audit Trail & Reversal Management</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Tools</span>
              </button>
              <button onClick={() => setActiveTab('DOCUMENTS')} className="grad-blue text-white px-4 py-2.5 rounded-xl shadow-blue active:scale-95 transition-all flex items-center gap-2 font-black text-[10px] uppercase">
                 <Plus size={18} /> Initiate Return
              </button>
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Returns Intelligence"
               subtitle="Monitor reversal volume and pending approvals"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                         <RotateCcw size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Total Returns</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">{refundedTransactions.length}</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center">
                         <Clock size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Pending Approval</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">{pendingRequests}</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                         <Activity size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Reversal Value</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Ksh {totalRefundedValue.toLocaleString()}</h3>
                      </div>
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="px-4 mb-8">
        <div className="relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
          <input 
            type="text" 
            placeholder="Search by receipt # or cashier..." 
            value={refundSearch} 
            onChange={(e) => setRefundSearch(e.target.value)}
            className="w-full pl-14 pr-4 py-4.5 bg-white rounded-[1.5rem] border-2 border-slate-100 text-sm font-bold text-slate-800 shadow-sm focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none"
          />
          {refundSearch && (
            <button onClick={() => setRefundSearch('')} className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Refunds List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
         {refundedTransactions.map(t => (
            <div 
              key={t.id} 
              onClick={() => setSelectedRecord(t)} 
              className="group bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm flex flex-col gap-4 hover:border-orange-300 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
            >
              <div className="flex justify-between items-start">
                 <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shadow-sm group-hover:scale-110 transition-transform">
                    <RotateCcw size={24} />
                 </div>
                 <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Refunded Amount</p>
                    <h3 className="text-lg font-black text-orange-600 leading-none">Ksh {t.total.toLocaleString()}</h3>
                 </div>
              </div>

              <div className="flex-1 min-w-0">
                 <h4 className="text-sm font-black text-slate-900 truncate mb-1">Receipt #{t.id.split('-')[0].toUpperCase()}</h4>
                 <div className="flex items-center gap-2 mb-4">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(t.timestamp).toLocaleDateString()}</span>
                    <span className="w-1 h-1 rounded-full bg-slate-200" />
                    <span className="text-[10px] font-bold text-slate-400 truncate max-w-[120px]">Cashier: {t.cashierName || 'System'}</span>
                 </div>
                 
                 <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                    <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-tighter ${t.status === 'REFUNDED' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                       {t.status}
                    </span>
                    <ChevronRight size={18} className="text-slate-200 group-hover:text-orange-400 transition-colors" />
                 </div>
              </div>
            </div>
         ))}
         
         {refundedTransactions.length === 0 && (
            <div className="col-span-full py-32 text-center flex flex-col items-center">
               <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner text-slate-200">
                 <ArrowLeftRight size={44} />
               </div>
               <p className="text-slate-500 font-black text-lg">No return records found</p>
               <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Processed returns will appear here</p>
            </div>
         )}
      </div>

      <DocumentDetailsModal 
        selectedRecord={selectedRecord} 
        setSelectedRecord={setSelectedRecord} 
        handleRefund={handleRefund} 
      />
    </div>
  );
}
