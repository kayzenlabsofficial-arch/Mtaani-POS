import React from 'react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import { Check, X, Package, Banknote, Clock, AlertCircle, FileMinus, RotateCcw, ClipboardList, PackagePlus, Eye, ChevronRight } from 'lucide-react';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';

export default function AdminApprovals() {
  const currentUser = useStore(state => state.currentUser);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);

  const pendingAdjustments = useLiveQuery(() => activeBranchId ? db.stockAdjustmentRequests.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingPicks = useLiveQuery(() => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingRefunds = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING_REFUND').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingPOs = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).and(x => x.approvalStatus === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSuppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);
  
  const [selectedRecordForDetails, setSelectedRecordForDetails] = React.useState<any | null>(null);

  const { success, error } = useToast();

  const handleApproveAdjustment = async (req: any) => {
    // ── FIX C7: Use DELTA (newQty - oldQty) applied to CURRENT stock, not absolute newQty.
    // This protects against stale snapshots when sales happened after the request was created.
    const product = await db.products.get(req.productId);
    if (product) {
        const delta = req.newQty - req.oldQty;
        const adjustedQty = Math.max(0, product.stockQuantity + delta);
        await db.products.update(req.productId, { stockQuantity: adjustedQty });
        await db.stockMovements.add({
            id: crypto.randomUUID(),
            productId: req.productId,
            type: 'ADJUST',
            quantity: delta,
            timestamp: Date.now(),
            reference: `Approved Adj: ${req.reason}`,
            branchId: activeBranchId!,
            businessId: activeBusinessId!,
            shiftId: req.shiftId // Preserve the shift ID from the request
        });
    }
    await db.stockAdjustmentRequests.update(req.id, { 
        status: 'APPROVED',
        approvedBy: currentUser?.name
    });
    success("Stock adjustment approved.");
  };

  const handleApproveExpense = async (e: any) => {
    // ── FIX C6: Guard against double-approval (rapid double-tap) ──
    const freshExpense = await db.expenses.get(e.id);
    if (!freshExpense || freshExpense.status !== 'PENDING') {
      error('This expense has already been processed.');
      return;
    }
    // Mark as APPROVED first to prevent a second concurrent approval from also passing the check
    await db.expenses.update(e.id, { 
        status: 'APPROVED',
        approvedBy: currentUser?.name
    });
    // safe deduction of stock for SHOP source
    if (e.source === 'SHOP' && (e as any).productId) {
        const product = await db.products.get((e as any).productId);
        if (product) {
            const qty = Number((e as any).quantity) || 1;
            await db.products.update(product.id, {
                stockQuantity: Math.max(0, product.stockQuantity - qty)
            });
            await db.stockMovements.add({
                id: crypto.randomUUID(),
                productId: product.id,
                type: 'OUT',
                quantity: -qty,
                timestamp: Date.now(),
                reference: `Expense: ${e.description || 'Shop Use'}`,
                branchId: activeBranchId!,
                businessId: activeBusinessId!,
                shiftId: e.shiftId
            });
        }
    }

    success("Expense disbursement authorized.");
  };

  const handleApprovePO = async (id: string) => {
    await db.purchaseOrders.update(id, { 
        approvalStatus: 'APPROVED',
        approvedBy: currentUser?.name || 'Administrator'
    });
    success("Purchase Order approved for receiving.");
  };

  const handleRejectExpense = async (id: string) => {
    await db.expenses.update(id, { status: 'REJECTED' });
    success("Expense request rejected.");
  };

  const handleRejectPO = async (id: string) => {
    await db.purchaseOrders.update(id, { approvalStatus: 'REJECTED' });
    success("Purchase Order rejected.");
  };

  const handleApproveRefund = async (t: Transaction) => {
    const items = t.pendingRefundItems || t.items.map(i => ({ productId: i.productId, quantity: i.quantity - (i.returnedQuantity || 0) }));

    // Refund logic: deduct cash from the branch-specific CASH account
    if (t.paymentMethod === 'CASH' && t.branchId) {
        const cashAccount = await db.financialAccounts.where('branchId').equals(t.branchId)
            .and(acc => acc.type === 'CASH').first();
        if (cashAccount) {
           await db.financialAccounts.update(cashAccount.id, { 
               balance: cashAccount.balance - (t.total || 0) 
           });
        }
    }

    for (const item of items) {
       if (item.quantity <= 0) continue;
       const product = await db.products.get(item.productId);
       if (product) {
          await db.products.update(item.productId, {
             stockQuantity: product.stockQuantity + item.quantity
          });
          await db.stockMovements.add({
             id: crypto.randomUUID(),
             productId: item.productId,
             type: 'RETURN',
             quantity: item.quantity,
             timestamp: Date.now(),
             reference: `Return #${t.id.split('-')[0].toUpperCase()}`,
             branchId: activeBranchId!,
             businessId: activeBusinessId!,
             shiftId: t.shiftId
          });
          const txItem = t.items.find(i => i.productId === item.productId);
          if (txItem) txItem.returnedQuantity = (txItem.returnedQuantity || 0) + item.quantity;
       }
    }

    const allReturned = t.items.every(i => (i.returnedQuantity || 0) >= i.quantity);
    await db.transactions.update(t.id, { 
        status: allReturned ? 'REFUNDED' : 'PARTIAL_REFUND',
        items: t.items,
        pendingRefundItems: undefined,
        approvedBy: currentUser?.name
    });
    success("Refund authorized and stock returned.");
  };

  const handleRejectAdjustment = async (id: string) => {
    await db.stockAdjustmentRequests.update(id, { status: 'REJECTED' });
    success("Adjustment request rejected.");
  };

  const handleConfirmBanking = async (id: string) => {
    await db.cashPicks.update(id, { status: 'APPROVED' });
    success("Cash deposit confirmed.");
  };

  if (!pendingAdjustments || !pendingPicks || !pendingExpenses || !pendingRefunds || !pendingPOs) {
    return (
        <div className="flex flex-col items-center justify-center h-full p-10 opacity-50">
            <div className="w-10 h-10 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin mb-4"></div>
            <p className="text-sm font-bold text-slate-400  ">Loading Approvals...</p>
        </div>
    );
  }

  return (
    <div className="p-5 pb-8 animate-in fade-in max-w-5xl mx-auto w-full h-full overflow-y-auto no-scrollbar">
      <div className="mb-6 mt-2">
         <h2 className="text-xl font-extrabold text-slate-900 mb-1">Authorization Board</h2>
         <p className="text-sm text-slate-500">Approve or reject critical business requests.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-24">
         
         {/* Expenses */}
         <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 sticky top-0 bg-slate-100 py-2 z-10">
               <FileMinus size={16} className="text-orange-500" /> Pending Expenses
            </h3>
            <div className="space-y-2">
               {pendingExpenses.length === 0 ? (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-8 text-center text-[10px] text-slate-400 font-bold   italic">No pending expenses</div>
               ) : (
                  pendingExpenses.map(e => (
                     <div key={e.id} onClick={() => setSelectedRecordForDetails({ ...e, recordType: 'EXPENSE' })} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between group hover:border-blue-300 transition-all cursor-pointer">
                        <div className="flex-1">
                           <div className="flex items-center gap-1.5 mb-1">
                              <p className="text-xs font-bold text-slate-900">{e.category || 'Unknown'}</p>
                              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">@{e.userName || 'System'}</span>
                              <Eye size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                           </div>
                           <p className="text-[11px] text-slate-500 font-medium italic mb-2 truncate">"{e.description || 'No description'}"</p>
                           <h3 className="text-lg font-black text-slate-900">Ksh {(e.amount || 0).toLocaleString()}</h3>
                        </div>
                        <div className="bg-slate-50 text-slate-400 p-2 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-600 transition-all">
                           <ChevronRight size={18} />
                        </div>
                     </div>
                  ))
               )}
            </div>
         </div>

         {/* Refunds */}
         <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 sticky top-0 bg-slate-100 py-2 z-10">
               <RotateCcw size={16} className="text-red-500" /> Refund Requests
            </h3>
            <div className="space-y-2">
               {pendingRefunds.length === 0 ? (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-8 text-center text-[10px] text-slate-400 font-bold   italic">No pending refunds</div>
               ) : (
                  pendingRefunds.map(t => (
                     <div key={t.id} onClick={() => setSelectedRecordForDetails({ ...t, recordType: 'SALE' })} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between group hover:border-blue-300 transition-all cursor-pointer">
                        <div className="flex-1">
                           <div className="flex items-center gap-1.5 mb-1">
                              <p className="text-xs font-bold text-slate-900">Receipt #{t.id ? t.id.split('-')[0].toUpperCase() : 'Unknown'}</p>
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">@{t.cashierName || 'System'}</span>
                              <Eye size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                           </div>
                           <p className="text-[10px] text-slate-500 font-medium">Items: {t.items?.length || 0} • {t.timestamp ? new Date(t.timestamp).toLocaleDateString() : 'Unknown Date'}</p>
                           <h3 className="text-lg font-black text-slate-900 mt-1">Ksh {(t.total || 0).toLocaleString()}</h3>
                        </div>
                        <div className="bg-slate-50 text-slate-400 p-2 rounded-xl group-hover:bg-blue-50 group-hover:text-blue-600 transition-all">
                           <ChevronRight size={18} />
                        </div>
                     </div>
                  ))
               )}
            </div>
         </div>

         {/* Purchase Orders */}
         <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 sticky top-0 bg-slate-100 py-2 z-10">
               <PackagePlus size={16} className="text-blue-500" /> PO Authorizations
            </h3>
            <div className="space-y-2">
               {pendingPOs.length === 0 ? (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-8 text-center text-[10px] text-slate-400 font-bold   italic">No pending orders</div>
               ) : (
                  pendingPOs.map(po => (
                     <div key={po.id} onClick={() => setSelectedRecordForDetails({ ...po, recordType: 'PURCHASE_ORDER' })} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm group hover:border-blue-300 transition-all cursor-pointer">
                        <div className="flex justify-between items-start mb-2">
                           <div>
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                 {allSuppliers?.find(s => s.id === po.supplierId)?.company || 'Unknown Supplier'}
                                 <Eye size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </h4>
                              <p className="text-xs text-slate-500 font-medium">PO #{po.id ? (po.id.startsWith('PO-') ? po.id : po.id.split('-')[0].toUpperCase()) : 'Unknown'} • {po.orderDate ? new Date(po.orderDate).toLocaleDateString() : 'Unknown'} • Items: {po.items?.length || 0}</p>
                           </div>
                           <div className="flex flex-col items-end">
                              <h3 className="text-base font-black text-blue-600">Ksh {(po.totalAmount || 0).toLocaleString()}</h3>
                              <div className="mt-2 text-[9px] font-black   text-slate-400 bg-slate-50 px-2 py-1 rounded">Pending Review</div>
                           </div>
                        </div>
                     </div>
                  ))
               )}
            </div>
         </div>

         {/* Stock Adjustments */}
         <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 sticky top-0 bg-slate-100 py-2 z-10">
               <Package size={16} className="text-blue-500" /> Stock Adjustments
            </h3>
            <div className="space-y-2">
               {pendingAdjustments.length === 0 ? (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-8 text-center text-[10px] text-slate-400 font-bold   italic">No pending adjustments</div>
               ) : (
                  pendingAdjustments.map(req => (
                     <div key={req.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                           <h4 className="text-sm font-bold text-slate-900">{req.productName || 'Unknown Product'}</h4>
                           <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><Clock size={10} /> {req.timestamp ? new Date(req.timestamp).toLocaleDateString() : 'Unknown'}</span>
                               {req.preparedBy && <span className="text-[9px] font-black text-blue-500  tracking-tighter">By: {req.preparedBy}</span>}
                        </div>
                        <div className="flex items-center gap-4 mb-3">
                           <div className="text-center">
                              <p className="text-[9px] font-bold text-slate-400 ">Current</p>
                              <p className="text-sm font-black text-slate-400">{req.oldQty}</p>
                           </div>
                           <div className="text-slate-300">→</div>
                           <div className="text-center">
                              <p className="text-[9px] font-bold text-blue-500 ">New</p>
                              <p className="text-sm font-black text-blue-600">{req.newQty}</p>
                           </div>
                        </div>
                        <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg mb-4 italic">"{req.reason}"</p>
                        <div className="flex gap-2">
                           <button onClick={() => handleApproveAdjustment(req)} className="flex-1 bg-green-600 text-white py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-transform"><Check size={14}/> Approve</button>
                           <button onClick={() => handleRejectAdjustment(req.id)} className="flex-1 bg-slate-100 text-slate-600 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1 active:scale-95 transition-transform"><X size={14}/> Reject</button>
                        </div>
                     </div>
                  ))
               )}
            </div>
         </div>

         {/* Banking */}
         <div className="space-y-4">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-2 sticky top-0 bg-slate-100 py-2 z-10">
               <Banknote size={16} className="text-green-500" /> Pending Banking
            </h3>
            <div className="space-y-2">
               {pendingPicks.length === 0 ? (
                  <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-8 text-center text-[10px] text-slate-400 font-bold   italic">Everything banked</div>
               ) : (
                  pendingPicks.map(p => (
                      <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between">
                         <div>
                            <div className="flex items-center gap-1.5 mb-1">
                               <p className="text-xs font-bold text-slate-900">Cash Pickup</p>
                               {p.userName && <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">@{p.userName}</span>}
                            </div>
                            <p className="text-[10px] text-slate-500 font-semibold">{p.timestamp ? new Date(p.timestamp).toLocaleString() : 'Unknown Time'}</p>
                            <h3 className="text-lg font-black text-slate-900 mt-1">Ksh {(p.amount || 0).toLocaleString()}</h3>
                         </div>
                         <button 
                            onClick={() => handleConfirmBanking(p.id)}
                            className="bg-green-100 h-10 px-4 text-green-700 rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-green-600 hover:text-white transition-all active:scale-95"
                         >
                            <Check size={16} /> Confirm Banked
                         </button>
                      </div>
                  ))
               )}
            </div>
         </div>
      </div>


      <DocumentDetailsModal 
        selectedRecord={selectedRecordForDetails} 
        setSelectedRecord={setSelectedRecordForDetails} 
        handleRefund={async (t) => handleApproveRefund(t)}
        onApprove={async (record) => {
           if (record.recordType === 'EXPENSE') await handleApproveExpense(record);
           if (record.recordType === 'PURCHASE_ORDER') await handleApprovePO(record.id);
           if (record.recordType === 'SALE') await handleApproveRefund(record);
        }}
        onReject={async (record) => {
           if (record.recordType === 'EXPENSE') await handleRejectExpense(record.id);
           if (record.recordType === 'PURCHASE_ORDER') await handleRejectPO(record.id);
           if (record.recordType === 'SALE') {
              await db.transactions.update(record.id, { status: 'PAID' }); // Revert back to PAID
              success("Refund request rejected.");
           }
        }}
      />
    </div>
  );
}

