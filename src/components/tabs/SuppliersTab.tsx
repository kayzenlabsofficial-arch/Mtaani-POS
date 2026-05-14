import React, { useState } from 'react';
import { Search, Plus, Truck, DollarSign, User, Phone, Mail, ChevronRight, X, Briefcase, Trash2, SlidersHorizontal, TrendingDown, CreditCard, Building2, MapPin, ChevronDown } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import SupplierPaymentModal from '../modals/SupplierPaymentModal';
import SupplierLedgerModal from '../modals/SupplierLedgerModal';
import { settleSupplierPayment, type SupplierPaymentInput } from '../../utils/supplierLedger';


export default function SuppliersTab({ setActiveTab, financialAccounts }: { setActiveTab?: (tab: string) => void, financialAccounts: any[] }) {
  const [supplierSearch, setSupplierSearch] = useState("");
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);

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

  const openPaymentModal = (s: Supplier, e?: React.MouseEvent) => {
      e?.stopPropagation();
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

   const handleSavePayment = async (payment: SupplierPaymentInput) => {
    if (!selectedSupplierForPayment || isSaving) return;
    setIsSaving(true);
    
    try {
        await settleSupplierPayment({
          supplier: selectedSupplierForPayment,
          payment,
          activeBranchId: activeBranchId!,
          activeBusinessId: activeBusinessId!,
          preparedBy: useStore.getState().currentUser?.name || 'Authorized Staff',
          shiftId: useStore.getState().activeShift?.id,
        });
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
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Suppliers</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{activeVendors} vendors</span>
            <span className="text-slate-300">·</span>
            <span className={`text-[10px] font-bold ${totalPayables > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              Ksh {totalPayables.toLocaleString()} payable
            </span>
          </div>
        </div>
        <button
          onClick={openAddSupplier}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
        >
          <Plus size={18} /> Add New Supplier
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by company or contact name..."
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
          />
          {supplierSearch && (
            <button onClick={() => setSupplierSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Vendor List */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
         {filteredSuppliers.length > 0 ? (
           <div className="divide-y divide-slate-100">
             {filteredSuppliers.map(supplier => (
               <div
                 key={supplier.id}
                 data-testid={`supplier-row-${supplier.id}`}
                 className="px-3 sm:px-5 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 hover:bg-indigo-50/40 transition-colors group cursor-pointer"
                 onClick={() => { setSelectedSupplierForLedger(supplier); setIsLedgerModalOpen(true); }}
               >
                 <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                     <Truck size={18} />
                   </div>
                   <div className="stable-row-copy">
                     <h4 className="text-sm font-black text-slate-900 stable-title leading-tight">{supplier.company}</h4>
                     <p className="text-[10px] font-bold text-slate-400 mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
                       <User size={11} className="shrink-0" /> <span className="stable-meta">{supplier.name}</span>
                     </p>
                   </div>
                 </div>
                 <div className="stable-actions flex items-center gap-2">
                   <div className="text-right">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Payable</p>
                     <p className={`text-sm font-black tabular-nums whitespace-nowrap ${supplier.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                       Ksh {supplier.balance.toLocaleString()}
                     </p>
                   </div>
                   <button
                     data-testid={`supplier-pay-${supplier.id}`}
                     onClick={(e) => {
                       e.stopPropagation();
                       useStore.getState().setPaymentSupplierId(supplier.id);
                       if (setActiveTab) setActiveTab('SUPPLIER_PAYMENTS');
                     }}
                     className="px-3 py-2 rounded-xl bg-slate-50 text-slate-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm active:scale-95 font-black text-[9px] uppercase tracking-widest whitespace-nowrap border border-slate-100 shrink-0"
                   >
                     Pay
                   </button>
                   <ChevronRight size={18} className="hidden sm:block text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                 </div>
               </div>
             ))}
           </div>
         ) : (
           <div className="py-20 text-center flex flex-col items-center">
             <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
               <Truck size={36} />
             </div>
             <p className="text-slate-500 font-black text-base">No vendor records matched</p>
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
        supplier={selectedSupplierForPayment}
        onSave={handleSavePayment}
        financialAccounts={financialAccounts}
        shiftId={useStore.getState().activeShift?.id}
      />

      <SupplierLedgerModal 
        supplier={selectedSupplierForLedger}
        onClose={() => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); }}
        onEdit={(s) => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); openEditSupplier(s); }}
        onPay={(s) => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); openPaymentModal(s); }}
        shiftId={useStore.getState().activeShift?.id}
        products={allProducts || []}
      />
    </div>
  );
}
