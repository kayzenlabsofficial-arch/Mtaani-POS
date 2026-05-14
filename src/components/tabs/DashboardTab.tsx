import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { canUseOwnerMode, getCashDrawerLimit, getCashFloatTarget, isOwnerCashSweepEnabled, isOwnerModeEnabled } from '../../utils/ownerMode';
import { recordAuditEvent } from '../../utils/auditLog';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

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

const chartData = [
  { time: '08:00', sales: 4200 },
  { time: '10:00', sales: 8100 },
  { time: '12:00', sales: 15200 },
  { time: '14:00', sales: 19800 },
  { time: '16:00', sales: 12400 },
  { time: '18:00', sales: 21000 },
  { time: '20:00', sales: 14500 },
  { time: '22:00', sales: 7200 },
];

export default function DashboardTab({ setActiveTab, openExpenseModal }: DashboardTabProps) {
  const [trendView, setTrendView] = useState<'DAY' | 'WEEK'>('DAY');
  const [isBankingExcess, setIsBankingExcess] = useState(false);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const { success, error } = useToast();
  const branches = useLiveQuery(() => db.branches.toArray(), []);
  const activeBranch = branches?.find(b => b.id === activeBranchId);

  const transactions = useLiveQuery(
    () => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).reverse().limit(8).toArray() : [],
    [activeBranchId], []
  );

  const products = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : [],
    [activeBusinessId], []
  );
  const businessSettings = useLiveQuery(() => activeBusinessId ? db.settings.get('core') : Promise.resolve(undefined), [activeBusinessId]);
  const branchTransactions = useLiveQuery(
    () => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]),
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

  const lowStockItems = products?.filter(p => (p.stockQuantity || 0) <= (p.reorderPoint || 5)).slice(0, 5) || [];
  const totalRevenue = transactions?.reduce((a, t) => a + t.total, 0) || 0;
  const ownerModeActive = canUseOwnerMode(currentUser) && isOwnerModeEnabled(businessSettings);
  const cashSweepActive = ownerModeActive && isOwnerCashSweepEnabled(businessSettings);
  const cashDrawerLimit = getCashDrawerLimit(businessSettings);
  const cashFloatTarget = getCashFloatTarget(businessSettings);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cashSalesToday = (branchTransactions || [])
    .filter(t => (t.timestamp || 0) >= todayStart.getTime() && t.status === 'PAID')
    .reduce((sum, t: any) => {
      if (t.paymentMethod === 'CASH') return sum + (t.total || 0);
      if (t.paymentMethod === 'SPLIT') return sum + (t.splitPayments?.cashAmount || t.splitData?.cashAmount || 0);
      return sum;
    }, 0);
  const tillExpensesToday = (branchExpenses || [])
    .filter(e => (e.timestamp || 0) >= todayStart.getTime() && e.source === 'TILL' && e.status !== 'REJECTED')
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const cashPicksToday = (branchCashPicks || [])
    .filter(p => (p.timestamp || 0) >= todayStart.getTime())
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const actualCashDrawer = Math.max(0, cashSalesToday - tillExpensesToday - cashPicksToday);
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

  const quickActions = [
    { id: 'REGISTER', label: 'New Sale', icon: 'point_of_sale', color: 'bg-primary' },
    { id: 'REPORTS', label: 'Reports', icon: 'analytics', color: 'bg-violet-600' },
    { fn: openExpenseModal, label: 'Add Expense', icon: 'payments', color: 'bg-rose-600' },
    { id: 'REFUNDS', label: 'Refund', icon: 'keyboard_return', color: 'bg-amber-500' },
    { id: 'CUSTOMERS', label: 'Customers', icon: 'group', color: 'bg-teal-600' },
    { id: 'INVENTORY', label: 'Inventory', icon: 'inventory_2', color: 'bg-indigo-600' },
  ];

  return (
    <div className="space-y-6 pb-24 animate-in fade-in">
      
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-black text-slate-900">
          Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {currentUser?.name?.split(' ')[0]} 👋
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          {activeBranch?.name || 'Main Shop'} • {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
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
                  <h3 className="text-sm font-black text-slate-900">Owner Console</h3>
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
                Owner Settings
              </button>
              <button
                onClick={handleBankExcessCash}
                disabled={!shouldSweepCash || isBankingExcess}
                className={`flex-[1.4] px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${shouldSweepCash ? 'bg-emerald-600 text-white shadow-emerald press' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}
              >
                {isBankingExcess ? 'Banking...' : shouldSweepCash ? `Bank Ksh ${sweepAmount.toLocaleString()}` : 'Cash OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Grid — 2x2 */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Total Sales"
          value={`Ksh ${totalRevenue.toLocaleString()}`}
          sub="Today's revenue"
          trend={12.4}
          icon="payments"
          color="bg-primary"
        />
        <StatCard
          label="Transactions"
          value={transactions?.length || 0}
          sub="Sales today"
          trend={5.2}
          icon="receipt_long"
          color="bg-violet-600"
        />
        <StatCard
          label="Avg. Sale"
          value={`Ksh ${transactions?.length ? Math.round(totalRevenue / transactions.length).toLocaleString() : 0}`}
          sub="Per transaction"
          trend={-2.1}
          icon="trending_up"
          color="bg-amber-500"
        />
        <StatCard
          label="Low Stock"
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
              <h3 className="text-base font-black text-slate-900">Sales Performance</h3>
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
              <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
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
            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Quick Actions</h3>
            <div className="grid grid-cols-3 gap-2">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => (action as any).fn ? (action as any).fn() : setActiveTab((action as any).id)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-slate-50 transition-all group"
                >
                  <div className={`w-10 h-10 ${action.color} rounded-xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform`}>
                    <MaterialIcon name={action.icon} className="text-white text-lg" />
                  </div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight text-center">{action.label}</span>
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
                  <h4 className="text-[11px] font-black text-rose-900">Low Stock Alert</h4>
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
                Manage Stock
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900">Recent Transactions</h3>
          <button onClick={() => setActiveTab('DOCUMENTS')} className="text-[10px] font-black text-primary uppercase tracking-widest hover:underline">View All</button>
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
                  {tx.status}
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
