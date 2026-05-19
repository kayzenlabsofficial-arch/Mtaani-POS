import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { canUseOwnerMode, getCashDrawerLimit, isOwnerCashSweepEnabled, isOwnerModeEnabled, shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { enrichProductsWithBundleStock } from '../../utils/bundleInventory';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getCurrentShiftId } from '../../utils/shiftSession';
import { getBusinessSettings } from '../../utils/settings';
import { belongsToActiveBranch } from '../../utils/branchScope';
import { CashService, ClosingService } from '../../services/operations';
import {
  Banknote,
  BarChart3,
  CalendarCheck,
  ClipboardCheck,
  CreditCard,
  Package,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Users,
} from 'lucide-react';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => {
  const icons: Record<string, React.ElementType> = {
    analytics: BarChart3,
    assignment_turned_in: ClipboardCheck,
    credit_card: CreditCard,
    event_available: CalendarCheck,
    group: Users,
    inventory: Package,
    inventory_2: Package,
    keyboard_return: RotateCcw,
    payments: Banknote,
    point_of_sale: ShoppingCart,
    receipt_long: ReceiptText,
    smartphone: Smartphone,
    trending_down: TrendingDown,
    trending_up: TrendingUp,
    verified_user: ShieldCheck,
    warning: TriangleAlert,
  };
  const Icon = icons[name] || Package;
  const sizeMatch = className.match(/text-(?:xs|sm|base|lg|xl|\[(\d+)px\])/);
  const size = sizeMatch?.[1] ? Number(sizeMatch[1]) : className.includes('text-xs') ? 14 : className.includes('text-sm') ? 16 : className.includes('text-base') ? 18 : className.includes('text-lg') ? 20 : 20;
  return <Icon className={className} size={size} strokeWidth={2.4} />;
};

interface DashboardTabProps {
  setActiveTab: (tab: any) => void;
  openExpenseModal: () => void;
}

const StatCard = ({ label, value, sub, trend, icon, color }: any) => (
  <div className="bg-white border border-slate-100 rounded-2xl p-5 hover:shadow-md hover:shadow-slate-100 transition-all duration-300 flex flex-col gap-3">
    <div className="flex items-start justify-between">
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center flex-shrink-0`}>
        <MaterialIcon name={icon} className="text-white text-lg" />
      </div>
      {Number.isFinite(Number(trend)) && (
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
          <MaterialIcon name={trend >= 0 ? 'trending_up' : 'trending_down'} className="text-xs" />
          {Math.abs(Number(trend)).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
        </span>
      )}
    </div>
    <div>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-black text-slate-900 tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-500 mt-1 font-medium">{sub}</p>
    </div>
  </div>
);

const DAY_MS = 24 * 60 * 60 * 1000;

function localDayStart(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function percentChange(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function splitDetails(record: any) {
  const raw = record?.splitPayments || record?.splitData?.splitPayments;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function paymentAmount(record: any, method: 'CASH' | 'MPESA' | 'PDQ') {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === method) return Number(record?.total || 0);
  if (paymentMethod !== 'SPLIT') return 0;

  const split = splitDetails(record);
  if (method === 'CASH') return Number(split?.cashAmount || 0);
  return String(split?.secondaryMethod || '').toUpperCase() === method
    ? Number(split?.secondaryAmount || 0)
    : 0;
}

function creditAmount(record: any) {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === 'CREDIT') return Number(record?.total || 0);
  if (paymentMethod !== 'SPLIT') return String(record?.status || '').toUpperCase() === 'UNPAID' ? Number(record?.total || 0) : 0;
  const split = splitDetails(record);
  return String(split?.secondaryMethod || '').toUpperCase() === 'CREDIT'
    ? Number(split?.secondaryAmount || 0)
    : 0;
}

function recordInShift(record: any, since: number, until: number, shiftId?: string) {
  if (shiftId && record?.shiftId) return record.shiftId === shiftId;
  const ts = Number(record?.timestamp || record?.issueDate || 0);
  return ts >= since && ts <= until;
}

function splitFundedRemittance(cashSales: number, expenses: number, supplierPayments: number) {
  const rawRemittance = Math.max(0, expenses + supplierPayments);
  const remittanceTotal = Math.min(Math.max(0, cashSales), rawRemittance);
  if (rawRemittance <= 0 || remittanceTotal <= 0) {
    return { totalExpenses: 0, supplierPaymentsTotal: 0, remittanceTotal: 0 };
  }
  const totalExpenses = Math.round(Math.min(expenses, remittanceTotal * (expenses / rawRemittance)) * 100) / 100;
  const supplierPaymentsTotal = Math.round((remittanceTotal - totalExpenses) * 100) / 100;
  return { totalExpenses, supplierPaymentsTotal, remittanceTotal };
}

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

type ClosureStats = {
  txs: any[];
  invoices: any[];
  expenses: any[];
  picks: any[];
  supplierPayments: any[];
  grossSales: number;
  totalSales: number;
  taxTotal: number;
  cashSales: number;
  mpesaSales: number;
  pdqSales: number;
  totalExpenses: number;
  supplierPaymentsTotal: number;
  remittanceTotal: number;
  totalPicks: number;
  expectedCash: number;
  cashierVariance: number;
};

type ShiftClosePreview = {
  since: number;
  until: number;
  shiftId: string;
  stats: ClosureStats;
  recoveredAfterClosedShift?: boolean;
};

const createShiftSessionId = (branchId: string, userId: string, timestamp = Date.now()) =>
  `shift_${branchId}_${new Date(timestamp).toISOString().slice(0, 10)}_${userId}_${timestamp}`;

export default function DashboardTab({ setActiveTab, openExpenseModal }: DashboardTabProps) {
  const [trendView, setTrendView] = useState<'DAY' | 'WEEK'>('DAY');
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const [isBankingExcess, setIsBankingExcess] = useState(false);
  const [isCashPickModalOpen, setIsCashPickModalOpen] = useState(false);
  const [cashPickAmount, setCashPickAmount] = useState('');
  const [isPickingCash, setIsPickingCash] = useState(false);
  const [isClosingShift, setIsClosingShift] = useState(false);
  const [shiftClosePreview, setShiftClosePreview] = useState<ShiftClosePreview | null>(null);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const setActiveShift = useStore(state => state.setActiveShift);
  const { success, error, warning } = useToast();

  React.useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const updateWidth = () => setChartWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeBranchId]);
  const branches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const activeBranch = branches?.find(b => b.id === activeBranchId);

  const transactions = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.transactions.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).reverse().limit(8).toArray()
      : [],
    [activeBusinessId, activeBranchId], []
  );

  const products = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).filter(p => belongsToActiveBranch(p, activeBranchId)).toArray() : [],
    [activeBusinessId, activeBranchId], []
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const branchTransactions = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.transactions.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchSalesInvoices = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.salesInvoices.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchExpenses = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.expenses.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchCashPicks = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.cashPicks.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchSupplierPayments = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.supplierPayments.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchCustomerPayments = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.customerPayments.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchReports = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.endOfDayReports.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const branchDailySummaries = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.dailySummaries.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId], []
  );
  const pendingApprovalCount = useLiveQuery(async () => {
    if (!activeBusinessId || !activeBranchId) return 0;
    const [expenses, refunds, purchaseOrders, picks] = await Promise.all([
      db.expenses.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId && row.status === 'PENDING').toArray(),
      db.transactions.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId && row.status === 'PENDING_REFUND').toArray(),
      db.purchaseOrders.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId && row.approvalStatus === 'PENDING').toArray(),
      db.cashPicks.where('branchId').equals(activeBranchId).and(row => row.businessId === activeBusinessId && row.status === 'PENDING').toArray(),
    ]);
    return expenses.length + refunds.length + purchaseOrders.length + picks.length;
  }, [activeBusinessId, activeBranchId], 0);

  const displayProducts = enrichProductsWithBundleStock(products || [], productIngredients || []);
  const lowStockItems = displayProducts.filter(p => (p.stockQuantity || 0) <= (p.reorderPoint || 5)).slice(0, 5) || [];
  const todayStart = getTodayStartMs();
  const yesterdayStart = todayStart - DAY_MS;
  const todaysDailySummary = (branchDailySummaries || []).find(summary => {
    const summaryDate = Number(summary.date || summary.timestamp || 0);
    return summaryDate >= todayStart && summaryDate < todayStart + DAY_MS;
  });
  const todaysTransactions = (branchTransactions || []).filter(t => (t.timestamp || 0) >= todayStart && t.status !== 'VOIDED' && t.status !== 'QUOTE');
  const todaysInvoices = (branchSalesInvoices || []).filter(invoice => (invoice.issueDate || 0) >= todayStart && invoice.status !== 'CANCELLED');
  const todaysCustomerPayments = (branchCustomerPayments || []).filter(payment => (payment.timestamp || 0) >= todayStart);
  const yesterdaysTransactions = (branchTransactions || []).filter(t => (t.timestamp || 0) >= yesterdayStart && (t.timestamp || 0) < todayStart && t.status !== 'VOIDED' && t.status !== 'QUOTE');
  const yesterdaysInvoices = (branchSalesInvoices || []).filter(invoice => (invoice.issueDate || 0) >= yesterdayStart && (invoice.issueDate || 0) < todayStart && invoice.status !== 'CANCELLED');
  const todaysSalesCount = todaysTransactions.length + todaysInvoices.length;
  const totalRevenue = todaysTransactions.reduce((a, t) => a + Number(t.total || 0), 0)
    + todaysInvoices.reduce((a, invoice) => a + Number(invoice.total || 0), 0);
  const yesterdaysSalesCount = yesterdaysTransactions.length + yesterdaysInvoices.length;
  const yesterdaysRevenue = yesterdaysTransactions.reduce((a, t) => a + Number(t.total || 0), 0)
    + yesterdaysInvoices.reduce((a, invoice) => a + Number(invoice.total || 0), 0);
  const todaysAverageSale = todaysSalesCount ? Math.round(totalRevenue / todaysSalesCount) : 0;
  const yesterdaysAverageSale = yesterdaysSalesCount ? Math.round(yesterdaysRevenue / yesterdaysSalesCount) : 0;
  const customerPaymentTotal = (method: 'CASH' | 'MPESA' | 'PDQ') => todaysCustomerPayments
    .filter(payment => String(payment.paymentMethod || '').toUpperCase() === method)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const paymentBreakdown = [
    {
      label: 'Cash',
      value: todaysTransactions.reduce((sum, tx) => sum + paymentAmount(tx, 'CASH'), 0) + customerPaymentTotal('CASH'),
      icon: 'payments',
      color: 'bg-emerald-600',
    },
    {
      label: 'M-Pesa',
      value: todaysTransactions.reduce((sum, tx) => sum + paymentAmount(tx, 'MPESA'), 0) + customerPaymentTotal('MPESA'),
      icon: 'smartphone',
      color: 'bg-green-600',
    },
    {
      label: 'Credit',
      value: todaysTransactions.reduce((sum, tx) => sum + creditAmount(tx), 0)
        + todaysInvoices.reduce((sum, invoice) => sum + Number(invoice.balance ?? invoice.total ?? 0), 0),
      icon: 'group',
      color: 'bg-amber-500',
    },
    {
      label: 'Swipe',
      value: todaysTransactions.reduce((sum, tx) => sum + paymentAmount(tx, 'PDQ'), 0) + customerPaymentTotal('PDQ'),
      icon: 'credit_card',
      color: 'bg-indigo-600',
    },
  ];
  const salesTrendData = React.useMemo(() => {
    const txs = (branchTransactions || []).filter(t => t.status !== 'VOIDED' && t.status !== 'QUOTE');
    const invoices = (branchSalesInvoices || []).filter(invoice => invoice.status !== 'CANCELLED');
    if (trendView === 'WEEK') {
      return Array.from({ length: 7 }, (_, index) => {
        const start = localDayStart(Date.now() - (6 - index) * DAY_MS);
        const end = start + DAY_MS;
        const day = new Date(start).toLocaleDateString('en-KE', { weekday: 'short' });
        return {
          time: day,
          sales: txs
            .filter(t => (t.timestamp || 0) >= start && (t.timestamp || 0) < end)
            .reduce((sum, t) => sum + Number(t.total || 0), 0)
            + invoices
              .filter(invoice => (invoice.issueDate || 0) >= start && (invoice.issueDate || 0) < end)
              .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
        };
      });
    }

    const today = localDayStart();
    return Array.from({ length: 8 }, (_, index) => {
      const hour = 6 + index * 2;
      const start = today + hour * 60 * 60 * 1000;
      const end = index === 7 ? today + DAY_MS : today + (hour + 2) * 60 * 60 * 1000;
      return {
        time: `${String(hour).padStart(2, '0')}:00`,
        sales: txs
          .filter(t => (t.timestamp || 0) >= start && (t.timestamp || 0) < end)
          .reduce((sum, t) => sum + Number(t.total || 0), 0)
          + invoices
            .filter(invoice => (invoice.issueDate || 0) >= start && (invoice.issueDate || 0) < end)
            .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
      };
    });
  }, [branchTransactions, branchSalesInvoices, trendView]);
  const ownerModeActive = canUseOwnerMode(currentUser) && isOwnerModeEnabled(businessSettings);
  const cashSweepActive = ownerModeActive && isOwnerCashSweepEnabled(businessSettings);
  const cashDrawerLimit = getCashDrawerLimit(businessSettings);

  const actualCashDrawer = Math.max(0, calculateCashDrawer({
    transactions: branchTransactions || [],
    expenses: branchExpenses || [],
    cashPicks: branchCashPicks || [],
    supplierPayments: branchSupplierPayments || [],
    customerPayments: branchCustomerPayments || [],
    since: getTodayStartMs(),
  }).actualCashDrawer);
  const sweepAmount = Math.max(0, actualCashDrawer - cashDrawerLimit);
  const shouldSweepCash = cashSweepActive && actualCashDrawer > cashDrawerLimit && sweepAmount > 0;
  const cashPickValue = Number(cashPickAmount) || 0;

  const handleBankExcessCash = async () => {
    if (!activeBranchId || !activeBusinessId || !currentUser || !shouldSweepCash || isBankingExcess) return;
    setIsBankingExcess(true);
    try {
      await CashService.createPick({
        amount: sweepAmount,
        status: 'APPROVED',
        userName: currentUser.name,
        shiftId: getCurrentShiftId(activeShift, activeBranchId, currentUser.id),
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      await db.cashPicks.reload();
      success(`Banked Ksh ${sweepAmount.toLocaleString()} from the drawer.`);
    } catch (err: any) {
      error(err.message || 'Cash sweep failed.');
    } finally {
      setIsBankingExcess(false);
    }
  };

  const handleCreateCashPick = async () => {
    if (!activeBranchId || !activeBusinessId || !currentUser || isPickingCash) return;
    if (cashPickValue <= 0) return warning('Enter the cash amount to pick.');
    if (cashPickValue > actualCashDrawer) return error(`Only Ksh ${actualCashDrawer.toLocaleString()} is available in the drawer.`);

    setIsPickingCash(true);
    try {
      const status = shouldAutoApproveOwnerAction(businessSettings, currentUser) ? 'APPROVED' : 'PENDING';
      await CashService.createPick({
        amount: cashPickValue,
        status,
        userName: currentUser.name,
        shiftId: getCurrentShiftId(activeShift, activeBranchId, currentUser.id),
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      await db.cashPicks.reload();
      setCashPickAmount('');
      setIsCashPickModalOpen(false);
      success(status === 'APPROVED'
        ? `Picked Ksh ${cashPickValue.toLocaleString()} from the drawer.`
        : `Cash pick request for Ksh ${cashPickValue.toLocaleString()} sent for approval.`
      );
    } catch (err: any) {
      error(err.message || 'Could not record cash pick.');
    } finally {
      setIsPickingCash(false);
    }
  };

  const getClosureStats = (since: number, until = Date.now(), shiftId?: string) => {
    const txs = (branchTransactions || []).filter(t => recordInShift(t, since, until, shiftId) && t.status !== 'VOIDED' && t.status !== 'QUOTE');
    const invoices = (branchSalesInvoices || []).filter(invoice => recordInShift(invoice, since, until, shiftId) && invoice.status !== 'CANCELLED');
    const expenses = (branchExpenses || []).filter(e => recordInShift(e, since, until, shiftId) && e.status !== 'REJECTED');
    const picks = (branchCashPicks || []).filter(p => recordInShift(p, since, until, shiftId) && p.status !== 'REJECTED');
    const supplierPayments = (branchSupplierPayments || []).filter(p => recordInShift(p, since, until, shiftId));
    const cashSales = txs.reduce((sum, tx) => sum + paymentAmount(tx, 'CASH'), 0);
    const mpesaSales = txs.reduce((sum, tx) => sum + paymentAmount(tx, 'MPESA'), 0);
    const pdqSales = txs.reduce((sum, tx) => sum + paymentAmount(tx, 'PDQ'), 0);
    const grossSales = txs.reduce((sum, tx) => sum + Number(tx.subtotal ?? tx.total ?? 0), 0)
      + invoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || invoice.total || 0), 0);
    const totalSales = txs.reduce((sum, tx) => sum + Number(tx.total || 0), 0)
      + invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const taxTotal = txs.reduce((sum, tx) => sum + Number(tx.tax || 0), 0)
      + invoices.reduce((sum, invoice) => sum + Number(invoice.tax || 0), 0);
    const rawTotalExpenses = expenses.filter(e => e.source === 'TILL').reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const rawSupplierPaymentsTotal = supplierPayments.filter(p => p.source === 'TILL').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const { totalExpenses, supplierPaymentsTotal, remittanceTotal } = splitFundedRemittance(cashSales, rawTotalExpenses, rawSupplierPaymentsTotal);
    const totalPicks = picks.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const expectedCashPicked = Math.max(0, cashSales - remittanceTotal);
    const cashierVariance = totalPicks - expectedCashPicked;

    return {
      txs,
      invoices,
      expenses,
      picks,
      supplierPayments,
      grossSales,
      totalSales,
      taxTotal,
      cashSales,
      mpesaSales,
      pdqSales,
      totalExpenses,
      supplierPaymentsTotal,
      remittanceTotal,
      totalPicks,
      expectedCash: expectedCashPicked,
      cashierVariance,
    };
  };

  const handleCloseShift = () => {
    if (!activeBranchId || !activeBusinessId || !currentUser || isClosingShift) return;
    const until = Date.now();
    const baseSince = Number(activeShift?.startTime || getTodayStartMs());
    const fallbackShiftId = getCurrentShiftId(activeShift, activeBranchId, currentUser.id) || `shift_${activeBranchId}_${new Date().toISOString().slice(0, 10)}_${currentUser.id}`;
    const latestClosedShift = !activeShift
      ? [...(branchReports || [])]
        .filter(report => Number(report.timestamp || 0) >= getTodayStartMs() && String(report.cashierName || '') === String(currentUser.name || ''))
        .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))[0]
      : null;
    const recoveredAfterClosedShift = !!latestClosedShift && Number(latestClosedShift.timestamp || 0) >= baseSince;
    const since = recoveredAfterClosedShift ? Number(latestClosedShift?.timestamp || baseSince) : baseSince;
    const shiftId = recoveredAfterClosedShift ? createShiftSessionId(activeBranchId, currentUser.id, until) : fallbackShiftId;
    setShiftClosePreview({
      since,
      until,
      shiftId,
      stats: getClosureStats(since, until, recoveredAfterClosedShift ? undefined : shiftId),
      recoveredAfterClosedShift,
    });
  };

  const confirmCloseShift = async () => {
    if (!activeBranchId || !activeBusinessId || !currentUser || isClosingShift || !shiftClosePreview) return;
    const { since, shiftId, stats } = shiftClosePreview;
    setIsClosingShift(true);
    try {
      const now = Date.now();
      const result = await ClosingService.closeShift({
        shiftId,
        startTime: since,
        report: {
          timestamp: now,
          totalSales: stats.totalSales,
          grossSales: stats.grossSales,
          taxTotal: stats.taxTotal,
          cashSales: stats.cashSales,
          mpesaSales: stats.mpesaSales,
          pdqSales: stats.pdqSales,
          totalExpenses: stats.totalExpenses,
          supplierPaymentsTotal: stats.supplierPaymentsTotal,
          remittanceTotal: stats.remittanceTotal,
          totalPicks: stats.totalPicks,
          totalRefunds: 0,
          expectedCash: stats.expectedCash,
          reportedCash: stats.totalPicks,
          difference: stats.cashierVariance,
          cashierName: currentUser.name,
        },
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      const nextShiftStart = Date.now();
      const nextShift = {
        id: createShiftSessionId(activeBranchId, currentUser.id, nextShiftStart),
        startTime: nextShiftStart,
        cashierId: currentUser.id,
        cashierName: currentUser.name,
        status: 'OPEN',
        branchId: activeBranchId,
        businessId: activeBusinessId,
        updated_at: nextShiftStart,
      };
      await Promise.allSettled([
        db.endOfDayReports.reload(),
        db.shifts.reload(),
        db.transactions.reload(),
        db.salesInvoices.reload(),
        db.cashPicks.reload(),
        db.expenses.reload(),
        db.supplierPayments.reload(),
        db.dailySummaries.reload(),
      ]);
      setActiveShift(nextShift);
      void db.shifts.add(nextShift as any).catch(() => {});
      setShiftClosePreview(null);
      if (result.idempotent) {
        warning('That shift was already closed. A fresh shift is ready for the next sales.');
      } else {
        success('Shift closed, report saved, and a fresh shift is ready.');
      }
    } catch (err: any) {
      error(err.message || 'Failed to close shift.');
    } finally {
      setIsClosingShift(false);
    }
  };

  const handleCloseDay = async () => {
    if (!activeBranchId || !activeBusinessId || isClosingDay) return;
    const since = getTodayStartMs();
    if (todaysDailySummary) {
      warning('This branch already has a daily close report for today. A day can only be closed once.');
      return;
    }
    if (!confirm('Close the business day and create today\'s daily close report? This can only be done once per day.')) return;
    const stats = getClosureStats(since);
    const todaysReports = (branchReports || []).filter(report => (report.timestamp || 0) >= since);
    const closedShiftTotals = todaysReports.reduce((totals, report) => ({
      totalSales: totals.totalSales + Number(report.totalSales || 0),
      grossSales: totals.grossSales + Number(report.grossSales || 0),
      taxTotal: totals.taxTotal + Number(report.taxTotal || 0),
      totalExpenses: totals.totalExpenses + Number(report.totalExpenses || 0),
      totalPicks: totals.totalPicks + Number(report.totalPicks || 0),
      totalVariance: totals.totalVariance + Number(report.difference || 0),
    }), { totalSales: 0, grossSales: 0, taxTotal: 0, totalExpenses: 0, totalPicks: 0, totalVariance: 0 });
    const closeTotals = todaysReports.length ? closedShiftTotals : {
      totalSales: stats.totalSales,
      grossSales: stats.grossSales,
      taxTotal: stats.taxTotal,
      totalExpenses: stats.totalExpenses,
      totalPicks: stats.totalPicks,
      totalVariance: stats.cashierVariance,
    };

    setIsClosingDay(true);
    try {
      const result = await ClosingService.closeDay({
        summary: {
          date: since,
          shiftIds: todaysReports.map(report => report.shiftId || report.id),
          totalSales: closeTotals.totalSales,
          grossSales: closeTotals.grossSales,
          taxTotal: closeTotals.taxTotal,
          totalExpenses: closeTotals.totalExpenses,
          totalPicks: closeTotals.totalPicks,
          totalVariance: closeTotals.totalVariance,
        },
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      await db.dailySummaries.reload();
      if (result.idempotent) {
        warning('This branch was already closed today. No second daily close report was created.');
      } else {
        success('Business day closed and daily close report saved.');
      }
    } catch (err: any) {
      error(err.message || 'Failed to close day.');
    } finally {
      setIsClosingDay(false);
    }
  };

  const quickActions = [
    { id: 'REGISTER', label: 'New sale', icon: 'point_of_sale', color: 'bg-primary' },
    { id: 'REPORTS', label: 'Reports', icon: 'analytics', color: 'bg-violet-600' },
    { fn: openExpenseModal, label: 'Add expense', icon: 'payments', color: 'bg-rose-600' },
    { fn: () => setIsCashPickModalOpen(true), label: 'Pick cash', icon: 'payments', color: 'bg-emerald-600' },
    { id: 'REFUNDS', label: 'Refund', icon: 'keyboard_return', color: 'bg-amber-500' },
    { id: 'CUSTOMERS', label: 'Customers', icon: 'group', color: 'bg-teal-600' },
    { id: 'INVENTORY', label: 'Inventory', icon: 'inventory_2', color: 'bg-indigo-600' },
    { fn: handleCloseShift, label: 'Close shift', icon: 'assignment_turned_in', color: 'bg-blue-600', busy: isClosingShift },
    { fn: handleCloseDay, label: 'Close day', icon: 'event_available', color: 'bg-slate-900', busy: isClosingDay },
  ];

  const shiftPreviewStats = shiftClosePreview?.stats;
  const shiftPreviewSaleCount = shiftPreviewStats ? shiftPreviewStats.txs.length + shiftPreviewStats.invoices.length : 0;
  const shiftPreviewVarianceClass = !shiftPreviewStats || shiftPreviewStats.cashierVariance === 0
    ? 'bg-slate-50 text-slate-700 border-slate-100'
    : shiftPreviewStats.cashierVariance > 0
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : 'bg-rose-50 text-rose-700 border-rose-100';
  const shiftPreviewRows = shiftPreviewStats ? [
    { label: 'Total sales', value: money(shiftPreviewStats.totalSales), tone: 'text-slate-900' },
    { label: 'Cash sales', value: money(shiftPreviewStats.cashSales), tone: 'text-emerald-700' },
    { label: 'M-Pesa sales', value: money(shiftPreviewStats.mpesaSales), tone: 'text-green-700' },
    { label: 'Swipe sales', value: money(shiftPreviewStats.pdqSales), tone: 'text-indigo-700' },
    { label: 'Till expenses', value: money(shiftPreviewStats.totalExpenses), tone: 'text-rose-700' },
    { label: 'Supplier till payments', value: money(shiftPreviewStats.supplierPaymentsTotal), tone: 'text-amber-700' },
    { label: 'Cash picked', value: money(shiftPreviewStats.totalPicks), tone: 'text-slate-900' },
    { label: 'Expected cash pick', value: money(shiftPreviewStats.expectedCash), tone: 'text-slate-900' },
  ] : [];

  return (
    <div className="space-y-6 pb-24 animate-in fade-in">
      
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-black text-slate-900">
          Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {currentUser?.name?.split(' ')[0]} 👋
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {activeBranch?.name || 'Main shop'} • {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {ownerModeActive && (
        <div className="bg-white border border-emerald-100 rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-9 h-9 bg-emerald-600 text-white rounded-xl flex items-center justify-center">
                  <MaterialIcon name="verified_user" className="text-lg" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900">Owner console</h3>
                  <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">Auto approvals active</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="text-[10px] font-black text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl">
                  Pending: {pendingApprovalCount || 0}
                </span>
                <span className="text-[10px] font-black text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl">
                  Drawer: Ksh {actualCashDrawer.toLocaleString()}
                </span>
                <span className="text-[10px] font-black text-slate-500 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl">
                  Limit: Ksh {cashDrawerLimit.toLocaleString()}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 lg:min-w-[360px]">
              <button
                onClick={() => {
                  sessionStorage.setItem('mtaani_admin_tab', 'SETTINGS');
                  setActiveTab('ADMIN_PANEL');
                }}
                className="flex-1 px-4 py-3 bg-slate-50 border border-slate-100 text-slate-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all"
              >
                Owner settings
              </button>
              <button
                onClick={handleBankExcessCash}
                disabled={!shouldSweepCash || isBankingExcess}
                data-testid="owner-cash-sweep"
                className={`flex-[1.4] px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${shouldSweepCash ? 'bg-emerald-600 text-white shadow-emerald press' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}
              >
                {isBankingExcess ? 'Banking...' : shouldSweepCash ? `Bank Ksh ${sweepAmount.toLocaleString()}` : 'Cash ok'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCashPickModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !isPickingCash && setIsCashPickModalOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-t-[32px] sm:rounded-3xl bg-white shadow-2xl p-6 sm:p-7 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-lg font-black text-slate-900">Pick cash</h3>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">Record cash removed from drawer</p>
              </div>
              <button
                type="button"
                onClick={() => !isPickingCash && setIsCashPickModalOpen(false)}
                className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 font-black hover:bg-slate-100"
              >
                x
              </button>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 mb-5">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Cash in drawer</p>
              <p className="text-2xl font-black text-emerald-900 tabular-nums mt-1">Ksh {actualCashDrawer.toLocaleString()}</p>
            </div>

            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Amount to pick</label>
            <div className="flex gap-3">
              <input
                type="number"
                min="0"
                step="any"
                value={cashPickAmount}
                onChange={event => setCashPickAmount(event.target.value)}
                placeholder="0"
                className="min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-slate-50 px-5 py-4 text-sm font-black text-slate-900 outline-none focus:border-emerald-500"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setCashPickAmount(String(actualCashDrawer))}
                disabled={actualCashDrawer <= 0}
                className="rounded-2xl border border-slate-200 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40"
              >
                All
              </button>
            </div>

            {cashPickValue > actualCashDrawer && (
              <p className="mt-2 text-[10px] font-bold text-rose-600">Amount is higher than the available drawer cash.</p>
            )}

            <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] gap-3 mt-6">
              <button
                type="button"
                onClick={() => setIsCashPickModalOpen(false)}
                disabled={isPickingCash}
                className="rounded-2xl bg-slate-100 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCashPick}
                disabled={isPickingCash || cashPickValue <= 0 || cashPickValue > actualCashDrawer}
                className="rounded-2xl bg-emerald-600 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white shadow-emerald transition-all disabled:bg-emerald-100 disabled:text-emerald-500 disabled:shadow-none"
              >
                {isPickingCash ? 'Saving...' : 'Save cash pick'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift close review */}
      {shiftClosePreview && shiftPreviewStats && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => !isClosingShift && setShiftClosePreview(null)} />
          <div className="relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-[32px] sm:rounded-3xl bg-white shadow-2xl animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200">
            <div className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-black text-slate-900">Review shift close</h3>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-1">
                    {new Date(shiftClosePreview.since).toLocaleString()} - {new Date(shiftClosePreview.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !isClosingShift && setShiftClosePreview(null)}
                  disabled={isClosingShift}
                  className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 font-black hover:bg-slate-100 disabled:opacity-50"
                >
                  x
                </button>
              </div>

              <div className="rounded-3xl bg-slate-950 text-white p-5 mb-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Shift total</p>
                    <p className="text-3xl font-black tabular-nums mt-1">{money(shiftPreviewStats.totalSales)}</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                    {shiftPreviewSaleCount} sale{shiftPreviewSaleCount === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-5">
                  <div className="rounded-2xl bg-white/10 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Receipts</p>
                    <p className="text-lg font-black">{shiftPreviewStats.txs.length}</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Invoices</p>
                    <p className="text-lg font-black">{shiftPreviewStats.invoices.length}</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Tax</p>
                    <p className="text-lg font-black tabular-nums">{money(shiftPreviewStats.taxTotal)}</p>
                  </div>
                </div>
              </div>

              {shiftPreviewSaleCount === 0 && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 mb-4">
                  <p className="text-[11px] font-bold text-amber-800">No receipts or invoices were found for this shift. You can still close it after reviewing the breakdown.</p>
                </div>
              )}

              {shiftClosePreview.recoveredAfterClosedShift && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 mb-4">
                  <p className="text-[11px] font-bold text-blue-800">A previous shift was already closed today, so this preview only includes activity after that close.</p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {shiftPreviewRows.map(row => (
                  <div key={row.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.label}</p>
                    <p className={`mt-1 text-lg font-black tabular-nums ${row.tone}`}>{row.value}</p>
                  </div>
                ))}
              </div>

              <div className={`mt-4 rounded-2xl border p-4 ${shiftPreviewVarianceClass}`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest">Cash variance</p>
                    <p className="text-[11px] font-bold mt-1 opacity-80">Cash picked minus expected cash pick.</p>
                  </div>
                  <p className="text-xl font-black tabular-nums">{money(shiftPreviewStats.cashierVariance)}</p>
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShiftClosePreview(null)}
                  disabled={isClosingShift}
                  className="rounded-2xl bg-slate-100 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmCloseShift}
                  disabled={isClosingShift}
                  className="rounded-2xl bg-blue-600 px-4 py-4 text-[10px] font-black uppercase tracking-widest text-white shadow-indigo transition-all disabled:bg-blue-100 disabled:text-blue-500 disabled:shadow-none"
                >
                  {isClosingShift ? 'Closing...' : 'Close shift now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Total sales"
          value={`Ksh ${totalRevenue.toLocaleString()}`}
          sub="Today's revenue"
          trend={percentChange(totalRevenue, yesterdaysRevenue)}
          icon="payments"
          color="bg-primary"
        />
        <StatCard
          label="Sales"
          value={todaysSalesCount || 0}
          sub="Sales and invoices today"
          trend={percentChange(todaysSalesCount, yesterdaysSalesCount)}
          icon="receipt_long"
          color="bg-violet-600"
        />
        <StatCard
          label="Avg. sale"
          value={`Ksh ${todaysAverageSale.toLocaleString()}`}
          sub="Per transaction"
          trend={percentChange(todaysAverageSale, yesterdaysAverageSale)}
          icon="trending_up"
          color="bg-amber-500"
        />
        <StatCard
          label="Low stock"
          value={lowStockItems.length}
          sub="Items almost out of stock"
          icon="inventory"
          color="bg-rose-600"
        />
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-black text-slate-900">Payments today</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cash, M-Pesa, credit, and swipe</p>
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {paymentBreakdown.map(item => (
            <div key={item.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="flex items-center gap-3">
                <span className={`w-9 h-9 rounded-xl ${item.color} text-white flex items-center justify-center shrink-0`}>
                  <MaterialIcon name={item.icon} className="text-base" />
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{item.label}</p>
                  <p className="text-sm font-black text-slate-900 tabular-nums truncate">Ksh {item.value.toLocaleString()}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content: Chart + Right Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Chart */}
        <div className="lg:col-span-8 bg-white border border-slate-100 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-black text-slate-900">Sales performance</h3>
              <p className="text-[11px] text-slate-500 mt-0.5 font-medium">Revenue over time</p>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              {(['DAY', 'WEEK'] as const).map(v => (
                <button 
                  key={v}
                  onClick={() => setTrendView(v)}
                  className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${trendView === v ? 'bg-white shadow text-primary' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {v === 'DAY' ? 'Today' : 'Weekly'}
                </button>
              ))}
            </div>
          </div>
          <div ref={chartRef} className="h-56 min-w-0">
            {chartWidth > 0 ? (
              <AreaChart width={chartWidth} height={224} data={salesTrendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#003d9b" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#003d9b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} dy={8} />
                <YAxis hide />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '12px', fontWeight: 700 }}
                  labelStyle={{ color: '#003d9b', fontWeight: 800 }}
                  formatter={(v: any) => [`Ksh ${v.toLocaleString()}`, 'Sales']}
                />
                <Area type="monotone" dataKey="sales" stroke="#003d9b" strokeWidth={2.5} fill="url(#salesGrad)" dot={false} activeDot={{ r: 5, fill: '#003d9b', stroke: 'white', strokeWidth: 2 }} />
              </AreaChart>
            ) : (
              <div className="h-full w-full rounded-xl bg-slate-50" />
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="lg:col-span-4 space-y-4">
          
          {/* Quick Actions */}
          <div className="bg-white border border-slate-100 rounded-2xl p-5">
            <h3 className="text-sm font-bold text-slate-700 mb-4">Quick actions</h3>
            <div className="grid grid-cols-3 gap-2">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => (action as any).fn ? (action as any).fn() : setActiveTab((action as any).id)}
                  data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-slate-50 transition-all group"
                >
                  <div className={`w-10 h-10 ${action.color} rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform`}>
                    <MaterialIcon name={action.icon} className="text-white text-lg" />
                  </div>
                  <span className="text-[11px] font-semibold text-slate-600 text-center leading-tight">{(action as any).busy ? 'Working...' : action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Low Stock Alert */}
          {lowStockItems.length > 0 && (
            <div className="bg-rose-50 border border-rose-100 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-rose-600 rounded-lg flex items-center justify-center">
                  <MaterialIcon name="warning" className="text-white text-sm" />
                </div>
                <div>
                  <h4 className="text-[11px] font-black text-rose-900">Low stock alert</h4>
                  <p className="text-[9px] font-medium text-rose-600">{lowStockItems.length} items almost out of stock</p>
                </div>
              </div>
              <div className="space-y-2">
                {lowStockItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between py-1.5 border-t border-rose-100">
                    <span className="text-[11px] font-medium text-rose-800 truncate mr-2">{item.name}</span>
                    <span className="text-[10px] font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full flex-shrink-0">
                      {item.stockQuantity} left
                    </span>
                  </div>
                ))}
              </div>
              <button onClick={() => setActiveTab('INVENTORY')} className="w-full mt-3 py-2 text-[10px] font-black text-rose-700 uppercase tracking-widest bg-white border border-rose-200 rounded-xl hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-all">
                Manage stock
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">Recent transactions</h3>
          <button onClick={() => setActiveTab('DOCUMENTS')} className="text-[10px] font-black text-primary uppercase tracking-widest hover:underline">View all</button>
        </div>
        <div className="divide-y divide-slate-50">
          {transactions?.map(tx => (
            <div key={tx.id} className="px-6 py-3.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tx.status === 'PAID' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  <MaterialIcon name={tx.paymentMethod === 'MPESA' ? 'smartphone' : tx.paymentMethod === 'CASH' ? 'payments' : 'credit_card'} className={`text-base ${tx.status === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`} />
                </div>
                <div>
                  <p className="text-[12px] font-bold text-slate-800">#{tx.id.slice(-8).toUpperCase()}</p>
                  <p className="text-[10px] text-slate-400 font-medium">
                    {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {tx.items.length} item{tx.items.length !== 1 ? 's' : ''}
                    {tx.cashierName && ` • ${tx.cashierName}`}
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[13px] font-black text-slate-900">Ksh {tx.total.toLocaleString()}</p>
                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest ${tx.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {tx.status === 'PAID' ? 'Paid' : tx.status === 'PENDING_REFUND' ? 'Pending refund' : tx.status}
                </span>
              </div>
            </div>
          ))}
          {(!transactions || transactions.length === 0) && (
            <div className="px-6 py-12 text-center">
              <MaterialIcon name="receipt_long" className="text-slate-300 text-5xl" />
              <p className="text-slate-400 text-sm font-medium mt-3">No transactions yet today</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
