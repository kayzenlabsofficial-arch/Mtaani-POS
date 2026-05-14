import React, { useState } from 'react';
import { Search, DollarSign, Wallet, ArrowUpRight, Clock, Landmark, CreditCard, Banknote, Building2, Receipt, SlidersHorizontal, ArrowDownLeft, ChevronRight, X, TrendingUp, History, Tag } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import SupplierPaymentModal from '../modals/SupplierPaymentModal';


export default function SupplierPaymentsTab({ financialAccounts }: { financialAccounts: any[] }) {
  const [paySearch, setPaySearch] = useState("");
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeHistoryTab, setActiveHistoryTab] = useState<'PAYMENTS' | 'CREDITS'>('PAYMENTS');
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState<Supplier | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { success, error } = useToast();
  
  const paymentSupplierId = useStore(state => state.paymentSupplierId);
  const setPaymentSupplierId = useStore(state => state.setPaymentSupplierId);

  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  
  const allSuppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const allPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allCreditNotes = useLiveQuery(() => activeBranchId ? db.creditNotes.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;

  const pendingCredits = allCreditNotes.filter(cn => cn.status === 'PENDING');
  const totalPendingCredit = pendingCredits.reduce((sum, cn) => sum + cn.amount, 0);

  const suppliersOwed = allSuppliers.filter(s => s.balance > 0);
  const totalDebt = suppliersOwed.reduce((sum, s) => sum + (s.balance || 0), 0);
  
  const filteredOwed = suppliersOwed.filter(s => 
      s.company.toLowerCase().includes(paySearch.toLowerCase()) || 
      s.name.toLowerCase().includes(paySearch.toLowerCase())
  );

  const sortedPayments = [...allPayments].sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  const sortedCredits = [...allCreditNotes].sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));

  const openPaymentModal = (s: Supplier) => {
      setSelectedSupplierForPayment(s);
      setIsPaymentModalOpen(true);
  }

  React.useEffect(() => {
      if (paymentSupplierId && allSuppliers.length > 0) {
          const supplier = allSuppliers.find(s => s.id === paymentSupplierId);
          if (supplier) {
              openPaymentModal(supplier);
          }
          setPaymentSupplierId(null);
      }
  }, [paymentSupplierId, allSuppliers, setPaymentSupplierId]);

  const handleSavePayment = async (payment: { amount: number, method: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE', reference: string, transactionCode?: string, purchaseOrderId?: string, purchaseOrderIds?: string[] }) => {
    if (!selectedSupplierForPayment || isSaving) return;
    
    setIsSaving(true);
    try {
        if ((payment as any).source === 'ACCOUNT' && (payment as any).accountId) {
           const account = await db.financialAccounts.get((payment as any).accountId);
           if (!account) { error('Selected account not found.'); return; }
           if (account.balance < payment.amount) {
               error(`Insufficient funds in "${account.name}". Balance: Ksh ${account.balance.toLocaleString()}`);
               return;
           }
        }

        await db.supplierPayments.add({
          id: crypto.randomUUID(),
          supplierId: selectedSupplierForPayment.id,
          purchaseOrderIds: payment.purchaseOrderIds,
          amount: payment.amount,
          paymentMethod: payment.method,
          transactionCode: payment.transactionCode,
          source: (payment as any).source,
          accountId: (payment as any).accountId,
          timestamp: Date.now(),
          branchId: activeBranchId!,
          businessId: activeBusinessId!
        });

        if ((payment as any).source === 'ACCOUNT' && (payment as any).accountId) {
           const account = await db.financialAccounts.get((payment as any).accountId);
           if (account) {
              await db.financialAccounts.update(account.id, { balance: account.balance - payment.amount });
           }
        }

        if (payment.purchaseOrderIds && payment.purchaseOrderIds.length > 0) {
            let remainingPool = payment.amount;
            for (const poId of payment.purchaseOrderIds) {
                if (remainingPool <= 0) break;
                
                const inv = await db.purchaseOrders.get(poId);
                if (inv) {
                    const due = inv.totalAmount - (inv.paidAmount || 0);
                    const paymentForThisInv = Math.min(due, remainingPool);
                    const newPaidAmount = (inv.paidAmount || 0) + paymentForThisInv;
                    
                    await db.purchaseOrders.update(poId, {
                        paidAmount: newPaidAmount,
                        paymentStatus: newPaidAmount >= inv.totalAmount ? 'PAID' : 'PARTIAL'
                    });
                    remainingPool -= paymentForThisInv;
                }
            }
        }

        await db.suppliers.update(selectedSupplierForPayment.id, {
          balance: Math.max(0, (selectedSupplierForPayment.balance || 0) - payment.amount)
        });
        success("Payment recorded successfully.");
        setIsPaymentModalOpen(false);
        setSelectedSupplierForPayment(null);
    } catch (err: any) {
        console.error("Failed to save payment:", err);
        error("Failed to save payment: " + err.message);
    } finally {
        setIsSaving(false);
    }
  }

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'MPESA': return <CreditCard size={18} />;
      case 'BANK': return <Building2 size={18} />;
      case 'CHEQUE': return <Receipt size={18} />;
      default: return <Banknote size={18} />;
    }
  }

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-black text-slate-900">Debt Settlement</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-rose-600">Payables: Ksh {totalDebt.toLocaleString()}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Credits: Ksh {totalPendingCredit.toLocaleString()}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">{suppliersOwed.length} Creditors</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 px-4">
         
         {/* Left: Payables List (3 cols) */}
         <div className="lg:col-span-3 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <ArrowDownLeft size={14} className="text-rose-500" /> Outstanding Balances
               </h3>
               <div className="relative group sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={14} />
                  <input 
                    type="text" 
                    placeholder="Filter vendors..." 
                    value={paySearch} 
                    onChange={(e) => setPaySearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-[11px] font-bold focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
                  />
               </div>
            </div>

            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
               {filteredOwed.length > 0 ? (
                 <div className="divide-y divide-slate-100">
                   {filteredOwed.map(s => (
                     <div key={s.id} className="px-3 sm:px-5 py-3 flex items-center gap-3 hover:bg-rose-50/40 transition-colors group">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                           <Building2 size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                           <h4 className="text-sm font-black text-slate-900 truncate">{s.company}</h4>
                           <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">{s.name}</p>
                        </div>
                        <div className="text-right shrink-0 min-w-[100px]">
                           <p className="text-[9px] font-black text-slate-400 uppercase">Due</p>
                           <h3 className="text-sm font-black text-rose-600 tabular-nums">Ksh {s.balance.toLocaleString()}</h3>
                        </div>
                        <button
                           onClick={() => openPaymentModal(s)}
                           className="px-3 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-sm press flex items-center justify-center gap-1.5 shrink-0"
                        >
                           <DollarSign size={13} /> Settle
                        </button>
                     </div>
                   ))}
                 </div>
               ) : (
                 <div className="py-20 bg-slate-50 border-2 border-dashed border-slate-100 rounded-[2rem] flex flex-col items-center justify-center text-slate-300">
                    <CheckCircle2 size={40} className="mb-3 opacity-20" />
                    <p className="text-xs font-black uppercase tracking-widest opacity-40">Zero Outstanding Liabilities</p>
                 </div>
               )}
            </div>
         </div>

         {/* Right: History Feed (2 cols) */}
         <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-[2.5rem] border-2 border-slate-100 shadow-sm overflow-hidden flex flex-col min-h-[600px]">
               <div className="flex bg-slate-50 p-2 border-b-2 border-slate-100">
                  <button 
                    onClick={() => setActiveHistoryTab('PAYMENTS')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeHistoryTab === 'PAYMENTS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Payments
                  </button>
                  <button 
                    onClick={() => setActiveHistoryTab('CREDITS')}
                    className={`flex-1 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeHistoryTab === 'CREDITS' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Credits {pendingCredits.length > 0 && <span className="ml-1 bg-rose-500 text-white px-2 py-0.5 rounded-full text-[8px]">{pendingCredits.length}</span>}
                  </button>
               </div>

               <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar">
                  {activeHistoryTab === 'PAYMENTS' ? (
                     sortedPayments.map(p => {
                        const vendor = allSuppliers.find(s => s.id === p.supplierId);
                        return (
                           <div key={p.id} className="p-4 bg-white border-2 border-slate-50 rounded-2xl flex items-center justify-between group hover:border-emerald-200 transition-all">
                              <div className="flex items-center gap-4">
                                 <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    {getMethodIcon(p.paymentMethod)}
                                 </div>
                                 <div className="min-w-0">
                                    <h4 className="text-[11px] font-black text-slate-900 truncate leading-tight">{vendor?.company || 'Unknown Vendor'}</h4>
                                    <div className="flex items-center gap-2 mt-1">
                                       <span className="text-[9px] font-bold text-slate-400 uppercase">{new Date(p.timestamp).toLocaleDateString()}</span>
                                       <span className="w-1 h-1 rounded-full bg-slate-200" />
                                       <span className="text-[9px] font-black text-indigo-500 uppercase">{p.paymentMethod}</span>
                                    </div>
                                 </div>
                              </div>
                              <div className="text-right pl-4">
                                 <p className="text-xs font-black text-slate-900 tabular-nums leading-none">Ksh {p.amount.toLocaleString()}</p>
                                 {p.transactionCode && <p className="text-[8px] font-bold text-emerald-500 mt-1 uppercase truncate max-w-[80px]">{p.transactionCode}</p>}
                              </div>
                           </div>
                        );
                     })
                  ) : (
                     sortedCredits.map(cn => {
                        const vendor = allSuppliers.find(s => s.id === cn.supplierId);
                        const isPend = cn.status === 'PENDING';
                        return (
                           <div key={cn.id} className="p-4 bg-white border-2 border-slate-50 rounded-2xl flex items-center justify-between group hover:border-blue-200 transition-all">
                              <div className="flex items-center gap-4">
                                 <div className={`w-10 h-10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform ${isPend ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                                    <ArrowUpRight size={18} />
                                 </div>
                                 <div className="min-w-0">
                                    <h4 className="text-[11px] font-black text-slate-900 truncate leading-tight">{vendor?.company || 'Unknown Vendor'}</h4>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{new Date(cn.timestamp).toLocaleDateString()}</p>
                                 </div>
                              </div>
                              <div className="text-right pl-4">
                                 <p className="text-xs font-black text-slate-900 tabular-nums leading-none">Ksh {cn.amount.toLocaleString()}</p>
                                 <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border mt-1 inline-block ${isPend ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                    {cn.status}
                                 </span>
                              </div>
                           </div>
                        );
                     })
                  )}
                  
                  {(activeHistoryTab === 'PAYMENTS' ? sortedPayments : sortedCredits).length === 0 && (
                     <div className="py-20 text-center flex flex-col items-center opacity-30">
                        <History size={40} className="mb-4" />
                        <p className="text-[10px] font-black uppercase tracking-widest">No activity log found</p>
                     </div>
                  )}
               </div>
            </div>
         </div>
      </div>

      <SupplierPaymentModal 
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        supplier={selectedSupplierForPayment}
        onSave={handleSavePayment}
        financialAccounts={financialAccounts}
      />
    </div>
  );
}

const CheckCircle2 = ({ size, className }: { size: number, className?: string }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>;
