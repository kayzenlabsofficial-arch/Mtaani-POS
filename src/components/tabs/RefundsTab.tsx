import React, { useState } from 'react';
import { Search, Plus, RotateCcw } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';

interface RefundsTabProps {
  setActiveTab: (tab: any) => void;
}

export default function RefundsTab({ setActiveTab }: RefundsTabProps) {
  const [refundSearch, setRefundSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { success, error } = useToast();

  const activeBranchId = useStore(state => state.activeBranchId);
  const currentUser = useStore(state => state.currentUser);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  
  if (!allTransactions) {
    return (
        <div className="p-10 text-center text-slate-400 font-bold   animate-pulse flex flex-col items-center justify-center min-h-[40vh]">
            <RotateCcw size={40} className="mb-4 opacity-20" />
            Loading returns...
        </div>
    );
  }

  const sortedTransactions = [...(allTransactions || [])].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const refundedTransactions = sortedTransactions.filter(t => (t.status === 'REFUNDED' || t.status === 'PARTIAL_REFUND') && t.id.toLowerCase().includes(refundSearch.toLowerCase()))
    .map(t => ({ ...t, recordType: 'SALE' as const }));

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
    <div className="p-5 pb-8 animate-in fade-in max-w-5xl mx-auto w-full flex flex-col">
      <div className="flex justify-between items-center mb-6 mt-2">
         <div>
           <h2 className="text-xl font-extrabold text-slate-900 mb-1">Returns</h2>
           <p className="text-sm text-slate-500">View and manage returned items.</p>
         </div>
         <button onClick={() => setActiveTab('DOCUMENTS')} className="bg-blue-600 text-white p-3 rounded-2xl shadow-lg shadow-blue-600/20 active:scale-95 transition-transform flex items-center gap-2 font-bold text-sm">
           <Plus size={18} /> New Return
         </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
        <input 
          type="text" placeholder="Search receipts..." value={refundSearch} onChange={(e) => setRefundSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white rounded-2xl border border-slate-200 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-medium"
        />
      </div>

      <div className="space-y-2 pb-24">
         {refundedTransactions.map(t => (
            <div key={t.id} onClick={() => setSelectedRecord(t)} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between active:scale-[0.98] transition-transform cursor-pointer">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                     <RotateCcw size={18} />
                  </div>
                  <div>
                     <h4 className="text-sm font-bold text-slate-900">Receipt #{t.id.split('-')[0].toUpperCase()}</h4>
                     <div className="text-[11px] font-semibold text-slate-500 mt-0.5">{new Date(t.timestamp).toLocaleString()}</div>
                  </div>
               </div>
               <div className="text-right flex flex-col items-end gap-1">
                  <div className="text-sm font-black text-slate-900">
                     Ksh {t.total.toLocaleString()}
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded  ${t.status === 'REFUNDED' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                     {t.status}
                  </span>
               </div>
            </div>
         ))}
         {refundedTransactions.length === 0 && (
            <div className="py-10 text-center text-slate-400 flex flex-col items-center">
               <RotateCcw size={40} className="mb-3 opacity-20" />
               <p className="text-sm">No refunded transactions found.</p>
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
