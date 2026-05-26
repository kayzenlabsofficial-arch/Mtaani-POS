import React, { useState } from 'react';
import { 
  BarChart3, Activity, Wallet, Package, TrendingDown, 
  Landmark, Scale, Calendar, ChevronRight, ArrowUpRight, 
  ArrowDownRight, CreditCard, Share2, Loader2, TrendingUp,
  Target, Info, Search, Box, PieChart as PieIcon, Layers,
  Users, Clock, ShoppingBag, ShieldAlert, Download, FileText, ChevronDown, X
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
  PieChart, Pie, Cell, BarChart, Bar, Legend,
  ComposedChart, Line
} from 'recharts';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { canPerform } from '../../utils/accessControl';
import { enrichProductsWithBundleStock } from '../../utils/bundleInventory';
import { isLowStockProduct } from '../../utils/inventoryIntegrity';
import { belongsToActiveShop } from '../../utils/shopScope';
import { getBusinessSettings } from '../../utils/settings';
import { generateAndDownloadProductPerformanceReport, generateAndDownloadProfitLossReport } from '../../utils/shareUtils';
import { roundMoney } from '../../utils/posMoney';
import {
  calculateCreditCollections,
  calculateProfitLossPeriod,
  creditSalesAmountForTransaction,
  reportableTransaction,
} from '../../utils/profitLoss';
import {
  buildCashierPerformance,
  buildCategoryPerformance,
  buildHourlySalesData,
  buildProductPerformance,
  buildSalesTrendBuckets,
  type ReportProductPerformanceRow as ProductPerformanceRow,
} from '../../utils/reportAnalytics';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e'];
const DAY_MS = 24 * 60 * 60 * 1000;
type ReportDateRange = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'MONTHLY' | 'CUSTOM' | 'ALL';
type ReportView = 'OVERVIEW' | 'PROFIT_EXPENSES' | 'SALES_TRENDS' | 'PRODUCTS' | 'CASHIERS';
type ProfitLossExportMode = 'INDIVIDUAL' | 'COMPARISON';

type PeriodBounds = {
  start: number;
  end: number;
  label: string;
};

function formatPeriodLabel(start: number, end: number) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = startDate.toDateString() === endDate.toDateString();
  if (sameDay) return startDate.toLocaleDateString();
  return `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`;
}

function previousPeriodBounds(current: PeriodBounds, range: ReportDateRange): PeriodBounds | null {
  if (current.start <= 0 || current.end <= 0) return null;

  if (range === 'MONTHLY') {
    const date = new Date(current.start);
    const start = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const end = new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
    return {
      start: start.getTime(),
      end: end.getTime(),
      label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    };
  }

  const span = Math.max(1, current.end - current.start + 1);
  const end = current.start - 1;
  const start = end - span + 1;
  return { start, end, label: formatPeriodLabel(start, end) };
}

function useChartSize() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize(current => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

export default function ReportsTabContent() {
  const todayInput = new Date().toISOString().split('T')[0];
  const monthInput = todayInput.slice(0, 7);
  const [dateRange, setDateRange] = useState<ReportDateRange>('TODAY');
  const [activeReportView, setActiveReportView] = useState<ReportView>('OVERVIEW');
  const [selectedMonth, setSelectedMonth] = useState(monthInput);
  const [customStart, setCustomStart] = useState(todayInput);
  const [customEnd, setCustomEnd] = useState(todayInput);
  const [deductTaxInPL, setDeductTaxInPL] = useState(true);
  const [productDateRange, setProductDateRange] = useState<ReportDateRange>('MONTH');
  const [productSelectedMonth, setProductSelectedMonth] = useState(monthInput);
  const [productCustomStart, setProductCustomStart] = useState(todayInput);
  const [productCustomEnd, setProductCustomEnd] = useState(todayInput);
  const [selectedProductIds, setSelectedProductIds] = React.useState<string[]>([]);
  const [selectedProductGroups, setSelectedProductGroups] = React.useState<string[]>([]);
  const [productSearch, setProductSearch] = React.useState('');
  const [productGroupSearch, setProductGroupSearch] = React.useState('');
  const [productTablePage, setProductTablePage] = React.useState(1);
  const [isExportingProducts, setIsExportingProducts] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const productTopScrollRef = React.useRef<HTMLDivElement | null>(null);
  const productTableScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [salesChartRef, salesChartSize] = useChartSize();
  const [profitExpenseChartRef, profitExpenseChartSize] = useChartSize();
  const [expenseChartRef, expenseChartSize] = useChartSize();
  const [categoryChartRef, categoryChartSize] = useChartSize();
  const [hourlyChartRef, hourlyChartSize] = useChartSize();
  const [cashierChartRef, cashierChartSize] = useChartSize();
  
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId], null);

  React.useEffect(() => {
    setProductTablePage(1);
  }, [
    productDateRange,
    productSelectedMonth,
    productCustomStart,
    productCustomEnd,
    selectedProductIds,
    selectedProductGroups,
  ]);

  if (!canPerform(currentUser, 'report.view', businessSettings)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-rose-100 bg-rose-50 text-rose-600">
           <ShieldAlert size={40} />
        </div>
        <div className="text-center">
           <h2 className="text-xl font-bold text-slate-900 tracking-tight">Access Denied</h2>
           <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">You don't have permission to view this</p>
        </div>
      </div>
    );
  }

  // Core Data Queries
  const allTransactions = useLiveQuery(() => activeBusinessId && activeShopId ? db.transactions.where('shopId').equals(activeShopId).and(t => t.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeShopId ? db.products.where('businessId').equals(activeBusinessId).filter(p => belongsToActiveShop(p, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const allExpenses = useLiveQuery(() => activeBusinessId && activeShopId ? db.expenses.where('shopId').equals(activeShopId).and(e => e.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const allSuppliers = useLiveQuery(() => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).filter(s => belongsToActiveShop(s, activeShopId)).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const allPurchases = useLiveQuery(() => activeBusinessId && activeShopId ? db.purchaseOrders.where('shopId').equals(activeShopId).and(po => po.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const allSalesInvoices = useLiveQuery(() => activeBusinessId && activeShopId ? db.salesInvoices.where('shopId').equals(activeShopId).and(invoice => invoice.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const allCustomerPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.customerPayments.where('shopId').equals(activeShopId).and(payment => payment.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  if (!allTransactions || !allProducts || !allExpenses || !allSuppliers || !allSalesInvoices || !allCustomerPayments) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="flex h-16 w-16 animate-spin-slow items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50">
          <BarChart3 size={40} className="text-slate-200" />
        </div>
        <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest">Loading Reports...</p>
      </div>
    );
  }

  // 1. Date Filtering Logic
  const getPeriodBoundsFor = (
    range: ReportDateRange,
    monthlyValue: string,
    customStartValue: string,
    customEndValue: string
  ) => {
    const now = new Date();
    if (range === 'TODAY') {
      const start = new Date();
      start.setHours(0,0,0,0);
      const end = new Date();
      end.setHours(23,59,59,999);
      return { start: start.getTime(), end: end.getTime(), label: start.toLocaleDateString() };
    }
    if (range === 'WEEK') {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      start.setHours(0,0,0,0);
      return { start: start.getTime(), end: now.getTime(), label: 'Last 7 days' };
    }
    if (range === 'MONTH') {
      const start = new Date();
      start.setMonth(start.getMonth() - 1);
      start.setHours(0,0,0,0);
      return { start: start.getTime(), end: now.getTime(), label: 'Last 30 days' };
    }
    if (range === 'QUARTER') {
      const start = new Date();
      start.setMonth(start.getMonth() - 3);
      start.setHours(0,0,0,0);
      return { start: start.getTime(), end: now.getTime(), label: 'Last quarter' };
    }
    if (range === 'MONTHLY') {
      const [year, month] = monthlyValue.split('-').map(Number);
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0, 23, 59, 59, 999);
      return { start: start.getTime(), end: end.getTime(), label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
    }
    if (range === 'CUSTOM') {
      const start = new Date(customStartValue || todayInput);
      start.setHours(0,0,0,0);
      const end = new Date(customEndValue || customStartValue || todayInput);
      end.setHours(23,59,59,999);
      return { start: start.getTime(), end: end.getTime(), label: `${start.toLocaleDateString()} to ${end.toLocaleDateString()}` };
    }
    return { start: 0, end: now.getTime(), label: 'All time' };
  };
  const getPeriodBounds = () => getPeriodBoundsFor(dateRange, selectedMonth, customStart, customEnd);
  const { start: startTime, end: endTime, label: periodLabel } = getPeriodBounds();
  const filteredTransactions = allTransactions.filter(t => t.timestamp >= startTime && t.timestamp <= endTime && reportableTransaction(t));
  const filteredSalesInvoices = allSalesInvoices.filter(invoice => invoice.issueDate >= startTime && invoice.issueDate <= endTime && invoice.status !== 'CANCELLED');
  const filteredCustomerPayments = allCustomerPayments.filter(payment => Number(payment.timestamp || 0) >= startTime && Number(payment.timestamp || 0) <= endTime);
  const creditCollectionSummary = calculateCreditCollections(filteredCustomerPayments);
  const mpesaCreditCollections = creditCollectionSummary.byMethod.MPESA || 0;
  const cashCreditCollections = creditCollectionSummary.byMethod.CASH || 0;
  const totalCreditCollections = creditCollectionSummary.total;
  const otherCreditCollections = Math.max(0, totalCreditCollections - mpesaCreditCollections - cashCreditCollections);
  const displayProducts = enrichProductsWithBundleStock(allProducts || [], productIngredients || []);
  const reportPeriodBounds = { start: startTime, end: endTime, label: periodLabel };
  const productPeriodBounds = getPeriodBoundsFor(productDateRange, productSelectedMonth, productCustomStart, productCustomEnd);
  const currentProfitLossPeriod = calculateProfitLossPeriod({
    label: periodLabel,
    bounds: reportPeriodBounds,
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    expenses: allExpenses,
    products: displayProducts,
    purchaseOrders: allPurchases,
    deductTaxInPL,
  });
  const {
    grossSales,
    discounts: totalDiscounts,
    totalRevenue,
    cogs: estimatedCOGS,
    grossProfit,
    expenses: totalExpenseAmount,
    netProfit,
    tax: totalTax,
    creditSales: creditSalesAmount,
    orderCount: salesDocumentCount,
    expenseBreakdown: fullExpenseBreakdown,
  } = currentProfitLossPeriod;

  const currentProductPerformanceRows = buildProductPerformance({
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    products: displayProducts,
    purchaseOrders: allPurchases,
    bounds: reportPeriodBounds,
  });
  const productPerformanceRows = buildProductPerformance({
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    products: displayProducts,
    purchaseOrders: allPurchases,
    bounds: productPeriodBounds,
  });
  const averageBasket = salesDocumentCount > 0 ? totalRevenue / salesDocumentCount : 0;
  const topProducts = currentProductPerformanceRows
    .filter(row => row.revenue > 0)
    .slice(0, 5)
    .map(row => ({ name: row.name, qty: row.qty, revenue: row.revenue, profit: row.profit }));
  const topProductShare = topProducts.length > 0 && totalRevenue > 0 ? (topProducts[0].revenue / totalRevenue) * 100 : 0;
  const lowStockCount = displayProducts.filter(isLowStockProduct).length;
  const creditTransactions = filteredTransactions.filter(
    t => creditSalesAmountForTransaction(t) > 0
  ).length + filteredSalesInvoices.filter(invoice => invoice.status === 'SENT' || invoice.status === 'PARTIAL').length;

  // Chart Data Formatting
  const salesTrendData = buildSalesTrendBuckets({
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    bounds: reportPeriodBounds,
    rangeHint: dateRange,
  }).map(row => ({ name: row.name, revenue: row.revenue }));

  const categoryData = buildCategoryPerformance({
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    products: displayProducts,
    purchaseOrders: allPurchases,
    bounds: reportPeriodBounds,
  }).slice(0, 6);
  const expenseData = fullExpenseBreakdown.map(item => ({
    name: item.name,
    value: item.value,
  })).slice(0, 5);

  const buildProfitLossPeriod = (bounds: PeriodBounds) => {
    return calculateProfitLossPeriod({
      label: bounds.label,
      bounds,
      transactions: allTransactions,
      salesInvoices: allSalesInvoices,
      expenses: allExpenses,
      products: displayProducts,
      purchaseOrders: allPurchases,
      deductTaxInPL,
    });
  };

  const topCashiers = buildCashierPerformance({
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    bounds: reportPeriodBounds,
  });
  const profitExpenseTrendData = (() => {
    const chartEnd = endTime || Date.now();
    const now = new Date(chartEnd);
    const chartStart = startTime > 0
      ? startTime
      : new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
    const spanDays = Math.max(1, Math.ceil((chartEnd - chartStart + 1) / DAY_MS));
    const useMonthlyBuckets = dateRange === 'ALL' || dateRange === 'QUARTER' || dateRange === 'MONTHLY' || spanDays > 45;

    if (useMonthlyBuckets) {
      const rows: Array<{ name: string; revenue: number; profit: number; expenses: number }> = [];
      const cursor = new Date(chartStart);
      cursor.setDate(1);
      cursor.setHours(0, 0, 0, 0);

      while (cursor.getTime() <= chartEnd && rows.length < 12) {
        const start = new Date(cursor);
        const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
        const period = buildProfitLossPeriod({
          start: Math.max(start.getTime(), chartStart),
          end: Math.min(end.getTime(), chartEnd),
          label: start.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        });
        rows.push({
          name: period.label,
          revenue: roundMoney(period.totalRevenue),
          profit: roundMoney(period.netProfit),
          expenses: roundMoney(period.expenses),
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }

      return rows;
    }

    const rows: Array<{ name: string; revenue: number; profit: number; expenses: number }> = [];
    const cursor = new Date(chartStart);
    cursor.setHours(0, 0, 0, 0);

    while (cursor.getTime() <= chartEnd) {
      const start = new Date(cursor);
      const end = new Date(cursor);
      end.setHours(23, 59, 59, 999);
      const period = buildProfitLossPeriod({
        start: Math.max(start.getTime(), chartStart),
        end: Math.min(end.getTime(), chartEnd),
        label: start.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
      });
      rows.push({
        name: period.label,
        revenue: roundMoney(period.totalRevenue),
        profit: roundMoney(period.netProfit),
        expenses: roundMoney(period.expenses),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return rows;
  })();
  const hourlySalesData = buildHourlySalesData({
    transactions: allTransactions,
    salesInvoices: allSalesInvoices,
    bounds: reportPeriodBounds,
  }).map(row => ({ name: row.name, revenue: row.revenue }));
  const cashierChartData = topCashiers.slice(0, 6).map(row => ({
    name: row.name,
    revenue: roundMoney(row.revenue),
    orders: row.orders,
  }));

  const productTotalRevenue = productPerformanceRows.reduce((sum, row) => sum + row.revenue, 0);
  const productGroups = Array.from(new Set(productPerformanceRows.map(row => row.group))).sort((a, b) => a.localeCompare(b));
  const selectedProductSet = new Set(selectedProductIds);
  const selectedProductGroupSet = new Set(selectedProductGroups);
  const productSearchText = productSearch.trim().toLowerCase();
  const productGroupSearchText = productGroupSearch.trim().toLowerCase();
  const selectedProductRows = selectedProductIds
    .map(id => productPerformanceRows.find(row => row.id === id))
    .filter(Boolean) as ProductPerformanceRow[];
  const selectedProductOptionIds = new Set(selectedProductRows.map(row => row.id));
  const productSelectionMatches = productPerformanceRows
    .filter(row => `${row.name} ${row.group} ${row.source}`.toLowerCase().includes(productSearchText));
  const productSelectionOptions = [
    ...selectedProductRows,
    ...productSelectionMatches.filter(row => !selectedProductOptionIds.has(row.id)).slice(0, 160),
  ];
  const selectedCategoryOptions = selectedProductGroups.filter(group => productGroups.includes(group));
  const productGroupOptions = [
    ...selectedCategoryOptions,
    ...productGroups
      .filter(group => group.toLowerCase().includes(productGroupSearchText) && !selectedProductGroupSet.has(group)),
  ];
  const visibleProductRows = productPerformanceRows.filter(row => {
    const productMatch = selectedProductSet.size === 0 || selectedProductSet.has(row.id);
    const groupMatch = selectedProductGroupSet.size === 0 || selectedProductGroupSet.has(row.group);
    return productMatch && groupMatch;
  });
  const productRowsPerPage = 20;
  const productTotalPages = Math.max(1, Math.ceil(visibleProductRows.length / productRowsPerPage));
  const productCurrentPage = Math.min(productTablePage, productTotalPages);
  const productPageStart = visibleProductRows.length === 0 ? 0 : (productCurrentPage - 1) * productRowsPerPage;
  const productPageRows = visibleProductRows.slice(productPageStart, productPageStart + productRowsPerPage);
  const productPageEnd = productPageStart + productPageRows.length;
  const productSummary = visibleProductRows.reduce(
    (acc, row) => {
      acc.qty += row.qty;
      acc.revenue += row.revenue;
      acc.cogs += row.cogs;
      acc.profit += row.profit;
      acc.tax += row.tax;
      acc.stock += Number(row.stock || 0);
      if (row.qty > 0) acc.activeItems += 1;
      return acc;
    },
    { qty: 0, revenue: 0, cogs: 0, profit: 0, tax: 0, stock: 0, activeItems: 0 }
  );
  const productSummaryMargin = productSummary.revenue > 0 ? (productSummary.profit / productSummary.revenue) * 100 : 0;
  const productTopRow = visibleProductRows.find(row => row.revenue > 0);
  const toggleProductSelection = (id: string) => {
    setSelectedProductIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };
  const toggleProductGroupSelection = (group: string) => {
    setSelectedProductGroups(current => current.includes(group) ? current.filter(item => item !== group) : [...current, group]);
  };
  const syncProductHorizontalScroll = (source: 'top' | 'table') => {
    const topScroll = productTopScrollRef.current;
    const tableScroll = productTableScrollRef.current;
    if (!topScroll || !tableScroll) return;
    if (source === 'top') tableScroll.scrollLeft = topScroll.scrollLeft;
    else topScroll.scrollLeft = tableScroll.scrollLeft;
  };
  const scrollProductSheet = (direction: 'left' | 'right') => {
    const topScroll = productTopScrollRef.current;
    const tableScroll = productTableScrollRef.current;
    const currentLeft = tableScroll?.scrollLeft ?? topScroll?.scrollLeft ?? 0;
    const nextLeft = Math.max(0, currentLeft + (direction === 'left' ? -360 : 360));
    tableScroll?.scrollTo({ left: nextLeft, behavior: 'smooth' });
    topScroll?.scrollTo({ left: nextLeft, behavior: 'smooth' });
  };

  const handleExportProductPerformance = async () => {
    setIsExportingProducts(true);
    try {
      await generateAndDownloadProductPerformanceReport({
        title: `Product-Performance-${productDateRange}-${new Date().toISOString().split('T')[0]}`,
        periodLabel: productPeriodBounds.label,
        businessName: businessSettings?.storeName,
        location: businessSettings?.location,
        productScope: selectedProductIds.length === 0 ? 'All items' : `${selectedProductIds.length} selected item${selectedProductIds.length === 1 ? '' : 's'}`,
        groupScope: selectedProductGroups.length === 0 ? 'All categories' : `${selectedProductGroups.length} selected categor${selectedProductGroups.length === 1 ? 'y' : 'ies'}`,
        rows: visibleProductRows,
        summary: {
          qty: productSummary.qty,
          revenue: productSummary.revenue,
          tax: productSummary.tax,
          cogs: productSummary.cogs,
          profit: productSummary.profit,
          margin: productSummaryMargin,
          stock: productSummary.stock,
          activeItems: productSummary.activeItems,
          rowCount: visibleProductRows.length,
        },
      });
    } catch (err) {
      console.error('Product performance export failed', err);
    } finally {
      setIsExportingProducts(false);
    }
  };

  const handleExportProfitLoss = async () => {
    setIsSharing(true);
    try {
      const periods = [currentProfitLossPeriod];
      const exportMode: ProfitLossExportMode = 'INDIVIDUAL';
      await generateAndDownloadProfitLossReport({
        title: `${exportMode}-${dateRange}-${new Date().toISOString().split('T')[0]}`,
        periodLabel: currentProfitLossPeriod.label,
        reportMode: exportMode,
        businessName: businessSettings?.storeName,
        location: businessSettings?.location,
        grossSales,
        discounts: totalDiscounts,
        totalRevenue,
        cogs: estimatedCOGS,
        grossProfit,
        expenses: totalExpenseAmount,
        netProfit,
        tax: totalTax,
        deductTaxInPL,
        creditSales: creditSalesAmount,
        orderCount: salesDocumentCount,
        expenseBreakdown: fullExpenseBreakdown,
        periods,
      });
    } catch (err) {
      console.error("P&L export failed", err);
    } finally {
      setIsSharing(false);
    }
  };

  const reportViews: Array<{ id: ReportView; label: string; icon: React.ReactNode; detail: string }> = [
    { id: 'OVERVIEW', label: 'Overview', icon: <FileText size={16} />, detail: 'Main numbers and quick checks' },
    { id: 'PROFIT_EXPENSES', label: 'Profit & Expenses', icon: <Scale size={16} />, detail: 'Profit, expenses, and P&L export' },
    { id: 'SALES_TRENDS', label: 'Sales Trends', icon: <BarChart3 size={16} />, detail: 'Sales movement by time and category' },
    { id: 'PRODUCTS', label: 'Products', icon: <Package size={16} />, detail: 'Product performance and PDF export' },
    { id: 'CASHIERS', label: 'Cashiers', icon: <Users size={16} />, detail: 'Cashier sales performance' },
  ];
  const activeReportViewConfig = reportViews.find(view => view.id === activeReportView) || reportViews[0];
  const renderMainDateControls = () => (
    <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
      <div className="no-scrollbar flex w-full max-w-full overflow-x-auto rounded-lg border-2 border-slate-200 bg-slate-50 p-1 lg:w-auto">
        {[
          { id: 'TODAY', label: 'Today' },
          { id: 'WEEK', label: 'Week' },
          { id: 'MONTH', label: 'Month' },
          { id: 'QUARTER', label: 'Quarter' },
          { id: 'CUSTOM', label: 'Custom' },
          { id: 'ALL', label: 'All' }
        ].map(range => (
          <button
            key={range.id}
            type="button"
            onClick={() => setDateRange(range.id as ReportDateRange)}
            className={`h-9 flex-shrink-0 rounded-md px-3 text-[11px] font-bold transition-all ${dateRange === range.id ? 'bg-blue-700 text-white' : 'text-slate-500 hover:bg-white hover:text-slate-700'}`}
          >
            {range.label}
          </button>
        ))}
      </div>
      {dateRange === 'CUSTOM' && (
        <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-center">
          <input
            type="date"
            value={customStart}
            onChange={event => setCustomStart(event.target.value)}
            className="h-11 min-w-0 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 lg:w-36"
          />
          <input
            type="date"
            value={customEnd}
            onChange={event => setCustomEnd(event.target.value)}
            className="h-11 min-w-0 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 lg:w-36"
          />
        </div>
      )}
    </div>
  );

  const renderProductDateControls = () => (
    <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
      <div className="no-scrollbar flex w-full max-w-full overflow-x-auto rounded-lg border-2 border-slate-200 bg-slate-50 p-1 lg:w-auto">
        {[
          { id: 'TODAY', label: 'Today' },
          { id: 'WEEK', label: 'Week' },
          { id: 'MONTH', label: 'Month' },
          { id: 'QUARTER', label: 'Quarter' },
          { id: 'CUSTOM', label: 'Custom' },
          { id: 'ALL', label: 'All' }
        ].map(range => (
          <button
            key={range.id}
            type="button"
            onClick={() => setProductDateRange(range.id as ReportDateRange)}
            className={`h-9 flex-shrink-0 rounded-md px-3 text-[11px] font-bold transition-all ${productDateRange === range.id ? 'bg-blue-700 text-white' : 'text-slate-500 hover:bg-white hover:text-slate-700'}`}
          >
            {range.label}
          </button>
        ))}
      </div>
      {productDateRange === 'CUSTOM' && (
        <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto lg:items-center">
          <input
            type="date"
            value={productCustomStart}
            onChange={event => setProductCustomStart(event.target.value)}
            className="h-11 min-w-0 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 lg:w-36"
          />
          <input
            type="date"
            value={productCustomEnd}
            onChange={event => setProductCustomEnd(event.target.value)}
            className="h-11 min-w-0 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 lg:w-36"
          />
        </div>
      )}
    </div>
  );

  return (
    <div className="w-full max-w-full space-y-5 overflow-x-hidden pb-24 animate-in fade-in">
      
      {/* Header */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-black text-slate-900">Financial reports</h2>
          <div className="mt-1 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] font-bold text-slate-500">{salesDocumentCount} sales documents</span>
            <span className={`text-[10px] font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Net: Ksh {netProfit.toLocaleString()}</span>
          </div>
        </div>
      </div>
      </section>

      <section className="rounded-lg border-2 border-slate-200 bg-white p-2 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {reportViews.map(view => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setActiveReportView(view.id)}
                  className={`flex min-w-max items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-black transition-all ${
                    activeReportView === view.id
                      ? 'border-blue-700 bg-blue-700 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'
                  }`}
                >
                  {view.icon}
                  <span>{view.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 px-1 text-xs font-semibold text-slate-500">{activeReportViewConfig.detail}</p>
          </div>
          {activeReportView === 'PRODUCTS' ? renderProductDateControls() : renderMainDateControls()}
        </div>
      </section>

      <div id="report-content" className="space-y-5">
        <div className={activeReportView === 'OVERVIEW' ? 'space-y-5' : 'hidden'}>
        
        {/* Global Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total revenue" value={totalRevenue} icon={<TrendingUp size={24}/>} color="indigo" subtitle={`${salesDocumentCount} sales documents - collections separate`} />
          <StatCard title="Net profit" value={netProfit} icon={<Target size={24}/>} color={netProfit >= 0 ? "emerald" : "rose"} subtitle={`After stock cost, expenses${deductTaxInPL ? ' and VAT' : ''}`} />
          <StatCard title="Profit margin" value={((grossProfit / (totalRevenue || 1)) * 100)} unit="%" icon={<Layers size={24}/>} color="blue" subtitle="Profit made from sales" />
          <StatCard title="Expense share" value={((totalExpenseAmount / (totalRevenue || 1)) * 100)} unit="%" icon={<Activity size={24}/>} color="amber" subtitle="Expenses compared to sales" />
        </div>
        </div>

        <div className={activeReportView === 'PROFIT_EXPENSES' ? 'space-y-5' : 'hidden'}>
        <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-900">Profit & Expenses</h3>
              <p className="mt-1 text-xs font-semibold text-slate-500">Control VAT treatment and export the selected P&L period.</p>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
              <button
                type="button"
                onClick={() => setDeductTaxInPL(v => !v)}
                aria-pressed={deductTaxInPL}
                className={`flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-3 text-[10px] font-black uppercase tracking-widest transition-all md:px-4 md:text-[11px] ${
                  deductTaxInPL
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
                title="Toggle whether VAT is deducted when calculating P&L"
              >
                <Scale size={15} />
                VAT {deductTaxInPL ? 'On' : 'Off'}
              </button>
              <button onClick={handleExportProfitLoss} disabled={isSharing} aria-busy={isSharing} data-busy={isSharing ? 'true' : undefined} className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50 md:px-4">
                {isSharing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                <span>{isSharing ? 'Exporting...' : 'Export P&L'}</span>
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-emerald-700"> <Scale size={20} /> </div>
              Profit vs expenses
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-black">
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Net profit Ksh {netProfit.toLocaleString()}</span>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Expenses Ksh {totalExpenseAmount.toLocaleString()}</span>
              <span className="text-slate-400">{periodLabel}</span>
            </div>
          </div>
          <div ref={profitExpenseChartRef} className="h-[340px] w-full min-w-0">
            {profitExpenseChartSize.width > 0 && profitExpenseChartSize.height > 0 && (
              <BarChart width={profitExpenseChartSize.width} height={profitExpenseChartSize.height} data={profitExpenseTrendData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} tickFormatter={(v) => `Ksh ${Math.abs(Number(v)) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : v}`} />
                <Tooltip formatter={(value: any) => `Ksh ${Number(value || 0).toLocaleString()}`} contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 12px 20px -12px rgba(15,23,42,0.35)', fontWeight: 900 }} />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }} />
                <Bar dataKey="profit" name="Net profit" fill="#10b981" radius={[8, 8, 0, 0]} maxBarSize={34} />
                <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[8, 8, 0, 0]} maxBarSize={34} />
              </BarChart>
            )}
          </div>
        </section>
        </div>

        {/* Primary Analytical Charts */}
        <div className={activeReportView === 'SALES_TRENDS' || activeReportView === 'PROFIT_EXPENSES' ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : 'hidden'}>
          <div className={activeReportView === 'SALES_TRENDS' ? 'lg:col-span-3 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5' : 'hidden'}>
            <div className="hidden" />
            <div className="relative z-10">
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-3 mb-8">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700"> <BarChart3 size={20} /> </div>
                Sales trend
              </h3>
              <div ref={salesChartRef} className="h-[320px] w-full min-w-0">
                {salesChartSize.width > 0 && salesChartSize.height > 0 && (
                  <ComposedChart width={salesChartSize.width} height={salesChartSize.height} data={salesTrendData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} tickFormatter={(v) => `Ksh ${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                    <Tooltip contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', fontWeight: 900 }} />
                    <Bar dataKey="revenue" barSize={32} fill="#6366f1" radius={[8, 8, 0, 0]} opacity={0.6} />
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
                  </ComposedChart>
                )}
              </div>
            </div>
          </div>

          <div className={activeReportView === 'PROFIT_EXPENSES' ? 'rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-3' : 'hidden'}>
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="flex items-center gap-3 text-lg font-bold text-slate-900">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-amber-700"> <PieIcon size={20} /> </div>
                Expenses by category
              </h3>
              <span className="rounded-full border-2 border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                {expenseData.length} categor{expenseData.length === 1 ? 'y' : 'ies'}
              </span>
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(280px,420px)_1fr] lg:items-center">
              <div ref={expenseChartRef} className="relative h-[300px] min-w-0">
                {expenseChartSize.width > 0 && expenseChartSize.height > 0 && (
                  <PieChart width={expenseChartSize.width} height={expenseChartSize.height}>
                    <Pie data={expenseData} innerRadius={82} outerRadius={118} paddingAngle={8} dataKey="value" stroke="none">
                      {expenseData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', fontWeight: 900 }} />
                  </PieChart>
                )}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                   <p className="text-[10px] font-black uppercase text-slate-400">Total spent</p>
                   <p className="text-lg font-black leading-none text-slate-900">Ksh {totalExpenseAmount.toLocaleString()}</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {expenseData.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-4 rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}} />
                      <span className="truncate text-[11px] font-black uppercase tracking-wider text-slate-600">{item.name}</span>
                    </div>
                    <span className="flex-shrink-0 text-[11px] font-black tabular-nums text-slate-900">Ksh {item.value.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Audit & Category Performance */}
        <div className={activeReportView === 'SALES_TRENDS' || activeReportView === 'OVERVIEW' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'hidden'}>
          <section className={activeReportView === 'SALES_TRENDS' ? 'rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2' : 'hidden'}>
             <h3 className="font-bold text-slate-900 text-lg flex items-center gap-3 mb-8">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-emerald-700"> <ShoppingBag size={20} /> </div>
                Category sales
             </h3>
             <div ref={categoryChartRef} className="h-[300px] w-full min-w-0">
                {categoryChartSize.width > 0 && categoryChartSize.height > 0 && (
                   <BarChart width={categoryChartSize.width} height={categoryChartSize.height} data={categoryData} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} width={90} />
                      <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '16px', border: 'none', fontWeight: 900 }} />
                      <Bar dataKey="revenue" fill="#10b981" radius={[0, 8, 8, 0]} barSize={20} />
                      <Bar dataKey="profit" fill="#6366f1" radius={[0, 8, 8, 0]} barSize={20} />
                   </BarChart>
                )}
             </div>
             <div className="mt-6 flex justify-center gap-6">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-sm"/> <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Revenue</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-600 rounded-sm"/> <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Profit</span></div>
             </div>
          </section>

          <section className={activeReportView === 'OVERVIEW' ? 'overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm lg:col-span-2' : 'hidden'}>
            <div className="border-b-2 border-slate-200 bg-slate-50 px-4 py-4">
              <h3 className="text-lg font-bold text-slate-900">Quick summary</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">How the business is doing</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <tbody className="divide-y-2 divide-slate-50 text-sm">
                  <SummaryRow metric="Net profit" value={`Ksh ${Math.floor(netProfit).toLocaleString()}`} target="Above zero" ok={netProfit >= 0} />
                  <SummaryRow metric="Profit margin" value={`${((grossProfit / (totalRevenue || 1)) * 100).toFixed(1)}%`} target="Above 25%" ok={((grossProfit / (totalRevenue || 1)) * 100) >= 25} />
                  <SummaryRow metric="Average sale" value={`Ksh ${Math.floor(averageBasket).toLocaleString()}`} target="Ksh 500+" ok={averageBasket >= 500} />
                  <SummaryRow metric="Low stock items" value={`${lowStockCount} items`} target="Less than 10" ok={lowStockCount < 10} />
                  <SummaryRow metric="Credit sales" value={`${creditTransactions} sales`} target="Under 15%" ok={salesDocumentCount === 0 || creditTransactions <= (salesDocumentCount * 0.15)} />
                  <SummaryRow metric="M-Pesa credit collections" value={`Ksh ${Math.floor(mpesaCreditCollections).toLocaleString()}`} target="Not counted as sales" ok />
                  <SummaryRow metric="Total credit collections" value={`Ksh ${Math.floor(totalCreditCollections).toLocaleString()}`} target={`${otherCreditCollections > 0 ? `Other Ksh ${Math.floor(otherCreditCollections).toLocaleString()}` : cashCreditCollections > 0 ? `Cash Ksh ${Math.floor(cashCreditCollections).toLocaleString()}` : 'No other collections'}`} ok />
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className={activeReportView === 'SALES_TRENDS' || activeReportView === 'CASHIERS' ? 'grid grid-cols-1 lg:grid-cols-2 gap-6' : 'hidden'}>
          <section className={activeReportView === 'SALES_TRENDS' ? 'rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2' : 'hidden'}>
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-3 mb-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700"> <Clock size={20} /> </div>
              Sales by hour
            </h3>
            <div ref={hourlyChartRef} className="h-[300px] w-full min-w-0">
              {hourlyChartSize.width > 0 && hourlyChartSize.height > 0 && (
                <BarChart width={hourlyChartSize.width} height={hourlyChartSize.height} data={hourlySalesData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" interval={2} axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} tickFormatter={(v) => `Ksh ${Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : v}`} />
                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '16px', border: 'none', fontWeight: 900 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[8, 8, 0, 0]} barSize={18} />
                </BarChart>
              )}
            </div>
          </section>

          <section className={activeReportView === 'CASHIERS' ? 'rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5 lg:col-span-2' : 'hidden'}>
            <h3 className="font-bold text-slate-900 text-lg flex items-center gap-3 mb-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700"> <Users size={20} /> </div>
              Cashier sales
            </h3>
            <div ref={cashierChartRef} className="h-[300px] w-full min-w-0">
              {cashierChartSize.width > 0 && cashierChartSize.height > 0 && (
                <BarChart width={cashierChartSize.width} height={cashierChartSize.height} data={cashierChartData} layout="vertical" margin={{ left: 12, right: 20 }}>
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} width={100} />
                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '16px', border: 'none', fontWeight: 900 }} />
                  <Bar dataKey="revenue" name="Revenue" fill="#7c3aed" radius={[0, 8, 8, 0]} barSize={22} />
                </BarChart>
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {cashierChartData.slice(0, 2).map(row => (
                <div key={row.name} className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
                  <p className="truncate text-[10px] font-black uppercase tracking-widest text-slate-400">{row.name}</p>
                  <p className="mt-1 text-sm font-black text-slate-900">Ksh {row.revenue.toLocaleString()}</p>
                  <p className="text-[10px] font-bold text-slate-500">{row.orders} order{row.orders === 1 ? '' : 's'}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Product Performance Sheet */}
        <section className={activeReportView === 'PRODUCTS' ? 'overflow-hidden rounded-lg border-2 border-slate-200 bg-white p-4 text-slate-900 shadow-sm sm:p-5' : 'hidden'}>
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <h3 className="text-2xl font-bold tracking-tight flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
                    <Activity size={28} />
                  </div>
                  Product sales details
                </h3>
              </div>

              <div className="flex w-full xl:w-auto">
                <button
                  type="button"
                  onClick={handleExportProductPerformance}
                  disabled={isExportingProducts || visibleProductRows.length === 0}
                  aria-busy={isExportingProducts}
                  data-busy={isExportingProducts ? 'true' : undefined}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[11px] font-black uppercase tracking-widest text-white transition-all hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50 xl:w-auto"
                >
                  {isExportingProducts ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  Export PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_0.85fr]">
              <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-blue-700" />
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Items</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedProductIds([])} className="h-8 rounded-lg border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50">All</button>
                    <button
                      onClick={() => setSelectedProductIds(Array.from(new Set([...selectedProductIds, ...productSelectionOptions.map(row => row.id)])))}
                      className="h-8 rounded-lg border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wider text-slate-600 hover:border-blue-200 hover:text-blue-700"
                    >
                      Select visible
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex h-11 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3">
                  <Search size={16} className="text-slate-500" />
                  <input
                    value={productSearch}
                    onChange={e => setProductSearch(e.target.value)}
                    placeholder="Search items"
                    className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
                {selectedProductRows.length > 0 && (
                  <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto rounded-lg border-2 border-blue-200 bg-blue-50 p-2">
                    {selectedProductRows.map(row => (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => toggleProductSelection(row.id)}
                        className="flex max-w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-950"
                      >
                        <span className="truncate">{row.name}</span>
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
                  {productSelectionOptions.map(row => (
                    <label key={row.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-white">
                      <input
                        type="checkbox"
                        checked={selectedProductSet.has(row.id)}
                        onChange={() => toggleProductSelection(row.id)}
                        className="h-4 w-4 rounded border-slate-300 bg-white accent-blue-700"
                      />
                      <span className="min-w-0 flex-1 truncate">{row.name}</span>
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{row.source}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {selectedProductIds.length === 0 ? 'All items selected' : `${selectedProductIds.length} selected`}
                </p>
              </div>

              <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Layers size={16} className="text-emerald-700" />
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-600">Categories</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedProductGroups([])} className="h-8 rounded-lg border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50">All</button>
                    <button
                      onClick={() => setSelectedProductGroups(Array.from(new Set([...selectedProductGroups, ...productGroupOptions])))}
                      className="h-8 rounded-lg border-2 border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-wider text-slate-600 hover:border-blue-200 hover:text-blue-700"
                    >
                      Select visible
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex h-11 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3">
                  <Search size={16} className="text-slate-500" />
                  <input
                    value={productGroupSearch}
                    onChange={e => setProductGroupSearch(e.target.value)}
                    placeholder="Search categories"
                    className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-800 outline-none placeholder:text-slate-400"
                  />
                </div>
                {selectedProductGroups.length > 0 && (
                  <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto rounded-lg border-2 border-emerald-200 bg-emerald-50 p-2">
                    {selectedProductGroups.map(group => (
                      <button
                        key={group}
                        type="button"
                        onClick={() => toggleProductGroupSelection(group)}
                        className="flex max-w-full items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-950"
                      >
                        <span className="truncate">{group}</span>
                        <X size={12} />
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
                  {productGroupOptions.map(group => (
                    <label key={group} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-white">
                      <input
                        type="checkbox"
                        checked={selectedProductGroupSet.has(group)}
                        onChange={() => toggleProductGroupSelection(group)}
                        className="h-4 w-4 rounded border-slate-300 bg-white accent-blue-700"
                      />
                      <span className="min-w-0 flex-1 truncate">{group}</span>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  {selectedProductGroups.length === 0 ? 'All categories selected' : `${selectedProductGroups.length} selected`}
                </p>
              </div>

            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-slate-500"><Layers size={13} /> Units sold</p>
                <p className="mt-3 text-2xl font-black tabular-nums">{productSummary.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
              </div>
              <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-emerald-700"><TrendingUp size={13} /> Sales</p>
                <p className="mt-3 text-2xl font-black tabular-nums">Ksh {Math.round(productSummary.revenue).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-700"><Target size={13} /> Profit</p>
                <p className={`mt-3 text-2xl font-black tabular-nums ${productSummary.profit < 0 ? 'text-rose-600' : 'text-slate-900'}`}>Ksh {Math.round(productSummary.profit).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <p className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-amber-700"><Calendar size={13} /> VAT</p>
                <p className="mt-3 text-2xl font-black tabular-nums">Ksh {Math.round(productSummary.tax).toLocaleString()}</p>
              </div>
              <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">Top item</p>
                <p className="mt-3 truncate text-xl font-black">{productTopRow?.name || 'No sales'}</p>
                <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{productSummaryMargin.toFixed(1)}% margin</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {visibleProductRows.length} rows, 20 per page
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => scrollProductSheet('left')}
                      className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100"
                    >
                      <ChevronRight size={14} className="rotate-180" />
                      Left
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollProductSheet('right')}
                      className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-100"
                    >
                      Right
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
                <div
                  ref={productTopScrollRef}
                  onScroll={() => syncProductHorizontalScroll('top')}
                  className="h-4 overflow-x-auto overflow-y-hidden rounded-lg border border-slate-200 bg-white"
                >
                  <div className="h-1 w-[1180px]" />
                </div>
              </div>
              <div
                ref={productTableScrollRef}
                onScroll={() => syncProductHorizontalScroll('table')}
                className="max-h-[560px] overflow-auto"
              >
                <table className="w-full min-w-[1180px] border-collapse text-left text-xs text-slate-700">
                  <thead className="sticky top-0 z-10 bg-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="border border-slate-300 px-3 py-3">#</th>
                      <th className="border border-slate-300 px-3 py-3">Product</th>
                      <th className="border border-slate-300 px-3 py-3">Category</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Qty sold</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Sales</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">VAT</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Cost</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Profit</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Margin</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Stock</th>
                      <th className="border border-slate-300 px-3 py-3 text-right">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productPageRows.map((row, index) => (
                      <tr key={row.id} className={`${(productPageStart + index) % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-blue-50`}>
                        <td className="border border-slate-200 px-3 py-2 font-black text-slate-400">{productPageStart + index + 1}</td>
                        <td className="border border-slate-200 px-3 py-2">
                          <div className="min-w-0">
                            <p className="font-black text-slate-900">{row.name}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{row.source}</p>
                          </div>
                        </td>
                        <td className="border border-slate-200 px-3 py-2 font-bold text-slate-600">{row.group}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right font-black tabular-nums text-slate-900">{row.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right font-black tabular-nums text-slate-900">Ksh {Math.round(row.revenue).toLocaleString()}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-500">Ksh {Math.round(row.tax).toLocaleString()}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-500">Ksh {Math.round(row.cogs).toLocaleString()}</td>
                        <td className={`border border-slate-200 px-3 py-2 text-right font-black tabular-nums ${row.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Ksh {Math.round(row.profit).toLocaleString()}</td>
                        <td className="border border-slate-200 px-3 py-2 text-right font-black tabular-nums text-slate-900">{row.margin.toFixed(1)}%</td>
                        <td className={`border border-slate-200 px-3 py-2 text-right font-black tabular-nums ${isLowStockProduct({ stockQuantity: row.stock, reorderPoint: row.reorderPoint }) ? 'text-rose-600' : 'text-slate-900'}`}>
                          {row.stock === null ? '-' : row.stock.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="border border-slate-200 px-3 py-2 text-right font-bold tabular-nums text-slate-500">{row.share.toFixed(1)}%</td>
                      </tr>
                    ))}
                    {visibleProductRows.length === 0 && (
                      <tr>
                        <td colSpan={11} className="border border-slate-200 px-3 py-16 text-center">
                          <Box size={40} className="mx-auto mb-4 text-slate-300" />
                          <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">No product rows found</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-slate-50 text-slate-900">
                    <tr className="text-[11px] font-black uppercase tracking-widest">
                      <td className="border border-slate-300 px-3 py-3" colSpan={3}>Total</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">{productSummary.qty.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">Ksh {Math.round(productSummary.revenue).toLocaleString()}</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">Ksh {Math.round(productSummary.tax).toLocaleString()}</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">Ksh {Math.round(productSummary.cogs).toLocaleString()}</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">Ksh {Math.round(productSummary.profit).toLocaleString()}</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">{productSummaryMargin.toFixed(1)}%</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">{productSummary.stock.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-300 px-3 py-3 text-right tabular-nums">{productTotalRevenue > 0 ? ((productSummary.revenue / productTotalRevenue) * 100).toFixed(1) : '0.0'}%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] font-black uppercase tracking-widest">
                  Showing {visibleProductRows.length === 0 ? 0 : productPageStart + 1}-{productPageEnd} of {visibleProductRows.length} rows
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setProductTablePage(Math.max(1, productCurrentPage - 1))}
                    disabled={productCurrentPage <= 1}
                    className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 transition-all hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronRight size={14} className="rotate-180" />
                    Prev
                  </button>
                  <span className="min-w-24 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Page {productCurrentPage} of {productTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setProductTablePage(Math.min(productTotalPages, productCurrentPage + 1))}
                    disabled={productCurrentPage >= productTotalPages}
                    className="flex h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-black uppercase tracking-widest text-slate-700 transition-all hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

// ── UI Helpers ─────────────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: number;
  unit?: string;
  icon: React.ReactNode;
  color: string;
  subtitle: string;
}

function StatCard({ title, value, unit, icon, color, subtitle }: StatCardProps) {
  const colors: any = {
    indigo: "border-blue-100 bg-blue-50 text-blue-700",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    rose: "border-rose-100 bg-rose-50 text-rose-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    blue: "border-blue-100 bg-blue-50 text-blue-700",
  };

  return (
    <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-200">
      <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-lg border-2 ${colors[color]}`}>
        {icon}
      </div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{title}</p>
      <h3 className="text-2xl font-black text-slate-900 tabular-nums">
        {unit !== '%' ? 'Ksh ' : ''}{Math.floor(value).toLocaleString()}{unit || ''}
      </h3>
      <p className="text-[11px] font-bold text-slate-500 mt-2 opacity-60 leading-tight">{subtitle}</p>
    </div>
  );
}

function SummaryRow({ metric, value, target, ok }: { metric: string; value: string; target: string; ok: boolean }) {
  return (
    <tr className="group hover:bg-slate-50/50 transition-colors">
      <td className="px-8 py-5 font-black text-slate-900 text-sm">{metric}</td>
      <td className="px-8 py-5 font-black text-slate-700 tabular-nums text-sm">{value}</td>
      <td className="px-8 py-5 text-slate-400 font-bold text-[11px] uppercase tracking-wider">{target}</td>
      <td className="px-8 py-5">
        <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center justify-center w-fit border ${
          ok ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'
        }`}>
          {ok ? 'Target met' : 'Off track'}
        </div>
      </td>
    </tr>
  );
}
