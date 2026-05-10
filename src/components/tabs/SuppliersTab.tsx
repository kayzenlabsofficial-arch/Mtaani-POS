import React, { useState } from 'react';
import { Search, Plus, Truck, DollarSign, User, Phone, Mail, ChevronRight, X, Briefcase, Trash2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Supplier } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import SupplierPaymentModal from '../modals/SupplierPaymentModal';
import SupplierLedgerModal from '../modals/SupplierLedgerModal';

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
              <p className="text-slate-400 font-black text-xs  ">Loading Supply Chain...</p>
          </div>
      );
  }

  const filteredSuppliers = allSuppliers.filter(s => 
      s.company.toLowerCase().includes(supplierSearch.toLowerCase()) || 
      s.name.toLowerCase().includes(supplierSearch.toLowerCase())
  );

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

        // Process Credit Notes first
        if (payment.creditNoteIds && payment.creditNoteIds.length > 0) {
            for (const cnId of payment.creditNoteIds) {
                const cn = await db.creditNotes.get(cnId);
                if (cn && cn.status === 'PENDING') {
                    await db.creditNotes.update(cnId, { status: 'ALLOCATED' });
                    totalDeduction += cn.amount; // Total reduction of debt
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

        // Deduct from Financial Account if source is ACCOUNT
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
    <div className="p-6 pb-24 animate-in fade-in max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-end mb-6">
         <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Supply Chain</h2>
            <p className="text-slate-500 text-sm font-medium">Manage vendors, procurement and payables.</p>
         </div>
         <button onClick={openAddSupplier} className="bg-slate-900 text-white px-5 py-3.5 rounded-2xl shadow-elevated active:scale-95 transition-all flex items-center gap-2 font-black text-xs  ">
            <Plus size={18} /> New Supplier
         </button>
      </div>

      {/* Supplier Stats */}
      <div className="grid grid-cols-2 gap-4 mb-8">
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-black text-slate-400   mb-1">Total Payables</p>
            <p className="text-2xl font-black text-red-600 tracking-tight">
               Ksh {allSuppliers.reduce((acc, s) => acc + (s.balance || 0), 0).toLocaleString()}
            </p>
         </div>
         <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <p className="text-[10px] font-black text-slate-400   mb-1">Active Vendors</p>
            <p className="text-2xl font-black text-slate-900 tracking-tight">
               {allSuppliers.length}
            </p>
         </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder="Search by company or primary contact..." 
          value={supplierSearch} 
          onChange={(e) => setSupplierSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white rounded-xl border border-slate-200 text-sm text-slate-700 shadow-card focus:border-slate-800 focus:ring-4 focus:ring-slate-800/10 outline-none transition-all font-bold"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {filteredSuppliers.map(supplier => (
            <div 
              key={supplier.id} 
              onClick={() => { setSelectedSupplierForLedger(supplier); setIsLedgerModalOpen(true); }} 
              className="group bg-white p-5 rounded-2xl border border-slate-100 shadow-card flex items-center justify-between hover:border-slate-800/30 transition-all cursor-pointer press gap-3"
            >
               <div className="flex items-center gap-4 min-w-0">
                  <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform shrink-0">
                     <Truck size={24} />
                  </div>
                  <div className="min-w-0">
                     <h4 className="text-[15px] font-black text-slate-900 truncate">{supplier.company}</h4>
                     <p className="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-2 truncate">
                        <User size={10} className="shrink-0"/> <span className="truncate">{supplier.name}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-200 shrink-0" />
                        <Phone size={10} className="shrink-0"/> <span className="truncate">{supplier.phone}</span>
                     </p>
                  </div>
               </div>
               <div className="flex flex-col items-end gap-2 shrink-0">
                  <div className={`text-[9px] font-black px-2.5 py-1 rounded-lg   border-2 ${supplier.balance > 0 ? 'bg-red-50 text-red-600 border-red-100' : 'bg-green-50 text-green-600 border-green-100'}`}>
                     Ksh {supplier.balance.toLocaleString()}
                  </div>
                  <button 
                    onClick={(e) => {
                       e.stopPropagation();
                       useStore.getState().setPaymentSupplierId(supplier.id);
                       if (setActiveTab) setActiveTab('SUPPLIER_PAYMENTS');
                    }}
                    className="px-4 h-10 flex items-center justify-center rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white transition-all shadow-sm active:scale-90 font-bold text-[10px]   whitespace-nowrap"
                  >
                    Make Payment
                  </button>
               </div>
            </div>
         ))}
         
         {filteredSuppliers.length === 0 && (
            <div className="col-span-full py-20 text-center flex flex-col items-center slide-up">
               <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 text-slate-200">
                 <Truck size={40} />
               </div>
               <p className="text-slate-500 font-black text-sm  ">No Vendors</p>
               <p className="text-slate-400 text-xs mt-1">Add your product suppliers to track inventory procurement.</p>
            </div>
         )}
      </div>

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

      {/* Supplier Modal */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsSupplierModalOpen(false)} />
           <div className="bg-white w-full max-w-sm rounded-t-[40px] sm:rounded-2xl shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center gap-4 mb-8">
                 <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-lg">
                   <Briefcase size={22} />
                 </div>
                 <div>
                   <h2 className="text-xl font-black text-slate-900">{editingSupplier ? 'Vendor Profile' : 'New Vendor'}</h2>
                   <p className="text-slate-400 text-[10px] font-black  ">Procurement Registry</p>
                 </div>
                 {editingSupplier && isAdmin && (
                    <button onClick={handleDeleteSupplier} className="ml-auto w-10 h-10 flex items-center justify-center rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors press">
                      <Trash2 size={20} />
                    </button>
                  )}
              </div>

              <div className="space-y-5 mb-8">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400   mb-2 ml-1">Registered Company Name</label>
                    <input type="text" value={supplierForm.company} onChange={e => setSupplierForm({...supplierForm, company: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-slate-800 transition-all font-bold" placeholder="e.g. Fresh Farms Ltd" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400   mb-2 ml-1">Key Account Manager</label>
                    <div className="relative">
                       <input type="text" value={supplierForm.name} onChange={e => setSupplierForm({...supplierForm, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-slate-800 transition-all" placeholder="Primary contact name" />
                       <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-[10px] font-black text-slate-400   mb-2 ml-1">Mobile</label>
                        <input type="text" value={supplierForm.phone} onChange={e => setSupplierForm({...supplierForm, phone: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-slate-800 transition-all" placeholder="07..." />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-slate-400   mb-2 ml-1">Email</label>
                        <input type="email" value={supplierForm.email} onChange={e => setSupplierForm({...supplierForm, email: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-slate-800 transition-all" placeholder="@" />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400   mb-2 ml-1">Business Address</label>
                    <input type="text" value={supplierForm.address} onChange={e => setSupplierForm({...supplierForm, address: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-slate-800 transition-all" placeholder="Street, Building, City" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400   mb-2 ml-1">KRA PIN</label>
                    <input type="text" value={supplierForm.kraPin} onChange={e => setSupplierForm({...supplierForm, kraPin: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-slate-800 transition-all " placeholder="A00..." />
                 </div>
              </div>

              <div className="flex gap-4">
                 <button onClick={() => setIsSupplierModalOpen(false)} className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-black text-xs   rounded-2xl transition-all press">
                   Cancel
                 </button>
                 <button onClick={handleSaveSupplier} disabled={!supplierForm.company} className="flex-[2] bg-slate-900 text-white px-6 py-4 font-black text-xs   rounded-2xl disabled:opacity-40 transition-all shadow-lg press">
                   Save Record
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

