import React, { useState } from 'react';
import { Search, Plus, Truck, User, ChevronRight, X, Briefcase, Trash2, MapPin } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import SupplierLedgerModal from '../modals/SupplierLedgerModalDesktop';
import { belongsToActiveShop } from '../../utils/shopScope';
import { SupplierService } from '../../services/suppliers';
import { getCurrentShiftId } from '../../utils/shiftSession';


export default function SuppliersTabDesktop({ setActiveTab }: { setActiveTab?: (tab: string) => void }) {
  const [supplierSearch, setSupplierSearch] = useState("");
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);

  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);
  const [selectedSupplierForLedger, setSelectedSupplierForLedger] = useState<Supplier | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm, setSupplierForm] = useState({ name: '', company: '', phone: '', email: '', address: '', kraPin: '' });
  const isAdmin = useStore(state => state.isAdmin);
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShift = useStore(state => state.activeShift);
  const currentUser = useStore(state => state.currentUser);
  const { success, error } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const currentShiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);

  const allSuppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).filter(s => belongsToActiveShop(s, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId]
  );
  
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeShopId ? db.products.where('businessId').equals(activeBusinessId).filter(p => belongsToActiveShop(p, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );

  if (!allSuppliers) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <Truck size={32} className="text-slate-300" />
              </div>
              <p className="text-sm font-medium text-slate-500">Loading suppliers...</p>
          </div>
      );
  }

  const filteredSuppliers = allSuppliers.filter(s => 
      s.company.toLowerCase().includes(supplierSearch.toLowerCase()) || 
      s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  const totalPayables = allSuppliers.reduce((acc, s) => acc + (s.balance || 0), 0);
  const supplierCount = allSuppliers.length;

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

  const openPaymentPage = (s: Supplier, e?: React.MouseEvent) => {
      e?.stopPropagation();
      useStore.getState().setPaymentSupplierId(s.id);
      if (setActiveTab) setActiveTab('SUPPLIER_PAYMENTS');
  }

  const handleSaveSupplier = async () => {
      if (!supplierForm.company) return;
      if (isSaving) return;
      if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
      setIsSaving(true);
      try {
        await SupplierService.saveProfile({
            supplierId: editingSupplier?.id,
            supplier: supplierForm,
            shopId: activeShopId,
            businessId: activeBusinessId,
        });
        await db.suppliers.reload();
        success(editingSupplier ? "Supplier information updated." : "Supplier added.");
        setIsSupplierModalOpen(false);
      } catch (err: any) {
        error("Failed to save supplier: " + err.message);
      } finally {
        setIsSaving(false);
      }
  }

  const handleDeleteSupplier = async () => {
    if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
    if (editingSupplier && confirm(`Are you sure you want to delete ${editingSupplier.company}?`)) {
      try {
        await SupplierService.deleteProfile({
          supplierId: editingSupplier.id,
          shopId: activeShopId,
          businessId: activeBusinessId,
        });
        await db.suppliers.reload();
        setIsSupplierModalOpen(false);
        success("Supplier removed.");
      } catch (err: any) {
        error("Failed to delete supplier: " + err.message);
      }
    }
  }

  return (
    <div className="w-full animate-in fade-in space-y-5 pb-24">
      
      {/* Header */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Suppliers</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Supplier balances, payments, and credit notes.</p>
        </div>
        <button
          onClick={openAddSupplier}
          className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white hover:bg-blue-800"
        >
          <Plus size={18} /> Add supplier
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Suppliers</p>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-950">{supplierCount}</p>
        </div>
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Amount to pay</p>
          <p className={`mt-1 text-xl font-black tabular-nums ${totalPayables > 0 ? 'text-rose-600' : 'text-slate-950'}`}>Ksh {totalPayables.toLocaleString()}</p>
        </div>
      </div>
      </section>

      {/* Search Bar */}
      <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
      <div className="border-b-2 border-slate-100 p-4">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-700 transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by company or contact name..."
            value={supplierSearch}
            onChange={(e) => setSupplierSearch(e.target.value)}
            className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-9 text-sm font-bold outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
          {supplierSearch && (
            <button onClick={() => setSupplierSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Supplier List */}
      <div>
         {filteredSuppliers.length > 0 ? (
           <div className="divide-y divide-slate-100">
             {filteredSuppliers.map(supplier => (
               <div
                 key={supplier.id}
                 data-testid={`supplier-row-${supplier.id}`}
                 className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 transition-colors hover:bg-blue-50/40 sm:px-5"
                 onClick={() => { setSelectedSupplierForLedger(supplier); setIsLedgerModalOpen(true); }}
               >
                 <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                   <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
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
                     <p className="text-[11px] font-medium text-slate-500">Amount owed</p>
                     <p className={`text-sm font-black tabular-nums whitespace-nowrap ${supplier.balance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                       Ksh {supplier.balance.toLocaleString()}
                     </p>
                   </div>
                   <button
                     data-testid={`supplier-pay-${supplier.id}`}
                     onClick={(e) => openPaymentPage(supplier, e)}
                     className="shrink-0 rounded-lg border-2 border-blue-700 bg-blue-700 px-3 py-2 text-xs font-black text-white transition-all hover:bg-blue-800 active:scale-95"
                   >
                     Pay
                   </button>
                   <ChevronRight size={18} className="hidden shrink-0 text-slate-300 transition-colors group-hover:text-blue-600 sm:block" />
                 </div>
               </div>
             ))}
           </div>
         ) : (
           <div className="py-20 text-center flex flex-col items-center">
             <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 text-slate-300">
               <Truck size={36} />
             </div>
             <p className="text-slate-500 font-black text-base">No suppliers found</p>
             <p className="mt-1 text-xs font-bold text-slate-400">Add your first supplier to track purchases.</p>
           </div>
         )}
      </div>
      </section>

      {/* Supplier Modal */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 pb-safe sm:items-center sm:p-4">
           <div className="absolute inset-0 bg-slate-900/45" onClick={() => setIsSupplierModalOpen(false)} />
           <div className="relative z-10 flex max-h-[95vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl border-2 border-slate-200 bg-white p-5 shadow-xl sm:rounded-lg">
              
              <div className="mb-6 flex shrink-0 items-center justify-between">
                 <div className="flex items-center gap-4">
                   <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
                     <Briefcase size={22} />
                   </div>
                   <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight">{editingSupplier ? 'Supplier details' : 'New supplier'}</h2>
                     <p className="text-xs font-medium text-slate-500 mt-0.5">Supplier list</p>
                   </div>
                 </div>
                 {editingSupplier && isAdmin && (
                    <button onClick={handleDeleteSupplier} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-rose-100 bg-rose-50 text-rose-600">
                      <Trash2 size={20} />
                    </button>
                  )}
              </div>

              <div className="mb-8 space-y-4">
                 <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Company name</label>
                    <input type="text" value={supplierForm.company} onChange={e => setSupplierForm({...supplierForm, company: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="e.g. Fresh Farms Ltd" />
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Contact person</label>
                    <div className="relative">
                       <input type="text" value={supplierForm.name} onChange={e => setSupplierForm({...supplierForm, name: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="Person to call" />
                       <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Mobile</label>
                        <input type="text" value={supplierForm.phone} onChange={e => setSupplierForm({...supplierForm, phone: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-blue-600" placeholder="07..." />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Email</label>
                        <input type="email" value={supplierForm.email} onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-blue-600" placeholder="@" />
                    </div>
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">Office address</label>
                    <div className="relative">
                       <input type="text" value={supplierForm.address} onChange={e => setSupplierForm({...supplierForm, address: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white py-3 pl-11 pr-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600" placeholder="Street, Building, City" />
                       <MapPin size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                 </div>
                 <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-2 ml-1">KRA tax PIN</label>
                    <input type="text" value={supplierForm.kraPin} onChange={e => setSupplierForm({...supplierForm, kraPin: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 font-mono text-sm font-black text-slate-900 outline-none focus:border-blue-600" placeholder="A00..." />
                 </div>
              </div>

              <div className="mt-auto flex gap-3 border-t-2 border-slate-100 pt-5">
                 <button onClick={() => setIsSupplierModalOpen(false)} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-600">
                   Cancel
                 </button>
                 <button onClick={handleSaveSupplier} disabled={!supplierForm.company} className="flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40 hover:bg-blue-800">
                   Save supplier
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Statement Modal */}
      <SupplierLedgerModal 
        supplier={selectedSupplierForLedger}
        onClose={() => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); }}
        onEdit={(s) => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); openEditSupplier(s); }}
        onPay={(s) => { setIsLedgerModalOpen(false); setSelectedSupplierForLedger(null); openPaymentPage(s); }}
        shiftId={currentShiftId}
        products={allProducts || []}
      />
    </div>
  );
}
