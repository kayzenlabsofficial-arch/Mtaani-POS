import React, { useRef, useState } from 'react';
import { Banknote, CreditCard, Search, Smartphone, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import MobileModal from '../shared/MobileModal';
import { MpesaService } from '../../services/mpesa';
import { belongsToActiveShop } from '../../utils/shopScope';
import { calculateCartTotals } from '../../utils/productPricing';
import { CartLineItem, MaterialIcon } from './RegisterSharedMobile';
import type { CheckoutOptions, RegisterCheckoutHandler } from './types';

export default function RegisterPaymentPanelMobile({
  onCheckout,
  isCheckingOut,
  canCheckout = true,
  className = '',
  onCheckoutSuccess,
  showCartItems = true,
}: {
  onCheckout: RegisterCheckoutHandler;
  isCheckingOut: boolean;
  canCheckout?: boolean;
  className?: string;
  onCheckoutSuccess?: () => void;
  showCartItems?: boolean;
}) {
  const { cart, removeFromCart, updateQuantity, setQuantity, clearCart } = useStore();
  const activeBusinessId = useStore((state) => state.activeBusinessId);
  const activeShopId = useStore((state) => state.activeShopId);
  const { warning, error, success } = useToast();
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'MPESA' | 'CREDIT'>('CASH');
  const [paymentWindow, setPaymentWindow] = useState<'CASH' | 'MPESA' | 'CREDIT' | null>(null);
  const [cashTendered, setCashTendered] = useState('');
  const [mpesaRef, setMpesaRef] = useState('');
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaVerification, setMpesaVerification] = useState<any | null>(null);
  const [isVerifyingMpesa, setIsVerifyingMpesa] = useState(false);
  const [mpesaState, setMpesaState] = useState<'IDLE' | 'PUSHING' | 'POLLING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [mpesaTab, setMpesaTab] = useState<'STK' | 'VERIFY' | 'MANUAL' | 'CASH'>('STK');
  const [mpesaManualAmount, setMpesaManualAmount] = useState('');
  const [mpesaCashDeduct, setMpesaCashDeduct] = useState('');
  const [mpesaAppliedCash, setMpesaAppliedCash] = useState(0);
  const checkoutLockRef = useRef(false);
  const mpesaIntervalRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  const customers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).filter(customer => belongsToActiveShop(customer, activeShopId)).sortBy('name') : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );

  const { subtotal, discountAmount, total } = calculateCartTotals(cart);
  const itemCount = cart.reduce((sum, item) => sum + (Number(item.cartQuantity) || 0), 0);
  const tendered = Number(cashTendered) || 0;
  const changeDue = Math.max(0, tendered - total);
  const selectedCustomer = customers?.find((customer: any) => customer.id === selectedCustomerId);
  const customerTerm = customerSearch.trim().toLowerCase();
  const filteredCreditCustomers = (customers || []).filter((customer: any) => {
    if (!customerTerm) return true;
    return `${customer.name || ''} ${customer.phone || ''} ${customer.email || ''}`.toLowerCase().includes(customerTerm);
  });
  const mpesaCashInputAmount = Math.min(Math.max(Number(mpesaCashDeduct) || 0, 0), total);
  const mpesaAppliedCashAmount = Math.min(Math.max(mpesaAppliedCash || 0, 0), total);
  const mpesaBalanceDue = Math.max(0, total - mpesaAppliedCashAmount);
  const hasMpesaCashSplit = mpesaAppliedCashAmount > 0;

  const paymentOptions = [
    { id: 'CASH' as const, label: 'Cash', icon: Banknote },
    { id: 'MPESA' as const, label: 'M-Pesa', icon: Smartphone },
    { id: 'CREDIT' as const, label: 'Credit', icon: CreditCard },
  ];
  const normaliseMpesaCode = (value: string) => value.replace(/\s+/g, '').trim().toUpperCase();
  const mpesaIsWaiting = mpesaState === 'PUSHING' || mpesaState === 'POLLING';

  const baseOptions = (): CheckoutOptions => ({
    subtotal,
    total,
    discountAmount,
    discountType: 'PRODUCT',
    customerId: selectedCustomer?.id,
    customerName: selectedCustomer?.name,
  });

  const runCheckout = async (status: 'PAID' | 'UNPAID', method: string, options?: CheckoutOptions) => {
    const result = await onCheckout(status, method, options);
    if (result) {
      setPaymentMode('CASH');
      setPaymentWindow(null);
      setCashTendered('');
      setMpesaRef('');
      setMpesaPhone('');
      setMpesaVerification(null);
      setMpesaState('IDLE');
      setSelectedCustomerId('');
      setCustomerSearch('');
      setMpesaTab('STK');
      setMpesaManualAmount('');
      setMpesaCashDeduct('');
      setMpesaAppliedCash(0);
      onCheckoutSuccess?.();
    }
    return result;
  };

  React.useEffect(() => {
    if (cart.length === 0) setPaymentWindow(null);
  }, [cart.length]);

  React.useEffect(() => {
    if (!canCheckout) setPaymentWindow(null);
  }, [canCheckout]);

  React.useEffect(() => {
    setMpesaVerification(null);
  }, [mpesaRef, mpesaBalanceDue]);

  React.useEffect(() => {
    if (mpesaAppliedCash > 0 && mpesaAppliedCash >= total) setMpesaAppliedCash(0);
  }, [mpesaAppliedCash, total]);

  React.useEffect(() => {
    return () => {
      if (mpesaIntervalRef.current !== null) {
        window.clearInterval(mpesaIntervalRef.current);
        mpesaIntervalRef.current = null;
      }
    };
  }, []);

  const verifyMpesaCode = async (rawCode = mpesaRef, expectedAmount = total) => {
    if (!activeBusinessId || !activeShopId) {
      error('The shop is still loading. Try again.');
      return null;
    }
    const code = normaliseMpesaCode(rawCode);
    if (!code) {
      warning('Enter the M-Pesa receipt code first.');
      return null;
    }
    setIsVerifyingMpesa(true);
    try {
      const res = await MpesaService.verifyPayment(code, expectedAmount, activeBusinessId, activeShopId);
      setMpesaVerification(res);
      if (res.usable) success(`M-Pesa verified: ${res.receiptNumber || code}`);
      else warning(res.message || res.error || 'M-Pesa payment is not ready to use.');
      return res;
    } finally {
      setIsVerifyingMpesa(false);
    }
  };

  const ensureMpesaUsable = async (rawCode: string, expectedAmount: number) => {
    const code = normaliseMpesaCode(rawCode);
    const verifiedCode = normaliseMpesaCode(mpesaVerification?.receiptNumber || mpesaVerification?.checkoutRequestId || '');
    if (mpesaVerification?.usable && verifiedCode === code && Number(mpesaVerification.expectedAmount || expectedAmount) === expectedAmount) return mpesaVerification;
    return verifyMpesaCode(code, expectedAmount);
  };

  const mpesaCheckoutDetails = (receipt: string, extra: Partial<CheckoutOptions> = {}) => {
    const options: CheckoutOptions = { ...baseOptions(), ...extra, mpesaRef: receipt, paymentReference: receipt };
    if (!hasMpesaCashSplit) return { method: 'MPESA', options };
    return {
      method: 'SPLIT',
      options: {
        ...options,
        amountTendered: mpesaAppliedCashAmount,
        changeGiven: 0,
        splitPayments: {
          cashAmount: mpesaAppliedCashAmount,
          secondaryAmount: mpesaBalanceDue,
          secondaryMethod: 'MPESA' as const,
          secondaryReference: receipt,
        },
      },
    };
  };

  const pollMpesaAndComplete = (
    requestId: string,
    expectedAmount = total,
    completeWith?: (receipt: string, res: any, requestId: string) => { status: 'PAID' | 'UNPAID'; method: string; options: CheckoutOptions }
  ) => {
    if (mpesaIntervalRef.current !== null) window.clearInterval(mpesaIntervalRef.current);
    let attempts = 0;
    const maxAttempts = 48;
    mpesaIntervalRef.current = window.setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        window.clearInterval(mpesaIntervalRef.current!);
        mpesaIntervalRef.current = null;
        setMpesaState('FAILED');
        error('M-Pesa request timed out. Check if the customer paid.');
        return;
      }
      const res = await MpesaService.checkStatus(requestId);
      const resultCode = Number(res.resultCode);
      const isPending = !Number.isFinite(resultCode) || resultCode === 999 || String(res.resultDesc || '').toUpperCase() === 'PENDING';
      if (res.found && resultCode === 0) {
        window.clearInterval(mpesaIntervalRef.current!);
        mpesaIntervalRef.current = null;
        const receipt = res.receiptNumber || requestId;
        setMpesaRef(receipt);
        setMpesaVerification({
          found: true,
          paid: true,
          usable: true,
          utilizationStatus: 'UNUTILIZED',
          paymentStatus: 'PAID',
          receiptNumber: receipt,
          checkoutRequestId: requestId,
          amount: Number(res.amount || expectedAmount),
          expectedAmount,
          amountOk: true,
          phoneNumber: res.phoneNumber,
        });
        setMpesaState('SUCCESS');
        const completion = completeWith?.(receipt, res, requestId) || {
          status: 'PAID' as const,
          method: 'MPESA',
          options: {
            ...baseOptions(),
            mpesaRef: receipt,
            paymentReference: receipt,
            mpesaCheckoutRequestId: requestId,
            mpesaCustomer: res.phoneNumber,
          },
        };
        await runCheckout(completion.status, completion.method, completion.options);
        success(`M-Pesa confirmed: ${receipt}`);
      } else if (res.found && !isPending) {
        window.clearInterval(mpesaIntervalRef.current!);
        mpesaIntervalRef.current = null;
        setMpesaState('FAILED');
        error(res.resultDesc || 'M-Pesa payment was not completed.');
      }
    }, 5000);
  };

  const sendMpesaPromptForAmount = async (
    amountToPay = total,
    completeWith?: (receipt: string, res: any, requestId: string) => { status: 'PAID' | 'UNPAID'; method: string; options: CheckoutOptions }
  ) => {
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    if (!mpesaPhone.trim()) return warning('Enter the customer phone number for the M-Pesa request.');
    if (cart.length === 0 || amountToPay <= 0 || mpesaState === 'PUSHING' || mpesaState === 'POLLING') return;
    setMpesaState('PUSHING');
    const res = await MpesaService.triggerStkPush(mpesaPhone.trim(), amountToPay, `SALE-${Date.now()}`, activeBusinessId, activeShopId);
    if (res.success && res.checkoutRequestId) {
      setMpesaState('POLLING');
      success('M-Pesa request sent. Waiting up to 4 minutes for payment.');
      pollMpesaAndComplete(res.checkoutRequestId, amountToPay, completeWith);
    } else {
      setMpesaState('FAILED');
      error(res.error || 'Could not send M-Pesa request.');
    }
  };

  const sendMpesaPrompt = async () => {
    if (mpesaBalanceDue <= 0) {
      warning('Apply less cash or use Cash payment for the full order.');
      return;
    }
    await sendMpesaPromptForAmount(mpesaBalanceDue, (receipt, res, requestId) => {
      const details = mpesaCheckoutDetails(receipt, { mpesaCustomer: res.phoneNumber, mpesaCheckoutRequestId: requestId });
      return { status: 'PAID', method: details.method, options: details.options };
    });
  };

  const completeCashPayment = async () => {
    if (cart.length === 0 || isCheckingOut || checkoutLockRef.current) return;
    if (!cashTendered.trim()) return warning('Enter the cash amount received.');
    if (tendered < total) return warning('Amount received must cover the sale total.');
    checkoutLockRef.current = true;
    try {
      await runCheckout('PAID', 'CASH', { ...baseOptions(), amountTendered: tendered, changeGiven: changeDue });
    } finally {
      checkoutLockRef.current = false;
    }
  };

  const completeVerifiedMpesaPayment = async () => {
    if (cart.length === 0 || isCheckingOut || checkoutLockRef.current) return;
    checkoutLockRef.current = true;
    try {
      const verified = await ensureMpesaUsable(mpesaRef, mpesaBalanceDue);
      if (!verified?.usable) return;
      const receipt = verified.receiptNumber || normaliseMpesaCode(mpesaRef);
      const details = mpesaCheckoutDetails(receipt, { mpesaCustomer: verified.phoneNumber, mpesaCheckoutRequestId: verified.checkoutRequestId });
      await runCheckout('PAID', details.method, details.options);
    } finally {
      checkoutLockRef.current = false;
    }
  };

  const completeManualMpesaPayment = async () => {
    if (cart.length === 0 || isCheckingOut || checkoutLockRef.current) return;
    const receipt = normaliseMpesaCode(mpesaRef);
    const amount = Number(mpesaManualAmount) || 0;
    if (!receipt) return warning('Enter the M-Pesa transaction code.');
    if (amount < mpesaBalanceDue) return warning('M-Pesa amount must cover the remaining order balance.');
    checkoutLockRef.current = true;
    try {
      const details = mpesaCheckoutDetails(receipt);
      await runCheckout('PAID', details.method, details.options);
    } finally {
      checkoutLockRef.current = false;
    }
  };

  const applyMpesaCashDeduction = () => {
    if (mpesaCashInputAmount <= 0) return warning('Enter the cash amount to deduct.');
    if (mpesaCashInputAmount >= total) return warning('Cash deduction must be less than the full order. Use Cash payment if the whole order is cash.');
    setMpesaAppliedCash(mpesaCashInputAmount);
    setMpesaVerification(null);
    success(`Cash applied. M-Pesa balance is Ksh ${(total - mpesaCashInputAmount).toLocaleString()}.`);
  };

  const completeCreditPayment = async () => {
    if (cart.length === 0 || isCheckingOut || checkoutLockRef.current) return;
    if (!selectedCustomer) return warning('Choose a registered customer before processing credit.');
    checkoutLockRef.current = true;
    try {
      await runCheckout('UNPAID', 'CREDIT', baseOptions());
    } finally {
      checkoutLockRef.current = false;
    }
  };

  const paymentLabel = (method: string) => method === 'MPESA' ? 'M-Pesa' : method === 'CREDIT' ? 'Credit' : 'Cash';
  const checkoutBusy = isCheckingOut || isVerifyingMpesa || mpesaState === 'PUSHING' || mpesaState === 'POLLING';
  const canCompleteSale = canCheckout && cart.length > 0 && !checkoutBusy;
  const renderPaymentIcon = (method: string, active = false) => {
    if (method === 'MPESA') return <span className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-black ${active ? 'border-blue-200 bg-white text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>M</span>;
    const option = paymentOptions.find(item => item.id === method);
    const Icon = option?.icon || CreditCard;
    return <Icon className={`h-6 w-6 ${active ? 'text-blue-700' : 'text-slate-700'}`} strokeWidth={2.4} />;
  };

  return (
    <aside className={`flex h-full min-h-0 flex-col rounded-lg border-2 border-slate-200 bg-white ${showCartItems ? 'overflow-hidden' : 'overflow-y-auto no-scrollbar'} ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h3 className="text-sm font-black text-slate-950">Sale</h3>
          <p className="text-[11px] font-semibold text-slate-500">{itemCount.toLocaleString()} item{itemCount === 1 ? '' : 's'}</p>
        </div>
        {cart.length > 0 && <button onClick={clearCart} className="text-xs font-bold text-slate-500 hover:text-slate-950">Clear</button>}
      </div>

      {showCartItems && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 no-scrollbar">
          {cart.length === 0 ? (
            <div className="flex h-full min-h-52 flex-col items-center justify-center text-center text-slate-400">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-100">
                <MaterialIcon name="shopping_cart" style={{ fontSize: '28px' }} />
              </div>
              <p className="text-sm font-bold">No items yet</p>
            </div>
          ) : cart.map(item => (
            <CartLineItem
              key={item.id}
              item={item}
              onRemove={removeFromCart}
              onDecrease={(id) => updateQuantity(id, -1)}
              onIncrease={(id) => updateQuantity(id, 1)}
              onQuantityChange={setQuantity}
              compact
            />
          ))}
        </div>
      )}

      <div className="keyboard-lift-when-open sticky bottom-0 z-20 max-h-[72dvh] shrink-0 space-y-3 overflow-y-auto border-t border-slate-300 bg-white p-4 lg:max-h-none lg:overflow-visible">
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 p-4 text-slate-950 shadow-sm ring-1 ring-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold text-slate-500">Amount due</p>
              <p className="mt-1 text-3xl font-black tabular-nums">Ksh {total.toLocaleString()}</p>
            </div>
            <div className="text-right text-[11px] font-semibold text-slate-500">
              <p>{itemCount.toLocaleString()} item{itemCount === 1 ? '' : 's'}</p>
              {discountAmount > 0 && <p className="mt-1 text-slate-500">Discount Ksh {discountAmount.toLocaleString()}</p>}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500">
            <div className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-inner">
              <p>Subtotal</p>
              <p className="mt-0.5 text-sm text-slate-950">Ksh {subtotal.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-inner">
              <p>Method</p>
              <p className="mt-0.5 text-sm text-slate-950">{paymentLabel(paymentMode)}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {paymentOptions.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (!canCheckout) return;
                setPaymentMode(id);
                setPaymentWindow(id);
              }}
              disabled={!canCheckout}
              data-testid={`payment-${id.toLowerCase()}`}
              className={`min-h-16 rounded-lg border-2 px-2 py-2 text-center shadow-sm transition-all ${
                paymentMode === id
                  ? 'border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'
              } disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:ring-0`}
            >
              <span className="mx-auto mb-1 flex h-8 items-center justify-center">{renderPaymentIcon(id, paymentMode === id)}</span>
              <span className="block text-[11px] font-bold">{label}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => setPaymentWindow(paymentMode)}
          disabled={!canCompleteSale}
          aria-busy={checkoutBusy}
          data-busy={checkoutBusy ? 'true' : undefined}
          data-testid="complete-sale"
          className="flex min-h-[3.25rem] w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-600 px-4 py-4 text-sm font-black text-white shadow-md shadow-blue-900/10 disabled:cursor-not-allowed disabled:border-slate-500 disabled:bg-slate-400 disabled:shadow-none"
        >
          <MaterialIcon name="payments" style={{ fontSize: '18px' }} />
          {!canCheckout ? 'Sale locked' : checkoutBusy ? 'Working...' : 'Complete sale'}
        </button>
        {!canCheckout && (
          <p className="rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">
            Admin has locked sale completion
          </p>
        )}
      </div>

      {paymentWindow && (
        <MobileModal
          onClose={() => setPaymentWindow(null)}
          closeOnBackdrop={!checkoutBusy}
          zIndexClassName="z-[180]"
          size="md"
          panelClassName="rounded-t-lg border-0 bg-slate-50"
          bodyClassName="p-0"
          backdropClassName="bg-slate-950/65 backdrop-blur-sm"
          header={(
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${paymentWindow === 'MPESA' ? '' : 'text-slate-950'}`}>{renderPaymentIcon(paymentWindow)}</span>
                <h3 className={`truncate text-lg font-medium ${paymentWindow === 'MPESA' ? 'text-[#43b02a]' : 'text-slate-950'}`}>
                  {paymentWindow === 'CASH' ? 'Cash Payment' : paymentWindow === 'MPESA' ? 'M-Pesa Payment' : 'Store Credit'}
                </h3>
              </div>
              <button type="button" onClick={() => setPaymentWindow(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-950 hover:bg-slate-200" aria-label="Close payment window">
                <X size={24} strokeWidth={2.2} />
              </button>
            </div>
          )}
        >

            {paymentWindow === 'CASH' && (
              <div className="space-y-5 overflow-y-auto p-5 modal-scroll-padding">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-slate-100 px-4 py-4">
                  <span className="text-base font-medium text-slate-600">Total Due</span>
                  <span className="text-base font-semibold tabular-nums text-slate-950">Ksh {total.toLocaleString()}.00</span>
                </div>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-slate-600">Amount Received</span>
                  <input type="number" min="0" value={cashTendered} onChange={(event) => setCashTendered(event.target.value)} placeholder="0.00" data-testid="cash-received" className="h-14 w-full rounded-md border border-slate-500 bg-white px-4 text-2xl font-bold tabular-nums text-slate-950 outline-none placeholder:text-slate-500 focus:border-slate-950" />
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-700">
                  <span className="text-lg font-medium">Change to Give</span>
                  <span className="text-lg font-semibold tabular-nums">Ksh {changeDue.toLocaleString()}.00</span>
                </div>
                <button type="button" onClick={() => void completeCashPayment()} disabled={isCheckingOut || !cashTendered.trim() || tendered < total} aria-busy={isCheckingOut} data-busy={isCheckingOut ? 'true' : undefined} className="sticky bottom-0 z-10 flex h-14 w-full items-center justify-center rounded-md bg-emerald-700 px-4 text-base font-bold text-white shadow-lg shadow-emerald-900/15 disabled:opacity-50">
                  Finalize Transaction
                </button>
              </div>
            )}

            {paymentWindow === 'MPESA' && (
              <div className="min-h-0 overflow-y-auto">
                <div className="grid grid-cols-4 border-b border-slate-300 bg-slate-50">
                  {([['STK', 'STK Push'], ['VERIFY', 'Verify Code'], ['MANUAL', 'Manual'], ['CASH', 'Cash']] as const).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setMpesaTab(id)} className={`h-12 border-b-2 px-2 text-center text-base font-medium ${mpesaTab === id ? 'border-slate-950 text-slate-950 outline outline-1 outline-slate-950' : 'border-transparent text-slate-600'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="space-y-4 p-5 modal-scroll-padding">
                  {mpesaTab === 'STK' && (
                    <>
                      <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-600">Customer Phone Number</span><input value={mpesaPhone} onChange={(event) => setMpesaPhone(event.target.value)} placeholder="e.g. 0712345678" data-testid="mpesa-phone" className="h-12 w-full rounded-md border border-slate-500 bg-white px-4 text-base font-semibold outline-none placeholder:text-slate-500 focus:border-[#43b02a]" /></label>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-slate-100 px-4 py-4"><span className="text-base font-medium text-slate-600">Amount to Pay via M-Pesa</span><span className="text-base font-semibold tabular-nums text-slate-950">Ksh {mpesaBalanceDue.toLocaleString()}.00</span></div>
                      {hasMpesaCashSplit && <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700"><span className="text-sm font-semibold">Cash Applied</span><span className="text-sm font-bold tabular-nums">Ksh {mpesaAppliedCashAmount.toLocaleString()}.00</span></div>}
                      <button type="button" onClick={() => void sendMpesaPrompt()} disabled={mpesaIsWaiting || isCheckingOut || mpesaBalanceDue <= 0} aria-busy={mpesaIsWaiting} data-busy={mpesaIsWaiting ? 'true' : undefined} data-testid="mpesa-prompt" className="sticky bottom-0 z-10 flex h-14 w-full items-center justify-center gap-2 rounded-md bg-[#43b02a] px-4 text-base font-bold text-white disabled:opacity-50"><Smartphone size={20} /> Send Prompt</button>
                    </>
                  )}
                  {mpesaTab === 'VERIFY' && (
                    <>
                      <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-600">Transaction Code</span><input value={mpesaRef} onChange={(event) => setMpesaRef(event.target.value.toUpperCase())} placeholder="ABC123XYZ" data-testid="mpesa-reference" className="h-12 w-full rounded-md border border-slate-500 bg-white px-4 text-base font-semibold uppercase outline-none placeholder:text-slate-500 focus:border-slate-950" /></label>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-slate-100 px-4 py-4"><span className="text-base font-medium text-slate-600">Required M-Pesa Amount</span><span className="text-base font-semibold tabular-nums text-slate-950">Ksh {mpesaBalanceDue.toLocaleString()}.00</span></div>
                      {hasMpesaCashSplit && <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700"><span className="text-sm font-semibold">Cash Applied</span><span className="text-sm font-bold tabular-nums">Ksh {mpesaAppliedCashAmount.toLocaleString()}.00</span></div>}
                      <button type="button" onClick={() => void completeVerifiedMpesaPayment()} disabled={isVerifyingMpesa || isCheckingOut || !mpesaRef.trim()} aria-busy={isVerifyingMpesa} data-busy={isVerifyingMpesa ? 'true' : undefined} className="sticky bottom-0 z-10 flex h-14 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-base font-bold text-white disabled:opacity-50">Verify & Complete</button>
                    </>
                  )}
                  {mpesaTab === 'MANUAL' && (
                    <>
                      <div className="grid grid-cols-2 gap-4">
                        <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-600">Transaction Code</span><input value={mpesaRef} onChange={(event) => setMpesaRef(event.target.value.toUpperCase())} placeholder="CODE" className="h-12 w-full rounded-md border border-slate-500 bg-white px-4 text-base font-semibold uppercase outline-none placeholder:text-slate-500 focus:border-slate-950" /></label>
                        <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-600">Amount</span><input type="number" min="0" value={mpesaManualAmount} onChange={(event) => setMpesaManualAmount(event.target.value)} placeholder="0.00" className="h-12 w-full rounded-md border border-slate-500 bg-white px-4 text-base font-semibold outline-none placeholder:text-slate-500 focus:border-slate-950" /></label>
                      </div>
                      <div className="rounded-md bg-slate-100 px-4 py-4 text-center"><p className="text-xs font-bold text-slate-600">M-PESA BALANCE DUE</p><p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">Ksh {mpesaBalanceDue.toLocaleString()}.00</p>{hasMpesaCashSplit && <p className="mt-1 text-xs font-semibold text-emerald-700">Cash applied: Ksh {mpesaAppliedCashAmount.toLocaleString()}.00</p>}</div>
                      <button type="button" onClick={() => void completeManualMpesaPayment()} disabled={isCheckingOut || !mpesaRef.trim() || (Number(mpesaManualAmount) || 0) < mpesaBalanceDue} aria-busy={isCheckingOut} data-busy={isCheckingOut ? 'true' : undefined} className="sticky bottom-0 z-10 flex h-14 w-full items-center justify-center rounded-md bg-slate-950 px-4 text-base font-bold text-white disabled:opacity-50">Process Manual Entry</button>
                    </>
                  )}
                  {mpesaTab === 'CASH' && (
                    <>
                      <div className="rounded-md bg-slate-100 px-4 py-4">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-300 pb-3"><span className="text-base font-medium text-slate-600">Full Order Amount</span><span className="text-base font-semibold tabular-nums text-slate-950">Ksh {total.toLocaleString()}.00</span></div>
                        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[#43b02a]"><span className="text-base font-medium">Cash Applied</span><span className="text-base font-semibold tabular-nums">Ksh {mpesaAppliedCashAmount.toLocaleString()}.00</span></div>
                        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[#43b02a]"><span className="text-base font-medium">M-Pesa Balance Due</span><span className="text-base font-semibold tabular-nums">Ksh {mpesaBalanceDue.toLocaleString()}.00</span></div>
                      </div>
                      <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-600">Cash Amount to Deduct</span><div className="relative"><span className="absolute left-4 top-1/2 -translate-y-1/2 text-base font-bold text-slate-700">Ksh</span><input type="number" min="0" max={total} value={mpesaCashDeduct} onChange={(event) => setMpesaCashDeduct(event.target.value)} placeholder="0.00" className="h-14 w-full rounded-md border border-slate-500 bg-white pl-14 pr-4 text-2xl font-bold tabular-nums text-slate-950 outline-none placeholder:text-slate-500 focus:border-slate-950" /></div></label>
                      <p className="text-sm italic text-slate-600">Apply the cash amount here, then finish the remaining balance from STK Push, Verify Code, or Manual.</p>
                      <button type="button" onClick={applyMpesaCashDeduction} disabled={isCheckingOut || mpesaCashInputAmount <= 0} className="sticky bottom-0 z-10 flex h-12 w-full items-center justify-center rounded-md border border-slate-950 bg-white px-4 text-base font-medium text-slate-950 disabled:opacity-50">Apply</button>
                    </>
                  )}
                  {mpesaState !== 'IDLE' && <p className={`rounded-md px-4 py-3 text-sm font-semibold ${mpesaState === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : mpesaState === 'FAILED' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>{mpesaState === 'PUSHING' ? 'Sending request' : mpesaState === 'POLLING' ? 'Waiting for customer PIN' : mpesaState === 'SUCCESS' ? 'Payment received' : 'Request failed or timed out'}</p>}
                  {mpesaVerification && mpesaTab === 'VERIFY' && <p className={`rounded-md px-4 py-3 text-sm font-semibold ${mpesaVerification.usable ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-amber-50 text-amber-700 border border-amber-100'}`}>{mpesaVerification.message || (mpesaVerification.usable ? 'M-Pesa code verified' : 'M-Pesa code not usable')}</p>}
                </div>
              </div>
            )}

            {paymentWindow === 'CREDIT' && (
              <div className="space-y-4 overflow-y-auto p-6 modal-scroll-padding">
                <label className="relative block"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-600" /><input value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Search customer..." className="h-12 w-full rounded-md border border-slate-500 bg-white pl-11 pr-4 text-base font-medium outline-none placeholder:text-slate-500 focus:border-slate-950" /></label>
                <div className="space-y-2">
                  {filteredCreditCustomers.length === 0 ? <div className="rounded-md border border-slate-300 bg-white px-4 py-6 text-center text-sm font-semibold text-slate-500">No registered customer found</div> : filteredCreditCustomers.slice(0, 6).map((customer: any) => {
                    const active = selectedCustomerId === customer.id;
                    const limit = Number(customer.creditLimit || customer.limit || 0);
                    return <button key={customer.id} type="button" onClick={() => setSelectedCustomerId(customer.id)} className={`w-full rounded-md border px-4 py-4 text-left transition-colors ${active ? 'border-slate-950 bg-white shadow-sm' : 'border-slate-300 bg-white hover:border-slate-500'}`}><span className="block text-base font-medium text-slate-950">{customer.name}</span><span className="mt-1 block text-sm text-slate-600">{limit > 0 ? `Limit: Ksh ${limit.toLocaleString()}.00` : `Balance: Ksh ${Number(customer.balance || 0).toLocaleString()}.00`}</span></button>;
                  })}
                </div>
                <button type="button" onClick={() => void completeCreditPayment()} disabled={isCheckingOut || !selectedCustomer} aria-busy={isCheckingOut} data-busy={isCheckingOut ? 'true' : undefined} className={`sticky bottom-0 z-10 flex h-14 w-full items-center justify-center rounded-md px-4 text-base font-bold text-white ${selectedCustomer ? 'bg-slate-950' : 'bg-slate-400'}`}>Process on Credit</button>
              </div>
            )}
        </MobileModal>
      )}
    </aside>
  );
}
