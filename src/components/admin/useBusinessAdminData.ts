import React from 'react';
import { useLiveQuery } from '../../clouddb';
import { db, type AuditLog } from '../../db';
import { useStore } from '../../store';
import { AdminStatusService, StaffService, type DeviceSyncRow, type SafeStaffUser } from '../../services/admin';

export type BusinessAdminTab = 'OVERVIEW' | 'STAFF' | 'ACCESS' | 'APPROVALS' | 'ACTIVITY';

export type PendingApprovalCounts = {
  expenses: number;
  refunds: number;
  purchases: number;
  stock: number;
  cashPicks: number;
  total: number;
};

export function useBusinessAdminData() {
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const currentUser = useStore(state => state.currentUser);

  const [staff, setStaff] = React.useState<SafeStaffUser[]>([]);
  const [isStaffLoading, setIsStaffLoading] = React.useState(true);
  const [staffError, setStaffError] = React.useState<string | null>(null);
  const [deviceSyncRows, setDeviceSyncRows] = React.useState<DeviceSyncRow[]>([]);
  const [deviceSyncError, setDeviceSyncError] = React.useState<string | null>(null);
  const [isDeviceSyncLoading, setIsDeviceSyncLoading] = React.useState(true);

  const pendingExpenses = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.expenses.where('shopId').equals(activeShopId).and(item => item.businessId === activeBusinessId && item.status === 'PENDING').toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const pendingRefunds = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.transactions.where('shopId').equals(activeShopId).and(item => item.businessId === activeBusinessId && item.status === 'PENDING_REFUND').toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const pendingPurchases = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.purchaseOrders.where('shopId').equals(activeShopId).and(item => item.businessId === activeBusinessId && item.approvalStatus === 'PENDING').toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const pendingStock = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.stockAdjustmentRequests.where('shopId').equals(activeShopId).and(item => item.businessId === activeBusinessId && item.status === 'PENDING').toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const pendingCashPicks = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.cashPicks.where('shopId').equals(activeShopId).and(item => item.businessId === activeBusinessId && item.status === 'PENDING').toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  );
  const auditLogs = useLiveQuery<AuditLog[]>(
    () => activeBusinessId ? db.auditLogs.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    [],
  );

  const reloadStaff = React.useCallback(async () => {
    if (!activeBusinessId) {
      setStaff([]);
      setIsStaffLoading(false);
      return;
    }
    setIsStaffLoading(true);
    setStaffError(null);
    try {
      const result = await StaffService.list({ businessId: activeBusinessId, shopId: activeShopId });
      setStaff(Array.isArray(result.users) ? result.users : []);
    } catch (err: any) {
      setStaffError(err?.message || 'Could not load staff.');
      setStaff([]);
    } finally {
      setIsStaffLoading(false);
    }
  }, [activeBusinessId, activeShopId]);

  const reloadDeviceSync = React.useCallback(async () => {
    if (!activeBusinessId) {
      setDeviceSyncRows([]);
      setIsDeviceSyncLoading(false);
      return;
    }
    setIsDeviceSyncLoading(true);
    try {
      const result = await AdminStatusService.deviceSync({ businessId: activeBusinessId, shopId: activeShopId });
      setDeviceSyncRows(Array.isArray(result.rows) ? result.rows : []);
      setDeviceSyncError(null);
    } catch (err: any) {
      setDeviceSyncError(err?.message || 'Failed to load terminal status.');
    } finally {
      setIsDeviceSyncLoading(false);
    }
  }, [activeBusinessId, activeShopId]);

  React.useEffect(() => {
    void reloadStaff();
  }, [reloadStaff]);

  React.useEffect(() => {
    void reloadDeviceSync();
    const timer = window.setInterval(() => void reloadDeviceSync(), 30000);
    return () => window.clearInterval(timer);
  }, [reloadDeviceSync]);

  const pendingCounts = React.useMemo<PendingApprovalCounts>(() => {
    const counts = {
      expenses: pendingExpenses.length,
      refunds: pendingRefunds.length,
      purchases: pendingPurchases.length,
      stock: pendingStock.length,
      cashPicks: pendingCashPicks.length,
    };
    return { ...counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0) };
  }, [pendingCashPicks.length, pendingExpenses.length, pendingPurchases.length, pendingRefunds.length, pendingStock.length]);

  const recentActivity = React.useMemo(
    () => [...(auditLogs || [])].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)),
    [auditLogs],
  );

  return {
    activeBusinessId,
    activeShopId,
    currentUser,
    staff,
    isStaffLoading,
    staffError,
    reloadStaff,
    deviceSyncRows,
    deviceSyncError,
    isDeviceSyncLoading,
    reloadDeviceSync,
    pendingCounts,
    recentActivity,
  };
}
