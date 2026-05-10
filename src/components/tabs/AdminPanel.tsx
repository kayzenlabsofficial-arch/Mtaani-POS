import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, ShieldCheck, Users, Plus, Minus, Trash2, KeyRound, Tag as TagIcon, Building2, Save, X, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Palette, Check, DollarSign, Activity, Monitor, Globe, ShieldAlert, SlidersHorizontal, ChevronRight, History } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { hashPassword } from '../../security';
import { useStore } from '../../store';
import { SearchableSelect } from '../shared/SearchableSelect';
import { getApiKey } from '../../runtimeConfig';

import SettingsTab from './SettingsTab';
import AdminApprovals from './AdminApprovals';
import BranchManagementTab from './BranchManagementTab';
import { useToast } from '../../context/ToastContext';
import { type Category } from '../../db';
import NestedControlPanel from '../shared/NestedControlPanel';

const ICON_OPTIONS = [
  { name: 'Utensils', icon: Utensils },
  { name: 'GlassWater', icon: GlassWater },
  { name: 'ShoppingBag', icon: ShoppingBag },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Package', icon: Package },
  { name: 'Tag', icon: TagIcon },
];

const COLOR_OPTIONS = [
  { name: 'indigo', bg: 'bg-indigo-500', text: 'text-indigo-700', light: 'bg-indigo-50' },
  { name: 'emerald', bg: 'bg-emerald-500', text: 'text-emerald-700', light: 'bg-emerald-50' },
  { name: 'rose', bg: 'bg-rose-500', text: 'text-rose-700', light: 'bg-rose-50' },
  { name: 'amber', bg: 'bg-amber-500', text: 'text-amber-700', light: 'bg-amber-50' },
  { name: 'sky', bg: 'bg-sky-500', text: 'text-sky-700', light: 'bg-sky-50' },
  { name: 'violet', bg: 'bg-violet-500', text: 'text-violet-700', light: 'bg-violet-50' },
  { name: 'slate', bg: 'bg-slate-600', text: 'text-slate-700', light: 'bg-slate-50' },
];

export default function AdminPanel({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'SETTINGS' | 'APPROVALS' | 'USERS' | 'CATEGORIES' | 'BRANCHES' | 'FINANCE'>('USERS');
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error, warning } = useToast();
  
  // Category Management State
  const categories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', iconName: 'Package', color: 'slate' });
  
  // User Management State
  const users = useLiveQuery(
    () => activeBusinessId ? db.users.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const activeShifts = useLiveQuery(
    () => activeBusinessId ? db.shifts.where('status').equals('OPEN').and(s => s.businessId === activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const branches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const activeBranchId = useStore(state => state.activeBranchId);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', password: '', role: 'CASHIER' as 'CASHIER' | 'ADMIN', branchId: '' });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState('');

  // Financial Management State
  const financialAccounts = useLiveQuery(
    () => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const [isAddingFinAccount, setIsAddingFinAccount] = useState(false);
  const [finAccountForm, setFinAccountForm] = useState({ name: '', type: 'BANK' as 'BANK' | 'MPESA' | 'CASH', accountNumber: '', balance: 0, branchId: '' });
  const [depositState, setDepositState] = useState<{ accountId: string | null, amount: string, mode: 'DEPOSIT' | 'WITHDRAW' }>({ accountId: null, amount: '', mode: 'DEPOSIT' });
  const [isSaving, setIsSaving] = useState(false);

  // Device sync status
  const [deviceSyncRows, setDeviceSyncRows] = useState<any[]>([]);
  const [deviceSyncError, setDeviceSyncError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!activeBusinessId || !activeBranchId) return;
      try {
        const apiKey = await getApiKey();
        const res = await fetch('/api/sync/status', {
          method: 'GET',
          headers: {
            'X-API-Key': apiKey,
            'X-Business-ID': activeBusinessId,
            'X-Branch-ID': activeBranchId,
          },
          cache: 'no-store',
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const j: any = await res.json();
        if (!alive) return;
        setDeviceSyncRows(Array.isArray(j?.rows) ? j.rows : []);
        setDeviceSyncError(null);
      } catch (e: any) {
        if (!alive) return;
        setDeviceSyncError(e?.message || 'Failed to load device status');
      }
    };

    run();
    const t = setInterval(run, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [activeBusinessId, activeBranchId]);

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
    success("Password updated successfully.");
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
         setDepositState({ accountId: null, amount: '', mode: 'DEPOSIT' });
      }
    } catch (err: any) {
      error("Deposit failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleWithdraw = async () => {
    if (!depositState.accountId || !depositState.amount || Number(depositState.amount) <= 0) return;
    if (isSaving) return;
    setIsSaving(true);
    try {
      const account = await db.financialAccounts.get(depositState.accountId);
      if (!account) {
        error("Account not found.");
        return;
      }

      const withdrawal = Number(depositState.amount);
      if ((account.balance || 0) < withdrawal) {
        error(`Insufficient balance in ${account.name}.`);
        return;
      }

      await db.financialAccounts.update(account.id, {
        balance: (account.balance || 0) - withdrawal,
        updated_at: Date.now()
      });
      success(`Withdrew Ksh ${withdrawal.toLocaleString()} successfully.`);
      setDepositState({ accountId: null, amount: '', mode: 'DEPOSIT' });
    } catch (err: any) {
      error("Withdrawal failed.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Control Room Header */}
      <div className="px-4 pt-2 mb-6">
        <div className="flex items-center justify-between mb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Control Room</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Enterprise Configuration Hub</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Fleet Tools</span>
              </button>
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Fleet Monitoring"
               subtitle="Real-time device synchronization and health"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="space-y-6">
                   <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                         <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                            <Monitor size={20} />
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Active Terminals</p>
                            <h3 className="text-xl font-black text-slate-900 leading-none">{deviceSyncRows.length}</h3>
                         </div>
                      </div>
                      <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                         <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                            <Globe size={20} />
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Global Status</p>
                            <h3 className="text-xl font-black text-slate-900 leading-none">Healthy</h3>
                         </div>
                      </div>
                      <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                         <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                            <Activity size={20} />
                         </div>
                         <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Sync Velocity</p>
                            <h3 className="text-xl font-black text-slate-900 leading-none">High</h3>
                         </div>
                      </div>
                   </div>

                   <div className="bg-slate-50 p-6 rounded-[2.5rem] border-2 border-slate-100">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-2">Device Synchronization Ledger</h4>
                      {deviceSyncError ? (
                        <div className="bg-rose-50 border-2 border-rose-100 p-4 rounded-2xl flex items-center gap-3 text-rose-600 text-[10px] font-black uppercase">
                           <ShieldAlert size={16} /> {deviceSyncError}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                           {deviceSyncRows.map((r, idx) => {
                              const last = r.lastSyncAt ? new Date(Number(r.lastSyncAt)) : null;
                              const online = last ? (Date.now() - last.getTime() < 60000) : false;
                              return (
                                <div key={idx} className="bg-white p-4 rounded-2xl border-2 border-slate-100 flex justify-between items-center group hover:border-indigo-300 transition-all">
                                   <div>
                                      <p className="text-[11px] font-black text-slate-900 leading-tight">{r.cashierName || 'Fleet Member'}</p>
                                      <p className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-1">{r.deviceId.split('-')[0]}...{r.deviceId.slice(-4)}</p>
                                   </div>
                                   <div className="text-right">
                                      <div className={`w-2 h-2 rounded-full mb-1 ml-auto ${online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                      <p className="text-[8px] font-black text-slate-400 uppercase">{last ? last.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'N/A'}</p>
                                   </div>
                                </div>
                              );
                           })}
                        </div>
                      )}
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      {/* Admin Nav Tabs */}
      <div className="px-4 mb-8">
        <div className="bg-white/50 backdrop-blur-md p-2 rounded-[2rem] border-2 border-slate-100 flex overflow-x-auto no-scrollbar gap-1.5">
            {[
              { id: 'USERS', label: 'Staffing', icon: Users },
              { id: 'BRANCHES', label: 'Locations', icon: Building2 },
              { id: 'CATEGORIES', label: 'Taxonomy', icon: TagIcon },
              { id: 'APPROVALS', label: 'Security', icon: ShieldCheck },
              { id: 'FINANCE', label: 'Accounts', icon: DollarSign },
              { id: 'SETTINGS', label: 'Configs', icon: SettingsIcon }
            ].map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveAdminTab(tab.id as any)}
                className={`flex-1 flex items-center justify-center gap-2.5 py-3.5 px-5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all press whitespace-nowrap ${activeAdminTab === tab.id ? 'bg-slate-900 text-white shadow-xl' : 'text-slate-400 hover:text-slate-600 hover:bg-white'}`}
              >
                <tab.icon size={16} /> {tab.label}
              </button>
            ))}
        </div>
      </div>

      <div className="px-4 space-y-8 animate-in slide-in-from-bottom-4 duration-500">
         
         {activeAdminTab === 'SETTINGS' && <SettingsTab updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
         {activeAdminTab === 'APPROVALS' && <AdminApprovals />}
         {activeAdminTab === 'BRANCHES' && <BranchManagementTab />}
         
         {activeAdminTab === 'USERS' && (
           <div className="space-y-6">
              <div className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
                 <div>
                    <h3 className="text-lg font-black text-slate-900">Personnel Management</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Authorizations & Access Control</p>
                 </div>
                 <button 
                   onClick={() => setIsAddingUser(true)}
                   className="grad-blue text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 px-6 py-4 rounded-2xl transition-all shadow-blue press"
                 >
                    <Plus size={18} /> Add Staff Member
                 </button>
              </div>

              {isAddingUser && (
                 <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-inner animate-in zoom-in-95">
                    <h3 className="text-base font-black text-slate-900 mb-6 flex items-center gap-2"> <Users className="text-blue-600" /> New Account Provisioning</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                       <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Full Identity Name</label>
                         <input type="text" className="w-full bg-white border-2 border-transparent focus:border-blue-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" placeholder="e.g. Samuel Karanja" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
                       </div>
                       <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Primary Access Key</label>
                         <input type="text" className="w-full bg-white border-2 border-transparent focus:border-blue-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" placeholder="Minimum 4 characters" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                       </div>
                       <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Operational Role</label>
                         <div className="flex gap-2">
                            <button onClick={() => setNewUser({...newUser, role: 'CASHIER'})} className={`flex-1 py-4.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'CASHIER' ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Standard Cashier
                            </button>
                            <button onClick={() => setNewUser({...newUser, role: 'ADMIN'})} className={`flex-1 py-4.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'ADMIN' ? 'bg-blue-600 text-white border-blue-600 shadow-blue' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Administrator
                            </button>
                         </div>
                       </div>
                       {newUser.role === 'CASHIER' && (
                         <div>
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Station Assignment</label>
                           <SearchableSelect
                             value={newUser.branchId || ''}
                             onChange={(v) => setNewUser({ ...newUser, branchId: v })}
                             placeholder="Select branch for this cashier..."
                             options={(branches || []).map(b => ({
                               value: b.id,
                               label: b.name,
                               keywords: `${b.name} ${b.location || ''}`,
                             }))}
                             buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                           />
                         </div>
                       )}
                    </div>
                    <div className="flex gap-4">
                       <button onClick={() => {setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER', branchId: '' });}} className="flex-1 py-5 bg-white text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-2xl border-2 border-slate-100 press">Cancel Request</button>
                       <button onClick={handleAddUser} disabled={!newUser.name || newUser.password.length < 4 || (newUser.role === 'CASHIER' && !newUser.branchId)} className="flex-[2] grad-blue text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-blue press">Commit Account</button>
                    </div>
                 </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                 {users?.map(user => (
                    <div key={user.id} className="group bg-white p-6 rounded-[2.5rem] border-2 border-slate-100 shadow-sm flex flex-col gap-6 hover:border-blue-300 hover:shadow-xl transition-all relative overflow-hidden">
                       <div className="flex justify-between items-start relative z-10">
                          <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center font-black text-lg shadow-sm group-hover:scale-110 transition-transform ${user.role === 'ADMIN' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                             {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex items-center gap-1">
                             <button onClick={() => { setEditingUserId(editingUserId === user.id ? null : user.id); setEditingPassword(''); }} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-all">
                                <KeyRound size={18} />
                             </button>
                             <button onClick={() => handleDeleteUser(user.id)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-all">
                                <Trash2 size={18} />
                             </button>
                          </div>
                       </div>

                       <div className="relative z-10">
                          <h4 className="text-base font-black text-slate-900 truncate leading-tight">{user.name}</h4>
                          <div className="flex flex-wrap items-center gap-2 mt-2">
                             <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest ${user.role === 'ADMIN' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                                {user.role}
                             </span>
                             {user.branchId && (
                                <span className="text-[9px] font-black text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full flex items-center gap-1.5 uppercase border border-slate-100">
                                   <Building2 size={10} /> {branches?.find(b => b.id === user.branchId)?.name || 'Local'}
                                </span>
                             )}
                          </div>
                       </div>

                       {editingUserId === user.id && (
                          <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm p-6 flex flex-col justify-center animate-in fade-in duration-300">
                             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Reset Access Key</h4>
                             <input 
                               type="password" 
                               autoFocus
                               className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none mb-4" 
                               placeholder="Min 4 characters"
                               value={editingPassword}
                               onChange={e => setEditingPassword(e.target.value)}
                             />
                             <div className="flex gap-2">
                                <button onClick={() => setEditingUserId(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-400 font-black text-[10px] uppercase rounded-xl">Cancel</button>
                                <button onClick={() => handlePasswordUpdate(user.id)} disabled={editingPassword.length < 4} className="flex-[2] grad-blue text-white font-black text-[10px] uppercase rounded-xl shadow-blue disabled:opacity-40">Confirm Update</button>
                             </div>
                          </div>
                       )}
                    </div>
                 ))}
              </div>
           </div>
         )}

         {activeAdminTab === 'CATEGORIES' && (
           <div className="space-y-6">
              <div className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
                 <div>
                    <h3 className="text-lg font-black text-slate-900">Taxonomy Architecture</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Product Grouping & Visual Tokens</p>
                 </div>
                 {!isAddingCategory && (
                    <button 
                      onClick={() => setIsAddingCategory(true)}
                      className="grad-indigo text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 px-6 py-4 rounded-2xl transition-all shadow-indigo press"
                    >
                       <Plus size={18} /> New Category
                    </button>
                 )}
              </div>

              {isAddingCategory ? (
                <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-inner animate-in zoom-in-95">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Group Identifier</label>
                        <input 
                          type="text" 
                          value={categoryForm.name} 
                          onChange={e => setCategoryForm({...categoryForm, name: e.target.value})}
                          className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-[1.5rem] px-6 py-5 text-sm font-black text-slate-900 outline-none shadow-sm"
                          placeholder="e.g. Hot Beverages, Electronics..."
                          autoFocus
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-2">Visual Iconography</label>
                        <div className="grid grid-cols-6 gap-3">
                          {ICON_OPTIONS.map(opt => (
                            <button
                              key={opt.name}
                              onClick={() => setCategoryForm({...categoryForm, iconName: opt.name})}
                              className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all border-2 ${categoryForm.iconName === opt.name ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-300 border-transparent hover:border-slate-200'}`}
                            >
                              <opt.icon size={24} />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-2">Brand Palette</label>
                        <div className="grid grid-cols-7 gap-3">
                          {COLOR_OPTIONS.map(opt => (
                            <button
                              key={opt.name}
                              onClick={() => setCategoryForm({...categoryForm, color: opt.name})}
                              className={`w-10 h-10 rounded-full ${opt.bg} flex items-center justify-center transition-all border-4 ${categoryForm.color === opt.name ? 'border-white ring-2 ring-slate-900 shadow-lg scale-110' : 'border-transparent opacity-80 hover:opacity-100'}`}
                            >
                              {categoryForm.color === opt.name && <Check size={18} className="text-white" />}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-4 pt-6">
                        <button onClick={resetCategoryForm} className="flex-1 py-5 bg-white text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-2xl border-2 border-slate-100 press">Cancel</button>
                        <button onClick={handleSaveCategory} className="flex-[2] grad-indigo text-white py-5 font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-indigo press flex items-center justify-center gap-3">
                          <Save size={20} /> {editingCategoryId ? 'Sync Changes' : 'Commit Category'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categories?.map(cat => {
                    const colorOpt = COLOR_OPTIONS.find(c => c.name === cat.color) || COLOR_OPTIONS[6];
                    const IconComp = ICON_OPTIONS.find(i => i.name === cat.iconName)?.icon || Package;

                    return (
                      <div key={cat.id} className="group bg-white p-5 rounded-[2.5rem] border-2 border-slate-100 shadow-sm flex items-center justify-between hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 transition-all">
                        <div className="flex items-center gap-4">
                          <div className={`w-12 h-12 rounded-2xl ${colorOpt.light} flex items-center justify-center ${colorOpt.text} border border-slate-50 shadow-sm group-hover:scale-110 transition-transform`}>
                            <IconComp size={24} />
                          </div>
                          <h4 className="text-sm font-black text-slate-900">{cat.name}</h4>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => startEditCategory(cat)} className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                            <Palette size={18} />
                          </button>
                          <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="w-10 h-10 flex items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-all">
                            <Trash2 size={18} />
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
               <div className="flex justify-between items-center bg-white p-6 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
                  <div>
                     <h3 className="text-lg font-black text-slate-900">Capital Accounts</h3>
                     <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Liquidity & Settlement Nodes</p>
                  </div>
                  <button 
                    onClick={() => setIsAddingFinAccount(true)}
                    className="grad-emerald text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 px-6 py-4 rounded-2xl transition-all shadow-emerald press"
                  >
                     <Plus size={18} /> New Account
                  </button>
               </div>

               {isAddingFinAccount && (
                 <div className="bg-slate-50 p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-inner animate-in zoom-in-95">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                       <div className="lg:col-span-2">
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Designated Account Name</label>
                          <input type="text" value={finAccountForm.name} onChange={e => setFinAccountForm({...finAccountForm, name: e.target.value})} className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" placeholder="e.g. Absa Business Current" />
                       </div>
                       <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Channel Type</label>
                          <SearchableSelect
                            value={finAccountForm.type}
                            onChange={(v) => setFinAccountForm({ ...finAccountForm, type: v as any })}
                            placeholder="Select channel..."
                            options={[
                              { value: 'BANK', label: 'Commercial Bank', keywords: 'bank' },
                              { value: 'MPESA', label: 'M-Pesa Utility', keywords: 'mpesa till paybill' },
                              { value: 'CASH', label: 'Petty Cash Node', keywords: 'cash' },
                            ]}
                            buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                          />
                       </div>
                       <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Terminal / Ref Number</label>
                          <input type="text" value={finAccountForm.accountNumber} onChange={e => setFinAccountForm({...finAccountForm, accountNumber: e.target.value})} className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" placeholder="Optional identifier" />
                       </div>
                       <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Anchor Location</label>
                          <SearchableSelect
                            value={finAccountForm.branchId}
                            onChange={(v) => setFinAccountForm({ ...finAccountForm, branchId: v })}
                            placeholder="Universal (Global)"
                            options={(branches || []).map(b => ({
                              value: b.id,
                              label: b.name,
                              keywords: `${b.name} ${b.location || ''}`,
                            }))}
                            buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                          />
                       </div>
                    </div>
                    <div className="flex gap-4">
                       <button onClick={() => setIsAddingFinAccount(false)} className="flex-1 py-5 bg-white text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-2xl border-2 border-slate-100 press">Cancel Provisioning</button>
                       <button onClick={handleSaveFinAccount} className="flex-[2] grad-emerald text-white py-5 font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-emerald press">Commit Financial Node</button>
                    </div>
                 </div>
               )}

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {financialAccounts?.map(acc => (
                    <div key={acc.id} className="group bg-white p-6 rounded-[2.5rem] border-2 border-slate-100 shadow-sm flex flex-col justify-between hover:border-emerald-300 hover:shadow-xl transition-all relative overflow-hidden">
                       <div className="flex items-start justify-between mb-6 relative z-10">
                          <div className="flex items-center gap-4">
                             <div className="w-14 h-14 rounded-[1.25rem] bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                                {acc.type === 'BANK' ? <Building2 size={28} /> : acc.type === 'MPESA' ? <Smartphone size={28} /> : <DollarSign size={28} />}
                             </div>
                             <div>
                                <h4 className="text-base font-black text-slate-900 leading-tight">{acc.name}</h4>
                                <div className="flex items-center gap-2 mt-2">
                                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{acc.type}</span>
                                   <span className="w-1 h-1 rounded-full bg-slate-200" />
                                   {acc.branchId ? (
                                      <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase">
                                         <Building2 size={10} /> {branches?.find(b => b.id === acc.branchId)?.name || 'Local'}
                                      </span>
                                   ) : (
                                      <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1 uppercase">
                                         <Globe size={10} /> Universal
                                      </span>
                                   )}
                                </div>
                             </div>
                          </div>
                          <div className="text-right">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Liquid Balance</p>
                             <h3 className="text-xl font-black text-slate-900 tabular-nums">Ksh {(acc.balance || 0).toLocaleString()}</h3>
                          </div>
                       </div>
                       
                       {depositState.accountId === acc.id ? (
                          <div className="flex items-center gap-3 mt-2 bg-slate-50 p-4 rounded-2xl border-2 border-slate-100 animate-in zoom-in-95">
                             <div className="flex-1 relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">KSH</span>
                                <input 
                                   type="number" 
                                   autoFocus
                                   value={depositState.amount} 
                                   onChange={e => setDepositState({...depositState, amount: e.target.value})} 
                                   placeholder="0.00" 
                                   className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl pl-12 pr-4 py-3 text-sm font-black text-slate-900 outline-none" 
                                />
                             </div>
                             <button
                               onClick={depositState.mode === 'WITHDRAW' ? handleWithdraw : handleDeposit}
                               className={`px-6 py-3.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all press ${depositState.mode === 'WITHDRAW' ? 'bg-orange-600 text-white shadow-orange' : 'bg-emerald-600 text-white shadow-emerald'}`}
                             >
                               {depositState.mode === 'WITHDRAW' ? 'Withdraw' : 'Deposit'}
                             </button>
                             <button onClick={() => setDepositState({ accountId: null, amount: '', mode: 'DEPOSIT' })} className="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-slate-400 hover:text-slate-600 border-2 border-slate-100"><X size={18}/></button>
                          </div>
                       ) : (
                          <div className="flex items-center justify-between gap-3 mt-4 pt-6 border-t border-slate-50">
                             <div className="flex gap-2">
                                <button onClick={() => setDepositState({ accountId: acc.id, amount: '', mode: 'DEPOSIT' })} className="px-4 py-2.5 bg-slate-50 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border-2 border-transparent hover:border-emerald-200">
                                   <Plus size={14} /> Deposit
                                </button>
                                <button onClick={() => setDepositState({ accountId: acc.id, amount: '', mode: 'WITHDRAW' })} className="px-4 py-2.5 bg-slate-50 hover:bg-orange-50 text-slate-400 hover:text-orange-600 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-2 border-2 border-transparent hover:border-orange-200">
                                   <Minus size={14} /> Withdraw
                                </button>
                             </div>
                             <button onClick={() => handleDeleteFinAccount(acc.id)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-300 hover:bg-rose-50 hover:text-rose-600 transition-all">
                                <Trash2 size={18} />
                             </button>
                          </div>
                       )}
                    </div>
                  ))}
                  {financialAccounts?.length === 0 && (
                    <div className="col-span-full py-20 bg-slate-50 border-2 border-dashed border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-center text-slate-300">
                       <Landmark size={48} className="mb-4 opacity-20" />
                       <p className="text-xs font-black uppercase tracking-widest opacity-40">No Financial Accounts Defined</p>
                    </div>
                  )}
               </div>
            </div>
          )}
       </div>
    </div>
  );
}

const Smartphone = ({ size, className }: { size: number, className?: string }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/></svg>;
const Landmark = ({ size, className }: { size: number, className?: string }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="3" x2="21" y1="22" y2="22"/><line x1="6" x2="6" y1="18" y2="11"/><line x1="10" x2="10" y1="18" y2="11"/><line x1="14" x2="14" y1="18" y2="11"/><line x1="18" x2="18" y1="18" y2="11"/><polygon points="12 2 20 7 4 7 12 2"/></svg>;
