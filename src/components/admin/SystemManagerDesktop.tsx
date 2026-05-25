import React, { useState } from 'react';
import { db, type Business } from '../../db';
import { useLiveQuery } from '../../clouddb';
import { useToast } from '../../context/ToastContext';
import { resetAttempts } from '../../security';
import { BusinessAdminService, StaffService } from '../../services/admin';
import { Building2, CloudOff, KeyRound, ShieldCheck, Store, UserRound, X } from 'lucide-react';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => {
  const icons: Record<string, React.ElementType> = {
    add_business: Building2,
    admin_panel_settings: ShieldCheck,
    close: X,
    cloud_off: CloudOff,
    key_reset: KeyRound,
    shield_person: UserRound,
    storefront: Store,
  };
  const Icon = icons[name] || ShieldCheck;
  const size = className.includes('text-4xl') ? 36 : className.includes('text-3xl') ? 30 : 20;
  return <Icon className={className} size={size} strokeWidth={2.4} />;
};

function sentenceValue(value: unknown, fallback = '') {
  const text = String(value || fallback).replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

type ManageBusinessModalProps = {
  business: Business;
  onClose: () => void;
};

export function ManageBusinessModal({ business, onClose }: ManageBusinessModalProps) {
  const users = useLiveQuery(() => db.users.where('businessId').equals(business.id).toArray(), [business.id], []);
  const lockout = useLiveQuery(() => db.loginAttempts.get(business.code.toUpperCase()), [business.code], null);
  const { success, error } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleResetPassword = async (userId: string, userName: string) => {
    if (!confirm(`Reset password for ${userName} to 1234 and require setup on next login?`)) return;
    setIsProcessing(true);
    try {
      const result = await StaffService.resetPassword({ userId, businessId: business.id });
      await db.users.reload();
      success(`Password reset for ${userName} to ${result.temporaryPassword || '1234'}. They must create a new password on next login.`);
    } catch {
      error('Reset failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearLockout = async () => {
    if (!confirm(`Unlock login for ${business.name}?`)) return;
    setIsProcessing(true);
    try {
      await resetAttempts(business.code);
      success('Login unlocked.');
    } catch {
      error('Could not unlock login.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl animate-in fade-in" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/50 p-5 sm:p-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <MaterialIcon name="admin_panel_settings" className="text-3xl" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-black text-white sm:text-2xl">{business.name}</h3>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Business code {business.code}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-all hover:text-white">
            <MaterialIcon name="close" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-8">
          <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h4 className="text-sm font-black uppercase tracking-tight text-white">Users</h4>
              <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{users?.length || 0} users</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {users?.map(user => (
                <div key={user.id} className="group flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-secondary">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{user.name}</p>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-tighter text-slate-500">{sentenceValue(user.role)}</p>
                        {Number(user.mustChangePassword || 0) === 1 && (
                          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
                            Setup required
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleResetPassword(user.id, user.name)}
                    disabled={isProcessing}
                    className="rounded-xl p-2 text-slate-500 transition-colors hover:text-primary disabled:opacity-50"
                    title="Reset password"
                  >
                    <MaterialIcon name="key_reset" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-5 flex items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-950 p-5">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-tight text-white">Login safety</h4>
              <p className="mt-1 text-[11px] font-medium text-slate-500">
                {lockout?.lockedUntil && Date.now() < lockout.lockedUntil
                  ? `Locked until ${new Date(lockout.lockedUntil).toLocaleTimeString()}`
                  : lockout?.count ? `${lockout.count} failed login tries` : 'No login problems.'}
              </p>
            </div>
            {(lockout?.count || (lockout?.lockedUntil && Date.now() < lockout.lockedUntil)) && (
              <button
                onClick={handleClearLockout}
                disabled={isProcessing}
                className="rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-error transition-all hover:bg-error hover:text-white disabled:opacity-50"
              >
                Unlock login
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default function SystemManagerDashboardDesktop({ onLogout }: { onLogout: () => void }) {
  const businesses = useLiveQuery(() => db.businesses.toArray(), [], []);
  const [form, setForm] = useState({ name: '', code: '' });
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code) return;
    const trimmedCode = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(trimmedCode)) {
      alert('Business code must be 3-20 alphanumeric characters (A-Z, 0-9).');
      return;
    }
    try {
      const result = await BusinessAdminService.create({ name: form.name.trim(), code: trimmedCode });
      setForm({ name: '', code: '' });
      await Promise.allSettled([db.businesses.reload(), db.users.reload()]);
      alert(`Business created. Login: username admin, password ${result.adminPassword || '1234'}. This is one-time; they must create their own admin account on first login.`);
    } catch (err: any) {
      console.error(err);
      alert(`Failed to create business: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-950 p-4 text-white animate-in fade-in font-hanken sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
              <MaterialIcon name="shield_person" className="text-3xl text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">System admin</h1>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Business access</p>
            </div>
          </div>
          <button onClick={onLogout} className="rounded-xl border border-error/20 bg-error/10 px-6 py-2 text-xs font-bold text-error transition-all hover:bg-error hover:text-white">Sign out</button>
        </div>

        <section className="mb-8 rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Businesses</p>
          <p className="mt-2 text-3xl font-black">{businesses?.length || 0}</p>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6 shadow-xl sm:p-8">
            <h3 className="mb-6 flex items-center gap-3 text-lg font-black">
              <MaterialIcon name="add_business" className="text-primary" />
              Add business
            </h3>
            <form onSubmit={handleCreate} className="space-y-6">
              <label className="block">
                <span className="ml-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Business name</span>
                <input type="text" placeholder="e.g. Smart Mart" className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-5 py-3 text-sm font-bold outline-none transition-all focus:border-primary" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="ml-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Login code</span>
                <input type="text" placeholder="e.g. SMART1" className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-5 py-3 text-sm font-bold outline-none transition-all focus:border-primary" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              </label>
              <button type="submit" className="w-full rounded-xl bg-primary py-4 text-xs font-black uppercase tracking-widest shadow-lg shadow-primary/20 transition-all hover:bg-primary-container active:scale-[0.98]">Save business</button>
            </form>
          </div>

          <div className="lg:col-span-2">
            <div className="flex h-full flex-col rounded-[2rem] border border-slate-800 bg-slate-900 p-6 shadow-xl sm:p-8">
              <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-3 text-xl font-black">
                  <MaterialIcon name="storefront" className="text-secondary" />
                  Businesses
                </h3>
                <div className="rounded-full border border-slate-800 bg-slate-950 px-4 py-1.5 text-[10px] font-bold text-slate-500">
                  {businesses?.length || 0} businesses
                </div>
              </div>

              <div className="min-h-[420px] space-y-4 pr-1">
                {businesses?.map(business => (
                  <div key={business.id} className="rounded-3xl border border-slate-800 bg-slate-950 p-5 transition-all hover:border-primary/50">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-4">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-primary transition-all">
                          <MaterialIcon name="storefront" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-base font-black">{business.name}</p>
                          <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Code: {business.code}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedBiz(business)}
                        className="rounded-xl border border-primary/20 bg-slate-900 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-primary transition-all hover:bg-primary hover:text-white"
                      >
                        Manage
                      </button>
                    </div>
                  </div>
                ))}
                {(!businesses || businesses.length === 0) && (
                  <div className="flex h-64 flex-col items-center justify-center text-slate-700">
                    <MaterialIcon name="cloud_off" className="mb-2 text-4xl" />
                    <p className="text-sm font-bold uppercase tracking-tighter">No businesses yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {selectedBiz && (
        <ManageBusinessModal
          business={selectedBiz}
          onClose={() => setSelectedBiz(null)}
        />
      )}
    </div>
  );
}
