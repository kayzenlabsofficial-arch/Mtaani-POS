import React, { useState } from 'react';
import { Search, Plus, RotateCcw, SlidersHorizontal, ChevronRight, X, ArrowLeftRight, Clock, ShieldCheck, Activity } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import DocumentDetailsModal from '../modals/DocumentDetailsModalDesktop';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';
import { approveRefundTransaction, requestRefundApproval } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { getBusinessSettings } from '../../utils/settings';
import { getCurrentShiftId } from '../../utils/shiftSession';
import { refundNetAmountForLines, refundNetAmountForRemainingItems, refundedAmountFromReturnedLines, transactionOriginalNetTotal } from '../../utils/posMoney';
import { useDesktopSubnav } from '../navigation/DesktopSubnav';


interface RefundsTabProps {
  setActiveTab: (tab: any) => void;
}

function refundedAmountFor(transaction: Transaction): number {
  if (transaction.status === 'REFUNDED') return transactionOriginalNetTotal(transaction as any);
  return refundedAmountFromReturnedLines(transaction as any);
}

function RefundsDesktopSubnav({
  refundSearch,
  setRefundSearch,
  refundCount,
  pendingRequests,
  totalRefundedValue,
  canRequestRefund,
  onInitiateReturn,
}: {
  refundSearch: string;
  setRefundSearch: (value: string) => void;
  refundCount: number;
  pendingRequests: number;
  totalRefundedValue: number;
  canRequestRefund: boolean;
  onInitiateReturn: () => void;
}) {
  const subnavConfig = React.useMemo(() => ({
    id: 'refunds',
    label: 'Refunds',
    search: {
      value: refundSearch,
      placeholder: 'Search receipt or cashier',
      onChange: setRefundSearch,
      onClear: () => setRefundSearch(''),
    },
    summary: [
      { label: 'Returns', value: refundCount.toLocaleString() },
      { label: 'Pending', value: pendingRequests.toLocaleString() },
      { label: 'Volume', value: `Ksh ${totalRefundedValue.toLocaleString()}` },
    ],
    actions: [
      {
        id: 'initiate-return',
        label: 'Initiate return',
        icon: RotateCcw,
        tone: 'primary' as const,
        hidden: !canRequestRefund,
        onClick: onInitiateReturn,
      },
    ],
  }), [canRequestRefund, onInitiateReturn, pendingRequests, refundCount, refundSearch, setRefundSearch, totalRefundedValue]);

  useDesktopSubnav(subnavConfig);
  return null;
}

export default function RefundsTabDesktop({ setActiveTab }: RefundsTabProps) {
  const [refundSearch, setRefundSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { success, error } = useToast();

  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const allTransactions = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.transactions.where('shopId').equals(activeShopId).and(t => t.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
  );
  const allRefunds = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.refunds.where('shopId').equals(activeShopId).and(r => r.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const canRequestRefund = canPerform(currentUser, 'sale.refund.request', businessSettings);
  
  if (!allTransactions || !allRefunds) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
            <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                <RotateCcw size={32} className="text-slate-300" />
            </div>
            <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading returns...</p>
        </div>
    );
  }

  const sortedTransactions = [...(allTransactions || [])].sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));
  const query = refundSearch.toLowerCase();
  const refundedTransactionIds = new Set((allRefunds || []).map(refund => String(refund.originalTransactionId || '')));
  const refundDocuments = [...(allRefunds || [])]
    .filter(refund => [
      refund.id,
      refund.refundNumber,
      refund.receiptNumber,
      refund.originalTransactionId,
      refund.cashierName,
      refund.source,
    ].some(value => String(value || '').toLowerCase().includes(query)))
    .map(refund => ({ ...refund, recordType: 'REFUND' as const, refundedAmount: Number(refund.amount || 0), total: Number(refund.amount || 0) }));
  const legacyRefundedTransactions = sortedTransactions.filter(t => 
    (t.status === 'REFUNDED' || t.status === 'PARTIAL_REFUND') && 
    !refundedTransactionIds.has(String(t.id || '')) &&
    (String(t.id || '').toLowerCase().includes(query) || (t.cashierName?.toLowerCase().includes(query)))
  ).map(t => ({ ...t, recordType: 'SALE' as const, refundedAmount: refundedAmountFor(t) }));
  const refundedTransactions = [...refundDocuments, ...legacyRefundedTransactions]
    .sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));

  const totalRefundedValue = refundedTransactions.reduce((sum, t) => sum + (t.refundedAmount || 0), 0);
  const pendingRequests = sortedTransactions.filter(t => t.status === 'PENDING_REFUND').length;

  const handleRefund = async (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => {
    if (t.status !== 'PAID' && t.status !== 'PARTIAL_REFUND') return;
    if (isSaving) return;
    if (!canPerform(currentUser, 'sale.refund.request', businessSettings)) {
      error("You do not have permission to request refunds.");
      return;
    }

    setIsSaving(true);
    try {
        const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
        const shiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);
        if (autoApprove && activeShopId && activeBusinessId) {
          await approveRefundTransaction(t, itemsToReturn, {
            approvedBy: currentUser?.name || 'Owner',
            activeShopId,
            activeBusinessId,
            shiftId
          });
        } else {
          await requestRefundApproval(t, itemsToReturn);
        }
        recordAuditEvent({
          userId: currentUser?.id,
          userName: currentUser?.name,
          action: 'sale.refund.request',
          entity: 'transaction',
          entityId: t.id,
          severity: autoApprove ? 'INFO' : 'WARN',
          details: `${autoApprove ? 'Refund processed' : 'Refund request submitted'} for Ksh ${(itemsToReturn?.length ? refundNetAmountForLines(t as any, itemsToReturn) : refundNetAmountForRemainingItems(t as any)).toLocaleString()}`,
        });
        
        setSelectedRecord(null);
        success(autoApprove ? "Refund processed and stock returned." : "Refund request sent to Admin for approval.");
    } catch (err: any) {
        error("Failed to request refund: " + err.message);
    } finally {
        setIsSaving(false);
    }
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      <RefundsDesktopSubnav
        refundSearch={refundSearch}
        setRefundSearch={setRefundSearch}
        refundCount={refundedTransactions.length}
        pendingRequests={pendingRequests}
        totalRefundedValue={totalRefundedValue}
        canRequestRefund={canRequestRefund}
        onInitiateReturn={() => setActiveTab('DOCUMENTS')}
      />
      {/* Refunds List */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
         {refundedTransactions.length > 0 ? (
           <div className="divide-y divide-slate-100">
             {refundedTransactions.map(t => {
               const row = t as any;
               const isRefundDoc = row.recordType === 'REFUND';
               const receiptRef = isRefundDoc
                 ? String(row.refundNumber || String(row.id || '').split('-')[0]).toUpperCase()
                 : String(row.id || '').split('-')[0].toUpperCase();
               return (
               <button
                 key={row.id}
                 type="button"
                 onClick={() => setSelectedRecord(row)}
                 className="w-full text-left px-3 sm:px-5 py-3 flex items-center gap-3 hover:bg-orange-50/40 transition-colors group"
               >
                 <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                   <RotateCcw size={18} />
                 </div>
                 <div className="min-w-0 flex-1">
                   <h4 className="text-sm font-black text-slate-900 truncate">{isRefundDoc ? 'Refund' : 'Receipt'} #{receiptRef}</h4>
                   <div className="flex items-center gap-2 mt-1 flex-wrap">
                     <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(row.timestamp).toLocaleDateString()}</span>
                     <span className="w-1 h-1 rounded-full bg-slate-200" />
                     <span className="text-[10px] font-bold text-slate-400 truncate">{isRefundDoc ? 'Refunded by cash from till' : `Cashier: ${row.cashierName || 'System'}`}</span>
                   </div>
                 </div>
                 <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-tighter shrink-0 ${row.status === 'REFUNDED' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                   {row.status === 'REFUNDED' ? 'Refunded' : row.status === 'PARTIAL_REFUND' ? 'Part refund' : row.status}
                 </span>
                 <div className="text-right shrink-0 min-w-[100px]">
                   <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Refunded</p>
                   <p className="text-sm font-black text-orange-600 leading-none tabular-nums">Ksh {Number(row.refundedAmount || 0).toLocaleString()}</p>
                 </div>
                 <ChevronRight size={18} className="text-slate-300 group-hover:text-orange-500 transition-colors shrink-0" />
               </button>
             );})}
           </div>
         ) : (
           <div className="py-20 text-center flex flex-col items-center">
             <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
               <ArrowLeftRight size={36} />
             </div>
             <p className="text-slate-500 font-black text-base">No return records found</p>
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
