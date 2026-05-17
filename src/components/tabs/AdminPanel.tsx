import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, ShieldCheck, Users, Plus, Minus, Trash2, KeyRound, Tag as TagIcon, Building2, Save, X, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Palette, Check, DollarSign, Activity, Monitor, Globe, ShieldAlert, SlidersHorizontal, ChevronRight, History } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { SearchableSelect } from '../shared/SearchableSelect';
import { getApiKey } from '../../runtimeConfig';

import SettingsTab from './SettingsTab';
import AdminApprovals from './AdminApprovals';
import BranchManagementTab from './BranchManagementTab';
import { useToast } from '../../context/ToastContext';
import { type Category } from '../../db';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { recordAuditEvent } from '../../utils/auditLog';


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

const ADMIN_TABS = [
  { id: 'USERS', label: 'Staff', icon: Users },
  { id: 'BRANCHES', label: 'Branches', icon: Building2 },
  { id: 'CATEGORIES', label: 'Categories', icon: TagIcon },
  { id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck },
  { id: 'FINANCE', label: 'Finance', icon: DollarSign },
  { id: 'SETTINGS', label: 'Settings', icon: SettingsIcon },
] as const;

function AdminSectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <h3 className="stable-title text-base font-black text-slate-900">{title}</h3>
        <p className="stable-title text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">{description}</p>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export default function AdminPanel({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const [activeAdminTab, setActiveAdminTab] = useState<'SETTINGS' | 'APPROVALS' | 'USERS' | 'CATEGORIES' | 'BRANCHES' | 'FINANCE'>(() => {
    const requested = sessionStorage.getItem('mtaani_admin_tab');
    sessionStorage.removeItem('mtaani_admin_tab');
    return ['SETTINGS', 'APPROVALS', 'USERS', 'CATEGORIES', 'BRANCHES', 'FINANCE'].includes(requested || '')
      ? requested as any
      : 'USERS';
  });
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeBranchId = useStore(state => state.activeBranchId);
  const { success, error, warning } = useToast();
  const scrollRef = useHorizontalScroll();
  
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
    () => activeBusinessId && activeBranchId ? db.shifts.where('status').equals('OPEN').and(s => s.businessId === activeBusinessId && s.branchId === activeBranchId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );
  const branches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
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
          credentials: 'same-origin',
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
      await db.users.add({
        id: crypto.randomUUID(),
        name: newUser.name,
        password: newUser.password,
        role: newUser.role,
        businessId: activeBusinessId!,
        branchId: newUser.branchId || undefined,
        updated_at: Date.now()
      });
      setNewUser({ name: '', password: '', role: 'CASHIER', branchId: '' });
      setIsAddingUser(false);
      recordAuditEvent({
        action: 'admin.user_create',
        entity: 'user',
        severity: 'INFO',
        details: `Created new ${newUser.role} account for ${newUser.name}.`
      });
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
      recordAuditEvent({
        action: 'admin.user_delete',
        entity: 'user',
        entityId: id,
        severity: 'WARN',
        details: `Deleted user ${userToDelete?.name} (${userToDelete?.role}).`
      });
      await db.sync();
    }
  };

  const handlePasswordUpdate = async (id: string) => {
    if (!editingPassword || editingPassword.length < 4) return;
    await db.users.update(id, { password: editingPassword, updated_at: Date.now() });
    setEditingUserId(null);
    setEditingPassword('');
    recordAuditEvent({
      action: 'admin.user_password_reset',
      entity: 'user',
      entityId: id,
      severity: 'WARN',
      details: `Reset password for user ID ${id}.`
    });
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
    <div className="pb-24 animate-in fade-in w-full max-w-6xl mx-auto">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <h2 className="text-xl font-black text-slate-900">Admin panel</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{deviceSyncRows.length} terminals</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">{deviceSyncError ? 'Needs attention' : 'Healthy'}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Live controls</span>
          </div>
        </div>
      </div>

      {/* Admin Nav Tabs */}
      <div className="mb-6">
        <div ref={scrollRef} className="flex gap-2 overflow-x-auto no-scrollbar rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
            {ADMIN_TABS.map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveAdminTab(tab.id as any)}
                className={`flex-shrink-0 sm:flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all press whitespace-nowrap ${activeAdminTab === tab.id ? 'bg-slate-950 text-white shadow-md' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'}`}
              >
                <tab.icon size={16} /> {tab.label}
              </button>
            ))}
        </div>
      </div>

      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
         
         {activeAdminTab === 'SETTINGS' && <SettingsTab updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
         {activeAdminTab === 'APPROVALS' && <AdminApprovals />}
         {activeAdminTab === 'BRANCHES' && <BranchManagementTab />}
         
         {activeAdminTab === 'USERS' && (
           <div className="space-y-6">
              <AdminSectionHeader
                title="Staff management"
                description="Manage staff accounts"
                action={(
                  <button
                    onClick={() => setIsAddingUser(true)}
                    className="bg-slate-950 text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 px-4 py-3 rounded-xl transition-all shadow-sm press whitespace-nowrap"
                  >
                    <Plus size={16} /> Add staff
                  </button>
                )}
              />

              {isAddingUser && (
                 <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95">
                    <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2"> <Users className="text-blue-600" /> Add staff member</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Full name</label>
                         <input type="text" className="w-full bg-white border-2 border-transparent focus:border-blue-500 rounded-xl px-5 py-3 text-sm font-bold text-slate-900 outline-none shadow-sm" placeholder="e.g. Samuel Karanja" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
                       </div>
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Password</label>
                         <input type="password" className="w-full bg-white border-2 border-transparent focus:border-blue-500 rounded-xl px-5 py-3 text-sm font-bold text-slate-900 outline-none shadow-sm" placeholder="Minimum 4 characters" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                       </div>
                       <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Staff role</label>
                         <div className="flex gap-2">
                            <button onClick={() => setNewUser({...newUser, role: 'CASHIER'})} className={`flex-1 py-4.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'CASHIER' ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Standard cashier
                            </button>
                            <button onClick={() => setNewUser({...newUser, role: 'ADMIN'})} className={`flex-1 py-4.5 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'ADMIN' ? 'bg-blue-600 text-white border-blue-600 shadow-blue' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Administrator
                            </button>
                         </div>
                       </div>
                       {newUser.role === 'CASHIER' && (
                         <div>
                           <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Station assignment</label>
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
                       <button onClick={() => {setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER', branchId: '' });}} className="flex-1 py-4 bg-white text-slate-400 font-bold text-[10px] uppercase tracking-widest rounded-xl border-2 border-slate-100 press">Cancel</button>
                       <button onClick={handleAddUser} disabled={!newUser.name || newUser.password.length < 4 || (newUser.role === 'CASHIER' && !newUser.branchId)} className="flex-[2] grad-blue text-white font-bold text-[10px] uppercase tracking-widest rounded-xl shadow-blue press">Save staff member</button>
                    </div>
                 </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
                 {users?.map(user => (
                    <div key={user.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5 hover:bg-blue-50/30 transition-all overflow-hidden">
                       <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm ${user.role === 'ADMIN' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'}`}>
                             {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="stable-row-copy">
                             <h4 className="stable-title text-sm font-black text-slate-900 leading-tight">{user.name}</h4>
                             <div className="flex min-w-0 items-center gap-2 mt-1 overflow-hidden">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0 ${user.role === 'ADMIN' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'}`}>
                                   {user.role === 'ADMIN' ? 'Admin' : user.role === 'CASHIER' ? 'Cashier' : user.role}
                                </span>
                                {user.branchId && (
                                   <span className="stable-chip text-[9px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full uppercase border border-slate-100">
                                      {branches?.find(b => b.id === user.branchId)?.name || 'Local'}
                                   </span>
                                )}
                             </div>
                          </div>
                       </div>

                       <div className="stable-actions flex items-center gap-1">
                          <button onClick={() => { setEditingUserId(editingUserId === user.id ? null : user.id); setEditingPassword(''); }} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition-all">
                             <KeyRound size={17} />
                          </button>
                          <button onClick={() => handleDeleteUser(user.id)} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-all">
                             <Trash2 size={17} />
                          </button>
                       </div>

                       {editingUserId === user.id && (
                          <div className="absolute inset-0 z-20 bg-white/95 backdrop-blur-sm p-4 flex flex-col justify-center animate-in fade-in duration-300">
                             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Reset access key</h4>
                             <input 
                               type="password" 
                               autoFocus
                               className="w-full bg-slate-50 border border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black text-slate-900 outline-none mb-4" 
                               placeholder="Min 4 characters"
                               value={editingPassword}
                               onChange={e => setEditingPassword(e.target.value)}
                             />
                             <div className="flex gap-2">
                                <button onClick={() => setEditingUserId(null)} className="flex-1 py-3.5 bg-slate-100 text-slate-400 font-black text-[10px] uppercase rounded-xl">Cancel</button>
                                <button onClick={() => handlePasswordUpdate(user.id)} disabled={editingPassword.length < 4} className="flex-[2] grad-blue text-white font-black text-[10px] uppercase rounded-xl shadow-blue disabled:opacity-40">Confirm update</button>
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
              <AdminSectionHeader
                title="Product categories"
                description="Organize products into fast checkout groups"
                action={!isAddingCategory ? (
                  <button
                    onClick={() => setIsAddingCategory(true)}
                    className="bg-slate-950 text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 px-4 py-3 rounded-xl transition-all shadow-sm press whitespace-nowrap"
                  >
                    <Plus size={16} /> New category
                  </button>
                ) : undefined}
              />

              {isAddingCategory ? (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                    <div className="space-y-8">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 ml-2">Category name</label>
                        <input 
                          type="text" 
                          value={categoryForm.name} 
                          onChange={e => setCategoryForm({...categoryForm, name: e.target.value})}
                          className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-xl px-5 py-3 text-sm font-bold text-slate-900 outline-none shadow-sm"
                          placeholder="e.g. Hot Beverages"
                          autoFocus
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-2">Visual icon</label>
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
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 ml-2">Brand palette</label>
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
                        <button onClick={resetCategoryForm} className="flex-1 py-4 bg-white text-slate-400 font-bold text-[10px] uppercase tracking-widest rounded-xl border-2 border-slate-100 press">Cancel</button>
                        <button onClick={handleSaveCategory} className="flex-[2] grad-indigo text-white py-4 font-bold text-[10px] uppercase tracking-widest rounded-xl shadow-indigo press flex items-center justify-center gap-3">
                          <Save size={18} /> {editingCategoryId ? 'Save changes' : 'Save category'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
                  {categories?.map(cat => {
                    const colorOpt = COLOR_OPTIONS.find(c => c.name === cat.color) || COLOR_OPTIONS[6];
                    const IconComp = ICON_OPTIONS.find(i => i.name === cat.iconName)?.icon || Package;

                    return (
                      <div key={cat.id} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5 hover:bg-indigo-50/30 transition-all">
                        <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl ${colorOpt.light} flex items-center justify-center ${colorOpt.text} border border-slate-100 shadow-sm`}>
                            <IconComp size={20} />
                          </div>
                          <div className="stable-row-copy">
                            <h4 className="stable-title text-sm font-black text-slate-900">{cat.name}</h4>
                            <p className="stable-title text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{cat.iconName} / {cat.color}</p>
                          </div>
                        </div>
                        <div className="stable-actions flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-all">
                          <button onClick={() => startEditCategory(cat)} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                            <Palette size={18} />
                          </button>
                          <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition-all">
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
               <AdminSectionHeader
                 title="Financial accounts"
                 description="Bank, M-Pesa, and cash accounts"
                 action={(
                   <button
                     onClick={() => setIsAddingFinAccount(true)}
                     className="bg-slate-950 text-white font-black text-[10px] uppercase tracking-widest flex items-center gap-2 px-4 py-3 rounded-xl transition-all shadow-sm press whitespace-nowrap"
                   >
                     <Plus size={16} /> New account
                   </button>
                 )}
               />

               {isAddingFinAccount && (
                 <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm animate-in zoom-in-95">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                       <div className="lg:col-span-2">
                          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Account name</label>
                          <input type="text" value={finAccountForm.name} onChange={e => setFinAccountForm({...finAccountForm, name: e.target.value})} className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl px-5 py-3 text-sm font-bold text-slate-900 outline-none shadow-sm" placeholder="e.g. Absa Business Current" />
                       </div>
                       <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Channel type</label>
                          <SearchableSelect
                            value={finAccountForm.type}
                            onChange={(v) => setFinAccountForm({ ...finAccountForm, type: v as any })}
                            placeholder="Select channel..."
                            options={[
                              { value: 'BANK', label: 'Commercial bank', keywords: 'bank' },
                              { value: 'MPESA', label: 'M-Pesa utility', keywords: 'mpesa till paybill' },
                              { value: 'CASH', label: 'Cash drawer', keywords: 'cash' },
                            ]}
                            buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                          />
                       </div>
                       <div>
                          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Terminal / ref number</label>
                          <input type="text" value={finAccountForm.accountNumber} onChange={e => setFinAccountForm({...finAccountForm, accountNumber: e.target.value})} className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" placeholder="Optional identifier" />
                       </div>
                    </div>
                    <div className="flex gap-4">
                       <button onClick={() => setIsAddingFinAccount(false)} className="flex-1 py-4 bg-white text-slate-400 font-bold text-[10px] uppercase tracking-widest rounded-xl border-2 border-slate-100 press">Cancel</button>
                       <button onClick={handleSaveFinAccount} className="flex-[2] grad-emerald text-white py-4 font-bold text-[10px] uppercase tracking-widest rounded-xl shadow-emerald press">Save account</button>
                    </div>
                 </div>
               )}

               <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
                  {financialAccounts?.map(acc => (
                    <div key={acc.id} className="group bg-white px-4 py-4 sm:px-5 hover:bg-emerald-50/20 transition-all relative overflow-hidden">
                       <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 mb-4 relative z-10">
                          <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
                             <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shadow-sm">
                                {acc.type === 'BANK' ? <Building2 size={22} /> : acc.type === 'MPESA' ? <Smartphone size={22} /> : <DollarSign size={22} />}
                             </div>
                             <div className="stable-row-copy">
                                <h4 className="stable-title text-sm font-black text-slate-900 leading-tight">{acc.name}</h4>
                                <div className="flex min-w-0 items-center gap-2 mt-1 overflow-hidden">
                                   <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex-shrink-0">{acc.type === 'MPESA' ? 'M-Pesa' : acc.type === 'BANK' ? 'Bank' : 'Cash'}</span>
                                   <span className="w-1 h-1 rounded-full bg-slate-200" />
                                   {acc.branchId ? (
                                      <span className="stable-chip text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase">
                                         {branches?.find(b => b.id === acc.branchId)?.name || 'Local'}
                                      </span>
                                   ) : (
                                      <span className="stable-chip text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full uppercase">
                                         All branches
                                      </span>
                                   )}
                                </div>
                             </div>
                          </div>
                          <div className="text-right stable-actions">
                             <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Liquid balance</p>
                             <h3 className="text-base sm:text-lg font-black text-slate-900 tabular-nums whitespace-nowrap">Ksh {(acc.balance || 0).toLocaleString()}</h3>
                          </div>
                       </div>
                       
                       {depositState.accountId === acc.id ? (
                          <div className="flex items-center gap-3 mt-2 bg-slate-50 p-4 rounded-2xl border-2 border-slate-100 animate-in zoom-in-95">
                             <div className="flex-1 relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">Ksh</span>
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
                          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-4 border-t border-slate-100">
                             <div className="flex flex-wrap gap-2">
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
                    <div className="py-16 bg-slate-50 border-2 border-dashed border-slate-100 flex flex-col items-center justify-center text-slate-300">
                       <Landmark size={48} className="mb-4 opacity-20" />
                       <p className="text-xs font-black uppercase tracking-widest opacity-40">No financial accounts defined</p>
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
