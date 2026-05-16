import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { canUseOwnerMode, getCashDrawerLimit, getCashFloatTarget, isOwnerCashSweepEnabled, isOwnerModeEnabled } from '../../utils/ownerMode';
import { recordAuditEvent } from '../../utils/auditLog';
import { enrichProductsWithBundleStock } from '../../utils/bundleInventory';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getBusinessSettings } from '../../utils/settings';
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
      <span className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
        <MaterialIcon name={trend >= 0 ? 'trending_up' : 'trending_down'} className="text-xs" />
        {Math.abs(trend)}%
      </span>
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

export default function DashboardTab({ setActiveTab, openExpenseModal }: DashboardTabProps) {
  const [trendView, setTrendView] = useState<'DAY' | 'WEEK'>('DAY');
  const [isBankingExcess, setIsBankingExcess] = useState(false);
  const [isClosingShift, setIsClosingShift] = useState(false);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const setActiveShift = useStore(state => state.setActiveShift);
  const { success, error, warning } = useToast();
  const branches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const activeBranch = branches?.find(b => b.id === activeBranchId);

  const transactions = useLiveQuery(
    () => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).reverse().limit(8).toArray() : [],
    [activeBranchId], []
  );

  const products = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : [],
    [activeBusinessId], []
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const branchTransactions = useLiveQuery(
    () => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const branchSalesInvoices = useLiveQuery(
    () => activeBranchId ? db.salesInvoices.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const branchExpenses = useLiveQuery(
    () => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const branchCashPicks = useLiveQuery(
    () => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const branchSupplierPayments = useLiveQuery(
    () => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const branchCustomerPayments = useLiveQuery(
    () => activeBranchId ? db.customerPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const branchReports = useLiveQuery(
    () => activeBranchId ? db.endOfDayReports.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
    [activeBranchId], []
  );
  const pendingApprovalCount = useLiveQuery(async () => {
    if (!activeBranchId) return 0;
    const [expenses, refunds, purchaseOrders, picks] = await Promise.all([
      db.expenses.where('branchId').equals(activeBranchId).and(row => row.status === 'PENDING').toArray(),
      db.transactions.where('branchId').equals(activeBranchId).and(row => row.status === 'PENDING_REFUND').toArray(),
      db.purchaseOrders.where('branchId').equals(activeBranchId).and(row => row.approvalStatus === 'PENDING').toArray(),
      db.cashPicks.where('branchId').equals(activeBranchId).and(row => row.status === 'PENDING').toArray(),
    ]);
    return expenses.length + refunds.length + purchaseOrders.length + picks.length;
  }, [activeBranchId], 0);

  const displayProducts = enrichProductsWithBundleStock(products || [], productIngredients || []);
  const lowStockItems = displayProducts.filter(p => (p.stockQuantity || 0) <= (p.reorderPoint || 5)).slice(0, 5) || [];
  const todaysTransactions = (branchTransactions || []).filter(t => (t.timestamp || 0) >= getTodayStartMs() && t.status !== 'VOIDED' && t.status !== 'QUOTE');
  const todaysInvoices = (branchSalesInvoices || []).filter(invoice => (invoice.issueDate || 0) >= getTodayStartMs() && invoice.status !== 'CANCELLED');
  const todaysSalesCount = todaysTransactions.length + todaysInvoices.length;
  const totalRevenue = todaysTransactions.reduce((a, t) => a + Number(t.total || 0), 0)
    + todaysInvoices.reduce((a, invoice) => a + Number(invoice.total || 0), 0);
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
  const cashFloatTarget = getCashFloatTarget(businessSettings);

  const actualCashDrawer = Math.max(0, calculateCashDrawer({
    transactions: branchTransactions || [],
    expenses: branchExpenses || [],
    cashPicks: branchCashPicks || [],
    supplierPayments: branchSupplierPayments || [],
    customerPayments: branchCustomerPayments || [],
    since: getTodayStartMs(),
  }).actualCashDrawer);
  const sweepAmount = Math.max(0, actualCashDrawer - cashFloatTarget);
  const shouldSweepCash = cashSweepActive && actualCashDrawer > cashDrawerLimit && sweepAmount > 0;

  const handleBankExcessCash = async () => {
    if (!activeBranchId || !activeBusinessId || !currentUser || !shouldSweepCash || isBankingExcess) return;
    setIsBankingExcess(true);
    try {
      await db.cashPicks.add({
        id: crypto.randomUUID(),
        amount: sweepAmount,
        timestamp: Date.now(),
        status: 'APPROVED',
        userName: currentUser.name,
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      recordAuditEvent({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'cash.pick.owner_sweep',
        entity: 'cashPick',
        severity: 'INFO',
        details: `Owner cash sweep recorded for Ksh ${sweepAmount.toLocaleString()}`,
      });
      success(`Banked Ksh ${sweepAmount.toLocaleString()} and left Ksh ${cashFloatTarget.toLocaleString()} in drawer.`);
    } catch (err: any) {
      error(err.message || 'Cash sweep failed.');
    } finally {
      setIsBankingExcess(false);
    }
  };

  const getClosureStats = (since: number, until = Date.now()) => {
    const txs = (branchTransactions || []).filter(t => (t.timestamp || 0) >= since && (t.timestamp || 0) <= until && t.status !== 'VOIDED');
    const invoices = (branchSalesInvoices || []).filter(invoice => (invoice.issueDate || 0) >= since && (invoice.issueDate || 0) <= until && invoice.status !== 'CANCELLED');
    const expenses = (branchExpenses || []).filter(e => (e.timestamp || 0) >= since && (e.timestamp || 0) <= until && e.status !== 'REJECTED');
    const picks = (branchCashPicks || []).filter(p => (p.timestamp || 0) >= since && (p.timestamp || 0) <= until && p.status !== 'REJECTED');
    const supplierPayments = (branchSupplierPayments || []).filter(p => (p.timestamp || 0) >= since && (p.timestamp || 0) <= until);
    const customerPayments = (branchCustomerPayments || []).filter(p => (p.timestamp || 0) >= since && (p.timestamp || 0) <= until);
    const drawer = calculateCashDrawer({ transactions: txs, expenses, cashPicks: picks, supplierPayments, customerPayments, since });
    const mpesaSales = txs.reduce((sum, tx) => {
      if (tx.paymentMethod === 'MPESA') return sum + Number(tx.total || 0);
      if (tx.paymentMethod === 'SPLIT' && tx.splitPayments?.secondaryMethod === 'MPESA') return sum + Number(tx.splitPayments.secondaryAmount || 0);
      return sum;
    }, 0);
    const grossSales = txs.reduce((sum, tx) => sum + Number(tx.subtotal ?? tx.total ?? 0), 0)
      + invoices.reduce((sum, invoice) => sum + Number(invoice.subtotal || invoice.total || 0), 0);
    const totalSales = txs.reduce((sum, tx) => sum + Number(tx.total || 0), 0)
      + invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
    const taxTotal = txs.reduce((sum, tx) => sum + Number(tx.tax || 0), 0)
      + invoices.reduce((sum, invoice) => sum + Number(invoice.tax || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const totalPicks = picks.reduce((sum, p) => sum + Number(p.amount || 0), 0);

    return {
      txs,
      grossSales,
      totalSales,
      taxTotal,
      cashSales: drawer.cashSales + drawer.customerCashPayments,
      mpesaSales,
      totalExpenses,
      totalPicks,
      expectedCash: Math.max(0, drawer.actualCashDrawer),
    };
  };

  const handleCloseShift = async () => {
    if (!activeBranchId || !activeBusinessId || !currentUser || isClosingShift) return;
    const since = Number(activeShift?.startTime || getTodayStartMs());
    const stats = getClosureStats(since);
    if (stats.txs.length === 0 && !confirm('No sales found for this shift. Close it anyway?')) return;

    const reportedInput = window.prompt('Enter counted cash in drawer', String(Math.round(stats.expectedCash)));
    if (reportedInput === null) return;
    const reportedCash = Number(reportedInput);
    if (!Number.isFinite(reportedCash) || reportedCash < 0) return warning('Enter a valid counted cash amount.');

    setIsClosingShift(true);
    try {
      const now = Date.now();
      const shiftId = activeShift?.id || `shift_${activeBranchId}_${new Date().toISOString().slice(0, 10)}_${currentUser.id}`;
      await db.endOfDayReports.add({
        id: `eod_${activeBranchId}_${now}`,
        shiftId,
        timestamp: now,
        totalSales: stats.totalSales,
        grossSales: stats.grossSales,
        taxTotal: stats.taxTotal,
        cashSales: stats.cashSales,
        mpesaSales: stats.mpesaSales,
        totalExpenses: stats.totalExpenses,
        totalPicks: stats.totalPicks,
        totalRefunds: 0,
        expectedCash: stats.expectedCash,
        reportedCash,
        difference: reportedCash - stats.expectedCash,
        cashierName: currentUser.name,
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });

      if (activeShift?.id) {
        await db.shifts.update(activeShift.id, { status: 'CLOSED', endTime: now, updated_at: now });
      } else {
        await db.shifts.add({
          id: shiftId,
          startTime: since,
          endTime: now,
          cashierName: currentUser.name,
          status: 'CLOSED',
          branchId: activeBranchId,
          businessId: activeBusinessId,
        } as any);
      }
      setActiveShift(null);
      success('Shift closed and Z-report saved.');
    } catch (err: any) {
      error(err.message || 'Failed to close shift.');
    } finally {
      setIsClosingShift(false);
    }
  };

  const handleCloseDay = async () => {
    if (!activeBranchId || !activeBusinessId || isClosingDay) return;
    if (!confirm('Close the business day and create the daily summary?')) return;
    const since = getTodayStartMs();
    const stats = getClosureStats(since);
    const todaysReports = (branchReports || []).filter(report => (report.timestamp || 0) >= since);

    setIsClosingDay(true);
    try {
      await db.dailySummaries.add({
        id: `day_${activeBranchId}_${new Date().toISOString().slice(0, 10)}_${Date.now()}`,
        date: since,
        shiftIds: todaysReports.map(report => report.shiftId || report.id),
        totalSales: stats.totalSales,
        grossSales: stats.grossSales,
        taxTotal: stats.taxTotal,
        totalExpenses: stats.totalExpenses,
        totalPicks: stats.totalPicks,
        totalVariance: todaysReports.reduce((sum, report) => sum + Number(report.difference || 0), 0),
        timestamp: Date.now(),
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      success('Business day closed and daily summary saved.');
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
    { id: 'REFUNDS', label: 'Refund', icon: 'keyboard_return', color: 'bg-amber-500' },
    { id: 'CUSTOMERS', label: 'Customers', icon: 'group', color: 'bg-teal-600' },
    { id: 'INVENTORY', label: 'Inventory', icon: 'inventory_2', color: 'bg-indigo-600' },
    { fn: handleCloseShift, label: 'Close shift', icon: 'assignment_turned_in', color: 'bg-blue-600', busy: isClosingShift },
    { fn: handleCloseDay, label: 'Close day', icon: 'event_available', color: 'bg-slate-900', busy: isClosingDay },
  ];

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

      {/* KPI Grid — 2x2 */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Total sales"
          value={`Ksh ${totalRevenue.toLocaleString()}`}
          sub="Today's revenue"
          trend={12.4}
          icon="payments"
          color="bg-primary"
        />
        <StatCard
          label="Sales"
          value={todaysSalesCount || 0}
          sub="Sales and invoices today"
          trend={5.2}
          icon="receipt_long"
          color="bg-violet-600"
        />
        <StatCard
          label="Avg. sale"
          value={`Ksh ${todaysSalesCount ? Math.round(totalRevenue / todaysSalesCount).toLocaleString() : 0}`}
          sub="Per transaction"
          trend={-2.1}
          icon="trending_up"
          color="bg-amber-500"
        />
        <StatCard
          label="Low stock"
          value={lowStockItems.length}
          sub="Items need restocking"
          trend={-lowStockItems.length}
          icon="inventory"
          color="bg-rose-600"
        />
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
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesTrendData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
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
            </ResponsiveContainer>
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
                  <p className="text-[9px] font-medium text-rose-600">{lowStockItems.length} items need restocking</p>
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
