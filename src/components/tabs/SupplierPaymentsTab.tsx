import React, { useState } from 'react';
import { Search, DollarSign, Wallet, ArrowUpRight, Clock, Landmark, CreditCard, Banknote, Building2, Receipt } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import SupplierPaymentModal from '../modals/SupplierPaymentModal';

export default function SupplierPaymentsTab({ financialAccounts }: { financialAccounts: any[] }) {
  const [paySearch, setPaySearch] = useState("");
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState<Supplier | null>(null);
  const { success, error } = useToast();
  const paymentSupplierId = useStore(state => state.paymentSupplierId);
  const setPaymentSupplierId = useStore(state => state.setPaymentSupplierId);

  // Live Queries
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const allSuppliers = useLiveQuery(() => db.suppliers.toArray(), [], []) ;
  const allPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;

  const suppliersOwed = allSuppliers.filter(s => s.balance > 0);
  const totalDebt = suppliersOwed.reduce((sum, s) => sum + (s.balance || 0), 0);
  
  const filteredOwed = suppliersOwed.filter(s => 
      s.company.toLowerCase().includes(paySearch.toLowerCase()) || 
      s.name.toLowerCase().includes(paySearch.toLowerCase())
  );

  const sortedPayments = [...allPayments].sort((a,b) => b.timestamp - a.timestamp);

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
    if (!selectedSupplierForPayment) return;
    
    try {
        // ── FIX C5: Check ACCOUNT balance BEFORE recording to prevent negative balances ──
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

        // Deduct from Financial Account if source is ACCOUNT
        if ((payment as any).source === 'ACCOUNT' && (payment as any).accountId) {
           const account = await db.financialAccounts.get((payment as any).accountId);
           if (account) {
              await db.financialAccounts.update(account.id, { balance: account.balance - payment.amount });
           }
        }

        // Allocation logic for multiple invoices
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
    } catch (err) {
        console.error("Failed to save payment:", err);
        error("Failed to save payment.");
    } finally {
        setIsPaymentModalOpen(false);
        setSelectedSupplierForPayment(null);
    }
  }

  const getMethodIcon = (method: string) => {
    switch (method) {
      case 'MPESA': return <CreditCard size={14} />;
      case 'BANK': return <Building2 size={14} />;
      case 'CHEQUE': return <Receipt size={14} />;
      default: return <Banknote size={14} />;
    }
  }

  return (
    <div className="p-5 pb-8 animate-in fade-in max-w-5xl mx-auto w-full flex flex-col">
      <div className="flex justify-between items-center mb-6 mt-2">
         <div>
           <h2 className="text-xl font-extrabold text-slate-900 mb-1">Supplier Payments</h2>
           <p className="text-sm text-slate-500">Manage vendor debt and payment logs.</p>
         </div>
      </div>

      {/* Debt Summary Card */}
      <div className="bg-red-600 rounded-3xl p-6 text-white shadow-xl shadow-red-600/20 mb-6 relative overflow-hidden">
         <div className="relative z-10">
            <p className="text-red-100 text-xs font-bold   mb-1">Total Outstanding Debt</p>
            <h3 className="text-4xl font-black mb-1">Ksh {totalDebt.toLocaleString()}</h3>
            <p className="text-red-100/80 text-[10px] font-medium italic">Owed to {suppliersOwed.length} active suppliers</p>
         </div>
         <Wallet className="absolute -right-4 -bottom-4 w-32 h-32 text-red-500 opacity-20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
         {/* Left Side: Pending Payables */}
         <div className="flex flex-col">
            <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
               <ArrowUpRight size={16} className="text-red-500" /> Pending Balances
            </h3>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
              <input 
                type="text" placeholder="Filter vendors..." value={paySearch} onChange={(e) => setPaySearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white rounded-xl border border-slate-200 text-xs font-semibold focus:border-red-500 focus:outline-none transition-all"
              />
            </div>
            <div className="space-y-2 pb-4">
               {filteredOwed.length === 0 ? (
                  <div className="bg-white/50 border border-dashed border-slate-200 rounded-2xl py-10 text-center">
                     <p className="text-xs text-slate-400 font-bold ">No pending debts</p>
                  </div>
               ) : (
                  filteredOwed.map(s => (
                     <div key={s.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                           <h4 className="text-sm font-bold text-slate-900">{s.company}</h4>
                           <p className="text-[10px] font-bold text-red-600 mt-1  tracking-tight">Ksh {s.balance.toLocaleString()} Due</p>
                        </div>
                        <button 
                          onClick={() => openPaymentModal(s)}
                          className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black   hover:bg-green-600 transition-colors shadow-md active:scale-95"
                        >
                          Record Pay
                        </button>
                     </div>
                  ))
               )}
            </div>
         </div>

         {/* Right Side: Payment History */}
         <div className="flex flex-col">
            <h3 className="text-sm font-black text-slate-900 mb-3 flex items-center gap-2">
               <Clock size={16} className="text-blue-500" /> Recent Payments
            </h3>
            <div className="space-y-2 pb-24">
               {sortedPayments.length === 0 ? (
                  <div className="bg-white/50 border border-dashed border-slate-200 rounded-2xl py-10 text-center">
                     <p className="text-xs text-slate-400 font-bold  ">No history yet</p>
                  </div>
               ) : (
                  sortedPayments.map(p => {
                    const vendor = allSuppliers.find(s => s.id === p.supplierId);
                    return (
                       <div key={p.id} className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between border-l-4 border-l-green-500">
                          <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center text-green-600">
                                {getMethodIcon(p.paymentMethod)}
                             </div>
                             <div>
                                <h4 className="text-[11px] font-bold text-slate-900">{vendor?.company || 'Unknown Vendor'}</h4>
                                <div className="flex flex-col gap-0.5 mt-0.5">
                                    <p className="text-[9px] font-semibold text-slate-500">{new Date(p.timestamp).toLocaleDateString()} • {p.reference || 'No ref'}</p>
                                    {p.transactionCode && (
                                        <div className="flex items-center gap-1">
                                            <Landmark size={8} className="text-blue-500" />
                                            <span className="text-[9px] font-bold text-blue-600  tracking-tight">{p.transactionCode}</span>
                                        </div>
                                    )}
                                </div>
                             </div>
                          </div>
                          <div className="text-right">
                             <p className="text-xs font-black text-slate-900">Ksh {p.amount.toLocaleString()}</p>
                             <p className="text-[8px] font-bold text-green-600  ">SENT</p>
                          </div>
                       </div>
                    );
                  })
               )}
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
