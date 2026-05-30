import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  Check,
  Landmark,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type CashPick, type Expense, type FinancialAccountAdjustment, type SupplierPayment } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import { MainAccountService, type MainAccountAdjustMode } from '../../services/finance';
import { MAIN_ACCOUNT_NAME, MAIN_ACCOUNT_NUMBER, mainAccountId, singleFinanceAccount } from '../../utils/financeAccount';
import MobileModal from '../shared/MobileModal';

type MainAccountDateRange = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM' | 'ALL';
type MainAccountLogSource = 'Cash pick' | 'Expense' | 'Supplier payment' | 'Adjustment' | 'M-Pesa sale' | 'M-Pesa customer payment';

type MainAccountLog = {
  id: string;
  timestamp: number;
  direction: 'IN' | 'OUT';
  amount: number;
  title: string;
  detail: string;
  source: MainAccountLogSource;
  userName?: string;
};

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

function toDateInputValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function dateBounds(range: MainAccountDateRange, startValue: string, endValue: string) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === 'ALL') return { start: 0, end: end.getTime(), label: 'All time' };
  if (range === 'CUSTOM') {
    const fallback = toDateInputValue(now);
    const start = new Date(`${startValue || fallback}T00:00:00`);
    const customEnd = new Date(`${endValue || startValue || fallback}T23:59:59.999`);
    return { start: start.getTime(), end: customEnd.getTime(), label: `${start.toLocaleDateString()} to ${customEnd.toLocaleDateString()}` };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'WEEK') start.setDate(start.getDate() - 6);
  if (range === 'MONTH') start.setDate(1);
  return { start: start.getTime(), end: end.getTime(), label: range === 'TODAY' ? 'Today' : range === 'WEEK' ? 'Last 7 days' : 'This month' };
}

function logMatchesAccount(recordAccountId: string | undefined, businessId: string | null, fallback = true) {
  if (!businessId) return fallback;
  if (!recordAccountId) return fallback;
  return recordAccountId === mainAccountId(businessId);
}

function directionMeta(direction: 'IN' | 'OUT') {
  return direction === 'IN'
    ? { label: 'Money in', Icon: ArrowDownLeft, iconClass: 'bg-blue-50 text-blue-700', amountClass: 'text-blue-700', sign: '+' }
    : { label: 'Money out', Icon: ArrowUpRight, iconClass: 'bg-rose-50 text-rose-600', amountClass: 'text-rose-600', sign: '-' };
}

export default function MainAccountTabMobile() {
  const todayInput = useMemo(() => toDateInputValue(new Date()), []);
  const [dateRange, setDateRange] = useState<MainAccountDateRange>('MONTH');
  const [startDate, setStartDate] = useState(todayInput);
  const [endDate, setEndDate] = useState(todayInput);
  const [search, setSearch] = useState('');
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [adjustMode, setAdjustMode] = useState<MainAccountAdjustMode>('IN');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isEnsuring, setIsEnsuring] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const ensureAttemptedRef = React.useRef(false);

  const { success, error } = useToast();
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const isAdminUser = currentUser?.role === 'ADMIN' || currentUser?.role === 'ROOT';

  const rawAccounts = useLiveQuery(
    () => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
  );
  const cashPicks = useLiveQuery(
    () => activeBusinessId ? db.cashPicks.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
  );
  const expenses = useLiveQuery(
    () => activeBusinessId ? db.expenses.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
  );
  const supplierPayments = useLiveQuery(
    () => activeBusinessId ? db.supplierPayments.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
  );
  const adjustments = useLiveQuery(
    () => activeBusinessId ? db.financialAccountAdjustments.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
  );

  const account = useMemo(
    () => singleFinanceAccount(rawAccounts || [], activeBusinessId)[0],
    [activeBusinessId, rawAccounts],
  );
  const hasSavedMainAccount = useMemo(() => {
    if (!activeBusinessId) return false;
    return (rawAccounts || []).some(item => (
      item.id === mainAccountId(activeBusinessId)
      || item.accountNumber === MAIN_ACCOUNT_NUMBER
      || String(item.name || '').trim().toLowerCase() === MAIN_ACCOUNT_NAME.toLowerCase()
    ));
  }, [activeBusinessId, rawAccounts]);

  const refreshAccount = async () => {
    if (!activeBusinessId) return;
    setIsEnsuring(true);
    try {
      if (isAdminUser) await MainAccountService.ensure({ businessId: activeBusinessId }).catch(() => null);
      await Promise.all([
        db.financialAccounts.reload(),
        db.financialAccountAdjustments.reload(),
      ]);
    } finally {
      setIsEnsuring(false);
    }
  };

  useEffect(() => {
    if (!activeBusinessId || !isAdminUser || hasSavedMainAccount || ensureAttemptedRef.current) return;
    ensureAttemptedRef.current = true;
    void refreshAccount();
  }, [activeBusinessId, hasSavedMainAccount, isAdminUser]);

  const period = dateBounds(dateRange, startDate, endDate);

  const logs = useMemo<MainAccountLog[]>(() => {
    const businessId = activeBusinessId || null;
    const cashPickLogs = (cashPicks || [])
      .filter((pick: CashPick) => String(pick.status || '').toUpperCase() === 'APPROVED')
      .filter((pick: CashPick) => logMatchesAccount(pick.accountId, businessId, true))
      .map((pick: CashPick) => ({
        id: `cash-pick-${pick.id}`,
        timestamp: Number(pick.timestamp || 0),
        direction: 'IN' as const,
        amount: Number(pick.amount || 0),
        title: 'Cash picked from till',
        detail: pick.shiftId ? `Shift ${String(pick.shiftId).slice(0, 8)}` : 'Cash moved into Main account',
        source: 'Cash pick' as const,
        userName: pick.userName,
      }));

    const expenseLogs = (expenses || [])
      .filter((expense: Expense) => String(expense.source || '').toUpperCase() === 'ACCOUNT')
      .filter((expense: Expense) => String(expense.status || 'APPROVED').toUpperCase() === 'APPROVED')
      .filter((expense: Expense) => logMatchesAccount(expense.accountId, businessId, true))
      .map((expense: Expense) => ({
        id: `expense-${expense.id}`,
        timestamp: Number(expense.timestamp || 0),
        direction: 'OUT' as const,
        amount: Number(expense.amount || 0),
        title: expense.category || 'Expense',
        detail: expense.description || 'Paid from Main account',
        source: 'Expense' as const,
        userName: expense.userName || expense.preparedBy,
      }));

    const supplierPaymentLogs = (supplierPayments || [])
      .filter((payment: SupplierPayment) => String(payment.source || '').toUpperCase() === 'ACCOUNT')
      .filter((payment: SupplierPayment) => logMatchesAccount(payment.accountId, businessId, true))
      .map((payment: SupplierPayment) => ({
        id: `supplier-payment-${payment.id}`,
        timestamp: Number(payment.timestamp || 0),
        direction: 'OUT' as const,
        amount: Number(payment.amount || 0),
        title: 'Supplier payment',
        detail: payment.reference || payment.transactionCode || 'Paid from Main account',
        source: 'Supplier payment' as const,
        userName: payment.preparedBy,
      }));

    const adjustmentLogs = (adjustments || [])
      .filter((adjustment: FinancialAccountAdjustment) => logMatchesAccount(adjustment.accountId, businessId, true))
      .map((adjustment: FinancialAccountAdjustment) => {
        const amount = Number(adjustment.amount || 0);
        const id = String(adjustment.id || '');
        const isMpesaSale = id.startsWith('mpesa_sale_');
        const isMpesaCustomerPayment = id.startsWith('mpesa_customer_payment_');
        return {
          id: `adjustment-${adjustment.id}`,
          timestamp: Number(adjustment.timestamp || 0),
          direction: amount < 0 ? 'OUT' as const : 'IN' as const,
          amount: Math.abs(amount),
          title: isMpesaSale ? 'M-Pesa sale' : isMpesaCustomerPayment ? 'M-Pesa customer payment' : adjustment.direction === 'SET' ? 'Balance correction' : 'Manual adjustment',
          detail: adjustment.reason || 'Manual adjustment',
          source: isMpesaSale ? 'M-Pesa sale' as const : isMpesaCustomerPayment ? 'M-Pesa customer payment' as const : 'Adjustment' as const,
          userName: adjustment.userName,
        };
      });

    return [...cashPickLogs, ...expenseLogs, ...supplierPaymentLogs, ...adjustmentLogs]
      .filter(log => log.amount > 0)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [activeBusinessId, adjustments, cashPicks, expenses, supplierPayments]);

  const filteredLogs = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return logs.filter(log => {
      const dateMatch = log.timestamp >= period.start && log.timestamp <= period.end;
      const searchMatch = !needle || `${log.title} ${log.detail} ${log.source} ${log.userName || ''}`.toLowerCase().includes(needle);
      return dateMatch && searchMatch;
    });
  }, [logs, period.end, period.start, search]);

  const moneyIn = filteredLogs.filter(log => log.direction === 'IN').reduce((sum, log) => sum + log.amount, 0);
  const moneyOut = filteredLogs.filter(log => log.direction === 'OUT').reduce((sum, log) => sum + log.amount, 0);
  const currentBalance = Number(account?.balance || 0);
  const adjustmentValue = Number(adjustAmount || 0);
  const previewBalance = adjustMode === 'SET' ? adjustmentValue : adjustMode === 'OUT' ? currentBalance - adjustmentValue : currentBalance + adjustmentValue;
  const isMainAccountLoading = !rawAccounts || !cashPicks || !expenses || !supplierPayments || !adjustments;

  if (isMainAccountLoading) {
    return (
      <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4">
        <div className="flex h-16 w-16 animate-spin-slow items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50">
          <Landmark size={34} className="text-slate-300" />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading main account...</p>
      </div>
    );
  }

  const resetAdjustment = () => {
    setAdjustMode('IN');
    setAdjustAmount('');
    setAdjustReason('');
  };

  const closeAdjust = () => {
    if (isSaving) return;
    setIsAdjustOpen(false);
    resetAdjustment();
  };

  const saveAdjustment = async () => {
    if (!activeBusinessId || isSaving) return;
    if (!isAdminUser) return error('Only admin can adjust the Main account.');
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount < 0 || ((adjustMode === 'IN' || adjustMode === 'OUT') && amount <= 0)) return error('Enter a valid amount.');
    if (adjustMode === 'OUT' && amount > currentBalance) return error('Main account balance cannot go below zero.');

    setIsSaving(true);
    try {
      await MainAccountService.adjust({
        businessId: activeBusinessId,
        mode: adjustMode,
        amount,
        reason: adjustReason.trim() || 'Manual adjustment',
        userName: currentUser?.name || 'Admin',
      });
      await Promise.all([db.financialAccounts.reload(), db.financialAccountAdjustments.reload(), db.auditLogs.reload()]);
      success('Main account updated.');
      closeAdjust();
    } catch (err: any) {
      error(err?.message || 'Could not update Main account.');
    } finally {
      setIsSaving(false);
    }
  };

  const reconcileMpesa = async () => {
    if (!activeBusinessId || isReconciling) return;
    if (!isAdminUser) return error('Only admin can reconcile M-Pesa money.');
    setIsReconciling(true);
    try {
      const result = await MainAccountService.reconcileMpesa({ businessId: activeBusinessId });
      await Promise.all([db.financialAccounts.reload(), db.financialAccountAdjustments.reload(), db.auditLogs.reload()]);
      if (result.anomalies?.length) {
        error(`M-Pesa reconcile posted ${result.posted}. ${result.anomalies.length} item${result.anomalies.length === 1 ? '' : 's'} need review.`);
      } else {
        success(`M-Pesa reconcile complete. Posted ${result.posted}, skipped ${result.skipped}.`);
      }
    } catch (err: any) {
      error(err?.message || 'Could not reconcile M-Pesa money.');
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <div className="space-y-4 pb-28">
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Finance</p>
            <h2 className="mt-1 truncate text-2xl font-black text-slate-950">{MAIN_ACCOUNT_NAME}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Picked cash and confirmed M-Pesa settlement.</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshAccount()}
            disabled={!activeBusinessId || isEnsuring}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-700 disabled:opacity-50"
            aria-label="Refresh Main account"
          >
            <RefreshCw size={18} className={isEnsuring ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="mt-5 rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current balance</p>
          <p className="mt-2 text-3xl font-black tabular-nums text-slate-950">{money(currentBalance)}</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border-2 border-blue-100 bg-blue-50/50 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">In</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-950">{money(moneyIn)}</p>
          </div>
          <div className="rounded-lg border-2 border-rose-100 bg-rose-50/50 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-600">Out</p>
            <p className="mt-1 text-lg font-black tabular-nums text-slate-950">{money(moneyOut)}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void reconcileMpesa()}
            disabled={!isAdminUser || !activeBusinessId || isReconciling}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-emerald-700 bg-white px-3 text-xs font-black text-emerald-700 disabled:border-slate-200 disabled:text-slate-300"
          >
            <RefreshCw size={16} className={isReconciling ? 'animate-spin' : ''} />
            M-Pesa
          </button>
          <button
            type="button"
            onClick={() => setIsAdjustOpen(true)}
            disabled={!isAdminUser}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-3 text-xs font-black text-white disabled:border-slate-300 disabled:bg-slate-300"
          >
            <SlidersHorizontal size={16} />
            Adjust
          </button>
        </div>
      </section>

      <section className="rounded-lg border-2 border-slate-200 bg-white p-3 shadow-sm">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search logs"
            className="h-11 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-9 text-sm font-bold outline-none focus:border-blue-600"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto rounded-lg border-2 border-slate-200 p-1">
          {[
            { id: 'TODAY', label: 'Today' },
            { id: 'WEEK', label: 'Week' },
            { id: 'MONTH', label: 'Month' },
            { id: 'CUSTOM', label: 'Custom' },
            { id: 'ALL', label: 'All' },
          ].map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => setDateRange(option.id as MainAccountDateRange)}
              className={`h-9 shrink-0 rounded-lg px-3 text-[11px] font-black ${dateRange === option.id ? 'bg-blue-700 text-white' : 'text-slate-500'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {dateRange === 'CUSTOM' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[{ value: startDate, setValue: setStartDate }, { value: endDate, setValue: setEndDate }].map((field, index) => (
              <label key={index} className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                <input
                  type="date"
                  value={field.value}
                  onChange={event => field.setValue(event.target.value)}
                  className="h-10 w-full rounded-lg border-2 border-slate-200 bg-white pl-8 pr-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-600"
                />
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <div>
            <h3 className="text-sm font-black text-slate-950">Account logs</h3>
            <p className="text-[11px] font-semibold text-slate-500">{period.label}</p>
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredLogs.length} log{filteredLogs.length === 1 ? '' : 's'}</p>
        </div>

        {filteredLogs.length > 0 ? filteredLogs.map(log => {
          const meta = directionMeta(log.direction);
          const Icon = meta.Icon;
          return (
            <article key={log.id} className="rounded-lg border-2 border-slate-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.iconClass}`}>
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{log.title}</p>
                      <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">{log.detail}</p>
                    </div>
                    <p className={`shrink-0 text-sm font-black tabular-nums ${meta.amountClass}`}>{meta.sign}{money(log.amount)}</p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">{log.source}</span>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
                      {new Date(log.timestamp || Date.now()).toLocaleString()}
                    </span>
                  </div>
                </div>
              </div>
            </article>
          );
        }) : (
          <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white p-8 text-center">
            <Landmark size={34} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm font-black text-slate-900">No account movement found</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">Change the filters to see more logs.</p>
          </div>
        )}
      </section>

      {isAdjustOpen && (
        <MobileModal
          onClose={closeAdjust}
          closeOnBackdrop={!isSaving}
          size="full"
          header={(
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Admin action</p>
                <h3 className="mt-1 text-lg font-black text-slate-950">Adjust {MAIN_ACCOUNT_NAME}</h3>
              </div>
              <button type="button" onClick={closeAdjust} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 text-slate-500">
                <X size={18} />
              </button>
            </div>
          )}
          footer={(
            <div className="p-4">
              <button
                type="button"
                onClick={() => void saveAdjustment()}
                disabled={isSaving || previewBalance < 0}
                className="mobile-popup-sticky-action flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white disabled:border-slate-300 disabled:bg-slate-300"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
                {isSaving ? 'Saving' : 'Save adjustment'}
              </button>
            </div>
          )}
        >
          <div className="space-y-5 p-5">
            <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current balance</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{money(currentBalance)}</p>
            </div>

            <div>
              <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Adjustment type</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'IN', label: 'In', Icon: Plus },
                  { id: 'OUT', label: 'Out', Icon: Minus },
                  { id: 'SET', label: 'Set', Icon: Wallet },
                ].map(option => {
                  const Icon = option.Icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setAdjustMode(option.id as MainAccountAdjustMode)}
                      className={`h-14 rounded-lg border-2 px-2 text-xs font-black ${adjustMode === option.id ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700'}`}
                    >
                      <Icon size={16} className="mx-auto mb-1" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Amount</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={adjustAmount}
                onChange={event => setAdjustAmount(event.target.value)}
                className="h-14 w-full rounded-lg border-2 border-slate-300 bg-white px-4 text-2xl font-black tabular-nums text-slate-950 outline-none focus:border-blue-600"
                placeholder="0"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Reason</span>
              <textarea
                value={adjustReason}
                onChange={event => setAdjustReason(event.target.value)}
                rows={4}
                className="w-full resize-none rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none focus:border-blue-600"
                placeholder="Owner deposit, bank transfer, correction..."
              />
            </label>

            <div className={`rounded-lg border-2 p-4 ${previewBalance < 0 ? 'border-rose-200 bg-rose-50' : 'border-blue-100 bg-blue-50/50'}`}>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">After saving</p>
              <p className={`mt-1 text-2xl font-black tabular-nums ${previewBalance < 0 ? 'text-rose-600' : 'text-slate-950'}`}>
                {money(Number.isFinite(previewBalance) ? previewBalance : currentBalance)}
              </p>
              {previewBalance < 0 && <p className="mt-2 text-xs font-bold text-rose-600">Main account balance cannot go below zero.</p>}
            </div>
          </div>
        </MobileModal>
      )}
    </div>
  );
}
