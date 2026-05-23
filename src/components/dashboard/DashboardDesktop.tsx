import {
  DashboardHeader,
  MetricTile,
  MoneyBreakdownPanel,
  OwnerConsole,
  QuickActions,
  SalesChartPanel,
} from './DashboardShared';
import type { DashboardModel } from './types';

function CashierNotice() {
  return (
    <section className="rounded-lg border-2 border-blue-200 bg-white p-5">
      <p className="text-[11px] font-black uppercase tracking-widest text-blue-700">Cashier dashboard</p>
      <h3 className="mt-1 text-lg font-black text-slate-950">Sales totals are locked for admin review.</h3>
      <p className="mt-2 text-sm font-semibold text-slate-600">Use the actions panel to pick cash, close the shift, or return to register.</p>
    </section>
  );
}

export default function DashboardDesktop({ model }: { model: DashboardModel }) {
  return (
    <div className="hidden space-y-5 pb-10 lg:block">
      <DashboardHeader model={model} />
      <OwnerConsole model={model} />
      {!model.canSeeSalesData && <CashierNotice />}

      {model.canSeeSalesData && (
        <div className="grid grid-cols-4 gap-4">
          {model.metrics.map(metric => (
            <div key={metric.label}>
              <MetricTile metric={metric} />
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        <div className={model.canSeeSalesData ? 'col-span-8' : 'col-span-7'}>
          <SalesChartPanel model={model} />
          {!model.canSeeSalesData && <QuickActions actions={model.quickActions} />}
        </div>
        <div className={model.canSeeSalesData ? 'col-span-4 space-y-5' : 'col-span-5 space-y-5'}>
          {model.canSeeSalesData && <MoneyBreakdownPanel model={model} />}
          {model.canSeeSalesData && <QuickActions actions={model.quickActions} />}
        </div>
      </div>
    </div>
  );
}
