import {
  DashboardHeader,
  MetricTile,
  MoneyBreakdownPanel,
  OwnerConsole,
  SalesChartPanel,
} from './DashboardSharedMobile';
import type { DashboardModel } from './types';

export default function DashboardMobile({ model }: { model: DashboardModel }) {
  const showSalesTrend = model.canSeeSalesData && model.salesTrendData.length > 0;

  return (
    <div className="space-y-4 pb-24">
      <DashboardHeader model={model} compact />
      <OwnerConsole model={model} />

      {model.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-3 px-3 sm:px-0">
          {model.metrics.map(metric => (
            <div key={metric.label}>
              <MetricTile metric={metric} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4 px-3 sm:px-0">
        <MoneyBreakdownPanel model={model} />
        {showSalesTrend && <SalesChartPanel model={model} />}
      </div>
    </div>
  );
}
