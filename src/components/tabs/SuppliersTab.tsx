import React, { useState } from 'react';
import { Search, Plus, Truck, DollarSign, User, Phone, Mail, ChevronRight, X, Briefcase, Trash2, SlidersHorizontal, TrendingDown, CreditCard, Building2, MapPin, ChevronDown } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import SupplierPaymentModal from '../modals/SupplierPaymentModal';
import SupplierLedgerModal from '../modals/SupplierLedgerModal';
import NestedControlPanel from '../shared/NestedControlPanel';

export default function SuppliersTab({ setActiveTab, financialAccounts }: { setActiveTab?: (tab: string) => void, financialAccounts: any[] }) {
  const [supplierSearch, setSupplierSearch] = useState("");
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [selectedSupplierForLedger, setSelectedSupplierForLedger] = useState<Supplier | null>(null);
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState<Supplier | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({ name: '', company: '', phone: '', email: '', address: '', kraPin: '' });
  const isAdmin = useStore(state => state.isAdmin);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const allSuppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );

  if (!allSuppliers) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <Truck size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading Supply Chain...</p>
          </div>
      );
  }

  const filteredSuppliers = allSuppliers.filter(s => 
      s.company.toLowerCase().includes(supplierSearch.toLowerCase()) || 
      s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  const totalPayables = allSuppliers.reduce((acc, s) => acc + (s.balance || 0), 0);
  const activeVendors = allSuppliers.length;

  const openAddSupplier = () => {
      setEditingSupplier(null);
      setSupplierForm({ name: '', company: '', phone: '', email: '', address: '', kraPin: '' });
      setIsSupplierModalOpen(true);
  }

  const openEditSupplier = (s: Supplier) => {
      setEditingSupplier(s);
      setSupplierForm({ name: s.name, company: s.company, phone: s.phone, email: s.email, address: s.address || '', kraPin: s.kraPin || '' });
      setIsSupplierModalOpen(true);
  }

  const openPaymentModal = (s: Supplier, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedSupplierForPayment(s);
      setIsPaymentModalOpen(true);
  }

  const handleSaveSupplier = async () => {
      if (!supplierForm.company) return;
      if (isSaving) return;
      setIsSaving(true);
      try {
        if (editingSupplier) {
            await db.suppliers.update(editingSupplier.id, { ...supplierForm });
            success("Supplier information updated.");
        } else {
            await db.suppliers.add({ id: crypto.randomUUID(), ...supplierForm, balance: 0, branchId: activeBranchId!, businessId: activeBusinessId! } as any);
            success("Supplier added.");
        }
        setIsSupplierModalOpen(false);
      } catch (err: any) {
        error("Failed to save supplier: " + err.message);
      } finally {
        setIsSaving(false);
      }
  }

  const handleDeleteSupplier = async () => {
    if (editingSupplier && confirm(`Are you sure you want to delete ${editingSupplier.company}?`)) {
      await db.suppliers.delete(editingSupplier.id);
      setIsSupplierModalOpen(false);
      success("Supplier removed.");
    }
  }

   const handleSavePayment = async (payment: { amount: number, method: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE', reference: string, source: 'TILL' | 'ACCOUNT', transactionCode?: string, purchaseOrderId?: string, purchaseOrderIds?: string[], creditNoteIds?: string[] }) => {
    if (!selectedSupplierForPayment) return;
    if (isSaving) return;
    setIsSaving(true);
    
    try {
        let totalDeduction = payment.amount;

        if (payment.creditNoteIds && payment.creditNoteIds.length > 0) {
            for (const cnId of payment.creditNoteIds) {
                const cn = await db.creditNotes.get(cnId);
                if (cn && cn.status === 'PENDING') {
                    await db.creditNotes.update(cnId, { status: 'ALLOCATED' });
                    totalDeduction += cn.amount;
                }
            }
        }

        await db.supplierPayments.add({
          id: crypto.randomUUID(),
          supplierId: selectedSupplierForPayment.id,
          purchaseOrderIds: payment.purchaseOrderIds,
          creditNoteIds: payment.creditNoteIds,
          amount: payment.amount,
          paymentMethod: payment.method,
          transactionCode: payment.transactionCode,
          reference: payment.reference,
          source: payment.source,
          timestamp: Date.now(),
          preparedBy: useStore.getState().currentUser?.name || 'Authorized Staff',
          branchId: activeBranchId!,
          businessId: activeBusinessId!,
          shiftId: useStore.getState().activeShift?.id
        });

        if (payment.purchaseOrderIds && payment.purchaseOrderIds.length > 0) {
            let remainingPool = totalDeduction;
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
          balance: Math.max(0, (selectedSupplierForPayment.balance || 0) - totalDeduction)
        });

        if (payment.source === 'ACCOUNT' && (payment as any).accountId) {
           const account = await db.financialAccounts.get((payment as any).accountId);
           if (account) {
              await db.financialAccounts.update(account.id, { balance: account.balance - payment.amount });
           }
        }
        success("Payment recorded successfully.");
        setIsPaymentModalOpen(false);
        setSelectedSupplierForPayment(null);
    } catch (err) {
        console.error("Failed to save payment:", err);
        error("Failed to save payment.");
    } finally {
        setIsSaving(false);
    }
  }

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Supply Chain Header */}
      <div className="px-4 pt-2 mb-6">
        <div className="flex items-center justify-between mb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Supply Chain</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Vendor & Procurement Management</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Tools</span>
              </button>
              <button onClick={openAddSupplier} className="grad-indigo text-white px-4 py-2.5 rounded-xl shadow-indigo active:scale-95 transition-all flex items-center gap-2 font-black text-[10px] uppercase">
                 <Plus size={18} /> New Vendor
              </button>
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Procurement Operations"
               subtitle="Monitor payables and supplier relationships"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className={`p-5 rounded-2xl border-2 flex items-center gap-5 transition-all ${totalPayables > 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
                      <div className={`w-12 h-12 rounded-[1.25rem] flex items-center justify-center ${totalPayables > 0 ? 'bg-rose-600 text-white shadow-rose' : 'bg-emerald-600 text-white shadow-emerald'}`}>
                         <CreditCard size={24} />
                      </div>
                      <div>
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Payables</p>
                         <h3 className={`text-2xl font-black ${totalPayables > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Ksh {totalPayables.toLocaleString()}</h3>
                      </div>
                   </div>
                   <div className="p-5 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-5 shadow-sm">
                      <div className="w-12 h-12 rounded-[1.25rem] bg-indigo-100 text-indigo-600 flex items-center justify-center">
                         <Building2 size={24} />
                      </div>
                      <div>
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Active Vendors</p>
                         <h3 className="text-2xl font-black text-slate-900 leading-none">{activeVendors} Registered</h3>
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
            placeholder="Search by company name or primary contact..." 
            value={supplierSearch} 
            onChange={(e) => setSupplierSearch(e.target.value)}
            className="w-full pl-14 pr-4 py-4.5 bg-white rounded-[1.5rem] border-2 border-slate-100 text-sm font-bold text-slate-800 shadow-sm focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none"
          />
          {supplierSearch && (
            <button onClick={() => setSupplierSearch('')} className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Vendor List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4">
         {filteredSuppliers.map(supplier => (
            <div 
              key={supplier.id} 
              onClick={() => { setSelectedSupplierForLedger(supplier); setIsLedgerModalOpen(true); }} 
              className="group bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm flex flex-col gap-5 hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
            >
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0">
                     <div className="w-14 h-14 rounded-[1.25rem] bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform shrink-0">
                        <Truck size={28} />
                     </div>
                     <div className="min-w-0">
                        <h4 className="text-base font-black text-slate-900 truncate leading-tight">{supplier.company}</h4>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight flex items-center gap-1.5 truncate">
                           <User size={12} className="shrink-0"/> <span className="truncate">{supplier.name}</span>
                        </p>
                     </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-200 group-hover:text-indigo-400 transition-colors" />
               </div>
               
               <div className="flex items-end justify-between pt-4 border-t border-slate-50">
                  <div className="flex-1">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Payable Balance</p>
                     <h3 className={`text-base font-black tabular-nums ${supplier.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        Ksh {supplier.balance.toLocaleString()}
                     </h3>
                  </div>
                  <button 
                    onClick={(e) => {
                       e.stopPropagation();
                       useStore.getState().setPaymentSupplierId(supplier.id);
                       if (setActiveTab) setActiveTab('SUPPLIER_PAYMENTS');
                    }}
                    className="px-5 py-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm active:scale-95 font-black text-[9px] uppercase tracking-widest whitespace-nowrap border border-slate-100"
                  >
                    Make Payment
                  </button>
               </div>
            </div>
         ))}
         
         {filteredSuppliers.length === 0 && (
            <div className="col-span-full py-32 text-center flex flex-col items-center">
               <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner text-slate-200">
                 <Truck size={44} />
               </div>
               <p className="text-slate-500 font-black text-lg">No vendor records matched</p>
               <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Add your first supplier to track procurement</p>
            </div>
         )}
      </div>

      {/* Supplier Modal */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsSupplierModalOpen(false)} />
           <div className="bg-white w-full max-w-md rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[95vh] overflow-y-auto no-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-lg">
                     <Briefcase size={22} />
                   </div>
                   <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight">{editingSupplier ? 'Vendor Profile' : 'New Vendor'}</h2>
                     <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Procurement Registry</p>
                   </div>
                 </div>
                 {editingSupplier && isAdmin && (
                    <button onClick={handleDeleteSupplier} className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all press">
                      <Trash2 size={20} />
                    </button>
                  )}
              </div>

              <div className="space-y-6 mb-10">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Company Name</label>
                    <input type="text" value={supplierForm.company} onChange={e => setSupplierForm({...supplierForm, company: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="e.g. Fresh Farms Ltd" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Primary Contact Person</label>
                    <div className="relative">
                       <input type="text" value={supplierForm.name} onChange={e => setSupplierForm({...supplierForm, name: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-14 pr-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="Key Account Manager" />
                       <User size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Mobile</label>
                        <input type="text" value={supplierForm.phone} onChange={e => setSupplierForm({...supplierForm, phone: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="07..." />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Email</label>
                        <input type="email" value={supplierForm.email} onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="@" />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Office Address</label>
                    <div className="relative">
                       <input type="text" value={supplierForm.address} onChange={e => setSupplierForm({...supplierForm, address: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-14 pr-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="Street, Building, City" />
                       <MapPin size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">KRA Tax PIN</label>
                    <input type="text" value={supplierForm.kraPin} onChange={e => setSupplierForm({...supplierForm, kraPin: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm font-mono" placeholder="A00..." />
                 </div>
              </div>

              <div className="flex gap-4 mt-auto pt-6 border-t border-slate-50">
                 <button onClick={() => setIsSupplierModalOpen(false)} className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl transition-all press">
                   Dismiss
                 </button>
                 <button onClick={handleSaveSupplier} disabled={!supplierForm.company} className="flex-[2] bg-slate-900 text-white px-8 py-5 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl disabled:opacity-40 transition-all shadow-xl press">
                   Save Record
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Ledger & Payment Modals */}
      <SupplierPaymentModal 
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onSave={handleSavePayment}
        financialAccounts={financialAccounts}
        shiftId={useStore.getState().activeShift?.id}
      />

      <SupplierLedgerModal 
        supplier={selectedSupplierForLedger}
        onClose={() => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); }}
        onEdit={(s) => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); openEditSupplier(s); }}
        onPay={(s) => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); openPaymentModal(s, {} as any); }}
        shiftId={useStore.getState().activeShift?.id}
        products={allProducts || []}
      />
    </div>
  );
}
