import { useLiveQuery } from '../clouddb';
import { db } from '../db';
import { useStore } from '../store';
import { calculateCashDrawer, getTodayStartMs } from '../utils/cashDrawer';
import { getCurrentShiftId, getCurrentShiftStart } from '../utils/shiftSession';

export function useTillCash() {
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const currentShiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);
  const currentShiftStart = getCurrentShiftStart(activeShift, getTodayStartMs());

  const transactions = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.transactions.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const expenses = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.expenses.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const cashPicks = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.cashPicks.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const refunds = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.refunds.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const supplierPayments = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.supplierPayments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const customerPayments = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.customerPayments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );

  const drawer = calculateCashDrawer({
    transactions: transactions || [],
    expenses: expenses || [],
    cashPicks: cashPicks || [],
    refunds: refunds || [],
    supplierPayments: supplierPayments || [],
    customerPayments: customerPayments || [],
    openingCash: Number(activeShift?.openingCash || 0),
    since: currentShiftStart,
    shiftId: currentShiftId,
  });

  return {
    ...drawer,
    currentShiftId,
    currentShiftStart,
    hasOpenShift: !!currentShiftId && String(activeShift?.status || '').toUpperCase() === 'OPEN',
  };
}
