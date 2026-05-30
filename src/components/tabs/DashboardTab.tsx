import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { canUseOwnerMode, getCashDrawerLimit, isOwnerCashSweepEnabled, isOwnerModeEnabled, shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { enrichProductsWithBundleStock } from '../../utils/bundleInventory';
import { isLowStockProduct } from '../../utils/inventoryIntegrity';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getCurrentShiftId, getCurrentShiftStart } from '../../utils/shiftSession';
import { getBusinessSettings } from '../../utils/settings';
import { generateAndShareDocument } from '../../utils/shareUtils';
import { getDefaultOpeningFloat, parseSalesTillRows, parseSalesTills } from '../../utils/tills';
import { belongsToActiveShop } from '../../utils/shopScope';
import { paymentAmountForMethod, transactionNetMetrics } from '../../utils/posMoney';
import { calculateCloseReportTotals } from '../../utils/reportAnalytics';
import { CashService, ClosingService, ShiftService } from '../../services/operations';
import { apiRequest } from '../../services/apiClient';
import { canAccessFeature, shouldBlurFeature } from '../../utils/accessControl';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import DashboardDesktop from '../dashboard/DashboardDesktop';
import DashboardMobile from '../dashboard/DashboardMobile';
import DashboardModals from '../dashboard/DashboardModals';
import { money } from '../dashboard/DashboardShared';
import LoadingState from '../shared/LoadingState';

interface DashboardTabProps {
  setActiveTab: (tab: any) => void;
  openExpenseModal: () => void;
}

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

function recordInShift(record: any, since: number, until: number, shiftId?: string) {
  if (shiftId && record?.shiftId) return record.shiftId === shiftId;
  const ts = Number(record?.timestamp || record?.issueDate || record?.orderDate || 0);
  return ts >= since && ts <= until;
}

function approvedMoneyStatus(record: { status?: string }) {
  return String(record?.status || 'APPROVED').toUpperCase() === 'APPROVED';
}

function reportableTransactionStatus(record: { status?: string }) {
  return !['VOIDED', 'QUOTE'].includes(String(record?.status || '').toUpperCase());
}

function activeInvoiceStatus(record: { status?: string }) {
  return String(record?.status || '').toUpperCase() !== 'CANCELLED';
}

type ClosureStats = {
  txs: any[];
  invoices: any[];
  expenses: any[];
  picks: any[];
  refunds: any[];
  supplierPayments: any[];
  customerPayments: any[];
  openingCash: number;
  grossSales: number;
  totalSales: number;
  taxTotal: number;
  cashSales: number;
  customerCashPayments: number;
  mpesaSales: number;
  customerMpesaPayments: number;
  pdqSales: number;
  totalExpenses: number;
  supplierPaymentsTotal: number;
  remittanceTotal: number;
  totalPicks: number;
  totalRefunds: number;
  cashRefunds: number;
  expectedCash: number;
  cashierVariance: number;
};

type ShiftClosePreview = {
  since: number;
  until: number;
  shiftId: string;
  stats?: ClosureStats;
  recoveredAfterClosedShift?: boolean;
};

type CashierDashboardMetrics = {
  lowStockCount: number;
  customersServed: number;
  previousCustomersServed: number;
  totalExpenses: number;
  previousExpenses: number;
};

const createShiftSessionId = (shopId: string, userId: string, timestamp = Date.now()) =>
  `shift_${shopId}_${new Date(timestamp).toISOString().slice(0, 10)}_${userId}_${timestamp}`;

export default function DashboardTab({ setActiveTab, openExpenseModal }: DashboardTabProps) {
  const isPhoneUi = usePhoneUi();
  const [trendView, setTrendView] = useState<'DAY' | 'WEEK'>('DAY');
  const [isBankingExcess, setIsBankingExcess] = useState(false);
  const [isCashPickModalOpen, setIsCashPickModalOpen] = useState(false);
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState(false);
  const [selectedTillId, setSelectedTillId] = useState('');
  const [openingCashAmount, setOpeningCashAmount] = useState('');
  const [cashPickAmount, setCashPickAmount] = useState('');
  const [shiftClosingCash, setShiftClosingCash] = useState('');
  const [isPickingCash, setIsPickingCash] = useState(false);
  const [isOpeningShift, setIsOpeningShift] = useState(false);
  const [isClosingShift, setIsClosingShift] = useState(false);
  const [shiftClosePreview, setShiftClosePreview] = useState<ShiftClosePreview | null>(null);
  const [isClosingDay, setIsClosingDay] = useState(false);
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const setActiveShift = useStore(state => state.setActiveShift);
  const { success, error, warning } = useToast();
  const isCashier = currentUser?.role === 'CASHIER';
  const todayStart = getTodayStartMs();
  const todayEnd = todayStart + DAY_MS;
  const yesterdayStart = todayStart - DAY_MS;
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const privilegedDashboardAccess = currentUser?.role === 'ADMIN' || currentUser?.role === 'ROOT';
  const dailySalesModeOpen = canAccessFeature(currentUser, businessSettings, 'dashboard.dailySales')
    && !shouldBlurFeature(currentUser, businessSettings, 'dashboard.dailySales');
  const moneyBreakdownModeOpen = canAccessFeature(currentUser, businessSettings, 'dashboard.moneyBreakdown')
    && !shouldBlurFeature(currentUser, businessSettings, 'dashboard.moneyBreakdown');
  const salesTrendModeOpen = canAccessFeature(currentUser, businessSettings, 'dashboard.salesTrend')
    && !shouldBlurFeature(currentUser, businessSettings, 'dashboard.salesTrend');
  const canSeeSalesData = privilegedDashboardAccess || dailySalesModeOpen || moneyBreakdownModeOpen || salesTrendModeOpen;
  const canLoadDashboardTotals = canSeeSalesData;
  const canShowSalesCountMetric = privilegedDashboardAccess || dailySalesModeOpen;
  const canShowExpenseMetric = privilegedDashboardAccess || moneyBreakdownModeOpen;

  const products = useLiveQuery(
    () => activeBusinessId && canLoadDashboardTotals
      ? db.products.where('businessId').equals(activeBusinessId).filter(p => belongsToActiveShop(p, activeShopId)).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals, currentUser?.id, currentUser?.name]
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId && canLoadDashboardTotals
      ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, canLoadDashboardTotals]
  );
  const cashierDashboardMetrics = useLiveQuery<CashierDashboardMetrics | null>(
    () => isCashier && activeBusinessId
      ? apiRequest<CashierDashboardMetrics>(`/api/dashboard/metrics?todayStart=${todayStart}`, {
          businessId: activeBusinessId,
          requireOnline: false,
        }).catch(() => null)
      : Promise.resolve(null),
    [activeBusinessId, isCashier, todayStart],
    null
  );
  const activeShop = {
    id: activeShopId,
    name: businessSettings?.storeName || 'Main shop',
    location: businessSettings?.location || '',
    tillNumber: businessSettings?.tillNumber || '',
  };
  const salesTillRows = useLiveQuery(
    () => activeBusinessId
      ? db.salesTills.where('businessId').equals(activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId]
  );
  const shopTransactions = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.transactions.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopRefunds = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.refunds.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopSalesInvoices = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.salesInvoices.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopExpenses = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.expenses.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopCashPicks = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.cashPicks.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopPurchaseOrders = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.purchaseOrders.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopStockAdjustmentRequests = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.stockAdjustmentRequests.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopSupplierPayments = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.supplierPayments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopCustomerPayments = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.customerPayments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopReports = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.endOfDayReports.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopShifts = useLiveQuery(
    () => {
      if (!activeBusinessId || !activeShopId) return Promise.resolve([]);
      if (!canLoadDashboardTotals) return Promise.resolve([]);
      const base = db.shifts.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId);
      return base.toArray();
    },
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const shopDailySummaries = useLiveQuery(
    () => canLoadDashboardTotals && activeBusinessId && activeShopId
      ? db.dailySummaries.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canLoadDashboardTotals]
  );
  const pendingApprovalCount = useLiveQuery(async () => {
    if (!canLoadDashboardTotals || !activeBusinessId || !activeShopId) return 0;
    const [expenses, refunds, purchaseOrders, picks] = await Promise.all([
      db.expenses.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId && row.status === 'PENDING').toArray(),
      db.transactions.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId && row.status === 'PENDING_REFUND').toArray(),
      db.purchaseOrders.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId && row.approvalStatus === 'PENDING').toArray(),
      db.cashPicks.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId && row.status === 'PENDING').toArray(),
    ]);
    return expenses.length + refunds.length + purchaseOrders.length + picks.length;
  }, [activeBusinessId, activeShopId, canLoadDashboardTotals], 0);

  const displayProducts = enrichProductsWithBundleStock(products || [], productIngredients || []);
  const lowStockProducts = displayProducts.filter(isLowStockProduct) || [];
  const transactionDashboardTotal = (transaction: any) => transactionNetMetrics(transaction).netTotal;
  const transactionDashboardGross = (transaction: any) => transactionNetMetrics(transaction).netSubtotal;
  const hasDashboardSaleValue = (transaction: any) => transactionDashboardTotal(transaction) > 0.01;
  const todaysDailySummary = (shopDailySummaries || []).find(summary => {
    const summaryDate = Number(summary.date || summary.timestamp || 0);
    return summaryDate >= todayStart && summaryDate < todayEnd;
  });
  const todaysTransactions = (shopTransactions || []).filter(t => (t.timestamp || 0) >= todayStart && (t.timestamp || 0) < todayEnd && reportableTransactionStatus(t));
  const todaysInvoices = (shopSalesInvoices || []).filter(invoice => (invoice.issueDate || 0) >= todayStart && (invoice.issueDate || 0) < todayEnd && activeInvoiceStatus(invoice));
  const yesterdaysTransactions = (shopTransactions || []).filter(t => (t.timestamp || 0) >= yesterdayStart && (t.timestamp || 0) < todayStart && reportableTransactionStatus(t));
  const yesterdaysInvoices = (shopSalesInvoices || []).filter(invoice => (invoice.issueDate || 0) >= yesterdayStart && (invoice.issueDate || 0) < todayStart && activeInvoiceStatus(invoice));
  const todaysExpenses = (shopExpenses || []).filter(expense => (expense.timestamp || 0) >= todayStart && (expense.timestamp || 0) < todayEnd && approvedMoneyStatus(expense))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const yesterdaysExpenses = (shopExpenses || []).filter(expense => (expense.timestamp || 0) >= yesterdayStart && (expense.timestamp || 0) < todayStart && approvedMoneyStatus(expense))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const todaysSalesCount = todaysTransactions.filter(hasDashboardSaleValue).length + todaysInvoices.length;
  const totalRevenue = todaysTransactions.reduce((a, t) => a + transactionDashboardTotal(t), 0)
    + todaysInvoices.reduce((a, invoice) => a + Number(invoice.total || 0), 0);
  const yesterdaysSalesCount = yesterdaysTransactions.filter(hasDashboardSaleValue).length + yesterdaysInvoices.length;
  const yesterdaysRevenue = yesterdaysTransactions.reduce((a, t) => a + transactionDashboardTotal(t), 0)
    + yesterdaysInvoices.reduce((a, invoice) => a + Number(invoice.total || 0), 0);
  const todaysCustomerPayments = (shopCustomerPayments || []).filter(payment => (payment.timestamp || 0) >= todayStart && (payment.timestamp || 0) < todayEnd);
  const todayCashSales = todaysTransactions.reduce((sum, tx) => sum + paymentAmountForMethod(tx, 'CASH'), 0);
  const todayMpesaSales = todaysTransactions.reduce((sum, tx) => sum + paymentAmountForMethod(tx, 'MPESA'), 0);
  const todayCreditSales = todaysTransactions.reduce((sum, tx) => sum + paymentAmountForMethod(tx, 'CREDIT'), 0);
  const todayCashRepayments = todaysCustomerPayments
    .filter(payment => String(payment.paymentMethod || '').toUpperCase() === 'CASH')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const todayMpesaRepayments = todaysCustomerPayments
    .filter(payment => String(payment.paymentMethod || '').toUpperCase() === 'MPESA')
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const todayInvoiceCredit = todaysInvoices
    .filter(invoice => invoice.status !== 'PAID')
    .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const todayTillTotal = todayCashSales + todayCashRepayments;
  const todayCreditTotal = todayCreditSales + todayInvoiceCredit;
  const salesTrendData = React.useMemo(() => {
    const txs = (shopTransactions || []).filter(reportableTransactionStatus);
    const invoices = (shopSalesInvoices || []).filter(activeInvoiceStatus);
    if (trendView === 'WEEK') {
      return Array.from({ length: 7 }, (_, index) => {
        const start = localDayStart(Date.now() - (6 - index) * DAY_MS);
        const end = start + DAY_MS;
        const day = new Date(start).toLocaleDateString('en-KE', { weekday: 'short' });
        return {
          time: day,
          sales: txs
            .filter(t => (t.timestamp || 0) >= start && (t.timestamp || 0) < end)
            .reduce((sum, t) => sum + transactionDashboardTotal(t), 0)
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
          .reduce((sum, t) => sum + transactionDashboardTotal(t), 0)
          + invoices
            .filter(invoice => (invoice.issueDate || 0) >= start && (invoice.issueDate || 0) < end)
            .reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
      };
    });
  }, [shopTransactions, shopSalesInvoices, trendView]);
  const configuredTills = React.useMemo(() => {
    const tableTills = parseSalesTillRows(salesTillRows);
    return tableTills.length ? tableTills : parseSalesTills(businessSettings);
  }, [businessSettings, salesTillRows]);
  const dashboardLoadingParts = [
    salesTillRows,
    ...(canLoadDashboardTotals ? [
      products,
      productIngredients,
      shopTransactions,
      shopRefunds,
      shopSalesInvoices,
      shopExpenses,
      shopCashPicks,
      shopPurchaseOrders,
      shopStockAdjustmentRequests,
      shopSupplierPayments,
      shopCustomerPayments,
      shopReports,
      shopShifts,
      shopDailySummaries,
    ] : []),
  ];
  const dashboardLoadedCount = dashboardLoadingParts.filter(Boolean).length;
  const dashboardLoadingProgress = Math.max(8, Math.round((dashboardLoadedCount / dashboardLoadingParts.length) * 100));
  const dashboardLoading = dashboardLoadedCount < dashboardLoadingParts.length;

  if (dashboardLoading) {
    return (
      <LoadingState
        title="Loading dashboard..."
        detail="Reading sales, stock, shifts, and cash totals from the local database."
        progress={dashboardLoadingProgress}
      />
    );
  }
  const activeOpenShifts = (shopShifts || []).filter(shift => String(shift.status || '').toUpperCase() === 'OPEN');
  const openTillIds = new Set(activeOpenShifts.map(shift => String(shift.tillId || '')).filter(Boolean));
  const availableTills = configuredTills.filter(till => !openTillIds.has(till.id));
  const selectedTill = configuredTills.find(till => till.id === selectedTillId) || availableTills[0] || configuredTills[0];
  const defaultOpeningFloat = getDefaultOpeningFloat(businessSettings);
  const ownerModeActive = canUseOwnerMode(currentUser) && isOwnerModeEnabled(businessSettings);
  const cashSweepActive = ownerModeActive && isOwnerCashSweepEnabled(businessSettings);
  const cashDrawerLimit = getCashDrawerLimit(businessSettings);
  const shiftBelongsToCurrentUser = (shift: any) => {
    if (!shift || !currentUser) return false;
    const userId = String(currentUser.id || '').trim();
    const userName = String(currentUser.name || '').trim().toLowerCase();
    const cashierId = String(shift.cashierId || '').trim();
    const cashierName = String(shift.cashierName || '').trim().toLowerCase();
    return (userId && cashierId === userId)
      || (userName && cashierName === userName)
      || (userId && String(shift.id || '').includes(`_${userId}`));
  };
  const shiftInActiveScope = (shift: any) => (
    shift
    && String(shift.shopId || activeShopId || '') === String(activeShopId || '')
    && String(shift.businessId || activeBusinessId || '') === String(activeBusinessId || '')
  );
  const localOpenShift = String(activeShift?.status || '').toUpperCase() === 'OPEN'
    && shiftInActiveScope(activeShift)
    && shiftBelongsToCurrentUser(activeShift)
    ? activeShift
    : null;
  const sharedOwnOpenShift = (shopShifts || []).find(shift => String(shift.status || '').toUpperCase() === 'OPEN' && shiftBelongsToCurrentUser(shift));
  const ownOpenShift = localOpenShift || sharedOwnOpenShift || null;
  const canOperateOwnShift = !!ownOpenShift;
  const currentShiftId = canOperateOwnShift ? getCurrentShiftId(ownOpenShift, activeShopId, currentUser?.id) : undefined;
  const currentShiftStart = canOperateOwnShift ? getCurrentShiftStart(ownOpenShift, getTodayStartMs()) : getTodayStartMs();
  const currentOpeningCash = Number(ownOpenShift?.openingCash || 0);

  const drawerBreakdown = canLoadDashboardTotals && canOperateOwnShift ? calculateCashDrawer({
    transactions: shopTransactions || [],
    expenses: shopExpenses || [],
    cashPicks: shopCashPicks || [],
    refunds: shopRefunds || [],
    supplierPayments: shopSupplierPayments || [],
    customerPayments: shopCustomerPayments || [],
    openingCash: currentOpeningCash,
    since: currentShiftStart,
    shiftId: currentShiftId,
  }) : {
    openingCash: 0,
    cashSales: 0,
    customerCashPayments: 0,
    tillExpenses: 0,
    cashPicks: 0,
    cashRefunds: 0,
    supplierTillPayments: 0,
    actualCashDrawer: 0,
  };
  const actualCashDrawer = Math.max(0, drawerBreakdown.actualCashDrawer);
  const sweepAmount = Math.max(0, actualCashDrawer - cashDrawerLimit);
  const shouldSweepCash = canOperateOwnShift && cashSweepActive && actualCashDrawer > cashDrawerLimit && sweepAmount > 0;
  const cashPickValue = Number(cashPickAmount) || 0;

  const handleBankExcessCash = async () => {
    if (!activeShopId || !activeBusinessId || !currentUser || !shouldSweepCash || isBankingExcess) return;
    if (!canOperateOwnShift || !currentShiftId) {
      warning('Open your own shift before picking cash.');
      return;
    }
    setIsBankingExcess(true);
    try {
      await CashService.createPick({
        amount: sweepAmount,
        status: 'APPROVED',
        userName: currentUser.name,
        shiftId: currentShiftId,
        shiftStart: currentShiftStart,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      if (canLoadDashboardTotals) await db.cashPicks.reload();
      success(`Banked Ksh ${sweepAmount.toLocaleString()} from the drawer.`);
    } catch (err: any) {
      error(err.message || 'Cash sweep failed.');
    } finally {
      setIsBankingExcess(false);
    }
  };

  const handleCreateCashPick = async () => {
    if (!activeShopId || !activeBusinessId || !currentUser || isPickingCash) return;
    if (!canOperateOwnShift || !currentShiftId) return warning('Open your own shift before picking cash.');
    if (cashPickValue <= 0) return warning('Enter the cash amount to pick.');

    setIsPickingCash(true);
    try {
      const status = shouldAutoApproveOwnerAction(businessSettings, currentUser) ? 'APPROVED' : 'PENDING';
      await CashService.createPick({
        amount: cashPickValue,
        status,
        userName: currentUser.name,
        shiftId: currentShiftId,
        shiftStart: currentShiftStart,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      if (canLoadDashboardTotals) await db.cashPicks.reload();
      setCashPickAmount('');
      setIsCashPickModalOpen(false);
      success(status === 'APPROVED'
        ? `Picked Ksh ${cashPickValue.toLocaleString()} from the drawer.`
        : `Cash pick request for Ksh ${cashPickValue.toLocaleString()} sent for approval.`
      );
    } catch (err: any) {
      error(isCashier ? 'Could not record cash pick. Check the amount and try again.' : (err.message || 'Could not record cash pick.'));
    } finally {
      setIsPickingCash(false);
    }
  };

  const getClosureStats = (since: number, until = Date.now(), shiftId?: string) => {
    const shift = (shopShifts || []).find(row => row.id === shiftId) || (ownOpenShift?.id === shiftId ? ownOpenShift : null);
    const openingCash = Number(shift?.openingCash || 0);
    const stats = calculateCloseReportTotals({
      transactions: shopTransactions || [],
      salesInvoices: shopSalesInvoices || [],
      expenses: shopExpenses || [],
      picks: shopCashPicks || [],
      refunds: shopRefunds || [],
      supplierPayments: shopSupplierPayments || [],
      customerPayments: shopCustomerPayments || [],
      openingCash,
      since,
      until,
      shiftId,
    });
    return {
      ...stats,
      cashierVariance: 0,
    };
  };

  const closedShiftRows = (shopReports || [])
    .filter(report => Number(report.timestamp || 0) >= todayStart && Number(report.timestamp || 0) < todayEnd)
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .map((report, index) => {
      const totalPicks = Number(report.totalPicks || 0);
      const expectedCash = Number(report.expectedCash || 0);
      return {
        id: report.id,
        shiftId: report.shiftId || report.id,
        label: report.tillName || `Shift ${index + 1}`,
        status: 'Closed',
        tillId: report.tillId,
        tillName: report.tillName || '',
        cashierName: report.cashierName || 'Staff',
        startTime: undefined as number | undefined,
        endTime: Number(report.timestamp || 0),
        totalSales: Number(report.totalSales || 0),
        cashSales: Number(report.cashSales || 0),
        mpesaSales: Number(report.mpesaSales || 0),
        customerMpesaPayments: Number(report.customerMpesaPayments || 0),
        pdqSales: Number(report.pdqSales || 0),
        totalExpenses: Number(report.totalExpenses || 0),
        supplierPaymentsTotal: Number(report.supplierPaymentsTotal || 0),
        totalRefunds: Number(report.totalRefunds || 0),
        totalPicks,
        expectedCash,
        actualCashDrawer: Number(report.reportedCash ?? report.closingCash ?? expectedCash),
        difference: Number(report.difference || 0),
      };
    });
  const closedShiftIds = new Set(closedShiftRows.map(row => row.shiftId));
  const sharedOpenShiftRows = (shopShifts || [])
    .filter(shift => shift.status === 'OPEN' && !closedShiftIds.has(shift.id))
    .sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0))
    .map((shift, index) => {
      const stats = getClosureStats(Number(shift.startTime || todayStart), Date.now(), shift.id);
      return {
        id: shift.id,
        shiftId: shift.id,
        label: shift.tillName || `Open ${index + 1}`,
        status: 'Open',
        tillId: shift.tillId,
        tillName: shift.tillName || '',
        cashierName: shift.cashierName || 'Staff',
        startTime: Number(shift.startTime || todayStart),
        endTime: undefined as number | undefined,
        totalSales: stats.totalSales,
        cashSales: stats.cashSales,
        mpesaSales: stats.mpesaSales,
        customerMpesaPayments: stats.customerMpesaPayments,
        pdqSales: stats.pdqSales,
        totalExpenses: stats.totalExpenses,
        supplierPaymentsTotal: stats.supplierPaymentsTotal,
        totalRefunds: stats.totalRefunds,
        totalPicks: stats.totalPicks,
        expectedCash: stats.expectedCash,
        actualCashDrawer: stats.expectedCash,
        difference: stats.cashierVariance,
      };
    });
  const openShiftStats = currentShiftId ? getClosureStats(currentShiftStart, Date.now(), currentShiftId) : null;
  const hasClosedCurrentShift = currentShiftId && closedShiftRows.some(row => row.shiftId === currentShiftId);
  const hasSharedCurrentShift = currentShiftId && sharedOpenShiftRows.some(row => row.shiftId === currentShiftId);
  const adminShiftRows = [
    ...closedShiftRows,
    ...sharedOpenShiftRows,
    ...(openShiftStats && !hasClosedCurrentShift && !hasSharedCurrentShift ? [{
      id: currentShiftId || 'current-shift',
      shiftId: currentShiftId || 'current-shift',
      label: ownOpenShift?.tillName || 'Current shift',
      status: 'Open',
      tillId: ownOpenShift?.tillId,
      tillName: ownOpenShift?.tillName || '',
      cashierName: activeShift?.cashierName || currentUser?.name || 'Staff',
      startTime: currentShiftStart,
      endTime: undefined as number | undefined,
      totalSales: openShiftStats.totalSales,
      cashSales: openShiftStats.cashSales,
      mpesaSales: openShiftStats.mpesaSales,
      customerMpesaPayments: openShiftStats.customerMpesaPayments,
      pdqSales: openShiftStats.pdqSales,
      totalExpenses: openShiftStats.totalExpenses,
      supplierPaymentsTotal: openShiftStats.supplierPaymentsTotal,
      totalRefunds: openShiftStats.totalRefunds,
      totalPicks: openShiftStats.totalPicks,
      expectedCash: openShiftStats.expectedCash,
      actualCashDrawer: openShiftStats.expectedCash,
      difference: openShiftStats.cashierVariance,
    }] : []),
  ];
  const adminShiftTotals = adminShiftRows.reduce((totals, row) => ({
    totalSales: totals.totalSales + row.totalSales,
    cashSales: totals.cashSales + row.cashSales,
    mpesaSales: totals.mpesaSales + row.mpesaSales,
    customerMpesaPayments: totals.customerMpesaPayments + Number(row.customerMpesaPayments || 0),
    pdqSales: totals.pdqSales + row.pdqSales,
    totalExpenses: totals.totalExpenses + row.totalExpenses,
    supplierPaymentsTotal: totals.supplierPaymentsTotal + row.supplierPaymentsTotal,
    totalRefunds: totals.totalRefunds + row.totalRefunds,
    totalPicks: totals.totalPicks + row.totalPicks,
    expectedCash: totals.expectedCash + row.expectedCash,
    actualCashDrawer: totals.actualCashDrawer + row.actualCashDrawer,
    difference: totals.difference + row.difference,
  }), {
    totalSales: 0,
    cashSales: 0,
    mpesaSales: 0,
    customerMpesaPayments: 0,
    pdqSales: 0,
    totalExpenses: 0,
    supplierPaymentsTotal: 0,
    totalRefunds: 0,
    totalPicks: 0,
    expectedCash: 0,
    actualCashDrawer: 0,
    difference: 0,
  });

  const pendingShiftItems = (shiftId?: string, since = currentShiftStart, until = Date.now()) => {
    if (!shiftId) return [];
    const pending: string[] = [];
    const isPendingShiftRecord = (record: any) => recordInShift(record, since, until, shiftId);
    if ((shopExpenses || []).some(expense => isPendingShiftRecord(expense) && String(expense.status || '').toUpperCase() === 'PENDING')) pending.push('expenses');
    if ((shopCashPicks || []).some(pick => isPendingShiftRecord(pick) && String(pick.status || '').toUpperCase() === 'PENDING')) pending.push('cash picks');
    if ((shopTransactions || []).some(transaction => isPendingShiftRecord(transaction) && String(transaction.status || '').toUpperCase() === 'PENDING_REFUND')) pending.push('refund approvals');
    if ((shopPurchaseOrders || []).some(order => isPendingShiftRecord(order) && String(order.approvalStatus || '').toUpperCase() === 'PENDING')) pending.push('purchase orders');
    if ((shopStockAdjustmentRequests || []).some(request => isPendingShiftRecord(request) && String(request.status || '').toUpperCase() === 'PENDING')) pending.push('stock adjustments');
    return pending;
  };

  const handleOpenShift = async () => {
    if (!activeShopId || !activeBusinessId || !currentUser) return;
    if (canOperateOwnShift) {
      warning('Your shift is already open.');
      return;
    }
    const nextTill = availableTills[0] || configuredTills[0];
    if (!nextTill) {
      warning('Set up at least one till in settings before opening a shift.');
      return;
    }
    setSelectedTillId(nextTill.id);
    setOpeningCashAmount(String(defaultOpeningFloat || 0));
    setIsOpenShiftModalOpen(true);
  };

  const confirmOpenShift = async () => {
    if (!activeShopId || !activeBusinessId || !currentUser || isOpeningShift) return;
    if (canOperateOwnShift) {
      warning('Your shift is already open.');
      setIsOpenShiftModalOpen(false);
      return;
    }
    const till = selectedTill || availableTills[0] || configuredTills[0];
    if (!till) return warning('Set up at least one till in settings before opening a shift.');
    const tillBusy = (shopShifts || []).some(shift => String(shift.status || '').toUpperCase() === 'OPEN' && String(shift.tillId || '') === till.id);
    if (tillBusy) return warning(`${till.name} is already open.`);

    const now = Date.now();
    const openingCash = Math.max(0, Number(openingCashAmount) || 0);
    const nextShift = {
      id: createShiftSessionId(activeShopId, `${till.id}_${currentUser.id}`, now),
      startTime: now,
      cashierId: currentUser.id,
      cashierName: currentUser.name,
      tillId: till.id,
      tillName: till.name,
      openingCash,
      status: 'OPEN',
      shopId: activeShopId,
      businessId: activeBusinessId,
      updated_at: now,
    };

    setIsOpeningShift(true);
    try {
      const result = await ShiftService.openShift(nextShift as any);
      const savedShift = result.shift || nextShift;
      await db.shifts.cacheLocal(savedShift).catch(() => {});
      void db.shifts.reload().catch(() => {});
      setActiveShift(savedShift);
      setIsOpenShiftModalOpen(false);
      success(result.idempotent ? 'Your shift is already open.' : `${till.name} shift opened.`);
    } catch (err: any) {
      error(err.message || 'Could not open shift.');
    } finally {
      setIsOpeningShift(false);
    }
  };

  const handleCloseShift = () => {
    if (!activeShopId || !activeBusinessId || !currentUser || isClosingShift) return;
    if (!canOperateOwnShift || !currentShiftId || !ownOpenShift) {
      warning('Open your own shift before closing it.');
      return;
    }
    const until = Date.now();
    const since = Number(ownOpenShift.startTime || getTodayStartMs());
    const pending = pendingShiftItems(currentShiftId, since, until);
    if (pending.length) {
      warning(`Resolve pending ${pending.join(', ')} for this shift before closing.`);
      return;
    }
    setShiftClosingCash('');
    setShiftClosePreview({
      since,
      until,
      shiftId: currentShiftId,
      ...(canLoadDashboardTotals ? { stats: getClosureStats(since, until, currentShiftId) } : {}),
    });
  };

  const confirmCloseShift = async () => {
    if (!activeShopId || !activeBusinessId || !currentUser || isClosingShift || !shiftClosePreview) return;
    const { since, shiftId, stats } = shiftClosePreview;
    const pending = canLoadDashboardTotals ? pendingShiftItems(shiftId, since, Date.now()) : [];
    if (pending.length) {
      warning(`Resolve pending ${pending.join(', ')} for this shift before closing.`);
      return;
    }
    if (!String(shiftClosingCash).trim()) {
      warning('Enter the counted closing cash before closing the shift.');
      return;
    }
    setIsClosingShift(true);
    try {
      const now = Date.now();
      const closingCash = Math.max(0, Number(shiftClosingCash) || 0);
      const difference = stats ? Math.round((closingCash - stats.expectedCash) * 100) / 100 : 0;
      const baseCloseRecord = {
        timestamp: now,
        tillId: ownOpenShift?.tillId,
        tillName: ownOpenShift?.tillName,
        reportedCash: closingCash,
        closingCash,
        difference,
        cashierId: ownOpenShift?.cashierId || currentUser.id,
        cashierName: ownOpenShift?.cashierName || currentUser.name,
      };
      const closeRecord = stats ? {
        ...baseCloseRecord,
        openingCash: stats.openingCash,
        totalSales: stats.totalSales,
        grossSales: stats.grossSales,
        taxTotal: stats.taxTotal,
        cashSales: stats.cashSales,
        customerCashPayments: stats.customerCashPayments,
        customerMpesaPayments: stats.customerMpesaPayments,
        mpesaSales: stats.mpesaSales,
        pdqSales: stats.pdqSales,
        totalExpenses: stats.totalExpenses,
        supplierPaymentsTotal: stats.supplierPaymentsTotal,
        remittanceTotal: stats.remittanceTotal,
        totalPicks: stats.totalPicks,
        totalRefunds: stats.totalRefunds,
        cashRefunds: stats.cashRefunds,
        expectedCash: stats.expectedCash,
        closeBreakdown: {
          receipts: stats.txs.length,
          invoices: stats.invoices.length,
          customerCashPayments: stats.customerCashPayments,
          customerMpesaPayments: stats.customerMpesaPayments,
          tillExpenses: stats.totalExpenses,
          supplierTillPayments: stats.supplierPaymentsTotal,
          cashRefunds: stats.cashRefunds,
          cashPicks: stats.totalPicks,
        },
      } : baseCloseRecord;
      const result = await ClosingService.closeShift({
        shiftId,
        startTime: since,
        report: closeRecord,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      if (ownOpenShift) {
        await db.shifts.cacheLocal({
          ...ownOpenShift,
          status: 'CLOSED',
          endTime: now,
          updated_at: now,
        }).catch(() => {});
      }
      await Promise.allSettled([
        db.shifts.reload(),
        ...(canLoadDashboardTotals ? [
          db.endOfDayReports.reload(),
          db.transactions.reload(),
          db.salesInvoices.reload(),
          db.cashPicks.reload(),
          db.refunds.reload(),
          db.expenses.reload(),
          db.supplierPayments.reload(),
          db.dailySummaries.reload(),
        ] : []),
      ]);
      setActiveShift(null);
      setShiftClosePreview(null);
      setShiftClosingCash('');
      const savedCloseRecord = result.report ? {
        ...result.report,
        id: result.reportId || result.report.id,
        shiftId,
        recordType: 'CLOSE_DAY_REPORT',
      } : {
        ...closeRecord,
        id: result.reportId || `shift-report-${shiftId}`,
        shiftId,
        recordType: 'CLOSE_DAY_REPORT',
      };
      await generateAndShareDocument(
        savedCloseRecord,
        `Shift-${(savedCloseRecord.tillName || 'Till').replace(/\s+/g, '-')}-${new Date(now).toISOString().slice(0, 10)}`,
        undefined,
        true,
        businessSettings?.storeName || 'Smart POS',
        businessSettings?.location || activeShop?.location || 'Nairobi, Kenya',
      ).catch((pdfErr) => {
        console.warn('Could not download shift PDF', pdfErr);
        warning('Shift closed, but the PDF could not be downloaded.');
      });
      if (result.idempotent) {
        warning('That shift was already closed.');
      } else {
        success('Shift closed, report saved, and PDF downloaded.');
      }
    } catch (err: any) {
      error(err.message || 'Failed to close shift.');
    } finally {
      setIsClosingShift(false);
    }
  };

  const handleCloseDay = async () => {
    if (!activeShopId || !activeBusinessId || isClosingDay) return;
    const since = getTodayStartMs();
    if (todaysDailySummary) {
      warning('This shop already has a daily close report for today. A day can only be closed once.');
      return;
    }
    const openRows = adminShiftRows.filter(row => row.status === 'Open');
    if (openRows.length) {
      warning('Close all open shifts before closing the business day.');
      return;
    }
    const todaysReports = (shopReports || []).filter(report => (report.timestamp || 0) >= since && (report.timestamp || 0) < todayEnd);
    if (!todaysReports.length) {
      warning('Close at least one shift before closing the business day.');
      return;
    }
    if (!confirm('Close the business day and create today\'s daily close report? This can only be done once per day.')) return;

    setIsClosingDay(true);
    try {
      const result = await ClosingService.closeDay({
        summary: { date: since },
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await db.dailySummaries.reload();
      if (result.idempotent) {
        warning('This shop was already closed today. No second daily close report was created.');
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
    {
      fn: canOperateOwnShift ? handleCloseShift : handleOpenShift,
      label: canOperateOwnShift ? 'Close shift' : 'Open shift',
      icon: canOperateOwnShift ? 'assignment_turned_in' : 'event_available',
      busy: isClosingShift,
    },
    { fn: () => setIsCashPickModalOpen(true), label: 'Pick cash', icon: 'payments' },
    { fn: handleCloseDay, label: 'Close day', icon: 'event_available', busy: isClosingDay },
  ];

  const openOwnerSettings = () => {
    setActiveTab('SETTINGS');
  };

  const dashboardQuickActions = quickActions.map((action: any) => ({
    label: action.label,
    icon: action.icon,
    busy: action.busy,
    onClick: () => action.fn ? action.fn() : setActiveTab(action.id),
  }));

  const dashboardMetrics = [
    {
      label: 'Daily sales',
      value: money(totalRevenue),
      sub: '',
      trend: percentChange(totalRevenue, yesterdaysRevenue),
      icon: 'payments',
    },
    {
      label: 'Customers served',
      value: todaysSalesCount || 0,
      sub: '',
      trend: percentChange(todaysSalesCount, yesterdaysSalesCount),
      icon: 'group',
    },
    {
      label: 'Low stock products',
      value: lowStockProducts.length,
      sub: '',
      icon: 'warning',
    },
    {
      label: 'Total expenses',
      value: money(todaysExpenses),
      sub: '',
      trend: percentChange(todaysExpenses, yesterdaysExpenses),
      icon: 'credit_card',
    },
  ];

  const dashboardMoneyBreakdown = [
    {
      label: 'Till cash',
      value: money(todayTillTotal),
      detail: `${money(todayCashSales)} sales + ${money(todayCashRepayments)} credit collections`,
      icon: 'payments',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    },
    {
      label: 'M-Pesa sales',
      value: money(todayMpesaSales),
      detail: 'Direct paid sales only',
      icon: 'smartphone',
      tone: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    {
      label: 'M-Pesa credit collections',
      value: money(todayMpesaRepayments),
      detail: 'Customer debt payments, not new sales',
      icon: 'smartphone',
      tone: 'border-cyan-200 bg-cyan-50 text-cyan-700',
    },
    {
      label: 'Credit',
      value: money(todayCreditTotal),
      detail: `${money(todayCreditSales)} sales + ${money(todayInvoiceCredit)} invoices`,
      icon: 'credit_card',
      tone: 'border-slate-300 bg-white text-slate-700',
    },
  ];

  const lockedDashboardMetrics = [
    { label: 'Daily sales', value: 'Ksh 00,000', sub: '', icon: 'payments', locked: true },
    { label: 'Customers served', value: '000', sub: '', icon: 'group', locked: true },
    { label: 'Low stock products', value: '00', sub: '', icon: 'warning', locked: true },
    { label: 'Total expenses', value: 'Ksh 00,000', sub: '', icon: 'credit_card', locked: true },
  ];

  const cashierDashboardCards = [
    { label: 'Daily sales', value: 'Ksh 00,000', sub: '', icon: 'payments', locked: true },
    {
      label: 'Customers served',
      value: Number(cashierDashboardMetrics?.customersServed || 0),
      sub: '',
      trend: percentChange(
        Number(cashierDashboardMetrics?.customersServed || 0),
        Number(cashierDashboardMetrics?.previousCustomersServed || 0)
      ),
      icon: 'group',
    },
    {
      label: 'Low stock products',
      value: Number(cashierDashboardMetrics?.lowStockCount || 0),
      sub: '',
      icon: 'warning',
    },
    {
      label: 'Total expenses',
      value: money(Number(cashierDashboardMetrics?.totalExpenses || 0)),
      sub: '',
      trend: percentChange(
        Number(cashierDashboardMetrics?.totalExpenses || 0),
        Number(cashierDashboardMetrics?.previousExpenses || 0)
      ),
      icon: 'credit_card',
    },
  ];

  const accessControlledDashboardMetrics = [
    dailySalesModeOpen ? dashboardMetrics[0] : lockedDashboardMetrics[0],
    canShowSalesCountMetric ? dashboardMetrics[1] : cashierDashboardCards[1],
    canLoadDashboardTotals ? dashboardMetrics[2] : cashierDashboardCards[2],
    canShowExpenseMetric ? dashboardMetrics[3] : lockedDashboardMetrics[3],
  ];

  const lockedMoneyBreakdown = [
    {
      label: 'Till cash',
      value: 'Ksh 00,000',
      detail: 'Sales + credit collections hidden',
      icon: 'payments',
      tone: 'border-slate-300 bg-slate-50 text-slate-500',
      locked: true,
    },
    {
      label: 'M-Pesa sales',
      value: 'Ksh 00,000',
      detail: 'Direct paid sales hidden',
      icon: 'smartphone',
      tone: 'border-slate-300 bg-slate-50 text-slate-500',
      locked: true,
    },
    {
      label: 'M-Pesa credit collections',
      value: 'Ksh 00,000',
      detail: 'Customer debt payments hidden',
      icon: 'smartphone',
      tone: 'border-slate-300 bg-slate-50 text-slate-500',
      locked: true,
    },
    {
      label: 'Credit',
      value: 'Ksh 00,000',
      detail: 'Sales + invoices hidden',
      icon: 'credit_card',
      tone: 'border-slate-300 bg-slate-50 text-slate-500',
      locked: true,
    },
  ];

  const publicShiftClosePreview = shiftClosePreview
    ? {
        since: shiftClosePreview.since,
        until: shiftClosePreview.until,
        shiftId: shiftClosePreview.shiftId,
      }
    : null;

  const dashboardModel = {
    currentUser,
    activeShop,
    canSeeSalesData,
    isCashier,
    ownerModeActive,
    pendingApprovalCount: Number(pendingApprovalCount || 0),
    actualCashDrawer: canSeeSalesData ? actualCashDrawer : 0,
    cashDrawerLimit: canSeeSalesData ? cashDrawerLimit : 0,
    shouldSweepCash: canSeeSalesData ? shouldSweepCash : false,
    sweepAmount: canSeeSalesData ? sweepAmount : 0,
    isBankingExcess,
    openOwnerSettings,
    handleBankExcessCash,
    adminShiftRows: canSeeSalesData ? adminShiftRows : [],
    adminShiftTotals: canSeeSalesData ? adminShiftTotals : {},
    metrics: accessControlledDashboardMetrics,
    moneyBreakdown: moneyBreakdownModeOpen ? dashboardMoneyBreakdown : lockedMoneyBreakdown,
    salesTrendData: salesTrendModeOpen ? salesTrendData : [],
    trendView,
    setTrendView,
    quickActions: dashboardQuickActions,
  };

  return (
    <div className="animate-in fade-in bg-slate-50">
      <DashboardModals
        isOpenShiftModalOpen={isOpenShiftModalOpen}
        setIsOpenShiftModalOpen={setIsOpenShiftModalOpen}
        configuredTills={configuredTills}
        availableTills={availableTills}
        selectedTillId={selectedTillId}
        setSelectedTillId={setSelectedTillId}
        openingCashAmount={openingCashAmount}
        setOpeningCashAmount={setOpeningCashAmount}
        isOpeningShift={isOpeningShift}
        confirmOpenShift={confirmOpenShift}
        isCashPickModalOpen={isCashPickModalOpen}
        isPickingCash={isPickingCash}
        setIsCashPickModalOpen={setIsCashPickModalOpen}
        cashPickAmount={cashPickAmount}
        setCashPickAmount={setCashPickAmount}
        cashPickValue={cashPickValue}
        canOperateOwnShift={canOperateOwnShift}
        handleCreateCashPick={handleCreateCashPick}
        shiftClosePreview={publicShiftClosePreview}
        shiftClosingCash={shiftClosingCash}
        setShiftClosingCash={setShiftClosingCash}
        isClosingShift={isClosingShift}
        setShiftClosePreview={setShiftClosePreview}
        confirmCloseShift={confirmCloseShift}
      />
      {isPhoneUi ? <DashboardMobile model={dashboardModel} /> : <DashboardDesktop model={dashboardModel} />}
    </div>
  );
}
