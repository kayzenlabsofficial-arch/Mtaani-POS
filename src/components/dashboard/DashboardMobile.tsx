import {
  DashboardHeader,
  MetricTile,
  MoneyBreakdownPanel,
  OwnerConsole,
  QuickActions,
  SalesChartPanel,
} from './DashboardShared';
import type { DashboardModel } from './types';

export default function DashboardMobile({ model }: { model: DashboardModel }) {
  return (
    <div className="space-y-4 pb-24 lg:hidden">
      <DashboardHeader model={model} compact />
      <OwnerConsole model={model} />

      {model.canSeeSalesData && (
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
        <SalesChartPanel model={model} />
        <QuickActions actions={model.quickActions} />
      </div>
    </div>
  );
}
