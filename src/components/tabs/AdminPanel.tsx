import React, { useState } from 'react';
import { Settings as SettingsIcon, ShieldCheck, Users, Plus, Trash2, KeyRound, Tag as TagIcon, Building2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';

import SettingsTab from './SettingsTab';
import AdminApprovals from './AdminApprovals';
import CategoryManagementModal from '../modals/CategoryManagementModal';
import BranchManagementTab from './BranchManagementTab';

export default function AdminPanel({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'SETTINGS' | 'APPROVALS' | 'USERS' | 'CATEGORIES' | 'BRANCHES'>('USERS');
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  
  // User Management State
  const users = useLiveQuery(() => db.users.toArray(), [], []);
  const activeShifts = useLiveQuery(() => db.shifts.where('status').equals('OPEN').toArray(), [], []);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', password: '', role: 'CASHIER' as 'CASHIER' | 'ADMIN' });

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.password) return;
    await db.users.add({
      id: crypto.randomUUID(),
      name: newUser.name,
      password: newUser.password,
      role: newUser.role,
      updated_at: Date.now()
    });
    setNewUser({ name: '', password: '', role: 'CASHIER' });
    setIsAddingUser(false);
    await db.sync();
  };

  const handleDeleteUser = async (id: string) => {
    if (confirm("Are you sure you want to delete this user?")) {
      await db.users.delete(id);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent relative animate-in fade-in max-w-5xl mx-auto w-full">
      <div className="p-5 pb-0">
        <h2 className="text-xl font-extrabold text-slate-900 mb-1">Admin Control Room</h2>
        <p className="text-sm text-slate-500 mb-4">Manage your business settings, users, and authorizations.</p>
        
        {/* Admin Sub-navigation */}
        <div className="flex bg-slate-200/50 p-1 rounded-xl mb-4 overflow-x-auto no-scrollbar gap-1">
            <button 
              onClick={() => setActiveAdminTab('USERS')} 
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${activeAdminTab === 'USERS' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Users size={13} /> Users
            </button>
            <button 
              onClick={() => setActiveAdminTab('BRANCHES')} 
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${activeAdminTab === 'BRANCHES' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Building2 size={13} /> Branches
            </button>
            <button 
              onClick={() => setActiveAdminTab('CATEGORIES')} 
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${activeAdminTab === 'CATEGORIES' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <TagIcon size={13} /> Categories
            </button>
            <button 
              onClick={() => setActiveAdminTab('APPROVALS')} 
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${activeAdminTab === 'APPROVALS' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <ShieldCheck size={13} /> Approvals
            </button>
            <button 
              onClick={() => setActiveAdminTab('SETTINGS')} 
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${activeAdminTab === 'SETTINGS' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <SettingsIcon size={13} /> Settings
            </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8 relative">
        {activeAdminTab === 'SETTINGS' && <div className="mt-[-20px]"><SettingsTab updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} /></div>}
        {activeAdminTab === 'APPROVALS' && <div className="mt-[-20px]"><AdminApprovals /></div>}
        {activeAdminTab === 'BRANCHES' && <BranchManagementTab />}
        
        {activeAdminTab === 'USERS' && (
          <div className="space-y-4">
             {activeShifts && activeShifts.length > 0 && (
               <div className="mb-6">
                 <h3 className="text-sm font-extrabold text-slate-900 mb-3 flex items-center gap-2">
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div> Active Cashier Sessions
                 </h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeShifts.map(shift => {
                       const isOnline = shift.lastSyncAt && (Date.now() - shift.lastSyncAt < 60000); // synced in last 60s
                       return (
                         <div key={shift.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex justify-between items-center shadow-sm">
                            <div className="flex items-center gap-3">
                               <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm bg-blue-100 text-blue-700">
                                  {shift.cashierName.charAt(0).toUpperCase()}
                               </div>
                               <div>
                                  <p className="font-bold text-sm text-slate-900">{shift.cashierName}</p>
                                  <p className="text-[10px] text-slate-500 font-medium">Shift started: {new Date(shift.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                               </div>
                            </div>
                            <div className="text-right">
                               <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${isOnline ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {isOnline ? 'Online' : 'Offline'}
                               </span>
                               <p className="text-[9px] text-slate-400 mt-1">
                                  Last sync: {shift.lastSyncAt ? new Date(shift.lastSyncAt).toLocaleTimeString() : 'Never'}
                               </p>
                            </div>
                         </div>
                       );
                    })}
                 </div>
               </div>
             )}

             <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200">
                <div>
                   <h3 className="text-sm font-extrabold text-slate-900">Registered Accounts</h3>
                   <p className="text-xs text-slate-500">Staff members authorized to log in.</p>
                </div>
                <button 
                  onClick={() => setIsAddingUser(true)}
                  className="bg-blue-600 text-white font-bold text-xs flex items-center gap-2 px-4 py-2.5 rounded-xl transition-transform active:scale-95 shadow-lg shadow-blue-600/20"
                >
                   <Plus size={14} /> Create Staff Account
                </button>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {users?.map(user => (
                   <div key={user.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
                      <div className="flex items-center gap-3">
                         <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                            {user.name.charAt(0).toUpperCase()}
                         </div>
                         <div>
                            <p className="font-bold text-sm text-slate-900">{user.name}</p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                               <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded tracking-widest ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {user.role}
                               </span>
                               <span className="text-xs text-slate-400 font-mono flex items-center gap-1"><KeyRound size={10}/> ****</span>
                            </div>
                         </div>
                      </div>
                      <button onClick={() => handleDeleteUser(user.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                         <Trash2 size={16} />
                      </button>
                   </div>
                ))}
             </div>

             {/* Add User Form Inline */}
             {isAddingUser && (
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm mt-4 animate-in fade-in slide-in-from-top-4">
                   <h3 className="text-sm font-extrabold text-slate-900 mb-4">Create New Account</h3>
                   <div className="space-y-4 mb-6">
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">Full Name</label>
                        <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500" placeholder="e.g. Jane Doe" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">Default Password</label>
                        <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 tracking-wider focus:outline-none focus:border-blue-500" placeholder="e.g. secret123" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-1">Role</label>
                        <div className="flex gap-2">
                           <button onClick={() => setNewUser({...newUser, role: 'CASHIER'})} className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-colors ${newUser.role === 'CASHIER' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                              Cashier
                           </button>
                           <button onClick={() => setNewUser({...newUser, role: 'ADMIN'})} className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-colors ${newUser.role === 'ADMIN' ? 'bg-purple-50 border-purple-500 text-purple-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                              Administrator
                           </button>
                        </div>
                      </div>
                   </div>
                   <div className="flex gap-3">
                      <button onClick={() => {setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER' });}} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold text-sm rounded-xl">Cancel</button>
                      <button onClick={handleAddUser} disabled={!newUser.name || newUser.password.length < 4} className="flex-[2] py-3 bg-blue-600 text-white font-bold text-sm rounded-xl disabled:opacity-50">Create User</button>
                   </div>
                </div>
             )}
          </div>
        )}
         {activeAdminTab === 'CATEGORIES' && (
           <div className="space-y-4">
              <div className="bg-white p-6 rounded-[28px] border border-slate-200 shadow-sm text-center">
                 <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-4">
                    <TagIcon size={32} />
                 </div>
                 <h3 className="text-lg font-black text-slate-900 mb-2">Category Architecture</h3>
                 <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">Configure your product taxonomy. Changes here affect both Inventory and the Register interface.</p>
                 <button 
                   onClick={() => setIsCategoryModalOpen(true)}
                   className="grad-blue text-white font-black text-xs uppercase tracking-widest px-8 py-4 rounded-2xl transition-transform active:scale-95 shadow-blue"
                 >
                    Launch Category Manager
                 </button>
              </div>
           </div>
         )}
      </div>
      
      <CategoryManagementModal 
        isOpen={isCategoryModalOpen} 
        onClose={() => setIsCategoryModalOpen(false)} 
      />
    </div>
  );
}
