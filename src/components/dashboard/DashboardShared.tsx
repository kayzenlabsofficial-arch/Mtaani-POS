import { useEffect, useRef, useState, type ElementType } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
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
import type { DashboardMetric, DashboardModel, DashboardMoneyBreakdown, DashboardQuickAction } from './types';

export const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

export const MaterialIcon = ({ name, className = '' }: { name: string; className?: string }) => {
  const icons: Record<string, ElementType> = {
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
  const size = sizeMatch?.[1]
    ? Number(sizeMatch[1])
    : className.includes('text-xs')
      ? 14
      : className.includes('text-sm')
        ? 16
        : className.includes('text-base')
          ? 18
          : className.includes('text-lg')
            ? 20
            : 20;
  return <Icon className={className} size={size} strokeWidth={2.4} />;
};

export function DashboardHeader({ model, compact = false }: { model: DashboardModel; compact?: boolean }) {
  const name = model.currentUser?.name?.split(' ')[0] || 'there';
  const shopName = String(model.activeShop?.name || 'Main shop');
  return (
    <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:rounded-lg lg:border-2 lg:px-5">
      <div className="min-w-0">
        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{shopName}</p>
        <h2 className={`${compact ? 'text-xl' : 'text-2xl'} mt-1 font-black text-slate-950`}>Dashboard</h2>
        <p className="mt-1 text-sm font-medium text-slate-600">
          {name} / {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>
    </div>
  );
}

export function OwnerConsole({ model }: { model: DashboardModel }) {
  if (!model.ownerModeActive) return null;

  return (
    <section className="rounded-lg border-2 border-emerald-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700">
              <MaterialIcon name="verified_user" className="text-lg" />
            </span>
            <div>
              <h3 className="text-sm font-black text-slate-950">Owner console</h3>
              <p className="text-[11px] font-semibold text-slate-500">Approvals and drawer controls</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-slate-700">
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">Pending {model.pendingApprovalCount || 0}</span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">Drawer {money(model.actualCashDrawer)}</span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5">Limit {money(model.cashDrawerLimit)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:min-w-80">
          <button
            type="button"
            onClick={model.openOwnerSettings}
            className="h-11 rounded-lg border-2 border-slate-300 bg-white px-3 text-xs font-black text-slate-700"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={model.handleBankExcessCash}
            disabled={!model.shouldSweepCash || model.isBankingExcess}
            className={`h-11 rounded-lg border-2 px-3 text-xs font-black ${
              model.shouldSweepCash
                ? 'border-emerald-700 bg-emerald-600 text-white'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            } disabled:opacity-60`}
          >
            {model.isBankingExcess ? 'Banking' : model.shouldSweepCash ? `Bank ${money(model.sweepAmount)}` : 'Cash OK'}
          </button>
        </div>
      </div>
    </section>
  );
}

export function MetricTile({ metric }: { metric: DashboardMetric }) {
  const trend = Number(metric.trend);
  const hasTrend = Number.isFinite(trend);
  const iconTone = metric.icon === 'payments'
    ? 'text-emerald-700'
    : metric.icon === 'warning'
      ? 'text-rose-600'
      : metric.icon === 'credit_card'
        ? 'text-slate-500'
        : 'text-blue-700';
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-md ${iconTone}`}>
          <MaterialIcon name={metric.icon} className="text-lg" />
        </span>
        {hasTrend && (
          <span className={`px-1 text-sm font-semibold ${trend >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {trend >= 0 ? '+' : ''}{trend.toLocaleString(undefined, { maximumFractionDigits: 1 })}%
          </span>
        )}
      </div>
      <p className="mt-7 text-sm font-medium uppercase text-slate-800">{metric.label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums text-slate-950">{metric.value}</p>
    </div>
  );
}

export function QuickActions({ actions }: { actions: DashboardQuickAction[] }) {
  return (
    <section className="rounded-lg border-2 border-slate-200 bg-white p-4">
      <h3 className="text-sm font-black text-slate-950">Actions</h3>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {actions.map(action => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            data-testid={`quick-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
            className="min-h-20 rounded-lg border-2 border-slate-200 bg-white px-2 py-3 text-center transition-colors hover:border-blue-300 hover:bg-blue-50"
          >
            <span className={`mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-white ${action.color}`}>
              <MaterialIcon name={action.icon} className="text-base" />
            </span>
            <span className="mt-2 block text-[11px] font-bold leading-tight text-slate-700">{action.busy ? 'Working' : action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function MoneyBreakdownItem({ item }: { item: DashboardMoneyBreakdown }) {
  return (
    <div className="rounded-lg border border-slate-300 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{item.label}</p>
          <p className="mt-2 text-xl font-black tabular-nums text-slate-950">{item.value}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">{item.detail}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${item.tone}`}>
          <MaterialIcon name={item.icon} className="text-lg" />
        </span>
      </div>
    </div>
  );
}

export function MoneyBreakdownPanel({ model }: { model: DashboardModel }) {
  if (!model.canSeeSalesData) return null;

  return (
    <section className="rounded-lg border-2 border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-sm font-black text-slate-950">Money breakdown</h3>
        <p className="text-[11px] font-semibold text-slate-500">Today by collection type</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
        {model.moneyBreakdown.map(item => (
          <div key={item.label}>
            <MoneyBreakdownItem item={item} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function SalesChartPanel({ model }: { model: DashboardModel }) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const updateWidth = () => setChartWidth(Math.max(0, Math.floor(element.getBoundingClientRect().width)));
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!model.canSeeSalesData) return null;

  return (
    <section className="rounded-lg border-2 border-slate-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-950">Sales trend</h3>
          <p className="text-[11px] font-semibold text-slate-500">Day and weekly sales movement</p>
        </div>
        <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-1">
          {(['DAY', 'WEEK'] as const).map(view => (
            <button
              key={view}
              type="button"
              onClick={() => model.setTrendView(view)}
              className={`h-8 rounded-md px-3 text-[11px] font-black ${model.trendView === view ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
            >
              {view === 'DAY' ? 'Day' : 'Weekly'}
            </button>
          ))}
        </div>
      </div>
      <div ref={chartRef} className="h-56 min-w-0">
        {chartWidth > 0 ? (
          <BarChart width={chartWidth} height={224} data={model.salesTrendData} margin={{ top: 6, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11, fontWeight: 700 }} dy={8} />
            <YAxis hide />
            <Tooltip
              contentStyle={{ borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 12px 24px rgba(15, 23, 42, 0.12)', fontSize: '12px', fontWeight: 700 }}
              labelStyle={{ color: '#0f172a', fontWeight: 800 }}
              formatter={(value: any) => [money(value), 'Sales']}
            />
            <Bar dataKey="sales" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={56} />
          </BarChart>
        ) : (
          <div className="h-full w-full rounded-lg border border-slate-200 bg-slate-50" />
        )}
      </div>
    </section>
  );
}
