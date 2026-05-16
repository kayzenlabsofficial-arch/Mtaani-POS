import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, CreditCard, Loader2, Smartphone, X } from 'lucide-react';
import { type User } from '../../db';
import { BillingService, type BillingAccount, type BillingInvoice } from '../../services/billing';

function money(value: unknown) {
  return `Ksh ${Math.round(Number(value) || 0).toLocaleString()}`;
}

type Props = {
  activeBusinessId?: string | null;
  currentUser?: User | null;
};

export default function BillingBanner({ activeBusinessId, currentUser }: Props) {
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const [invoice, setInvoice] = useState<BillingInvoice | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [paymentId, setPaymentId] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const balance = Math.max(0, Number(invoice?.balance || 0));
  const canPay = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER' || currentUser?.role === 'ROOT';
  const minPartial = Math.min(balance || 0, Math.max(1, Number(account?.minPaymentAmount || 1)));
  const paymentAmount = useMemo(() => {
    if (!invoice) return '';
    return String(Math.ceil(account?.allowPartial ? minPartial : balance));
  }, [account?.allowPartial, balance, invoice, minPartial]);

  const refreshBilling = async () => {
    if (!activeBusinessId) return;
    const data = await BillingService.current(activeBusinessId);
    if (data.error) {
      setShowBanner(false);
      return;
    }
    setAccount(data.account);
    setInvoice(data.invoice);
    setShowBanner(Boolean(data.showBanner));
  };

  useEffect(() => {
    setIsHidden(false);
    setPaymentId('');
    setStatusMessage('');
    refreshBilling();
  }, [activeBusinessId]);

  useEffect(() => {
    if (!paymentAmount || amount) return;
    setAmount(paymentAmount);
  }, [paymentAmount, amount]);

  useEffect(() => {
    if (!paymentId) return;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      const data = await BillingService.status(paymentId);
      if (data.invoice) setInvoice(data.invoice);
      if (data.payment?.status === 'PAID') {
        setStatusMessage('Payment received. Thank you.');
        setPaymentId('');
        await refreshBilling();
        window.clearInterval(timer);
      } else if (data.payment?.status === 'FAILED') {
        setStatusMessage(data.payment.resultDesc || 'Payment was not completed.');
        setPaymentId('');
        window.clearInterval(timer);
      } else if (attempts >= 48) {
        setStatusMessage('The M-Pesa request is still waiting. You can check again shortly.');
        setPaymentId('');
        window.clearInterval(timer);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paymentId]);

  const handleSendPrompt = async () => {
    if (!activeBusinessId || isSending) return;
    const numericAmount = Math.ceil(Number(amount || 0));
    if (!phone.trim()) return setStatusMessage('Enter the phone number to send the M-Pesa request.');
    if (numericAmount <= 0) return setStatusMessage('Enter a valid payment amount.');
    if (account?.allowPartial && numericAmount < minPartial) return setStatusMessage(`Minimum payment is ${money(minPartial)}.`);

    setIsSending(true);
    setStatusMessage('');
    const data = await BillingService.sendStk({
      businessId: activeBusinessId,
      phone,
      amount: numericAmount,
      period: invoice?.period,
    });
    setIsSending(false);
    if (data.error) {
      setStatusMessage(data.error);
      return;
    }
    setPaymentId(data.paymentId);
    setStatusMessage(data.message || 'M-Pesa request sent. Waiting for payment.');
  };

  if (!activeBusinessId || !invoice || !showBanner || isHidden || balance <= 0) return null;

  return (
    <>
      <section className="border-b border-blue-200 bg-blue-50 px-3 py-3 text-blue-950 sm:px-5">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <CreditCard size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black leading-snug">{account?.bannerMessage || 'Your Mtaani POS software subscription is due.'}</p>
              <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-blue-700">
                {invoice.period} bill: {money(invoice.totalDue)} | Paid {money(invoice.amountPaid)} | Remaining {money(balance)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            {canPay ? (
              <button
                onClick={() => {
                  setAmount(paymentAmount || String(Math.ceil(balance)));
                  setIsPayOpen(true);
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-blue-700/20 transition-all hover:bg-blue-800 sm:flex-none"
              >
                <Smartphone size={15} />
                Pay Software
              </button>
            ) : (
              <span className="rounded-xl bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-blue-700">Ask admin to pay</span>
            )}
            <button
              onClick={() => setIsHidden(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-blue-700 transition-colors hover:bg-blue-100"
              aria-label="Hide billing banner"
            >
              <X size={17} />
            </button>
          </div>
        </div>
      </section>

      {isPayOpen && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:items-center">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-blue-700 px-6 py-5 text-white">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-100">Software Billing</p>
                <h3 className="mt-1 text-xl font-black">Pay {money(balance)}</h3>
              </div>
              <button onClick={() => setIsPayOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-5 p-6">
              <div className="grid grid-cols-3 gap-3 rounded-2xl bg-slate-50 p-4 text-center">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Due</p>
                  <p className="mt-1 text-xs font-black text-slate-900">{money(invoice.totalDue)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Paid</p>
                  <p className="mt-1 text-xs font-black text-emerald-600">{money(invoice.amountPaid)}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Balance</p>
                  <p className="mt-1 text-xs font-black text-blue-700">{money(balance)}</p>
                </div>
              </div>

              <label className="block">
                <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Customer Phone</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="2547..."
                  inputMode="tel"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-bold outline-none focus:border-blue-500"
                />
              </label>

              <label className="block">
                <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-500">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  readOnly={!account?.allowPartial}
                  inputMode="numeric"
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm font-bold outline-none focus:border-blue-500 read-only:bg-slate-50"
                />
                {account?.allowPartial ? (
                  <span className="mt-2 block text-[11px] font-semibold text-slate-500">Minimum partial payment is {money(minPartial)}.</span>
                ) : (
                  <span className="mt-2 block text-[11px] font-semibold text-slate-500">This bill must be paid in full.</span>
                )}
              </label>

              {statusMessage && (
                <div className="flex items-start gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                  {paymentId ? <Loader2 size={16} className="animate-spin text-blue-600" /> : statusMessage.toLowerCase().includes('received') ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-blue-600" />}
                  <span>{statusMessage}</span>
                </div>
              )}

              <button
                onClick={handleSendPrompt}
                disabled={isSending || Boolean(paymentId)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-700 px-5 py-4 text-xs font-black uppercase tracking-widest text-white transition-all hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending || paymentId ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />}
                {paymentId ? 'Waiting for Payment' : 'Send M-Pesa Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
