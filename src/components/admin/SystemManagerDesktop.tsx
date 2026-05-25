import React, { useEffect, useMemo, useState } from 'react';
import { db, type Business } from '../../db';
import { useLiveQuery } from '../../clouddb';
import { useToast } from '../../context/ToastContext';
import { BusinessAdminService, StaffService, type BusinessBillingStatus, type BusinessDetails } from '../../services/admin';
import { AlertTriangle, Banknote, Building2, CheckCircle2, Clock, CloudOff, KeyRound, LockKeyhole, ShieldCheck, Store, UserRound, X } from 'lucide-react';

const billingOptions: Array<{ value: BusinessBillingStatus; label: string }> = [
  { value: 'OK', label: 'Ok' },
  { value: 'REMINDER', label: 'Reminder' },
  { value: 'LOCKED', label: 'Locked' },
];

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

function dateInputValue(ms?: number | null) {
  if (!ms) return '';
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function dateFromInput(value: string) {
  if (!value) return null;
  const ms = new Date(`${value}T23:59:59`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sentenceValue(value: unknown, fallback = '') {
  const text = String(value || fallback).replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function billingStatusOf(business?: Partial<Business> | null): BusinessBillingStatus {
  const value = String(business?.billingStatus || 'OK').toUpperCase();
  return value === 'REMINDER' || value === 'LOCKED' ? value : 'OK';
}

function BillingPill({ status }: { status: BusinessBillingStatus }) {
  const classes = status === 'LOCKED'
    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    : status === 'REMINDER'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  return <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest ${classes}`}>{status}</span>;
}

type ManageBusinessModalProps = {
  business: Business;
  onClose: () => void;
  onChanged: () => Promise<void>;
};

export function ManageBusinessModal({ business, onClose, onChanged }: ManageBusinessModalProps) {
  const { success, error } = useToast();
  const [details, setDetails] = useState<BusinessDetails | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [billingForm, setBillingForm] = useState({
    billingStatus: billingStatusOf(business),
    amountDue: String(business.billingAmountDue || ''),
    dueAt: dateInputValue(business.billingDueAt),
    message: business.billingMessage || '',
  });

  const loadDetails = async () => {
    const next = await BusinessAdminService.details(business.id);
    setDetails(next);
    setBillingForm({
      billingStatus: next.billing.billingStatus,
      amountDue: next.billing.amountDue ? String(next.billing.amountDue) : '',
      dueAt: dateInputValue(next.billing.dueAt),
      message: next.billing.message || '',
    });
  };

  useEffect(() => {
    loadDetails().catch(() => error('Could not load business details.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  const users = details?.users || [];
  const loginAttempts = details?.loginAttempts || [];
  const payments = details?.billingPayments || [];

  const handleResetPassword = async (userId: string, userName: string) => {
    if (!confirm(`Reset password for ${userName} to the Cloudflare bootstrap password and require setup on next login?`)) return;
    setIsProcessing(true);
    try {
      await StaffService.resetPassword({ userId, businessId: business.id });
      await loadDetails();
      success(`Password reset for ${userName}. Share the Cloudflare bootstrap password outside the app.`);
    } catch (err: any) {
      error(err?.message || 'Reset failed.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveBilling = async () => {
    setIsProcessing(true);
    try {
      const next = await BusinessAdminService.updateBilling({
        businessId: business.id,
        billingStatus: billingForm.billingStatus,
        amountDue: Number(billingForm.amountDue) || 0,
        dueAt: dateFromInput(billingForm.dueAt),
        message: billingForm.message,
      });
      setDetails(next);
      await onChanged();
      success('Billing status updated.');
    } catch (err: any) {
      error(err?.message || 'Could not update billing.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkPaid = async () => {
    if (!confirm(`Mark ${business.name} as paid and unlock the business?`)) return;
    setIsProcessing(true);
    try {
      const next = await BusinessAdminService.markPaid({ businessId: business.id });
      setDetails(next);
      await onChanged();
      success('Business marked paid and unlocked.');
    } catch (err: any) {
      error(err?.message || 'Could not mark paid.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearLockouts = async () => {
    if (!confirm(`Clear failed-login lockouts for ${business.name}?`)) return;
    setIsProcessing(true);
    try {
      const next = await BusinessAdminService.clearLoginLockouts({ businessId: business.id });
      setDetails(next);
      success('Login lockouts cleared.');
    } catch (err: any) {
      error(err?.message || 'Could not clear login lockouts.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 animate-in fade-in bg-slate-950/80 backdrop-blur-xl" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/50 p-5 sm:p-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck size={30} strokeWidth={2.4} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="truncate text-xl font-black text-white sm:text-2xl">{details?.business.name || business.name}</h3>
                <BillingPill status={details?.billing.billingStatus || billingStatusOf(business)} />
              </div>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Business code {business.code}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-all hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-8">
          <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-black uppercase tracking-tight text-white">Late payment controls</h4>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">Reminder keeps POS open. Locked blocks business writes until paid.</p>
              </div>
              <button
                onClick={handleMarkPaid}
                disabled={isProcessing}
                className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-300 transition-all hover:bg-emerald-500 hover:text-white disabled:opacity-50"
              >
                Mark paid
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-[10rem_1fr_1fr]">
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Status</span>
                <select
                  value={billingForm.billingStatus}
                  onChange={event => setBillingForm(prev => ({ ...prev, billingStatus: event.target.value as BusinessBillingStatus }))}
                  className="h-12 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 text-sm font-bold text-white outline-none focus:border-primary"
                >
                  {billingOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Amount due</span>
                <input
                  type="number"
                  min="0"
                  value={billingForm.amountDue}
                  onChange={event => setBillingForm(prev => ({ ...prev, amountDue: event.target.value }))}
                  className="h-12 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 text-sm font-bold text-white outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Due date</span>
                <input
                  type="date"
                  value={billingForm.dueAt}
                  onChange={event => setBillingForm(prev => ({ ...prev, dueAt: event.target.value }))}
                  className="h-12 w-full rounded-xl border border-slate-800 bg-slate-900 px-4 text-sm font-bold text-white outline-none focus:border-primary"
                />
              </label>
            </div>
            <label className="mt-3 block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Owner message</span>
              <textarea
                rows={3}
                value={billingForm.message}
                onChange={event => setBillingForm(prev => ({ ...prev, message: event.target.value }))}
                className="w-full resize-none rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary"
                placeholder="Payment is overdue. Please pay to keep Smart POS active."
              />
            </label>
            <button
              onClick={handleSaveBilling}
              disabled={isProcessing}
              className="mt-4 w-full rounded-xl bg-primary py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-container disabled:opacity-50"
            >
              Save billing status
            </button>
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_20rem]">
            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="text-sm font-black uppercase tracking-tight text-white">Users</h4>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{users.length} users</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {users.map(user => (
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
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">Setup required</span>
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
                      <KeyRound size={20} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5">
              <h4 className="text-sm font-black uppercase tracking-tight text-white">Recent billing</h4>
              <div className="mt-4 space-y-3">
                {payments.slice(0, 5).map(payment => (
                  <div key={payment.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-white">{money(payment.amount)}</p>
                      <span className="rounded-full bg-slate-950 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-slate-400">{payment.status}</span>
                    </div>
                    <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{payment.receiptNumber || payment.checkoutRequestId || payment.reference || 'Manual'}</p>
                  </div>
                ))}
                {payments.length === 0 && <p className="rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm font-bold text-slate-500">No billing payments yet.</p>}
              </div>
            </section>
          </div>

          <section className="mt-5 flex items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-950 p-5">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-tight text-white">Login safety</h4>
              <p className="mt-1 text-[11px] font-medium text-slate-500">
                {loginAttempts.length ? `${loginAttempts.length} login lockout record${loginAttempts.length === 1 ? '' : 's'}` : 'No login problems.'}
              </p>
            </div>
            {loginAttempts.length > 0 && (
              <button
                onClick={handleClearLockouts}
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

  const stats = useMemo(() => {
    const rows = businesses || [];
    return {
      total: rows.length,
      reminders: rows.filter(row => billingStatusOf(row) === 'REMINDER').length,
      locked: rows.filter(row => billingStatusOf(row) === 'LOCKED').length,
    };
  }, [businesses]);

  const reloadBusinesses = async () => {
    await db.businesses.reload();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code) return;
    const trimmedCode = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(trimmedCode)) {
      alert('Business code must be 3-20 alphanumeric characters (A-Z, 0-9).');
      return;
    }
    try {
      await BusinessAdminService.create({ name: form.name.trim(), code: trimmedCode });
      setForm({ name: '', code: '' });
      await reloadBusinesses();
      alert('Business created. Login username is admin. Share the Cloudflare BUSINESS_BOOTSTRAP_PASSWORD with the owner outside the app.');
    } catch (err: any) {
      console.error(err);
      alert(`Failed to create business: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="h-[100dvh] overflow-y-auto bg-slate-950 p-4 font-hanken text-white animate-in fade-in sm:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
              <UserRound className="text-white" size={30} strokeWidth={2.4} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">System admin</h1>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Business access and billing</p>
            </div>
          </div>
          <button onClick={onLogout} className="rounded-xl border border-error/20 bg-error/10 px-6 py-2 text-xs font-bold text-error transition-all hover:bg-error hover:text-white">Sign out</button>
        </div>

        <section className="mb-8 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Businesses', value: stats.total, Icon: Store },
            { label: 'Reminders', value: stats.reminders, Icon: AlertTriangle },
            { label: 'Locked', value: stats.locked, Icon: LockKeyhole },
          ].map(item => {
            const Icon = item.Icon;
            return (
              <div key={item.label} className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{item.label}</p>
                  <Icon size={18} className="text-slate-600" />
                </div>
                <p className="text-3xl font-black">{item.value}</p>
              </div>
            );
          })}
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6 shadow-xl sm:p-8">
            <h3 className="mb-6 flex items-center gap-3 text-lg font-black">
              <Building2 className="text-primary" size={22} />
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
                  <Store className="text-secondary" size={22} />
                  Businesses
                </h3>
                <div className="rounded-full border border-slate-800 bg-slate-950 px-4 py-1.5 text-[10px] font-bold text-slate-500">
                  {stats.total} businesses
                </div>
              </div>

              <div className="min-h-[420px] space-y-4 pr-1">
                {businesses?.map(business => {
                  const status = billingStatusOf(business);
                  return (
                    <div key={business.id} className="rounded-3xl border border-slate-800 bg-slate-950 p-5 transition-all hover:border-primary/50">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-primary transition-all">
                            {status === 'LOCKED' ? <LockKeyhole size={20} /> : status === 'REMINDER' ? <Clock size={20} /> : <CheckCircle2 size={20} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <p className="truncate text-base font-black">{business.name}</p>
                              <BillingPill status={status} />
                            </div>
                            <div className="mt-1 flex flex-wrap gap-3 text-[10px] font-mono uppercase tracking-widest text-slate-500">
                              <span>Code: {business.code}</span>
                              {Number(business.billingAmountDue || 0) > 0 && <span className="flex items-center gap-1"><Banknote size={12} /> {money(business.billingAmountDue)}</span>}
                            </div>
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
                  );
                })}
                {(!businesses || businesses.length === 0) && (
                  <div className="flex h-64 flex-col items-center justify-center text-slate-700">
                    <CloudOff className="mb-2" size={36} />
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
          onChanged={reloadBusinesses}
        />
      )}
    </div>
  );
}
