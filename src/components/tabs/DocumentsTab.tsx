import React, { useState } from 'react';
import { Search, CheckCircle2, FileText, RotateCcw, Receipt, ArrowUpRight, ArrowDownLeft, Wallet, Landmark, ClipboardList, CalendarCheck, Activity, ShoppingBag, Clock } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import AdminApprovals from './AdminApprovals';
import { useStore } from '../../store';

export default function DocumentsTab() {
  const [docSearch, setDocSearch] = useState("");
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'APPROVALS' | 'SALES' | 'EXPENSES' | 'SUPPLIER_PAYMENTS' | 'INVOICES' | 'SHIFTS' | 'DAILY'>('ALL');

  const activeBranchId = useStore(state => state.activeBranchId);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSupplierPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allPurchaseOrders = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allReports = useLiveQuery(() => activeBranchId ? db.endOfDayReports.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allDailySummaries = useLiveQuery(() => activeBranchId ? db.dailySummaries.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);

  // Unify all records into a single timeline
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
        <div className="p-10 text-center text-slate-400 font-bold uppercase tracking-widest animate-pulse flex flex-col items-center justify-center min-h-[40vh]">
           <Receipt size={40} className="mb-4 opacity-20" />
           Loading records...
        </div>
      );
  }

  const handleRefund = async (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => {
    if (t.status !== 'PAID' && t.status !== 'PARTIAL_REFUND') return;

    const items = itemsToReturn || t.items.map(i => ({ productId: i.productId, quantity: i.quantity - (i.returnedQuantity || 0) }));

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
             branchId: activeBranchId!
          });
          const txItem = t.items.find(i => i.productId === item.productId);
          if (txItem) txItem.returnedQuantity = (txItem.returnedQuantity || 0) + item.quantity;
       }
    }

    const allReturned = t.items.every(i => (i.returnedQuantity || 0) >= i.quantity);
    await db.transactions.update(t.id, { 
        status: allReturned ? 'REFUNDED' : 'PARTIAL_REFUND',
        items: t.items
    });
    setSelectedRecord(null);
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
    <div className="p-5 pb-8 animate-in fade-in max-w-5xl mx-auto w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-6 mt-2">
         <div>
           <h2 className="text-xl font-extrabold text-slate-900 mb-1">Business Records</h2>
           <p className="text-sm text-slate-500">History of all financial activities.</p>
         </div>
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar py-1">
         {[
           { id: 'ALL', label: 'All Activity' },
           { id: 'APPROVALS', label: 'Pending Approvals' },
           { id: 'SALES', label: 'Sales' },
           { id: 'EXPENSES', label: 'Expenses' },
           { id: 'SUPPLIER_PAYMENTS', label: 'Payments' },
           { id: 'INVOICES', label: 'Invoices' },
           { id: 'SHIFTS', label: 'Shift Reports' },
           { id: 'DAILY', label: 'Daily Summaries' }
         ].map(type => (
           <button 
             key={type.id} 
             onClick={() => setFilterType(type.id as any)}
             className={`px-4 py-2 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${filterType === type.id ? 'bg-slate-900 text-white shadow-md' : 'bg-white text-slate-500 border border-slate-200'}`}
           >
             {type.label}
           </button>
         ))}
      </div>

      {filterType !== 'APPROVALS' && (
        <div className="relative mb-4">
          <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
          <input 
            type="text" placeholder="Search by ID, reference or notes..." value={docSearch} onChange={(e) => setDocSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white rounded-2xl border border-slate-200 text-sm text-slate-700 shadow-sm focus:border-slate-500 focus:ring-4 focus:ring-slate-500/10 outline-none transition-all font-medium"
          />
        </div>
      )}

      {filterType === 'APPROVALS' ? (
         <div className="flex-1 overflow-y-auto no-scrollbar -mx-5 px-5 pb-24">
            <AdminApprovals />
         </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 pb-24">
           {filteredDocs.map(r => (
            <div key={r.id} onClick={() => setSelectedRecord(r)} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between active:scale-[0.98] transition-transform cursor-pointer">
               <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 
                    ${r.recordType === 'SALE' ? (r.status === 'PAID' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600') : 
                      r.recordType === 'EXPENSE' ? 'bg-orange-50 text-orange-600' : 
                      r.recordType === 'SUPPLIER_PAYMENT' ? 'bg-purple-50 text-purple-600' :
                      r.recordType === 'CLOSE_DAY_REPORT' ? 'bg-slate-900 text-white' :
                      r.recordType === 'DAILY_SUMMARY' ? 'bg-blue-600 text-white' :
                      'bg-blue-50 text-blue-600'}`}>
                      {r.recordType === 'SALE' ? (r.status === 'PAID' ? <CheckCircle2 size={18} /> : <FileText size={18} />) : 
                       r.recordType === 'EXPENSE' ? <Wallet size={18} /> : 
                       r.recordType === 'SUPPLIER_PAYMENT' ? <Landmark size={18} /> :
                       r.recordType === 'CLOSE_DAY_REPORT' ? <CalendarCheck size={18} /> :
                       <ClipboardList size={18} />}
                  </div>
                  <div>
                     <h4 className="text-sm font-bold text-slate-900">
                       {r.recordType === 'SALE' ? `Receipt #${r.id.split('-')[0].toUpperCase()}` : 
                        r.recordType === 'EXPENSE' ? `Expense: ${r.category}` : 
                        r.recordType === 'SUPPLIER_PAYMENT' ? 'Payment to Supplier' :
                        r.recordType === 'CLOSE_DAY_REPORT' ? `Shift Close Report` :
                        r.recordType === 'DAILY_SUMMARY' ? `Master Business Summary` :
                        `Invoice #${r.invoiceNumber || r.id.split('-')[0].toUpperCase()}`}
                     </h4>
                     <div className="text-[11px] font-semibold text-slate-500 mt-0.5">
                       {new Date(r.timestamp).toLocaleString()} {r.description || r.reference ? ` • ${r.description || r.reference}` : ''}
                       {r.userName && <span className="ml-2 text-blue-600 font-bold">(@{r.userName})</span>}
                       {r.cashierName && <span className="ml-2 text-indigo-600 font-bold">(@{r.cashierName})</span>}
                     </div>
                  </div>
               </div>
               <div className="text-right flex flex-col items-end gap-1">
                  <div className="text-sm font-black text-slate-900">
                     Ksh {(r.total || 0).toLocaleString()}
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-widest uppercase 
                    ${r.recordType === 'SALE' ? 'bg-slate-100 text-slate-600' : 
                      r.recordType === 'EXPENSE' ? 'bg-orange-100 text-orange-700' : 
                      r.recordType === 'SUPPLIER_PAYMENT' ? 'bg-purple-100 text-purple-700' :
                      'bg-blue-100 text-blue-700'}`}>
                     {r.recordType === 'SALE' ? r.status : 
                      r.recordType === 'PURCHASE_ORDER' ? (r.paymentStatus || 'UNPAID') :
                      r.recordType === 'CLOSE_DAY_REPORT' ? 'FINALIZED' :
                      r.recordType === 'DAILY_SUMMARY' ? 'DAY CLOSED' :
                      r.recordType.replace('_', ' ')}
                  </span>
               </div>
            </div>
         ))}
           {filteredDocs.length === 0 && (
              <div className="py-10 text-center text-slate-400 flex flex-col items-center">
                 <Receipt size={40} className="mb-3 opacity-20" />
                 <p className="text-sm">No records found.</p>
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
