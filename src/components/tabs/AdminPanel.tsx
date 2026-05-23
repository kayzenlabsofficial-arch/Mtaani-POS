import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, ShieldCheck, Users, Plus, Trash2, KeyRound, Tag as TagIcon, Save, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Palette, Check } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { getApiKey } from '../../runtimeConfig';

import SettingsTab from './SettingsTab';
import AdminApprovals from './AdminApprovals';
import { useToast } from '../../context/ToastContext';
import { type Category } from '../../db';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { recordAuditEvent } from '../../utils/auditLog';
import { StaffService } from '../../services/admin';
import { CategoryService } from '../../services/catalog';


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
  { id: 'CATEGORIES', label: 'Categories', icon: TagIcon },
  { id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck },
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
  const [activeAdminTab, setActiveAdminTab] = useState<'SETTINGS' | 'APPROVALS' | 'USERS' | 'CATEGORIES'>(() => {
    const requested = sessionStorage.getItem('mtaani_admin_tab');
    sessionStorage.removeItem('mtaani_admin_tab');
    return ['SETTINGS', 'APPROVALS', 'USERS', 'CATEGORIES'].includes(requested || '')
      ? requested as any
      : 'USERS';
  });
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
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
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', password: '', role: 'CASHIER' as 'CASHIER' | 'MANAGER' | 'ADMIN' });
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingPassword, setEditingPassword] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  // Device sync status
  const [deviceSyncRows, setDeviceSyncRows] = useState<any[]>([]);
  const [deviceSyncError, setDeviceSyncError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (!activeBusinessId || !activeShopId) return;
      try {
        const apiKey = await getApiKey();
        const res = await fetch('/api/sync/status', {
          method: 'GET',
          headers: {
            'X-API-Key': apiKey,
            'X-Business-ID': activeBusinessId,
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
  }, [activeBusinessId, activeShopId]);

  const handleAddUser = async () => {
    if (!newUser.name || !newUser.password) return;
    if (!activeBusinessId) return error("Please log in again.");
    if (isSaving) return;
    setIsSaving(true);
    try {
      await StaffService.save({
        user: {
          name: newUser.name,
          password: newUser.password,
          role: newUser.role,
          shopId: activeShopId || undefined,
        },
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await db.users.reload();
      setNewUser({ name: '', password: '', role: 'CASHIER' });
      setIsAddingUser(false);
      recordAuditEvent({
        action: 'admin.user_create',
        entity: 'user',
        severity: 'INFO',
        details: `Created new ${newUser.role} account for ${newUser.name}.`
      });
      success("Staff member created successfully.");
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
      if (!activeBusinessId) return error("Please log in again.");
      await StaffService.delete({ userId: id, businessId: activeBusinessId, shopId: activeShopId });
      await db.users.reload();
      recordAuditEvent({
        action: 'admin.user_delete',
        entity: 'user',
        entityId: id,
        severity: 'WARN',
        details: `Deleted user ${userToDelete?.name} (${userToDelete?.role}).`
      });
    }
  };

  const handlePasswordUpdate = async (id: string) => {
    if (!editingPassword || editingPassword.length < 4) return;
    if (!activeBusinessId) return error("Please log in again.");
    await StaffService.resetPassword({ userId: id, newPassword: editingPassword, businessId: activeBusinessId, shopId: activeShopId });
    await db.users.reload();
    setEditingUserId(null);
    setEditingPassword('');
    recordAuditEvent({
      action: 'admin.user_password_reset',
      entity: 'user',
      entityId: id,
      severity: 'WARN',
      details: `Reset password for user ID ${id}.`
    });
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
      if (!activeBusinessId) return error("Please log in again.");
      await CategoryService.save({
        category: { id: editingCategoryId || undefined, ...categoryForm },
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await db.categories.reload();
      success(editingCategoryId ? "Category updated successfully." : "New category created.");
      resetCategoryForm();
    } catch (err) {
      error("Failed to save category.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!activeBusinessId) return error("Please log in again.");
    if (confirm(`Are you sure you want to delete "${name}"? Products in this category will need to be reassigned.`)) {
      await CategoryService.delete({ categoryId: id, businessId: activeBusinessId, shopId: activeShopId });
      await db.categories.reload();
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
                         <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <button onClick={() => setNewUser({...newUser, role: 'CASHIER'})} className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'CASHIER' ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Cashier
                            </button>
                            <button onClick={() => setNewUser({...newUser, role: 'MANAGER'})} className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'MANAGER' ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Manager
                            </button>
                            <button onClick={() => setNewUser({...newUser, role: 'ADMIN'})} className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${newUser.role === 'ADMIN' ? 'bg-blue-600 text-white border-blue-600 shadow-blue' : 'bg-white text-slate-400 border-transparent hover:border-slate-200'}`}>
                                Admin
                            </button>
                         </div>
                       </div>
                    </div>
                    <div className="flex gap-4">
                       <button onClick={() => {setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER' });}} className="flex-1 py-4 bg-white text-slate-400 font-bold text-[10px] uppercase tracking-widest rounded-xl border-2 border-slate-100 press">Cancel</button>
                       <button onClick={handleAddUser} disabled={!newUser.name || newUser.password.length < 4} className="flex-[2] grad-blue text-white font-bold text-[10px] uppercase tracking-widest rounded-xl shadow-blue press">Save staff member</button>
                    </div>
                 </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
                 {users?.map(user => (
                    <div key={user.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5 hover:bg-blue-50/30 transition-all overflow-hidden">
                       <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm ${user.role === 'ADMIN' ? 'bg-indigo-50 text-indigo-600' : user.role === 'MANAGER' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                             {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="stable-row-copy">
                             <h4 className="stable-title text-sm font-black text-slate-900 leading-tight">{user.name}</h4>
                             <div className="flex min-w-0 items-center gap-2 mt-1 overflow-hidden">
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest flex-shrink-0 ${user.role === 'ADMIN' ? 'bg-indigo-100 text-indigo-700' : user.role === 'MANAGER' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                   {user.role === 'ADMIN' ? 'Admin' : user.role === 'MANAGER' ? 'Manager' : user.role === 'CASHIER' ? 'Cashier' : user.role}
                                </span>
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
       </div>
    </div>
  );
}
