import React, { useEffect, useMemo, useState } from 'react';
import { db, type Business, type BusinessSettings } from '../../db';
import { useLiveQuery } from '../../clouddb';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { resetAttempts } from '../../security';
import { BillingService, type BillingDiscountType, type BillingSummaryRow } from '../../services/billing';
import { getApiKey } from '../../runtimeConfig';
import { Building2, Bot, CloudOff, KeyRound, Network, ReceiptText, ShieldCheck, Store, UserRound, X } from 'lucide-react';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => {
  const icons: Record<string, React.ElementType> = {
    add_business: Building2,
    admin_panel_settings: ShieldCheck,
    close: X,
    cloud_off: CloudOff,
    smart_toy: Bot,
    hub: Network,
    key_reset: KeyRound,
    receipt_long: ReceiptText,
    shield_person: UserRound,
    storefront: Store,
  };
  const Icon = icons[name] || ShieldCheck;
  const size = className.includes('text-4xl') ? 36 : className.includes('text-3xl') ? 30 : 20;
  return <Icon className={className} size={size} strokeWidth={2.4} />;
};

const defaultBannerMessage = 'Your Mtaani POS software subscription is due. Pay by M-Pesa to keep your account current.';
const DEFAULT_AI_LIMIT = 20;

function defaultBusinessSettings(business: Business): BusinessSettings {
  return {
    id: `core_${business.id}`,
    storeName: business.name,
    location: 'Nairobi, Kenya',
    tillNumber: '',
    kraPin: '',
    receiptFooter: 'Thank you for shopping!',
    ownerModeEnabled: 0,
    autoApproveOwnerActions: 1,
    cashSweepEnabled: 1,
    cashDrawerLimit: 5000,
    cashFloatTarget: 1000,
    aiAssistantEnabled: 1,
    aiDailyRequestLimit: DEFAULT_AI_LIMIT,
    businessId: business.id,
    updated_at: Date.now(),
  };
}

async function fetchBusinessSettingsForRoot(business: Business): Promise<BusinessSettings> {
  const apiKey = await getApiKey();
  const res = await fetch('/api/data/settings', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Business-ID': business.id,
    },
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Could not load AI settings (${res.status}).`);
  const rows = await res.json().catch(() => []) as BusinessSettings[];
  return rows.find(row => row.id === `core_${business.id}`) || rows[0] || defaultBusinessSettings(business);
}

async function saveBusinessSettingsForRoot(settings: BusinessSettings) {
  const apiKey = await getApiKey();
  const res = await fetch('/api/data/settings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Business-ID': settings.businessId,
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify([{ ...settings, updated_at: Date.now() }]),
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Could not save AI settings (${res.status}).`);
  }
}

function money(value: unknown) {
  return `Ksh ${Math.round(Number(value) || 0).toLocaleString()}`;
}

function invoiceStatusClass(status?: string) {
  if (status === 'PAID') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (status === 'PARTIAL') return 'bg-amber-500/10 text-amber-300 border-amber-500/20';
  return 'bg-rose-500/10 text-rose-300 border-rose-500/20';
}

function sentenceValue(value: unknown, fallback = '') {
  const text = String(value || fallback).replace(/_/g, ' ').toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function temporaryPassword(length = 12) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

type ManageBusinessModalProps = {
  business: Business;
  billingRow?: BillingSummaryRow;
  onBillingChanged?: () => Promise<void> | void;
  onClose: () => void;
};

export function ManageBusinessModal({ business, billingRow, onBillingChanged, onClose }: ManageBusinessModalProps) {
  const users = useLiveQuery(() => db.users.where('businessId').equals(business.id).toArray(), [business.id], []);
  const lockout = useLiveQuery(() => db.loginAttempts.get(business.code.toUpperCase()), [business.code], null);
  const { success, error } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [billingForm, setBillingForm] = useState({
    monthlyBaseFee: 3000,
    pricePerBranch: 500,
    discountType: 'FIXED' as BillingDiscountType,
    discountValue: 0,
    dueDay: 5,
    bannerEnabled: false,
    bannerMessage: defaultBannerMessage,
    allowPartial: true,
    minPaymentAmount: 500,
    status: 'ACTIVE',
  });
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'MPESA',
    receiptNumber: '',
    notes: '',
  });
  const [aiSourceSettings, setAiSourceSettings] = useState<BusinessSettings | null>(null);
  const [aiForm, setAiForm] = useState({
    enabled: true,
    dailyLimit: String(DEFAULT_AI_LIMIT),
  });
  const [isAiLoading, setIsAiLoading] = useState(false);

  const invoice = billingRow?.invoice;
  const branchCount = billingRow?.branchCount ?? invoice?.branchCount ?? 0;
  const balance = Math.max(0, Number(invoice?.balance || 0));

  useEffect(() => {
    const account = billingRow?.account;
    if (!account) return;
    setBillingForm({
      monthlyBaseFee: Number(account.monthlyBaseFee || 0),
      pricePerBranch: Number(account.pricePerBranch || 0),
      discountType: account.discountType === 'PERCENT' ? 'PERCENT' : 'FIXED',
      discountValue: Number(account.discountValue || 0),
      dueDay: Number(account.dueDay || 5),
      bannerEnabled: Boolean(account.bannerEnabled),
      bannerMessage: account.bannerMessage || defaultBannerMessage,
      allowPartial: Boolean(account.allowPartial),
      minPaymentAmount: Number(account.minPaymentAmount || 500),
      status: account.status || 'ACTIVE',
    });
  }, [billingRow?.account]);

  useEffect(() => {
    setPaymentForm((prev) => ({
      ...prev,
      amount: balance > 0 ? String(Math.ceil(balance)) : '',
    }));
  }, [balance, business.id]);

  useEffect(() => {
    let cancelled = false;
    setIsAiLoading(true);
    fetchBusinessSettingsForRoot(business)
      .then((settings) => {
        if (cancelled) return;
        setAiSourceSettings(settings);
        setAiForm({
          enabled: settings.aiAssistantEnabled !== 0,
          dailyLimit: String(settings.aiDailyRequestLimit ?? DEFAULT_AI_LIMIT),
        });
      })
      .catch((err) => {
        if (!cancelled) error(err?.message || 'Could not load AI settings.');
      })
      .finally(() => {
        if (!cancelled) setIsAiLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [business.id]);

  const handleResetPassword = async (userId: string, userName: string) => {
    if (!confirm(`Reset password for ${userName}?`)) return;
    setIsProcessing(true);
    try {
      const newPassword = temporaryPassword();
      await db.users.update(userId, { password: newPassword, updated_at: Date.now() });
      success(`Temporary password for ${userName}: ${newPassword}`);
    } catch (err) {
      error('Reset failed');
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
    } catch (err) {
      error('Could not unlock login.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveBilling = async () => {
    setIsProcessing(true);
    const data = await BillingService.saveAccount({
      businessId: business.id,
      monthlyBaseFee: Math.max(0, Number(billingForm.monthlyBaseFee || 0)),
      pricePerBranch: Math.max(0, Number(billingForm.pricePerBranch || 0)),
      discountType: billingForm.discountType,
      discountValue: Math.max(0, Number(billingForm.discountValue || 0)),
      dueDay: Math.min(28, Math.max(1, Number(billingForm.dueDay || 5))),
      bannerEnabled: billingForm.bannerEnabled ? 1 : 0,
      bannerMessage: billingForm.bannerMessage || defaultBannerMessage,
      allowPartial: billingForm.allowPartial ? 1 : 0,
      minPaymentAmount: Math.max(1, Number(billingForm.minPaymentAmount || 1)),
      status: billingForm.status || 'ACTIVE',
    });
    setIsProcessing(false);
    if (data.error) return error(data.error);
    success('Billing settings saved.');
    await onBillingChanged?.();
  };

  const handleRegenerateInvoice = async () => {
    setIsProcessing(true);
    const data = await BillingService.generateInvoice(business.id);
    setIsProcessing(false);
    if (data.error) return error(data.error);
    success('Current bill recalculated.');
    await onBillingChanged?.();
  };

  const handleRecordPayment = async () => {
    const amount = Number(paymentForm.amount);
    if (amount <= 0) return error('Enter a valid payment amount.');
    setIsProcessing(true);
    const data = await BillingService.recordPayment({
      businessId: business.id,
      amount,
      method: paymentForm.method,
      receiptNumber: paymentForm.receiptNumber,
      notes: paymentForm.notes,
      recordedBy: 'System Admin',
      period: invoice?.period,
    });
    setIsProcessing(false);
    if (data.error) return error(data.error);
    success(`Recorded ${money(amount)} software payment.`);
    setPaymentForm({ amount: '', method: 'MPESA', receiptNumber: '', notes: '' });
    await onBillingChanged?.();
  };

  const handleSaveAi = async () => {
    const dailyLimit = Math.min(200, Math.max(1, Number(aiForm.dailyLimit) || DEFAULT_AI_LIMIT));
    setIsProcessing(true);
    try {
      const base = aiSourceSettings || defaultBusinessSettings(business);
      const next: BusinessSettings = {
        ...base,
        id: base.id || `core_${business.id}`,
        businessId: business.id,
        storeName: base.storeName || business.name,
        location: base.location || 'Nairobi, Kenya',
        tillNumber: base.tillNumber || '',
        kraPin: base.kraPin || '',
        receiptFooter: base.receiptFooter || 'Thank you for shopping!',
        aiAssistantEnabled: aiForm.enabled ? 1 : 0,
        aiDailyRequestLimit: dailyLimit,
      };
      await saveBusinessSettingsForRoot(next);
      setAiSourceSettings(next);
      setAiForm({ enabled: next.aiAssistantEnabled !== 0, dailyLimit: String(next.aiDailyRequestLimit ?? DEFAULT_AI_LIMIT) });
      success(`AI allowance saved for ${business.name}.`);
    } catch (err: any) {
      error(err?.message || 'Could not save AI allowance.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl animate-in fade-in" onClick={onClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-900 shadow-2xl animate-in zoom-in-95 sm:rounded-[3rem]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-900/50 p-5 sm:p-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-16 sm:w-16">
              <MaterialIcon name="admin_panel_settings" className="text-3xl" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-xl font-black text-white sm:text-2xl">{business.name}</h3>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Business settings | {business.code}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-800 text-slate-400 transition-all hover:text-white">
            <MaterialIcon name="close" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-8">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 lg:col-span-1">
              <h4 className="mb-4 text-[10px] font-black uppercase tracking-widest text-slate-500">Current bill</h4>
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Branches</p>
                  <p className="mt-1 text-3xl font-black text-white">{branchCount}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Paid</p>
                    <p className="mt-1 text-sm font-black text-emerald-300">{money(invoice?.amountPaid || 0)}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Balance</p>
                    <p className="mt-1 text-sm font-black text-blue-300">{money(balance)}</p>
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{invoice?.period || 'Current period'}</p>
                    <span className={`rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-widest ${invoiceStatusClass(invoice?.status)}`}>
                      {sentenceValue(invoice?.status, 'Pending')}
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-black text-white">{money(invoice?.totalDue || 0)}</p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">
                    Due {invoice?.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'this month'}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 lg:col-span-2">
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h4 className="text-sm font-black uppercase tracking-tight text-white">Software billing rules</h4>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500">Bill by monthly fee plus active branch count, then apply discounts.</p>
                </div>
                <button
                  onClick={handleRegenerateInvoice}
                  disabled={isProcessing}
                  className="rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-blue-200 transition-all hover:bg-blue-600 hover:text-white disabled:opacity-50"
                >
                  Recalculate bill
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Monthly fee</span>
                  <input type="number" min="0" value={billingForm.monthlyBaseFee} onChange={(e) => setBillingForm({ ...billingForm, monthlyBaseFee: Number(e.target.value) })} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                </label>
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Price per branch</span>
                  <input type="number" min="0" value={billingForm.pricePerBranch} onChange={(e) => setBillingForm({ ...billingForm, pricePerBranch: Number(e.target.value) })} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                </label>
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Discount type</span>
                  <select value={billingForm.discountType} onChange={(e) => setBillingForm({ ...billingForm, discountType: e.target.value as BillingDiscountType })} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary">
                    <option value="FIXED">Fixed amount</option>
                    <option value="PERCENT">Percent</option>
                  </select>
                </label>
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Discount value</span>
                  <input type="number" min="0" value={billingForm.discountValue} onChange={(e) => setBillingForm({ ...billingForm, discountValue: Number(e.target.value) })} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                </label>
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Due day</span>
                  <input type="number" min="1" max="28" value={billingForm.dueDay} onChange={(e) => setBillingForm({ ...billingForm, dueDay: Number(e.target.value) })} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                </label>
                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Minimum partial payment</span>
                  <input type="number" min="1" value={billingForm.minPaymentAmount} onChange={(e) => setBillingForm({ ...billingForm, minPaymentAmount: Number(e.target.value) })} className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                </label>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
                  <span className="text-xs font-bold text-slate-300">Allow partial software payments</span>
                  <input type="checkbox" checked={billingForm.allowPartial} onChange={(e) => setBillingForm({ ...billingForm, allowPartial: e.target.checked })} className="h-5 w-5 accent-primary" />
                </label>
                <label className="flex items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
                  <span className="text-xs font-bold text-slate-300">Show payment banner</span>
                  <input type="checkbox" checked={billingForm.bannerEnabled} onChange={(e) => setBillingForm({ ...billingForm, bannerEnabled: e.target.checked })} className="h-5 w-5 accent-primary" />
                </label>
              </div>

              <label className="mt-5 block">
                <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Banner message</span>
                <textarea value={billingForm.bannerMessage} onChange={(e) => setBillingForm({ ...billingForm, bannerMessage: e.target.value })} rows={3} className="mt-2 w-full resize-none rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
              </label>

              <button
                onClick={handleSaveBilling}
                disabled={isProcessing}
                className="mt-5 w-full rounded-2xl bg-primary px-5 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-primary/20 transition-all hover:bg-primary-container disabled:opacity-50"
              >
                Save billing settings
              </button>
            </section>
          </div>

          <section className="mt-5 rounded-3xl border border-blue-500/20 bg-blue-500/10 p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-200">
                  <MaterialIcon name="smart_toy" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-black uppercase tracking-tight text-white">AI allowance</h4>
                  <p className="mt-1 text-[11px] font-semibold text-blue-100/70">Only business admins can use AI. Super Admin controls the business limit.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_10rem_auto] sm:items-end">
                <button
                  type="button"
                  onClick={() => setAiForm(prev => ({ ...prev, enabled: !prev.enabled }))}
                  disabled={isAiLoading || isProcessing}
                  className={`flex h-12 min-w-44 items-center justify-between rounded-2xl border px-4 text-sm font-black disabled:opacity-50 ${aiForm.enabled ? 'border-blue-400/30 bg-blue-500/20 text-blue-100' : 'border-slate-800 bg-slate-900 text-slate-400'}`}
                >
                  {aiForm.enabled ? 'AI enabled' : 'AI disabled'}
                  <span className={`flex h-6 w-11 rounded-full p-1 ${aiForm.enabled ? 'justify-end bg-blue-500' : 'justify-start bg-slate-700'}`}>
                    <span className="h-4 w-4 rounded-full bg-white" />
                  </span>
                </button>

                <label className="block">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-blue-100/60">Daily prompts</span>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    value={aiForm.dailyLimit}
                    onChange={(e) => setAiForm(prev => ({ ...prev, dailyLimit: e.target.value }))}
                    disabled={isAiLoading || isProcessing}
                    className="mt-2 h-12 w-full rounded-2xl border border-blue-400/20 bg-slate-950 px-4 text-sm font-black text-white outline-none focus:border-blue-300 disabled:opacity-50"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleSaveAi}
                  disabled={isAiLoading || isProcessing}
                  className="h-12 rounded-2xl bg-blue-600 px-5 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-500 disabled:opacity-50"
                >
                  {isAiLoading ? 'Loading' : 'Save AI'}
                </button>
              </div>
            </div>
          </section>

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 lg:col-span-1">
              <h4 className="mb-4 text-sm font-black uppercase tracking-tight text-white">Manual payment</h4>
              <div className="space-y-3">
                <input type="number" min="1" placeholder="Amount paid" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })} className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary">
                  <option value="MPESA">M-Pesa</option>
                  <option value="BANK">Bank</option>
                  <option value="CASH">Cash</option>
                  <option value="MANUAL">Manual</option>
                </select>
                <input placeholder="Receipt or reference" value={paymentForm.receiptNumber} onChange={(e) => setPaymentForm({ ...paymentForm, receiptNumber: e.target.value })} className="w-full rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                <textarea placeholder="Notes" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} rows={3} className="w-full resize-none rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-bold text-white outline-none focus:border-primary" />
                <button onClick={handleRecordPayment} disabled={isProcessing} className="w-full rounded-2xl bg-emerald-600 px-5 py-4 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-emerald-500 disabled:opacity-50">
                  Record payment
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-800 bg-slate-950 p-5 lg:col-span-2">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h4 className="text-sm font-black uppercase tracking-tight text-white">Users</h4>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{users?.length || 0} users</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {users?.map(u => (
                  <div key={u.id} className="group flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-secondary">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-white">{u.name}</p>
                        <p className="text-[10px] font-bold uppercase tracking-tighter text-slate-500">{u.role === 'ADMIN' ? 'Admin' : u.role === 'CASHIER' ? 'Cashier' : sentenceValue(u.role)}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleResetPassword(u.id, u.name)}
                      className="rounded-xl p-2 text-slate-500 opacity-100 transition-colors hover:text-primary sm:opacity-0 sm:group-hover:opacity-100"
                      title="Reset password"
                    >
                      <MaterialIcon name="key_reset" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900 p-4">
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
                    className="rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-error transition-all hover:bg-error hover:text-white"
                  >
                    Unlock login
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SystemManagerDashboard({ onLogout }: { onLogout: () => void }) {
  const businesses = useLiveQuery(() => db.businesses.toArray(), [], []);
  const [form, setForm] = useState({ name: '', code: '' });
  const { setActiveBusinessId } = useStore();
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [billingRows, setBillingRows] = useState<BillingSummaryRow[]>([]);
  const [isBillingLoading, setIsBillingLoading] = useState(false);

  const billingByBusiness = useMemo(() => new Map(billingRows.map(row => [row.business.id, row])), [billingRows]);
  const totalBranches = billingRows.reduce((sum, row) => sum + Number(row.branchCount || 0), 0);
  const totalBalance = billingRows.reduce((sum, row) => sum + Number(row.invoice?.balance || 0), 0);
  const totalPaid = billingRows.reduce((sum, row) => sum + Number(row.invoice?.amountPaid || 0), 0);

  const loadBilling = async () => {
    setIsBillingLoading(true);
    const data = await BillingService.summary();
    setIsBillingLoading(false);
    if (data.error) {
      console.error(data.error);
      return;
    }
    setBillingRows(data.rows || []);
  };

  useEffect(() => {
    loadBilling();
  }, [businesses?.length]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code) return;
    const trimmedCode = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(trimmedCode)) {
      alert('Business code must be 3-20 alphanumeric characters (A-Z, 0-9)');
      return;
    }
    const prevBusinessId = useStore.getState().activeBusinessId;
    try {
      const newBusinessId = crypto.randomUUID();
      await db.businesses.add({
        id: newBusinessId,
        name: form.name,
        code: trimmedCode,
        isActive: 1,
        updated_at: Date.now()
      } as any);

      setActiveBusinessId(newBusinessId);
      await new Promise(r => setTimeout(r, 50));

      const adminPassword = temporaryPassword();
      await db.users.add({
        id: crypto.randomUUID(),
        name: 'admin',
        password: adminPassword,
        role: 'ADMIN',
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      await db.branches.add({
        id: crypto.randomUUID(),
        name: 'Main Branch',
        location: 'Default',
        isActive: true,
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      setForm({ name: '', code: '' });
      await BillingService.saveAccount({ businessId: newBusinessId });
      await loadBilling();
      alert(`Business created. Login: username admin, temporary password ${adminPassword}`);
    } catch (err: any) {
      console.error(err);
      alert(`Failed to create business: ${err.message || 'Unknown error'}`);
    } finally {
      setActiveBusinessId(prevBusinessId);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-white animate-in fade-in font-hanken sm:p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/20">
              <MaterialIcon name="shield_person" className="text-3xl text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">System admin</h1>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Businesses and software billing</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-3 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 md:flex">
              <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Connected</span>
            </div>
            <button onClick={onLogout} className="rounded-xl border border-error/20 bg-error/10 px-6 py-2 text-xs font-bold text-error transition-all hover:bg-error hover:text-white">Sign out</button>
          </div>
        </div>

        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Businesses</p>
            <p className="mt-2 text-3xl font-black">{businesses?.length || 0}</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Active branches</p>
            <p className="mt-2 text-3xl font-black">{totalBranches}</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Paid this month</p>
            <p className="mt-2 text-2xl font-black text-emerald-300">{money(totalPaid)}</p>
          </div>
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Outstanding</p>
            <p className="mt-2 text-2xl font-black text-blue-300">{money(totalBalance)}</p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="space-y-8 lg:col-span-1">
            <div className="rounded-[2rem] border border-slate-800 bg-slate-900 p-6 shadow-xl sm:p-8">
              <h3 className="mb-6 flex items-center gap-3 text-lg font-black">
                <MaterialIcon name="add_business" className="text-primary" />
                Add business
              </h3>
              <form onSubmit={handleCreate} className="space-y-6">
                <label className="block">
                  <span className="ml-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Business name</span>
                  <input type="text" placeholder="e.g. Mtaani Mart" className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-5 py-3 text-sm font-bold outline-none transition-all focus:border-primary" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="block">
                  <span className="ml-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Login code</span>
                  <input type="text" placeholder="e.g. MTAANI1" className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950 px-5 py-3 text-sm font-bold outline-none transition-all focus:border-primary" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
                </label>
                <button type="submit" className="w-full rounded-xl bg-primary py-4 text-xs font-black uppercase tracking-widest shadow-lg shadow-primary/20 transition-all hover:bg-primary-container active:scale-[0.98]">Save business</button>
              </form>
            </div>

            <div className="rounded-[2rem] border border-blue-500/20 bg-blue-500/10 p-6 sm:p-8">
              <div className="mb-4 flex items-center gap-4 text-blue-200">
                <MaterialIcon name="receipt_long" />
                <h4 className="text-xs font-bold uppercase tracking-wider">Billing logic</h4>
              </div>
              <p className="text-[11px] font-medium leading-relaxed text-blue-100/70">
                Each business gets a monthly bill from the base fee, active branches, branch fee, and any discount you set. Turn on the banner when you want them to pay.
              </p>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="flex h-full flex-col rounded-[2rem] border border-slate-800 bg-slate-900 p-6 shadow-xl sm:p-8">
              <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-3 text-xl font-black">
                  <MaterialIcon name="hub" className="text-secondary" />
                  Businesses
                </h3>
                <div className="rounded-full border border-slate-800 bg-slate-950 px-4 py-1.5 text-[10px] font-bold text-slate-500">
                  {isBillingLoading ? 'Loading billing...' : `${businesses?.length || 0} businesses`}
                </div>
              </div>

              <div className="min-h-[420px] flex-1 space-y-4 overflow-y-auto pr-1">
                {businesses?.map(b => {
                  const billing = billingByBusiness.get(b.id);
                  const rowBalance = billing?.invoice?.balance || 0;
                  return (
                    <div key={b.id} className="rounded-3xl border border-slate-800 bg-slate-950 p-5 transition-all hover:border-primary/50">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-4">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-primary transition-all">
                            <MaterialIcon name="storefront" />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-base font-black">{b.name}</p>
                            <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-slate-500">Code: {b.code}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedBiz(b)}
                          className="rounded-xl border border-primary/20 bg-slate-900 px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-primary transition-all hover:bg-primary hover:text-white"
                        >
                          Manage
                        </button>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Branches</p>
                          <p className="mt-1 text-sm font-black text-white">{billing?.branchCount ?? '-'}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Bill</p>
                          <p className="mt-1 text-sm font-black text-white">{money(billing?.invoice?.totalDue || 0)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Balance</p>
                          <p className="mt-1 text-sm font-black text-blue-300">{money(rowBalance)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Banner</p>
                          <p className={`mt-1 text-sm font-black ${billing?.account?.bannerEnabled ? 'text-amber-300' : 'text-slate-400'}`}>{billing?.account?.bannerEnabled ? 'On' : 'Off'}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
          billingRow={billingByBusiness.get(selectedBiz.id)}
          onBillingChanged={loadBilling}
          onClose={() => setSelectedBiz(null)}
        />
      )}
    </div>
  );
}
