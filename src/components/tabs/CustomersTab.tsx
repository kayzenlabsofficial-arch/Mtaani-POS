import React, { useState } from 'react';
import { Search, Plus, Users, Phone, Mail, ChevronRight, X, User, Trash2, Smartphone, Loader2, CheckCircle2, SlidersHorizontal, TrendingUp, CreditCard, UserCheck, ChevronDown } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Customer } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { MpesaService } from '../../services/mpesa';


export default function CustomersTab() {
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '' });
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error, info } = useToast();

  const [mpesaState, setMpesaState] = useState<'IDLE' | 'PUSHING' | 'POLLING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [mpesaRequestId, setMpesaRequestId] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');

  const allCustomers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );

  if (!allCustomers) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <Users size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading CRM...</p>
          </div>
      );
  }

  const filteredCustomers = allCustomers.filter(c => 
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
      c.phone.includes(customerSearch)
  );

  const totalCredit = allCustomers.reduce((sum, c) => sum + (c.balance || 0), 0);
  const activeClients = allCustomers.length;
  const highValueClients = allCustomers.filter(c => c.totalSpent > 10000).length;

  const openAddCustomer = () => {
      setEditingCustomer(null);
      setCustomerForm({ name: '', phone: '', email: '' });
      setIsCustomerModalOpen(true);
  }

  const openEditCustomer = (c: Customer) => {
      setEditingCustomer(c);
      setCustomerForm({ name: c.name, phone: c.phone, email: c.email });
      setIsCustomerModalOpen(true);
  }

  const handleSaveCustomer = async () => {
      if (isSaving) return;
      setIsSaving(true);
      try {
        if (editingCustomer) {
            await db.customers.update(editingCustomer.id, { ...customerForm });
            success("Customer updated.");
        } else {
            await db.customers.add({ id: crypto.randomUUID(), ...customerForm, totalSpent: 0, balance: 0, businessId: activeBusinessId! } as any);
            success("Customer added.");
        }
        setIsCustomerModalOpen(false);
      } catch (err: any) {
        error("Failed to save customer: " + err.message);
      } finally {
        setIsSaving(false);
      }
  }

  const handleDeleteCustomer = async () => {
    if (isSaving) return;
    if (editingCustomer && confirm(`Are you sure you want to delete ${editingCustomer.name}?`)) {
      setIsSaving(true);
      try {
        await db.customers.delete(editingCustomer.id);
        setIsCustomerModalOpen(false);
        success("Customer removed.");
      } catch (err: any) {
        error("Failed to delete customer: " + err.message);
      } finally {
        setIsSaving(false);
      }
    }
  }

  const handleMpesaRepayment = async () => {
    if (!editingCustomer || !repaymentAmount) return;
    const amount = Number(repaymentAmount);
    if (isNaN(amount) || amount <= 0) return error("Invalid amount");

    const activeBranchId = useStore.getState().activeBranchId;

    setMpesaState('PUSHING');
    try {
      const res = await MpesaService.triggerStkPush(editingCustomer.phone, amount, `REPAY-${editingCustomer.name.substring(0,5)}`, activeBusinessId!, activeBranchId!);
      if (res.success && res.checkoutRequestId) {
        setMpesaRequestId(res.checkoutRequestId);
        setMpesaState('POLLING');
        startPolling(res.checkoutRequestId, amount);
      } else {
        setMpesaState('FAILED');
        error(res.error || "STK Push failed");
      }
    } catch (err) {
      setMpesaState('FAILED');
      error("Connection failed");
    }
  }

  const startPolling = (requestId: string, amount: number) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 12) {
        clearInterval(interval);
        setMpesaState('FAILED');
        error("Payment timeout. Check M-Pesa message.");
        return;
      }

      const res = await MpesaService.checkStatus(requestId);
      if (res.found && res.resultCode === 0) {
        clearInterval(interval);
        setMpesaState('SUCCESS');
        
        if (editingCustomer) {
          const newBalance = Math.max(0, editingCustomer.balance - amount);
          await db.customers.update(editingCustomer.id, { balance: newBalance });
          success(`Ksh ${amount} received! New balance: Ksh ${newBalance}`);
        }
        
        setTimeout(() => {
          setMpesaState('IDLE');
          setRepaymentAmount('');
        }, 3000);
      } else if (res.found && res.resultCode !== 0) {
        clearInterval(interval);
        setMpesaState('FAILED');
        error(res.resultDesc || "Payment failed");
      }
    }, 5000);
  }

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Client Directory</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{activeClients} clients</span>
            <span className="text-slate-300">·</span>
            <span className={`text-[10px] font-bold ${totalCredit > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
              Ksh {totalCredit.toLocaleString()} debt
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-amber-600">
              {highValueClients} High-Value
            </span>
          </div>
        </div>
        <button
          onClick={openAddCustomer}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
        >
          <Plus size={18} /> Add New Client
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by client name or mobile number..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
          />
          {customerSearch && (
            <button onClick={() => setCustomerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Client List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
         {filteredCustomers.map(customer => (
            <div 
              key={customer.id} 
              onClick={() => openEditCustomer(customer)} 
              className="group bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm flex flex-col gap-4 hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
            >
               <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                     <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-sm shrink-0 font-black text-lg group-hover:scale-110 transition-transform">
                        {customer.name.substring(0,1).toUpperCase()}
                     </div>
                     <div className="min-w-0">
                        <h4 className="text-base font-black text-slate-900 truncate leading-tight">{customer.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                           <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><Phone size={12}/> {customer.phone}</span>
                        </div>
                     </div>
                  </div>
                  <ChevronRight size={20} className="text-slate-200 group-hover:text-indigo-400 transition-colors" />
               </div>
               
               <div className="flex items-end justify-between pt-4 border-t border-slate-50">
                  <div>
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Spent</p>
                     <h3 className="text-base font-black text-indigo-600 tabular-nums">Ksh {customer.totalSpent.toLocaleString()}</h3>
                  </div>
                  <div className="text-right">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Debt Balance</p>
                     <h3 className={`text-base font-black tabular-nums ${customer.balance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {customer.balance > 0 ? `Ksh ${customer.balance.toLocaleString()}` : 'CLEAN'}
                     </h3>
                  </div>
               </div>
            </div>
         ))}
         
         {filteredCustomers.length === 0 && (
            <div className="col-span-full py-32 text-center flex flex-col items-center">
               <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner text-slate-200">
                 <Users size={44} />
               </div>
               <p className="text-slate-500 font-black text-lg">No client records found</p>
               <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Adjust filters or add a new relationship</p>
            </div>
         )}
      </div>

      {/* Customer Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsCustomerModalOpen(false)} />
           <div className="bg-white w-full max-w-md rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[95vh] overflow-y-auto no-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center text-white shadow-blue">
                     <User size={24} />
                   </div>
                   <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight">{editingCustomer ? 'Client Profile' : 'New Client'}</h2>
                     <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">CRM Record Management</p>
                   </div>
                 </div>
                 {editingCustomer && isAdmin && (
                    <button onClick={handleDeleteCustomer} className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all press">
                      <Trash2 size={20} />
                    </button>
                  )}
              </div>

              <div className="space-y-6 mb-10">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Legal Full Name</label>
                    <input type="text" value={customerForm.name} onChange={e => setCustomerForm({...customerForm, name: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="e.g. Samuel Maina" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Mobile Contact</label>
                    <div className="relative">
                       <input type="text" value={customerForm.phone} onChange={e => setCustomerForm({...customerForm, phone: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-14 pr-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="0700 000 000" />
                       <Phone className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Email Address</label>
                    <div className="relative">
                       <input type="email" value={customerForm.email} onChange={e => setCustomerForm({...customerForm, email: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-14 pr-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="client@example.com" />
                       <Mail className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    </div>
                 </div>

                  {editingCustomer && editingCustomer.balance > 0 && (
                    <div className="pt-8 mt-4 border-t-2 border-slate-50">
                       <div className="flex items-center justify-between mb-4">
                          <h4 className="text-[11px] font-black text-indigo-600 uppercase tracking-[0.1em] flex items-center gap-2">
                             <Smartphone size={14} /> Repay Debt via M-Pesa
                          </h4>
                          <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-3 py-1 rounded-full">Ksh {editingCustomer.balance.toLocaleString()} Owed</span>
                       </div>
                       
                       {mpesaState === 'IDLE' || mpesaState === 'FAILED' ? (
                         <div className="flex gap-3">
                            <div className="relative flex-1">
                               <input 
                                type="number" 
                                value={repaymentAmount}
                                onChange={e => setRepaymentAmount(e.target.value)}
                                placeholder="Amount to pay..."
                                className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                               />
                               <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">KSH</span>
                            </div>
                            <button 
                              onClick={handleMpesaRepayment}
                              className="px-6 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-emerald active:scale-95 transition-all flex items-center gap-2"
                            >
                              Push
                            </button>
                         </div>
                       ) : (
                         <div className="bg-slate-50/50 p-6 rounded-[1.5rem] border-2 border-indigo-50 flex items-center justify-center gap-4">
                            {mpesaState === 'SUCCESS' ? (
                               <CheckCircle2 className="text-emerald-500 animate-bounce-in" size={24} />
                            ) : (
                               <Loader2 className="text-indigo-600 animate-spin" size={24} />
                            )}
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                               {mpesaState === 'PUSHING' ? 'Sending STK Prompt...' : 
                                mpesaState === 'POLLING' ? 'Awaiting Customer PIN...' : 
                                mpesaState === 'SUCCESS' ? 'Repayment Confirmed!' : 'Processing...'}
                            </span>
                         </div>
                       )}
                    </div>
                  )}
               </div>

              <div className="flex gap-4 mt-auto">
                 <button onClick={() => setIsCustomerModalOpen(false)} disabled={isSaving} className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl transition-all press disabled:opacity-50">
                   Dismiss
                 </button>
                 <button onClick={handleSaveCustomer} disabled={!customerForm.name || isSaving} className="flex-[2] grad-blue text-white px-8 py-5 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl disabled:opacity-40 transition-all shadow-blue press flex items-center justify-center gap-3">
                   {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                   {isSaving ? 'Processing...' : 'Save Record'}
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
