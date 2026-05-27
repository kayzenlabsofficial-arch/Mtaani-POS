import React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { db, type AuditLog } from '../../db';
import { StaffService, type SafeStaffUser } from '../../services/admin';
import { useToast } from '../../context/ToastContext';
import AdminApprovals from '../tabs/AdminApprovals';
import AccessControlPanel from './AccessControlPanel';
import { type BusinessAdminTab, useBusinessAdminData } from './useBusinessAdminData';

type AdminPanelMode = 'desktop' | 'mobile';
type StaffRole = 'CASHIER' | 'MANAGER' | 'ADMIN';
type ActivityFilter = 'ALL' | 'STAFF' | 'ACCESS' | 'APPROVALS' | 'CASH' | 'SETTINGS' | 'SECURITY';
type DateFilter = 'TODAY' | 'WEEK' | 'ALL';

const TABS: Array<{ id: BusinessAdminTab; label: string; Icon: React.ElementType }> = [
  { id: 'OVERVIEW', label: 'Overview', Icon: ShieldCheck },
  { id: 'STAFF', label: 'Staff', Icon: Users },
  { id: 'ACCESS', label: 'Access', Icon: LockKeyhole },
  { id: 'APPROVALS', label: 'Approvals', Icon: AlertCircle },
  { id: 'ACTIVITY', label: 'Activity', Icon: Activity },
];

const ACTIVITY_FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: 'ALL', label: 'All' },
  { id: 'STAFF', label: 'Staff' },
  { id: 'ACCESS', label: 'Access' },
  { id: 'APPROVALS', label: 'Approvals' },
  { id: 'CASH', label: 'Cash' },
  { id: 'SETTINGS', label: 'Settings' },
  { id: 'SECURITY', label: 'Security' },
];

function roleLabel(role?: string) {
  if (role === 'ADMIN') return 'Admin';
  if (role === 'MANAGER') return 'Manager';
  if (role === 'CASHIER') return 'Cashier';
  return role || 'Staff';
}

function formatDateTime(value?: number) {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString();
}

function formatTimeAgo(value?: number | null) {
  if (!value) return 'Never synced';
  const diff = Math.max(0, Date.now() - Number(value));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function classifyActivity(action?: string): ActivityFilter {
  const value = String(action || '').toLowerCase();
  if (value.includes('user') || value.includes('staff')) return 'STAFF';
  if (value.includes('access')) return 'ACCESS';
  if (value.includes('approve') || value.includes('reject') || value.includes('approval')) return 'APPROVALS';
  if (value.includes('cash') || value.includes('shift') || value.includes('drawer') || value.includes('bank')) return 'CASH';
  if (value.includes('setting') || value.includes('mpesa') || value.includes('till')) return 'SETTINGS';
  if (value.includes('login') || value.includes('password') || value.includes('lock')) return 'SECURITY';
  return 'ALL';
}

function activityLabel(action?: string) {
  return String(action || 'activity')
    .split('.')
    .filter(Boolean)
    .map(part => part.replace(/-/g, ' '))
    .join(' / ');
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function AdminDrawer({
  title,
  description,
  onClose,
  footer,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex justify-end bg-slate-950/45 backdrop-blur-sm">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        <footer className="border-t-2 border-slate-200 bg-slate-50 p-4 sm:p-5">{footer}</footer>
      </section>
    </div>
  );
}

function StatCard({ label, value, detail, Icon }: { label: string; value: string; detail: string; Icon: React.ElementType }) {
  return (
    <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700">
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function ActivityRows({ logs, compact = false }: { logs: AuditLog[]; compact?: boolean }) {
  if (!logs.length) {
    return (
      <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
        <p className="text-sm font-black text-slate-900">No activity yet</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">Important admin actions will appear here.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-200 overflow-hidden rounded-lg border-2 border-slate-200 bg-white">
      {logs.map(log => (
        <div key={log.id} className={`grid gap-3 px-4 py-3 ${compact ? '' : 'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center'}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-black capitalize text-slate-950">{activityLabel(log.action)}</p>
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black uppercase ${
                log.severity === 'CRITICAL'
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : log.severity === 'WARN'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
              }`}>
                {log.severity || 'INFO'}
              </span>
            </div>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">{log.details || 'No extra details'}</p>
          </div>
          <div className="shrink-0 text-left sm:text-right">
            <p className="text-xs font-black text-slate-900">{log.userName || 'System'}</p>
            <p className="mt-1 text-[10px] font-bold text-slate-500">{formatDateTime(log.ts)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function OverviewPanel({
  staff,
  pendingCounts,
  deviceSyncRows,
  deviceSyncError,
  recentActivity,
  onOpenTab,
}: ReturnType<typeof useBusinessAdminData> & { onOpenTab: (tab: BusinessAdminTab) => void }) {
  const freshTerminals = deviceSyncRows.filter(row => Number(row.lastSyncAt || 0) >= Date.now() - 2 * 60 * 1000).length;
  const terminalBacklog = deviceSyncRows.reduce((sum, row) => sum + Number(row.pendingOutboxCount || 0), 0);
  const recentCritical = recentActivity.filter(log => log.severity === 'CRITICAL').length;
  const latestActivities = recentActivity.slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Staff accounts" value={String(staff.length)} detail="People with POS logins" Icon={Users} />
        <StatCard label="Pending approvals" value={String(pendingCounts.total)} detail="Requests waiting for admin" Icon={AlertCircle} />
        <StatCard label="Terminals online" value={`${freshTerminals}/${deviceSyncRows.length}`} detail={deviceSyncError || (terminalBacklog > 0 ? `${terminalBacklog} offline sale${terminalBacklog === 1 ? '' : 's'} waiting` : 'Heartbeat in the last 2 minutes')} Icon={MonitorSmartphone} />
        <StatCard label="Security alerts" value={String(recentCritical)} detail="Critical activity records" Icon={ShieldCheck} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]">
        <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Owner check</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">Needs attention</h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenTab('APPROVALS')}
              className="rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
            >
              Review approvals
            </button>
          </div>
          <div className="divide-y divide-slate-200">
            {[
              { label: 'Expenses', value: pendingCounts.expenses },
              { label: 'Refunds', value: pendingCounts.refunds },
              { label: 'Purchases', value: pendingCounts.purchases },
              { label: 'Stock changes', value: pendingCounts.stock },
              { label: 'Cash picks', value: pendingCounts.cashPicks },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between gap-4 py-3">
                <p className="text-sm font-black text-slate-900">{item.label}</p>
                <span className={`rounded-lg border px-3 py-1 text-sm font-black ${item.value ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Recent activity</p>
              <h3 className="mt-1 text-lg font-black text-slate-950">Last actions</h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenTab('ACTIVITY')}
              className="text-[10px] font-black uppercase tracking-widest text-blue-700"
            >
              View all
            </button>
          </div>
          <div className="mt-4">
            <ActivityRows logs={latestActivities} compact />
          </div>
        </section>
      </div>
    </div>
  );
}

function StaffPanel({
  activeBusinessId,
  activeShopId,
  staff,
  isStaffLoading,
  staffError,
  reloadStaff,
}: Pick<ReturnType<typeof useBusinessAdminData>, 'activeBusinessId' | 'activeShopId' | 'staff' | 'isStaffLoading' | 'staffError' | 'reloadStaff'>) {
  const { success, error } = useToast();
  const [isAdding, setIsAdding] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [newUser, setNewUser] = React.useState({ name: '', password: '', role: 'CASHIER' as StaffRole });
  const [editingUserId, setEditingUserId] = React.useState<string | null>(null);
  const [editingPassword, setEditingPassword] = React.useState('');
  const editingUser = staff.find(user => user.id === editingUserId);

  const closeAdd = () => {
    setIsAdding(false);
    setNewUser({ name: '', password: '', role: 'CASHIER' });
  };

  const handleAdd = async () => {
    if (!activeBusinessId || isSaving) return;
    setIsSaving(true);
    try {
      await StaffService.save({
        user: { name: newUser.name, password: newUser.password, role: newUser.role },
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await Promise.allSettled([reloadStaff(), db.users.reload()]);
      closeAdd();
      success('Staff member created.');
    } catch (err: any) {
      error(err?.message || 'Could not create staff member.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (user: SafeStaffUser) => {
    if (!activeBusinessId) return;
    const adminCount = staff.filter(item => item.role === 'ADMIN').length;
    if (user.role === 'ADMIN' && adminCount <= 1) {
      error('The last admin account cannot be deleted.');
      return;
    }
    if (!window.confirm(`Delete ${user.name}? This removes their POS login.`)) return;
    try {
      await StaffService.delete({ userId: user.id, businessId: activeBusinessId, shopId: activeShopId });
      await Promise.allSettled([reloadStaff(), db.users.reload()]);
      success('Staff member deleted.');
    } catch (err: any) {
      error(err?.message || 'Could not delete staff member.');
    }
  };

  const handlePasswordUpdate = async () => {
    if (!activeBusinessId || !editingUser || editingPassword.length < 4) return;
    try {
      await StaffService.resetPassword({ userId: editingUser.id, newPassword: editingPassword, businessId: activeBusinessId, shopId: activeShopId });
      await Promise.allSettled([reloadStaff(), db.users.reload()]);
      setEditingUserId(null);
      setEditingPassword('');
      success('Password updated.');
    } catch (err: any) {
      error(err?.message || 'Could not update password.');
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Staff</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">Staff management</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">Create accounts and reset access keys.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800"
          >
            <Plus size={16} />
            Add staff
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Staff profile</p>
          <p className="mt-1 text-sm font-bold text-slate-500">
            {isStaffLoading ? 'Loading staff accounts...' : `${staff.length} active account${staff.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {staffError && (
          <div className="m-4 rounded-lg border-2 border-rose-100 bg-rose-50 p-3 text-sm font-bold text-rose-700">{staffError}</div>
        )}
        {isStaffLoading ? (
          <div className="p-5 text-sm font-bold text-slate-500">Loading staff safely...</div>
        ) : staff.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-black text-slate-900">No staff accounts loaded</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">Add a cashier or manager to begin.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {staff.map(user => (
              <div key={user.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 sm:px-5">
                <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-black text-slate-900">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <h4 className="truncate text-sm font-black text-slate-900">{user.name}</h4>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{roleLabel(user.role)}</span>
                      {Number(user.mustChangePassword || 0) === 1 && (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">Setup needed</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { setEditingUserId(user.id); setEditingPassword(''); }}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-700"
                    title="Reset password"
                  >
                    <KeyRound size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(user)}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-rose-100 bg-white text-rose-600 transition hover:bg-rose-50"
                    title="Delete staff"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdding && (
        <AdminDrawer
          title="Add staff member"
          description="Create one login for a cashier, manager, or admin."
          onClose={closeAdd}
          footer={(
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={closeAdd} className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newUser.name.trim() || newUser.password.length < 4 || isSaving}
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
              <input className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" value={newUser.name} onChange={event => setNewUser({ ...newUser, name: event.target.value })} placeholder="e.g. Samuel Karanja" />
            </div>
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Password</label>
              <input type="password" className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" value={newUser.password} onChange={event => setNewUser({ ...newUser, password: event.target.value })} placeholder="Minimum 4 characters" />
            </div>
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Staff role</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(['CASHIER', 'MANAGER', 'ADMIN'] as StaffRole[]).map(role => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setNewUser({ ...newUser, role })}
                    className={`rounded-lg border-2 py-3 text-[10px] font-black uppercase tracking-widest transition ${newUser.role === role ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'}`}
                  >
                    {roleLabel(role)}
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
              <button type="button" onClick={() => { setEditingUserId(null); setEditingPassword(''); }} className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600">Cancel</button>
              <button
                type="button"
                onClick={handlePasswordUpdate}
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
            onChange={event => setEditingPassword(event.target.value)}
          />
        </AdminDrawer>
      )}
    </div>
  );
}

function TerminalsPanel({
  rows,
  error,
  loading,
  onRefresh,
}: {
  rows: ReturnType<typeof useBusinessAdminData>['deviceSyncRows'];
  error: string | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Terminals</p>
          <h3 className="mt-1 text-lg font-black text-slate-950">Sync health</h3>
        </div>
        <button type="button" onClick={onRefresh} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-600">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {error && <p className="mt-4 rounded-lg border-2 border-rose-100 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}
      <div className="mt-4 divide-y divide-slate-200">
        {rows.length === 0 ? (
          <p className="py-4 text-sm font-semibold text-slate-500">No terminal sync records yet.</p>
        ) : rows.map(row => {
          const fresh = Number(row.lastSyncAt || 0) >= Date.now() - 2 * 60 * 1000;
          const pending = Number(row.pendingOutboxCount || 0);
          const failed = Number(row.failedOutboxCount || 0);
          const statusLabel = failed > 0 ? 'Error' : pending > 0 ? 'Pending' : fresh ? 'Online' : 'Quiet';
          const statusClass = failed > 0
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : pending > 0
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : fresh
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-500';
          return (
            <div key={row.deviceId} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-900">{row.cashierName || row.deviceId}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {formatTimeAgo(row.lastSyncAt)}
                  {pending > 0 ? ` - ${pending} pending` : ''}
                  {row.shopId ? ` - ${row.shopId}` : ''}
                </p>
                {pending > 0 && row.oldestPendingAt && (
                  <p className="mt-1 text-[11px] font-bold text-amber-700">Oldest pending sale: {formatTimeAgo(row.oldestPendingAt)}</p>
                )}
                {row.lastSyncError && (
                  <p className="mt-1 line-clamp-2 text-[11px] font-bold text-rose-700">{row.lastSyncError}</p>
                )}
              </div>
              <span className={`rounded-lg border px-3 py-1 text-[10px] font-black uppercase ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivityPanel({ logs, staff }: { logs: AuditLog[]; staff: SafeStaffUser[] }) {
  const [dateFilter, setDateFilter] = React.useState<DateFilter>('WEEK');
  const [typeFilter, setTypeFilter] = React.useState<ActivityFilter>('ALL');
  const [staffFilter, setStaffFilter] = React.useState('ALL');
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const now = Date.now();
    const minDate = dateFilter === 'TODAY'
      ? startOfToday()
      : dateFilter === 'WEEK'
        ? now - 7 * 24 * 60 * 60 * 1000
        : 0;
    const q = query.trim().toLowerCase();
    return logs.filter(log => {
      if (minDate && Number(log.ts || 0) < minDate) return false;
      if (typeFilter !== 'ALL' && classifyActivity(log.action) !== typeFilter) return false;
      if (staffFilter !== 'ALL' && String(log.userName || '') !== staffFilter) return false;
      if (q && !`${log.action} ${log.details} ${log.userName}`.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 120);
  }, [dateFilter, logs, query, staffFilter, typeFilter]);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Activity</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">Admin activity log</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">Staff changes, approvals, cash actions, and settings edits.</p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-11 w-full rounded-lg border-2 border-slate-200 bg-white pl-9 pr-3 text-sm font-bold outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="Search activity..."
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {(['TODAY', 'WEEK', 'ALL'] as DateFilter[]).map(item => (
              <button key={item} type="button" onClick={() => setDateFilter(item)} className={`rounded-lg border-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest ${dateFilter === item ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                {item === 'TODAY' ? 'Today' : item === 'WEEK' ? '7 days' : 'All'}
              </button>
            ))}
          </div>
          <select value={staffFilter} onChange={event => setStaffFilter(event.target.value)} className="h-10 rounded-lg border-2 border-slate-200 bg-white px-3 text-xs font-bold text-slate-700">
            <option value="ALL">All staff</option>
            {staff.map(user => <option key={user.id} value={user.name}>{user.name}</option>)}
          </select>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
          {ACTIVITY_FILTERS.map(item => (
            <button key={item.id} type="button" onClick={() => setTypeFilter(item.id)} className={`rounded-lg border-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest ${typeFilter === item.id ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
      <ActivityRows logs={filtered} />
    </div>
  );
}

export default function AdminPanelContent({ mode }: { mode: AdminPanelMode }) {
  const adminData = useBusinessAdminData();
  const {
    staff,
    pendingCounts,
    deviceSyncRows,
    deviceSyncError,
    isDeviceSyncLoading,
    reloadDeviceSync,
    recentActivity,
  } = adminData;
  const [activeTab, setActiveTab] = React.useState<BusinessAdminTab>(() => {
    if (typeof sessionStorage === 'undefined') return 'OVERVIEW';
    const requested = sessionStorage.getItem('mtaani_admin_tab');
    sessionStorage.removeItem('mtaani_admin_tab');
    return ['OVERVIEW', 'STAFF', 'ACCESS', 'APPROVALS', 'ACTIVITY'].includes(requested || '')
      ? requested as BusinessAdminTab
      : 'OVERVIEW';
  });
  const isMobile = mode === 'mobile';

  const tabCount = (tab: BusinessAdminTab) => {
    if (tab === 'STAFF') return staff.length;
    if (tab === 'APPROVALS') return pendingCounts.total;
    if (tab === 'ACTIVITY') return recentActivity.length;
    return 0;
  };

  return (
    <div className={`mx-auto w-full max-w-6xl space-y-5 pb-24 animate-in fade-in ${isMobile ? 'px-0' : ''}`}>
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Owner controls</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">Admin control center</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Staff access, approvals, terminals, and activity in one place.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
              <CheckCircle2 size={14} className="text-emerald-600" />
              {deviceSyncError ? 'Needs attention' : 'Healthy'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
              <MonitorSmartphone size={14} className="text-blue-700" />
              {deviceSyncRows.length} terminal{deviceSyncRows.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border-2 border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {TABS.map(item => {
            const count = tabCount(item.id);
            const active = activeTab === item.id;
            const Icon = item.Icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${
                  active ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700'
                }`}
              >
                <Icon size={16} />
                {item.label}
                {count > 0 && (
                  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black ${active ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'}`}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {activeTab === 'OVERVIEW' && <OverviewPanel {...adminData} onOpenTab={setActiveTab} />}
      {activeTab === 'STAFF' && <StaffPanel {...adminData} />}
      {activeTab === 'ACCESS' && <AccessControlPanel />}
      {activeTab === 'APPROVALS' && <AdminApprovals />}
      {activeTab === 'ACTIVITY' && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <ActivityPanel logs={recentActivity} staff={staff} />
          <TerminalsPanel rows={deviceSyncRows} error={deviceSyncError} loading={isDeviceSyncLoading} onRefresh={reloadDeviceSync} />
        </div>
      )}
    </div>
  );
}
