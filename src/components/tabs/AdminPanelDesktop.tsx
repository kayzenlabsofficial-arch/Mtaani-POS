import React, { useEffect, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { getApiKey } from '../../runtimeConfig';

import AdminApprovals from './AdminApprovals';
import { useToast } from '../../context/ToastContext';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { recordAuditEvent } from '../../utils/auditLog';
import { StaffService } from '../../services/admin';

const ADMIN_TABS = [
  { id: 'USERS', label: 'Staff', icon: Users },
  { id: 'APPROVALS', label: 'Approvals', icon: ShieldCheck },
] as const;

function AdminSectionHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-slate-200 bg-white px-4 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="min-w-0">
        <h3 className="stable-title text-base font-black text-slate-900">{title}</h3>
        <p className="stable-title text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-1">{description}</p>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

export default function AdminPanelDesktop() {
  const [activeAdminTab, setActiveAdminTab] = useState<'APPROVALS' | 'USERS'>(() => {
    const requested = sessionStorage.getItem('mtaani_admin_tab');
    sessionStorage.removeItem('mtaani_admin_tab');
    return ['APPROVALS', 'USERS'].includes(requested || '')
      ? requested as any
      : 'USERS';
  });
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const { success, error } = useToast();
  const scrollRef = useHorizontalScroll();
  
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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-24 animate-in fade-in">
      
      {/* Header */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-xl font-black text-slate-900">Admin panel</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{deviceSyncRows.length} terminals</span>
            <span className="text-[10px] font-bold text-emerald-600">{deviceSyncError ? 'Needs attention' : 'Healthy'}</span>
            <span className="text-[10px] font-bold text-blue-700">Live controls</span>
          </div>
        </div>
      </div>
      </section>

      {/* Admin Nav Tabs */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-2 shadow-sm">
        <div ref={scrollRef} className="flex gap-2 overflow-x-auto no-scrollbar">
            {ADMIN_TABS.map(tab => (
              <button 
                key={tab.id}
                onClick={() => setActiveAdminTab(tab.id as any)}
                className={`flex flex-shrink-0 items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all press whitespace-nowrap sm:flex-1 ${activeAdminTab === tab.id ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'}`}
              >
                <tab.icon size={16} /> {tab.label}
              </button>
            ))}
        </div>
      </section>

      <div className="space-y-5 animate-in slide-in-from-bottom-4 duration-500">
         
         {activeAdminTab === 'APPROVALS' && <AdminApprovals />}
         
         {activeAdminTab === 'USERS' && (
            <div className="space-y-5">
              <AdminSectionHeader
                title="Staff management"
                description="Manage staff accounts"
                action={(
                  <button
                    onClick={() => setIsAddingUser(true)}
                    className="flex items-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-blue-800 press whitespace-nowrap"
                  >
                    <Plus size={16} /> Add staff
                  </button>
                )}
              />

              {isAddingUser && (
                 <div className="rounded-lg border-2 border-slate-200 bg-white p-5 shadow-sm animate-in zoom-in-95">
                    <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2"> <Users className="text-blue-600" /> Add staff member</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Full name</label>
                          <input type="text" className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="e.g. Samuel Karanja" value={newUser.name} onChange={e => setNewUser({...newUser, name: e.target.value})} />
                       </div>
                       <div>
                         <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Password</label>
                          <input type="password" className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="Minimum 4 characters" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                       </div>
                       <div>
                         <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Staff role</label>
                         <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                             <button onClick={() => setNewUser({...newUser, role: 'CASHIER'})} className={`rounded-lg border-2 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${newUser.role === 'CASHIER' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-700'}`}>
                                Cashier
                            </button>
                             <button onClick={() => setNewUser({...newUser, role: 'MANAGER'})} className={`rounded-lg border-2 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${newUser.role === 'MANAGER' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-700'}`}>
                                Manager
                            </button>
                             <button onClick={() => setNewUser({...newUser, role: 'ADMIN'})} className={`rounded-lg border-2 py-3 text-[10px] font-black uppercase tracking-widest transition-all ${newUser.role === 'ADMIN' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-700'}`}>
                                Admin
                            </button>
                         </div>
                       </div>
                    </div>
                    <div className="flex gap-4">
                       <button onClick={() => {setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER' });}} className="flex-1 rounded-lg border-2 border-slate-200 bg-white py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 press">Cancel</button>
                       <button onClick={handleAddUser} disabled={!newUser.name || newUser.password.length < 4} className="flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 py-3 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-blue-800 disabled:opacity-50 press">Save staff member</button>
                    </div>
                 </div>
              )}

               <div className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
                 {users?.map(user => (
                    <div key={user.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-5 hover:bg-blue-50/30 transition-all overflow-hidden">
                       <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                           <div className={`flex h-10 w-10 items-center justify-center rounded-lg border-2 font-black text-sm ${user.role === 'ADMIN' ? 'border-blue-100 bg-blue-50 text-blue-700' : user.role === 'MANAGER' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                             {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="stable-row-copy">
                             <h4 className="stable-title text-sm font-black text-slate-900 leading-tight">{user.name}</h4>
                             <div className="flex min-w-0 items-center gap-2 mt-1 overflow-hidden">
                                 <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${user.role === 'ADMIN' ? 'bg-blue-50 text-blue-700' : user.role === 'MANAGER' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
                                   {user.role === 'ADMIN' ? 'Admin' : user.role === 'MANAGER' ? 'Manager' : user.role === 'CASHIER' ? 'Cashier' : user.role}
                                </span>
                             </div>
                          </div>
                       </div>

                       <div className="stable-actions flex items-center gap-1">
                           <button onClick={() => { setEditingUserId(editingUserId === user.id ? null : user.id); setEditingPassword(''); }} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500 transition-all hover:border-blue-200 hover:text-blue-700">
                             <KeyRound size={17} />
                          </button>
                           <button onClick={() => handleDeleteUser(user.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-rose-100 bg-white text-rose-600 transition-all hover:bg-rose-50">
                             <Trash2 size={17} />
                          </button>
                       </div>

                       {editingUserId === user.id && (
                           <div className="absolute inset-0 z-20 flex flex-col justify-center bg-white p-4 animate-in fade-in duration-300">
                             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Reset access key</h4>
                             <input 
                               type="password" 
                               autoFocus
                               className="mb-4 w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" 
                               placeholder="Min 4 characters"
                               value={editingPassword}
                               onChange={e => setEditingPassword(e.target.value)}
                             />
                             <div className="flex gap-2">
                                 <button onClick={() => setEditingUserId(null)} className="flex-1 rounded-lg border-2 border-slate-200 bg-white py-3 text-[10px] font-black uppercase text-slate-500">Cancel</button>
                                 <button onClick={() => handlePasswordUpdate(user.id)} disabled={editingPassword.length < 4} className="flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 py-3 text-[10px] font-black uppercase text-white disabled:opacity-40">Confirm update</button>
                             </div>
                          </div>
                       )}
                    </div>
                 ))}
              </div>
           </div>
         )}
       </div>
    </div>
  );
}
