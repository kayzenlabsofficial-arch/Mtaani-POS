import React, { useEffect, useState } from 'react';
import { KeyRound, LockKeyhole, Plus, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { getApiKey } from '../../runtimeConfig';

import AdminApprovals from './AdminApprovals';
import AccessControlPanel from '../admin/AccessControlPanel';
import { useToast } from '../../context/ToastContext';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { recordAuditEvent } from '../../utils/auditLog';
import { StaffService } from '../../services/admin';

const ADMIN_TABS = [
  { id: 'USERS', label: 'Staff', icon: Users },
  { id: 'ACCESS', label: 'Access', icon: LockKeyhole },
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

function AdminDrawer({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-slate-950/45 backdrop-blur-sm">
      <section className="flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-xl sm:border-l-2 sm:border-slate-200">
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-slate-950">{title}</h3>
            {description && <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
            aria-label="Close admin editor"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {children}
        </div>
        <footer className="border-t-2 border-slate-200 bg-slate-50 p-4 sm:p-5">
          {footer}
        </footer>
      </section>
    </div>
  );
}

export default function AdminPanelDesktop() {
  const [activeAdminTab, setActiveAdminTab] = useState<'APPROVALS' | 'USERS' | 'ACCESS'>(() => {
    const requested = sessionStorage.getItem('mtaani_admin_tab');
    sessionStorage.removeItem('mtaani_admin_tab');
    return ['APPROVALS', 'USERS', 'ACCESS'].includes(requested || '')
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

  const editingUser = users?.find(user => user.id === editingUserId);

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
         {activeAdminTab === 'ACCESS' && <AccessControlPanel />}
         
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

               <div className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
                 <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
                   <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Staff profile</p>
                   <p className="mt-1 text-sm font-bold text-slate-500">{users?.length || 0} active account{(users?.length || 0) === 1 ? '' : 's'}</p>
                 </div>
                 <div className="divide-y divide-slate-200">
                 {users?.map(user => (
                    <div key={user.id} className="group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition-all hover:bg-blue-50/20 sm:px-5">
                       <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                           <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-black text-slate-900">
                             {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="stable-row-copy">
                             <h4 className="stable-title text-sm font-black text-slate-900 leading-tight">{user.name}</h4>
                             <div className="flex min-w-0 items-center gap-2 mt-1 overflow-hidden">
                                 <span className="flex-shrink-0 text-[10px] font-black uppercase tracking-widest text-slate-500">
                                   {user.role === 'ADMIN' ? 'Admin' : user.role === 'MANAGER' ? 'Manager' : user.role === 'CASHIER' ? 'Cashier' : user.role}
                                </span>
                             </div>
                          </div>
                       </div>

                       <div className="stable-actions flex items-center gap-1">
                           <button onClick={() => { setEditingUserId(user.id); setEditingPassword(''); }} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500 transition-all hover:border-blue-200 hover:text-blue-700">
                             <KeyRound size={17} />
                          </button>
                           <button onClick={() => handleDeleteUser(user.id)} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-rose-100 bg-white text-rose-600 transition-all hover:bg-rose-50">
                             <Trash2 size={17} />
                          </button>
                       </div>
                    </div>
                 ))}
                 </div>
              </div>
           </div>
         )}
       </div>

      {isAddingUser && (
        <AdminDrawer
          title="Add staff member"
          description="Create one login for a cashier, manager, or admin."
          onClose={() => { setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER' }); }}
          footer={(
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => { setIsAddingUser(false); setNewUser({ name: '', password: '', role: 'CASHIER' }); }}
                className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddUser}
                disabled={!newUser.name || newUser.password.length < 4 || isSaving}
                className="h-12 flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 px-5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save staff member'}
              </button>
            </div>
          )}
        >
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Full name</label>
              <input type="text" className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="e.g. Samuel Karanja" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} />
            </div>
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Password</label>
              <input type="password" className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="Minimum 4 characters" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} />
            </div>
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Staff role</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(['CASHIER', 'MANAGER', 'ADMIN'] as const).map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setNewUser({ ...newUser, role })}
                    className={`rounded-lg border-2 py-3 text-[10px] font-black uppercase tracking-widest transition ${newUser.role === role ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'}`}
                  >
                    {role === 'CASHIER' ? 'Cashier' : role === 'MANAGER' ? 'Manager' : 'Admin'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </AdminDrawer>
      )}

      {editingUser && (
        <AdminDrawer
          title="Reset password"
          description={`Set a new access key for ${editingUser.name}.`}
          onClose={() => { setEditingUserId(null); setEditingPassword(''); }}
          footer={(
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => { setEditingUserId(null); setEditingPassword(''); }}
                className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handlePasswordUpdate(editingUser.id)}
                disabled={editingPassword.length < 4}
                className="h-12 flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 px-5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800 disabled:opacity-50"
              >
                Confirm update
              </button>
            </div>
          )}
        >
          <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">New password</label>
          <input
            type="password"
            autoFocus
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            placeholder="Minimum 4 characters"
            value={editingPassword}
            onChange={e => setEditingPassword(e.target.value)}
          />
        </AdminDrawer>
      )}
    </div>
  );
}
