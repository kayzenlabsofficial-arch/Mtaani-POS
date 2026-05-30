import { AlertTriangle, CreditCard, LockKeyhole, LogOut, RefreshCw, Smartphone } from 'lucide-react';
import type { BillingInfo, BillingPaymentMethod } from '../../services/billing';

type BillingPayProps = {
  method: BillingPaymentMethod;
  setMethod: (value: BillingPaymentMethod) => void;
  phone: string;
  setPhone: (value: string) => void;
  onPay: () => void;
  isPaying: boolean;
  paymentMessage?: string;
};

type BillingNoticeProps = {
  billing: BillingInfo;
  isAdmin: boolean;
  payment: BillingPayProps;
};

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

function dueText(value?: number | null) {
  if (!value) return '';
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PaymentControls({ payment }: { payment: BillingPayProps }) {
  const methods: Array<{ id: BillingPaymentMethod; label: string; Icon: typeof Smartphone }> = [
    { id: 'PESAPAL', label: 'PesaPal', Icon: CreditCard },
    { id: 'MPESA', label: 'Direct STK', Icon: Smartphone },
  ];
  const isPesaPal = payment.method === 'PESAPAL';

  return (
    <div className="grid w-full gap-2">
      <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-white p-1">
        {methods.map(({ id, label, Icon }) => {
          const active = payment.method === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => payment.setMethod(id)}
              className={`flex h-9 items-center justify-center gap-2 rounded-md px-2 text-[11px] font-black uppercase tracking-widest transition ${
                active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(12rem,18rem)_auto]">
        <input
          value={payment.phone}
          onChange={event => payment.setPhone(event.target.value)}
          placeholder={isPesaPal ? 'M-Pesa phone' : 'Safaricom phone'}
          className="h-11 rounded-lg border border-amber-300 bg-white px-4 text-sm font-bold text-slate-950 outline-none placeholder:text-slate-400 focus:border-amber-600"
        />
        <button
          type="button"
          onClick={payment.onPay}
          disabled={payment.isPaying}
          className="flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-xs font-black uppercase tracking-widest text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {payment.isPaying ? <RefreshCw className="h-4 w-4 animate-spin" /> : isPesaPal ? <CreditCard className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
          {isPesaPal ? 'Open PesaPal' : 'Send STK'}
        </button>
      </div>
    </div>
  );
}

export function BillingBanner({ billing, isAdmin, payment }: BillingNoticeProps) {
  const isLocked = billing.billingStatus === 'LOCKED';
  return (
    <div className={`border-b px-3 py-3 sm:px-6 ${isLocked ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isLocked ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
            {isLocked ? <LockKeyhole size={18} /> : <AlertTriangle size={18} />}
          </span>
          <div className="min-w-0">
            <p className={`text-sm font-black ${isLocked ? 'text-rose-950' : 'text-amber-950'}`}>
              {isLocked ? 'Business locked for late payment' : 'Payment reminder'}
            </p>
            <p className={`mt-0.5 text-xs font-semibold ${isLocked ? 'text-rose-700' : 'text-amber-700'}`}>
              {billing.message || 'Please make the pending Smart POS payment.'}
              {billing.amountDue > 0 ? ` Amount due: ${money(billing.amountDue)}.` : ''}
              {billing.dueAt ? ` Due: ${dueText(billing.dueAt)}.` : ''}
            </p>
            {payment.paymentMessage && <p className="mt-1 text-xs font-black text-slate-700">{payment.paymentMessage}</p>}
          </div>
        </div>
        {isAdmin ? (
          <div className="lg:w-[28rem]">
            <PaymentControls payment={payment} />
          </div>
        ) : (
          <p className={`text-xs font-black uppercase tracking-widest ${isLocked ? 'text-rose-700' : 'text-amber-700'}`}>Ask the business owner to pay</p>
        )}
      </div>
    </div>
  );
}

export function BillingLockScreen({
  billing,
  isAdmin,
  payment,
  onLogout,
}: BillingNoticeProps & { onLogout: () => void }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-950 p-5 font-hanken text-white">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300">
              <LockKeyhole size={24} />
            </span>
            <div>
              <p className="text-lg font-black">Business locked</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Late payment</p>
            </div>
          </div>
          <button onClick={onLogout} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-800 text-slate-400 hover:text-white" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4">
          <p className="text-sm font-bold leading-relaxed text-rose-100">
            {billing.message || 'This account is locked because payment is overdue.'}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-950/70 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Amount due</p>
              <p className="mt-1 text-lg font-black tabular-nums">{money(billing.amountDue)}</p>
            </div>
            <div className="rounded-lg bg-slate-950/70 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Due date</p>
              <p className="mt-1 text-lg font-black">{dueText(billing.dueAt) || 'Now'}</p>
            </div>
          </div>
        </div>

        {isAdmin ? (
          <div className="mt-5 space-y-3">
            <PaymentControls payment={payment} />
            {payment.paymentMessage && <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm font-bold text-slate-300">{payment.paymentMessage}</p>}
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-slate-800 bg-slate-950 p-4 text-sm font-bold text-slate-400">
            Ask the business owner or administrator to make the payment.
          </p>
        )}
      </div>
    </div>
  );
}
