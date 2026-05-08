import React, { useState } from 'react';
import { Settings as SettingsIcon, ShieldCheck, Users, Plus, Trash2, KeyRound, Tag as TagIcon, Building2, Save, X, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Palette, Check, DollarSign } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { hashPassword } from '../../security';
import { useStore } from '../../store';
import { SearchableSelect } from '../shared/SearchableSelect';

import SettingsTab from './SettingsTab';
import AdminApprovals from './AdminApprovals';
import BranchManagementTab from './BranchManagementTab';
import { useToast } from '../../context/ToastContext';
import { type Category } from '../../db';

const ICON_OPTIONS = [
  { name: 'Utensils', icon: Utensils },
  { name: 'GlassWater', icon: GlassWater },
  { name: 'ShoppingBag', icon: ShoppingBag },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Package', icon: Package },
  { name: 'Tag', icon: TagIcon },
];

const COLOR_OPTIONS = [
  { name: 'orange', bg: 'bg-orange-500', text: 'text-orange-700', light: 'bg-orange-50' },
  { name: 'blue',   bg: 'bg-blue-500',   text: 'text-blue-700',   light: 'bg-blue-50'   },
  { name: 'purple', bg: 'bg-purple-500', text: 'text-purple-700', light: 'bg-purple-50' },
  { name: 'yellow', bg: 'bg-yellow-500', text: 'text-yellow-700', light: 'bg-yellow-50' },
  { name: 'slate',  bg: 'bg-slate-600',  text: 'text-slate-700',  light: 'bg-slate-50'  },
  { name: 'green',  bg: 'bg-green-500',  text: 'text-green-700',  light: 'bg-green-50'  },
  { name: 'red',    bg: 'bg-red-500',    text: 'text-red-700',    light: 'bg-red-50'    },
];

export default function AdminPanel({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'SETTINGS' | 'APPROVALS' | 'USERS' | 'CATEGORIES' | 'BRANCHES' | 'FINANCE'>('USERS');
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error, warning } = useToast();
  
  // Category Management State
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', iconName: 'Package', color: 'slate' });
  
  // User Management State
  const users = useLiveQuery(() => db.users.toArray(), [], []);
  const activeShifts = useLiveQuery(() => db.shifts.where('status').equals('OPEN').toArray(), [], []);
  const branches = useLiveQuery(() => db.branches.toArray(), [], []);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', password: '', role: 'CASHIER' as 'CASHIER' | 'ADMIN', branchId: '' });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState('');

  // Financial Management State
  const financialAccounts = useLiveQuery(() => db.financialAccounts.toArray(), [], []);
  const [isAddingFinAccount, setIsAddingFinAccount] = useState(false);
  const [finAccountForm, setFinAccountForm] = useState({ name: '', type: 'BANK' as 'BANK' | 'MPESA' | 'CASH', accountNumber: '', balance: 0, branchId: '' });
  const [depositState, setDepositState] = useState<{ accountId: string | null, amount: string }>({ accountId: null, amount: '' });
  const [isSaving, setIsSaving] = useState(false);

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.password) return;
    if (isSaving) return;
    setIsSaving(true);
    try {
      const hashedPassword = await hashPassword(newUser.password);
      
      await db.users.add({
        id: crypto.randomUUID(),
        name: newUser.name,
        password: hashedPassword,
        role: newUser.role,
        businessId: activeBusinessId!,
        branchId: newUser.branchId || undefined,
        updated_at: Date.now()
      });
      setNewUser({ name: '', password: '', role: 'CASHIER', branchId: '' });
      setIsAddingUser(false);
      success("Staff member created successfully.");
      await db.sync();
    } catch (err: any) {
      error("Failed to add user: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    const adminCount = users?.filter(u => u.role === 'ADMIN').length || 0;
    const userToDelete = users?.find(u => u.id === id);
    
    if (userToDelete?.role === 'ADMIN' && adminCount <= 1) {
      alert("Security Alert: Cannot delete the last administrator. Please promote another staff member to Admin first.");
      return;
    }

    if (confirm(`Are you sure you want to delete staff member "${userToDelete?.name}"? This action is permanent.`)) {
      await db.users.delete(id);
      await db.sync();
    }
  };

  const handlePasswordUpdate = async (id: string) => {
    if (!editingPassword || editingPassword.length < 4) return;
    const hashedPassword = await hashPassword(editingPassword);
    await db.users.update(id, { password: hashedPassword, updated_at: Date.now() });
    setEditingUserId(null);
    setEditingPassword('');
    await db.sync();
    alert("Password updated successfully.");
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim()) {
      warning("Please enter a category name.");
      return;
    }
    if (isSaving) return;
    setIsSaving(true);

    try {
      if (editingCategoryId) {
        await db.categories.update(editingCategoryId, { ...categoryForm, updated_at: Date.now() });
        success("Category updated successfully.");
      } else {
        await db.categories.add({
          id: crypto.randomUUID(),
          ...categoryForm,
          updated_at: Date.now(),
          businessId: activeBusinessId!
        });
        success("New category created.");
      }
      resetCategoryForm();
      db.syncAll();
    } catch (err) {
      error("Failed to save category.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? Products in this category will need to be reassigned.`)) {
      await db.categories.delete(id);
      success("Category removed.");
    }
  };

  const startEditCategory = (cat: Category) => {
    setEditingCategoryId(cat.id);
    setCategoryForm({ name: cat.name, iconName: cat.iconName, color: cat.color });
    setIsAddingCategory(true);
  };

  const resetCategoryForm = () => {
    setCategoryForm({ name: '', iconName: 'Package', color: 'slate' });
    setIsAddingCategory(false);
    setEditingCategoryId(null);
  };

  const handleSaveFinAccount = async () => {
    if (!finAccountForm.name.trim()) return;
    if (isSaving) return;
    setIsSaving(true);
    try {
      await db.financialAccounts.add({
        id: crypto.randomUUID(),
        ...finAccountForm,
        branchId: finAccountForm.branchId || undefined,
        businessId: activeBusinessId!,
        updated_at: Date.now()
      });
      setFinAccountForm({ name: '', type: 'BANK', accountNumber: '', balance: 0, branchId: '' });
      setIsAddingFinAccount(false);
      success("Financial account added.");
    } catch (err: any) {
      error("Failed to add account: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFinAccount = async (id: string) => {
    if (confirm("Remove this financial account?")) {
      await db.financialAccounts.delete(id);
      success("Account removed.");
    }
  };

  const handleDeposit = async () => {
    if (!depositState.accountId || !depositState.amount || Number(depositState.amount) <= 0) return;
    if (isSaving) return;
    setIsSaving(true);
    try {
      const account = await db.financialAccounts.get(depositState.accountId);
      if (account) {
         await db.financialAccounts.update(account.id, { 
             balance: (account.balance || 0) + Number(depositState.amount),
             updated_at: Date.now() 
         });
         success(`Deposited Ksh ${Number(depositState.amount).toLocaleString()} successfully.`);
         setDepositState({ accountId: null, amount: '' });
      }
    } catch (err: any) {
      error("Deposit failed.");
    } finally {
      setIsSaving(false);
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
              onClick={() => setActiveAdminTab('FINANCE')} 
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all whitespace-nowrap ${activeAdminTab === 'FINANCE' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <DollarSign size={13} /> Finance
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
                   <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div> Active cashier sessions
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
                   <h3 className="text-sm font-extrabold text-slate-900">Registered accounts</h3>
                   <p className="text-xs text-slate-500">Staff members authorized to log in.</p>
                </div>
                <button 
                  onClick={() => setIsAddingUser(true)}
                  className="bg-blue-600 text-white font-bold text-xs flex items-center gap-2 px-4 py-2.5 rounded-xl transition-transform active:scale-95 shadow-lg shadow-blue-600/20"
                >
                   <Plus size={14} /> Create staff account
                </button>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {users?.map(user => (
                    <React.Fragment key={user.id}>
                    <div className="bg-white p-4 rounded-2xl border border-slate-200 flex justify-between items-center">
                       <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                             {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                             <p className="font-bold text-sm text-slate-900">{user.name}</p>
                             <div className="flex items-center gap-1.5 mt-0.5">
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded  ${user.role === 'ADMIN' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>
                                   {user.role}
                                </span>
                                 <span className="text-xs text-slate-400 font-mono flex items-center gap-1"><KeyRound size={10}/> ****</span>
                                 {user.branchId && (
                                   <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                                     <Building2 size={8} /> {branches?.find(b => b.id === user.branchId)?.name || 'Loading...'}
                                   </span>
                                 )}
                              </div>
                          </div>
                       </div>
                       <div className="flex items-center gap-1">
                          <button 
                            onClick={() => {
                              if (editingUserId === user.id) {
                                setEditingUserId(null);
                                setEditingPassword('');
                              } else {
                                setEditingUserId(user.id);
                                setEditingPassword('');
                              }
                            }} 
                            className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                          >
                             <KeyRound size={16} />
                          </button>
                          <button onClick={() => handleDeleteUser(user.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                             <Trash2 size={16} />
                          </button>
                       </div>
                    </div>
                    {editingUserId === user.id && (
                      <div className="mt-[-8px] mb-2 bg-blue-50/50 p-3 rounded-xl border border-blue-100 flex gap-2 animate-in slide-in-from-top-2">
                        <input 
                          type="password" 
                          autoFocus
                          className="flex-1 bg-white border border-blue-200 rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-blue-500" 
                          placeholder="New password (min 4 chars)"
                          value={editingPassword}
                          onChange={e => setEditingPassword(e.target.value)}
                        />
                        <button 
                          onClick={() => handlePasswordUpdate(user.id)}
                          disabled={editingPassword.length < 4}
                          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                        >
                          Save
                        </button>
                      </div>
                    )}
                    </React.Fragment>
                ))}
             </div>

             {/* Add User Form Inline */}
             {isAddingUser && (
                <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm mt-4 animate-in fade-in slide-in-from-top-4">
                   <h3 className="text-sm font-extrabold text-slate-900 mb-4">Create new account</h3>
                   <div className="space-y-4 mb-6">
                      <div>
                        <label className="block text-xs font-bold text-slate-400   mb-2 ml-1">Full name</label>
                        <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500" placeholder="e.g. Jane Doe" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400   mb-2 ml-1">Default password</label>
                        <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900  focus:outline-none focus:border-blue-500" placeholder="e.g. secret123" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-400   mb-2 ml-1">Role</label>
                        <div className="flex gap-2">
                           <button onClick={() => setNewUser({...newUser, role: 'CASHIER'})} className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-colors ${newUser.role === 'CASHIER' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                               Cashier
                           </button>
                           <button onClick={() => setNewUser({...newUser, role: 'ADMIN'})} className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-colors ${newUser.role === 'ADMIN' ? 'bg-purple-50 border-purple-500 text-purple-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                               Administrator
                           </button>
                        </div>
                      </div>
                      {newUser.role === 'CASHIER' && (
                        <div>
                          <label className="block text-xs font-bold text-slate-400 mb-2 ml-1">Assign Branch</label>
                          <SearchableSelect
                            value={newUser.branchId || ''}
                            onChange={(v) => setNewUser({ ...newUser, branchId: v })}
                            placeholder="Select a branch"
                            options={(branches || []).map(b => ({
                              value: b.id,
                              label: b.name,
                              keywords: `${b.name} ${b.location || ''}`,
                            }))}
                          />
                        </div>
                      )}
                   </div>
                   <div className="flex gap-3">
                      <button onClick={() => {setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER', branchId: '' });}} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold text-sm rounded-xl">Cancel</button>
                      <button onClick={handleAddUser} disabled={!newUser.name || newUser.password.length < 4 || (newUser.role === 'CASHIER' && !newUser.branchId)} className="flex-[2] py-3 bg-blue-600 text-white font-bold text-sm rounded-xl disabled:opacity-50">Create User</button>
                   </div>
                </div>
             )}
          </div>
        )}
         {activeAdminTab === 'CATEGORIES' && (
           <div className="space-y-6">
              <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200">
                <div>
                   <h3 className="text-sm font-extrabold text-slate-900">Category architecture</h3>
                   <p className="text-xs text-slate-500">Configure your product taxonomy.</p>
                </div>
                {!isAddingCategory && (
                  <button 
                    onClick={() => setIsAddingCategory(true)}
                    className="bg-blue-600 text-white font-bold text-xs flex items-center gap-2 px-4 py-2.5 rounded-xl transition-transform active:scale-95 shadow-lg shadow-blue-600/20"
                  >
                     <Plus size={14} /> Add new category
                  </button>
                )}
              </div>

              {isAddingCategory ? (
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm animate-in slide-in-from-top-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-6">
                      <div>
                        <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Category name</label>
                        <input 
                          type="text" 
                          value={categoryForm.name} 
                          onChange={e => setCategoryForm({...categoryForm, name: e.target.value})}
                          className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all"
                          placeholder="e.g. Snacks, Electronics..."
                          autoFocus
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Choose icon</label>
                        <div className="grid grid-cols-6 gap-3">
                          {ICON_OPTIONS.map(opt => (
                            <button
                              key={opt.name}
                              onClick={() => setCategoryForm({...categoryForm, iconName: opt.name})}
                              className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all border ${categoryForm.iconName === opt.name ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-200'}`}
                            >
                              <opt.icon size={20} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div>
                        <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Theme color</label>
                        <div className="grid grid-cols-7 gap-3">
                          {COLOR_OPTIONS.map(opt => (
                            <button
                              key={opt.name}
                              onClick={() => setCategoryForm({...categoryForm, color: opt.name})}
                              className={`w-10 h-10 rounded-full ${opt.bg} flex items-center justify-center transition-all border-4 ${categoryForm.color === opt.name ? 'border-white ring-2 ring-slate-900 shadow-lg scale-110' : 'border-transparent opacity-80 hover:opacity-100'}`}
                            >
                              {categoryForm.color === opt.name && <Check size={16} className="text-white" />}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-4 pt-4">
                        <button onClick={resetCategoryForm} className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-black text-xs   rounded-2xl transition-all press">
                          Cancel
                        </button>
                        <button onClick={handleSaveCategory} className="flex-[2] bg-blue-600 text-white px-6 py-4 font-black text-xs   rounded-2xl transition-all shadow-blue press flex items-center justify-center gap-2">
                          <Save size={18} /> {editingCategoryId ? 'Update' : 'Create'} Category
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {categories?.map(cat => {
                    const colorOpt = COLOR_OPTIONS.find(c => c.name === cat.color) || COLOR_OPTIONS[4];
                    const IconComp = ICON_OPTIONS.find(i => i.name === cat.iconName)?.icon || Package;

                    return (
                      <div key={cat.id} className="group bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between hover:border-blue-200 transition-all">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl ${colorOpt.light} flex items-center justify-center ${colorOpt.text} border border-slate-50 shadow-sm`}>
                            <IconComp size={20} />
                          </div>
                          <h4 className="text-sm font-bold text-slate-900">{cat.name}</h4>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => startEditCategory(cat)} className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                            <Palette size={16} />
                          </button>
                          <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
           </div>
          )}
          
          {activeAdminTab === 'FINANCE' && (
            <div className="space-y-6">
               <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200">
                  <div>
                     <h3 className="text-sm font-extrabold text-slate-900">Financial Accounts</h3>
                     <p className="text-xs text-slate-500">Manage bank accounts and M-Pesa tills.</p>
                  </div>
                  <button 
                    onClick={() => setIsAddingFinAccount(true)}
                    className="bg-blue-600 text-white font-bold text-xs flex items-center gap-2 px-4 py-2.5 rounded-xl"
                  >
                     <Plus size={14} /> Add Account
                  </button>
               </div>

               {isAddingFinAccount && (
                 <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm animate-in slide-in-from-top-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                       <div>
                          <label className="block text-[10px] font-bold text-slate-400 mb-2">Account Name</label>
                          <input type="text" value={finAccountForm.name} onChange={e => setFinAccountForm({...finAccountForm, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="e.g. KCB Business" />
                       </div>
                       <div>
                          <label className="block text-[10px] font-bold text-slate-400 mb-2">Type</label>
                          <SearchableSelect
                            value={finAccountForm.type}
                            onChange={(v) => setFinAccountForm({ ...finAccountForm, type: v as any })}
                            placeholder="Select type..."
                            options={[
                              { value: 'BANK', label: 'Bank Account', keywords: 'bank' },
                              { value: 'MPESA', label: 'M-Pesa Till/Paybill', keywords: 'mpesa till paybill' },
                              { value: 'CASH', label: 'External Cash', keywords: 'cash' },
                            ]}
                          />
                       </div>
                       <div>
                          <label className="block text-[10px] font-bold text-slate-400 mb-2">Account Number (Optional)</label>
                          <input type="text" value={finAccountForm.accountNumber} onChange={e => setFinAccountForm({...finAccountForm, accountNumber: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold" placeholder="e.g. 123456789" />
                       </div>
                       <div>
                          <label className="block text-[10px] font-bold text-slate-400 mb-2">Linked Branch (Optional)</label>
                          <SearchableSelect
                            value={finAccountForm.branchId}
                            onChange={(v) => setFinAccountForm({ ...finAccountForm, branchId: v })}
                            placeholder="Global (All Branches)"
                            options={(branches || []).map(b => ({
                              value: b.id,
                              label: b.name,
                              keywords: `${b.name} ${b.location || ''}`,
                            }))}
                          />
                       </div>
                    </div>
                    <div className="flex gap-3">
                       <button onClick={() => setIsAddingFinAccount(false)} className="flex-1 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl text-sm">Cancel</button>
                       <button onClick={handleSaveFinAccount} className="flex-[2] py-3 bg-blue-600 text-white font-bold rounded-xl text-sm">Save Account</button>
                    </div>
                 </div>
               )}

               <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {financialAccounts?.map(acc => (
                    <div key={acc.id} className="bg-white p-4 rounded-2xl border border-slate-200 flex flex-col justify-between shadow-sm">
                       <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                             <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                <Building2 size={20} />
                             </div>
                             <div>
                                <p className="font-bold text-sm text-slate-900">{acc.name}</p>
                                <div className="flex items-center gap-2">
                                   <p className="text-[10px] text-slate-500 font-medium capitalize">{acc.type.toLowerCase()} • {acc.accountNumber || 'No number'}</p>
                                   {acc.branchId && (
                                      <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1">
                                         <Building2 size={8} /> {branches?.find(b => b.id === acc.branchId)?.name || 'Local'}
                                      </span>
                                   )}
                                </div>
                             </div>
                          </div>
                          <div className="text-right">
                             <p className="text-xs font-black text-slate-900">Ksh {(acc.balance || 0).toLocaleString()}</p>
                             <p className="text-[9px] font-bold text-slate-400">Balance</p>
                          </div>
                       </div>
                       
                       {depositState.accountId === acc.id ? (
                          <div className="flex items-center gap-2 mt-2 bg-slate-50 p-2 rounded-xl border border-slate-100 animate-in fade-in zoom-in-95">
                             <input 
                                type="number" 
                                autoFocus
                                value={depositState.amount} 
                                onChange={e => setDepositState({...depositState, amount: e.target.value})} 
                                placeholder="Amount..." 
                                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-green-500"
                             />
                             <button onClick={handleDeposit} className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-green-700 whitespace-nowrap">Add</button>
                             <button onClick={() => setDepositState({ accountId: null, amount: '' })} className="bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-[10px] font-black hover:bg-slate-300">Cancel</button>
                          </div>
                       ) : (
                          <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-slate-100">
                             <button onClick={() => setDepositState({ accountId: acc.id, amount: '' })} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors">
                                <Plus size={12} /> Deposit
                             </button>
                             <button onClick={() => handleDeleteFinAccount(acc.id)} className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1 transition-colors">
                                <Trash2 size={12} />
                             </button>
                          </div>
                       )}
                    </div>
                  ))}
                  {financialAccounts?.length === 0 && <p className="col-span-full text-center text-slate-400 py-8 italic text-sm">No accounts configured yet.</p>}
               </div>
            </div>
          )}
       </div>
      

    </div>
  );
}
