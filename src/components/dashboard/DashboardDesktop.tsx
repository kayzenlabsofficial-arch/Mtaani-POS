import {
  DashboardHeader,
  MetricTile,
  MoneyBreakdownPanel,
  OwnerConsole,
  SalesChartPanel,
} from './DashboardSharedDesktop';
import type { DashboardModel } from './types';

function CashierNotice() {
  return (
    <section className="rounded-lg border-2 border-blue-200 bg-white p-5">
      <p className="text-[11px] font-black uppercase tracking-widest text-blue-700">Cashier dashboard</p>
      <h3 className="mt-1 text-lg font-black text-slate-950">Sales totals are locked for admin review.</h3>
      <p className="mt-2 text-sm font-semibold text-slate-600">Use the header buttons to pick cash or close the shift.</p>
    </section>
  );
}

export default function DashboardDesktop({ model }: { model: DashboardModel }) {
  return (
    <div className="space-y-5 pb-10">
      <DashboardHeader model={model} />
      <OwnerConsole model={model} />
      {!model.canSeeSalesData && <CashierNotice />}

      {model.metrics.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {model.metrics.map(metric => (
            <div key={metric.label}>
              <MetricTile metric={metric} />
            </div>
          ))}
        </div>
      )}

      {model.canSeeSalesData ? (
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-8 h-full">
            <SalesChartPanel model={model} />
          </div>
          <div className="col-span-4 space-y-5">
            <MoneyBreakdownPanel model={model} />
          </div>
        </div>
      ) : (
        <MoneyBreakdownPanel model={model} />
      )}
    </div>
  );
}
