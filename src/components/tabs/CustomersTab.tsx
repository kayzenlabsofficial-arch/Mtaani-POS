import React, { useState } from 'react';
import { Search, Plus, Users, Phone, Mail, ChevronRight, X, User, Trash2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Customer } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';

export default function CustomersTab() {
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '' });
  const isAdmin = useStore(state => state.isAdmin);
  const { success, error } = useToast();

  const allCustomers = useLiveQuery(() => db.customers.toArray(), [], []) ;

  if (!allCustomers) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <Users size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-xs uppercase tracking-widest">Loading CRM...</p>
          </div>
      );
  }

  const filteredCustomers = allCustomers.filter(c => 
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
      c.phone.includes(customerSearch)
  );

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
      if (editingCustomer) {
          await db.customers.update(editingCustomer.id, { ...customerForm });
          success("Customer updated.");
      } else {
          await db.customers.add({ id: crypto.randomUUID(), ...customerForm, totalSpent: 0, balance: 0 } as any);
          success("Customer added.");
      }
      setIsCustomerModalOpen(false);
  }

  const handleDeleteCustomer = async () => {
    if (editingCustomer && confirm(`Are you sure you want to delete ${editingCustomer.name}?`)) {
      await db.customers.delete(editingCustomer.id);
      setIsCustomerModalOpen(false);
      success("Customer removed.");
    }
  }

  return (
    <div className="p-6 pb-24 animate-in fade-in max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-end mb-8">
         <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Client Directory</h2>
            <p className="text-slate-500 text-sm font-medium">Manage customer relationships and loyalty.</p>
         </div>
         <button onClick={openAddCustomer} className="grad-blue text-white px-5 py-3.5 rounded-2xl shadow-blue active:scale-95 transition-all flex items-center gap-2 font-black text-xs uppercase tracking-widest">
            <Plus size={18} /> Add Client
         </button>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder="Search by name or mobile number..." 
          value={customerSearch} 
          onChange={(e) => setCustomerSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white rounded-[20px] border border-slate-200 text-sm text-slate-700 shadow-card focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-bold"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
         {filteredCustomers.map(customer => (
            <div 
              key={customer.id} 
              onClick={() => openEditCustomer(customer)} 
              className="group bg-white p-5 rounded-[28px] border border-slate-100 shadow-card flex items-center justify-between hover:border-blue-200 transition-all cursor-pointer press"
            >
               <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm shrink-0 uppercase font-black text-lg group-hover:scale-105 transition-transform">
                     {customer.name.substring(0,1)}
                  </div>
                  <div className="min-w-0">
                     <h4 className="text-[15px] font-black text-slate-900 truncate">{customer.name}</h4>
                     <div className="flex items-center gap-3 mt-1 underline-offset-4">
                        <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><Phone size={10}/> {customer.phone}</span>
                        {customer.email && <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 hidden sm:flex"><Mail size={10}/> {customer.email.split('@')[0]}</span>}
                     </div>
                  </div>
               </div>
               <div className="text-right shrink-0">
                  <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest mb-1">Total Spent</p>
                  <p className="text-sm font-black text-blue-600 tabular-nums">
                     Ksh {customer.totalSpent.toLocaleString()}
                  </p>
               </div>
            </div>
         ))}
         
         {filteredCustomers.length === 0 && (
            <div className="col-span-full py-20 text-center flex flex-col items-center slide-up">
               <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center mb-4 text-slate-200">
                 <Users size={40} />
               </div>
               <p className="text-slate-500 font-black text-sm uppercase tracking-widest">No Clients Found</p>
               <p className="text-slate-400 text-xs mt-1">Start by adding your first customer to the system.</p>
            </div>
         )}
      </div>

      {/* Customer Modal */}
      {isCustomerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsCustomerModalOpen(false)} />
           <div className="bg-white w-full max-w-sm rounded-t-[40px] sm:rounded-[32px] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center gap-4 mb-8">
                 <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center text-white shadow-blue">
                   <User size={24} />
                 </div>
                 <div>
                   <h2 className="text-xl font-black text-slate-900">{editingCustomer ? 'Client Profile' : 'New Client'}</h2>
                   <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">CRM Management</p>
                 </div>
                 {editingCustomer && isAdmin && (
                    <button onClick={handleDeleteCustomer} className="ml-auto w-10 h-10 flex items-center justify-center rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors press">
                      <Trash2 size={20} />
                    </button>
                  )}
              </div>

              <div className="space-y-5 mb-8">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Legal Full Name</label>
                    <input type="text" value={customerForm.name} onChange={e => setCustomerForm({...customerForm, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all" placeholder="e.g. Samuel Maina" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Mobile Contact</label>
                    <div className="relative">
                       <input type="text" value={customerForm.phone} onChange={e => setCustomerForm({...customerForm, phone: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all" placeholder="0700 000 000" />
                       <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Email Address</label>
                    <div className="relative">
                       <input type="email" value={customerForm.email} onChange={e => setCustomerForm({...customerForm, email: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all font-medium" placeholder="client@example.com" />
                       <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    </div>
                 </div>
              </div>

              <div className="flex gap-4">
                 <button onClick={() => setIsCustomerModalOpen(false)} className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-black text-xs uppercase tracking-widest rounded-2xl transition-all press">
                   Cancel
                 </button>
                 <button onClick={handleSaveCustomer} disabled={!customerForm.name} className="flex-[2] grad-blue text-white px-6 py-4 font-black text-xs uppercase tracking-widest rounded-2xl disabled:opacity-40 transition-all shadow-blue press">
                   Save Record
                 </button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
