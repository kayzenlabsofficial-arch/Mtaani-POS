import React, { useState } from 'react';
import { Plus, FileMinus, Trash2, Calendar, User, X, PackageMinus } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import ExpenseModal from '../modals/ExpenseModalDesktop';
import { SearchableSelect } from '../shared/SearchableSelect';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';
import { submitExpenseRecord } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getBusinessSettings } from '../../utils/settings';
import { getCurrentShiftId, getCurrentShiftStart } from '../../utils/shiftSession';
import { ExpenseService } from '../../services/expenses';
import { pickedCashAccountId, singleFinanceAccount } from '../../utils/financeAccount';
import { belongsToActiveShop } from '../../utils/shopScope';
import {
  expenseLifecycleTotals,
  isBundleExpenseProduct,
  normalizeExpenseSource,
  normalizeExpenseStatus,
  shopExpenseProductEligibility,
} from '../../utils/expenseIntegrity';
import { useDesktopSubnav } from '../navigation/DesktopSubnav';

type ExpenseDateRange = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM' | 'ALL';
type ExpenseSourceFilter = 'ALL' | 'TILL' | 'ACCOUNT' | 'SHOP';
type ExpenseStatusFilter = 'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED';
type ExpenseViewTab = 'RECORDS' | 'SHOP';

function ExpensesDesktopSubnav({
  activeExpenseTab,
  setActiveExpenseTab,
  expenseSearch,
  setExpenseSearch,
  expenseDateRange,
  setExpenseDateRange,
  expenseStartDate,
  setExpenseStartDate,
  expenseEndDate,
  setExpenseEndDate,
  expenseSourceFilter,
  setExpenseSourceFilter,
  expenseStatusFilter,
  setExpenseStatusFilter,
  expenseCategoryFilter,
  setExpenseCategoryFilter,
  expenseCategories,
  filteredExpenseTotal,
  filteredExpensesCount,
  canCreateExpense,
  onLogExpense,
  hasExpenseFilters,
  onClearFilters,
}: {
  activeExpenseTab: ExpenseViewTab;
  setActiveExpenseTab: (value: ExpenseViewTab) => void;
  expenseSearch: string;
  setExpenseSearch: (value: string) => void;
  expenseDateRange: ExpenseDateRange;
  setExpenseDateRange: (value: ExpenseDateRange) => void;
  expenseStartDate: string;
  setExpenseStartDate: (value: string) => void;
  expenseEndDate: string;
  setExpenseEndDate: (value: string) => void;
  expenseSourceFilter: ExpenseSourceFilter;
  setExpenseSourceFilter: (value: ExpenseSourceFilter) => void;
  expenseStatusFilter: ExpenseStatusFilter;
  setExpenseStatusFilter: (value: ExpenseStatusFilter) => void;
  expenseCategoryFilter: string;
  setExpenseCategoryFilter: (value: string) => void;
  expenseCategories: string[];
  filteredExpenseTotal: number;
  filteredExpensesCount: number;
  canCreateExpense: boolean;
  onLogExpense: () => void;
  hasExpenseFilters: boolean;
  onClearFilters: () => void;
}) {
  const selectClassName = 'h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100';
  const subnavConfig = React.useMemo(() => ({
    id: 'expenses',
    label: 'Expenses',
    tabs: [
      { id: 'RECORDS', label: 'Expense records', icon: FileMinus, active: activeExpenseTab === 'RECORDS', onClick: () => setActiveExpenseTab('RECORDS') },
      { id: 'SHOP', label: 'Shop product', icon: PackageMinus, active: activeExpenseTab === 'SHOP', onClick: () => setActiveExpenseTab('SHOP') },
    ],
    filters: activeExpenseTab === 'RECORDS' ? ([
      { id: 'TODAY', label: 'Today', active: expenseDateRange === 'TODAY', onClick: () => setExpenseDateRange('TODAY') },
      { id: 'WEEK', label: 'Week', active: expenseDateRange === 'WEEK', onClick: () => setExpenseDateRange('WEEK') },
      { id: 'MONTH', label: 'Month', active: expenseDateRange === 'MONTH', onClick: () => setExpenseDateRange('MONTH') },
      { id: 'CUSTOM', label: 'Custom', active: expenseDateRange === 'CUSTOM', onClick: () => setExpenseDateRange('CUSTOM') },
      { id: 'ALL', label: 'All', active: expenseDateRange === 'ALL', onClick: () => setExpenseDateRange('ALL') },
    ]) : [],
    search: activeExpenseTab === 'RECORDS' ? {
      value: expenseSearch,
      placeholder: 'Search expenses',
      onChange: setExpenseSearch,
      onClear: () => setExpenseSearch(''),
    } : undefined,
    controls: activeExpenseTab === 'RECORDS' ? (
      <>
        {expenseDateRange === 'CUSTOM' && (
          <>
            <input type="date" value={expenseStartDate} onChange={event => setExpenseStartDate(event.target.value)} className={selectClassName} />
            <input type="date" value={expenseEndDate} onChange={event => setExpenseEndDate(event.target.value)} className={selectClassName} />
          </>
        )}
        <select value={expenseSourceFilter} onChange={event => setExpenseSourceFilter(event.target.value as ExpenseSourceFilter)} className={selectClassName}>
          <option value="ALL">All sources</option>
          <option value="TILL">Till</option>
          <option value="ACCOUNT">Main account</option>
          <option value="SHOP">Shop stock</option>
        </select>
        <select value={expenseStatusFilter} onChange={event => setExpenseStatusFilter(event.target.value as ExpenseStatusFilter)} className={selectClassName}>
          <option value="ALL">All statuses</option>
          <option value="APPROVED">Approved</option>
          <option value="PENDING">Pending</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select value={expenseCategoryFilter} onChange={event => setExpenseCategoryFilter(event.target.value)} className={selectClassName}>
          <option value="ALL">All categories</option>
          {expenseCategories.map(category => <option key={category} value={category}>{category}</option>)}
        </select>
      </>
    ) : undefined,
    summary: activeExpenseTab === 'RECORDS' ? [
      { label: 'Approved', value: `Ksh ${filteredExpenseTotal.toLocaleString()}` },
      { label: 'Records', value: filteredExpensesCount.toLocaleString() },
    ] : [],
    actions: [
      ...(hasExpenseFilters && activeExpenseTab === 'RECORDS' ? [{
        id: 'clear-filters',
        label: 'Clear filters',
        icon: X,
        onClick: onClearFilters,
      }] : []),
      ...(canCreateExpense ? [{
        id: 'log-expense',
        label: activeExpenseTab === 'SHOP' ? 'Save from form' : 'Log expense',
        icon: activeExpenseTab === 'SHOP' ? PackageMinus : Plus,
        tone: 'primary' as const,
        onClick: onLogExpense,
        hidden: activeExpenseTab === 'SHOP',
      }] : []),
    ],
  }), [
    activeExpenseTab,
    canCreateExpense,
    expenseCategories,
    expenseCategoryFilter,
    expenseDateRange,
    expenseEndDate,
    expenseSearch,
    expenseSourceFilter,
    expenseStartDate,
    expenseStatusFilter,
    filteredExpenseTotal,
    filteredExpensesCount,
    hasExpenseFilters,
    onClearFilters,
    onLogExpense,
    setActiveExpenseTab,
    setExpenseCategoryFilter,
    setExpenseDateRange,
    setExpenseEndDate,
    setExpenseSearch,
    setExpenseSourceFilter,
    setExpenseStartDate,
    setExpenseStatusFilter,
  ]);

  useDesktopSubnav(subnavConfig);
  return null;
}

function toDateInputValue(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

function expenseDateBounds(range: ExpenseDateRange, startValue: string, endValue: string) {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === 'ALL') return { start: 0, end: end.getTime(), label: 'All time' };

  if (range === 'CUSTOM') {
    const start = new Date(`${startValue || toDateInputValue(now)}T00:00:00`);
    const customEnd = new Date(`${endValue || startValue || toDateInputValue(now)}T23:59:59.999`);
    return { start: start.getTime(), end: customEnd.getTime(), label: `${start.toLocaleDateString()} to ${customEnd.toLocaleDateString()}` };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (range === 'WEEK') start.setDate(start.getDate() - 6);
  if (range === 'MONTH') start.setDate(1);

  return { start: start.getTime(), end: end.getTime(), label: range === 'TODAY' ? 'Today' : range === 'WEEK' ? 'Last 7 days' : 'This month' };
}


export default function ExpensesTabDesktop() {
  const todayInput = React.useMemo(() => toDateInputValue(new Date()), []);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseDateRange, setExpenseDateRange] = useState<ExpenseDateRange>('MONTH');
  const [expenseStartDate, setExpenseStartDate] = useState(todayInput);
  const [expenseEndDate, setExpenseEndDate] = useState(todayInput);
  const [expenseSourceFilter, setExpenseSourceFilter] = useState<ExpenseSourceFilter>('ALL');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<ExpenseStatusFilter>('ALL');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('ALL');
  const [activeExpenseTab, setActiveExpenseTab] = useState<ExpenseViewTab>('RECORDS');
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: '', description: '', source: 'TILL' as 'TILL' | 'ACCOUNT', accountId: '' });
  const [shopExpenseForm, setShopExpenseForm] = useState({ productId: '', quantity: '1', description: '' });
  const [isSaving, setIsSaving] = useState(false);
  
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShift = useStore(state => state.activeShift);
  const { success, error } = useToast();

  const allExpenses = useLiveQuery(() => activeBusinessId && activeShopId ? db.expenses.where('shopId').equals(activeShopId).and(e => e.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const products = useLiveQuery(() => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).filter(product => belongsToActiveShop(product, activeShopId)).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId]) ;
  const rawFinancialAccounts = useLiveQuery(
    () => activeBusinessId
      ? db.financialAccounts
          .where('businessId')
          .equals(activeBusinessId)
          .toArray()
      : Promise.resolve([]),
    [activeBusinessId],
  );
  const financialAccounts = React.useMemo(
    () => singleFinanceAccount(rawFinancialAccounts || [], activeBusinessId),
    [rawFinancialAccounts, activeBusinessId],
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const allTransactions = useLiveQuery(() => activeBusinessId && activeShopId ? db.transactions.where('shopId').equals(activeShopId).and(t => t.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const allCashPicks = useLiveQuery(() => activeBusinessId && activeShopId ? db.cashPicks.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const allRefunds = useLiveQuery(() => activeBusinessId && activeShopId ? db.refunds.where('shopId').equals(activeShopId).and(r => r.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const allSupplierPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.supplierPayments.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const allCustomerPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.customerPayments.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId]) ;
  const canCreateExpense = canPerform(currentUser, 'expense.create', businessSettings);
  
  const todayStartMs = getTodayStartMs();
  const currentShiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);
  const currentShiftStart = getCurrentShiftStart(activeShift, todayStartMs);
  const drawer = calculateCashDrawer({
    transactions: allTransactions || [],
    expenses: allExpenses || [],
    cashPicks: allCashPicks || [],
    refunds: allRefunds || [],
    supplierPayments: allSupplierPayments || [],
    customerPayments: allCustomerPayments || [],
    openingCash: Number(activeShift?.openingCash || 0),
    since: currentShiftStart,
    shiftId: currentShiftId,
  });
  const todayExpenseTotals = expenseLifecycleTotals((allExpenses || []).filter(e => (Number(e.timestamp) || 0) >= todayStartMs));
  const todayTillExpenses = todayExpenseTotals.bySource.TILL.approved;
  const todayAccountExpenses = todayExpenseTotals.bySource.ACCOUNT.approved;
  const todayShopExpenses = todayExpenseTotals.bySource.SHOP.approved;
  const todayPendingExpenses = todayExpenseTotals.pendingTotal;
  const actualCashDrawer = Math.max(0, drawer.actualCashDrawer);
  const productById = React.useMemo(() => {
    const map = new Map<string, any>();
    (products || []).forEach(product => map.set(product.id, product));
    return map;
  }, [products]);
  const selectedShopProduct = shopExpenseForm.productId ? productById.get(shopExpenseForm.productId) : null;
  const shopExpenseQuantity = Number(shopExpenseForm.quantity) || 0;
  const shopExpenseEligibility = shopExpenseProductEligibility(selectedShopProduct, shopExpenseQuantity);
  const shopExpenseUnitCost = shopExpenseEligibility.unitCost;
  const shopExpenseAmount = shopExpenseEligibility.amount;
  const productOptions = React.useMemo(() => (products || [])
    .filter(product => !isBundleExpenseProduct(product) && Number(product.stockQuantity || 0) > 0)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
    .map(product => ({
      value: product.id,
      label: `${product.name} - ${Number(product.stockQuantity || 0).toLocaleString()} ${product.unit || 'pcs'} in stock`,
      keywords: `${product.name || ''} ${product.category || ''} ${product.barcode || ''}`,
    })), [products]);

  const handleSaveExpense = async () => {
      if (isSaving) return;
      const expenseSource = expenseForm.source === 'ACCOUNT' ? 'ACCOUNT' : 'TILL';
      const amount = Number(expenseForm.amount);
      if (amount <= 0) {
          error("Invalid amount.");
          return;
      }
      if (expenseSource === 'TILL' && !currentShiftId) {
          error("Open a till shift before paying expenses from the till.");
          return;
      }
      if (expenseSource === 'TILL' && amount > actualCashDrawer) {
          error("Insufficient cash in drawer.");
          return;
      }
      if (expenseSource === 'ACCOUNT' && amount > Number(financialAccounts[0]?.balance || 0)) {
          error("Insufficient balance in the Main account.");
          return;
      }
      if (!currentUser) return;
      if (!canPerform(currentUser, 'expense.create', businessSettings)) {
          error("You do not have permission to create expenses.");
          return;
      }

      setIsSaving(true);
      try {
        const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
        const accountId = expenseSource === 'ACCOUNT' && activeBusinessId ? pickedCashAccountId(activeBusinessId) : undefined;
        const expenseRecord = {
           id: crypto.randomUUID(),
           amount,
           category: expenseForm.category || 'General',
           description: expenseForm.description,
           timestamp: Date.now(),
           userName: currentUser.name,
           preparedBy: currentUser.name,
           status: autoApprove ? 'APPROVED' : 'PENDING',
           approvedBy: autoApprove ? currentUser.name : undefined,
           source: expenseSource,
           accountId,
           shiftId: expenseSource === 'TILL' ? currentShiftId : undefined,
           shopId: activeShopId!,
           businessId: activeBusinessId!
        } as any;

        await submitExpenseRecord(expenseRecord);

        recordAuditEvent({
          userId: currentUser.id,
          userName: currentUser.name,
          action: 'expense.create',
          entity: 'expense',
          severity: autoApprove ? 'INFO' : 'WARN',
          details: `${autoApprove ? 'Auto-approved' : 'Created pending'} expense for Ksh ${amount.toLocaleString()} (${expenseForm.category || 'Uncategorized'})`,
        });
        setIsExpenseModalOpen(false);
        setExpenseForm({ amount: '', category: '', description: '', source: 'TILL', accountId: '' });
        success(autoApprove ? "Expense logged and approved." : "Expense logged successfully.");
      } catch (err: any) {
        error("Failed to log expense: " + err.message);
      } finally {
        setIsSaving(false);
      }
  };

  const handleSaveShopExpense = async () => {
      if (isSaving) return;
      if (!currentUser) return;
      if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
      if (!canPerform(currentUser, 'expense.create', businessSettings)) {
          error("You do not have permission to create expenses.");
          return;
      }
      const eligibility = shopExpenseProductEligibility(selectedShopProduct, shopExpenseQuantity);
      if (!eligibility.ok) {
          error(eligibility.message || "The selected product cannot be expensed.");
          return;
      }
      if (!selectedShopProduct) return;

      setIsSaving(true);
      try {
        const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
        const expenseRecord = {
           id: crypto.randomUUID(),
           amount: eligibility.amount,
           category: 'Shop product',
           description: shopExpenseForm.description.trim() || `Shop use: ${selectedShopProduct.name}`,
           timestamp: Date.now(),
           userName: currentUser.name,
           preparedBy: currentUser.name,
           status: autoApprove ? 'APPROVED' : 'PENDING',
           approvedBy: autoApprove ? currentUser.name : undefined,
           source: 'SHOP',
           productId: selectedShopProduct.id,
           quantity: shopExpenseQuantity,
           shiftId: currentShiftId || undefined,
           shopId: activeShopId,
           businessId: activeBusinessId
        } as any;

        await submitExpenseRecord(expenseRecord);

        recordAuditEvent({
          userId: currentUser.id,
          userName: currentUser.name,
          action: 'expense.create.product',
          entity: 'expense',
          severity: autoApprove ? 'INFO' : 'WARN',
          details: `${autoApprove ? 'Auto-approved' : 'Created pending'} shop product expense for ${shopExpenseQuantity.toLocaleString()} ${selectedShopProduct.unit || 'pcs'} of ${selectedShopProduct.name}.`,
        });
        setShopExpenseForm({ productId: '', quantity: '1', description: '' });
        success(autoApprove ? "Product expensed and stock updated." : "Product expense request created.");
      } catch (err: any) {
        error("Failed to expense product: " + err.message);
      } finally {
        setIsSaving(false);
      }
  };

  const handleDeleteExpense = async (id: string) => {
      if (!isAdmin || isSaving) return;
      if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
      if (confirm("Are you sure you want to delete this expense? This action cannot be undone.")) {
          setIsSaving(true);
          try {
            await ExpenseService.delete({
              expenseId: id,
              businessId: activeBusinessId,
              shopId: activeShopId,
            });
            await db.expenses.reload();
            recordAuditEvent({
              userId: currentUser?.id,
              userName: currentUser?.name,
              action: 'expense.delete',
              entity: 'expense',
              entityId: id,
              severity: 'CRITICAL',
              details: 'Expense record deleted by admin',
            });
            success("Expense deleted.");
          } catch (err: any) {
            error("Failed to delete expense: " + err.message);
          } finally {
            setIsSaving(false);
          }
      }
  };

  const sourceBadge = (source?: string) => {
    const normalized = normalizeExpenseSource(source);
    if (normalized === 'SHOP') return { label: 'Shop stock', className: 'bg-blue-50 text-blue-700 border-blue-100' };
    if (normalized === 'TILL') return { label: 'Till', className: 'bg-slate-50 text-slate-700 border-slate-200' };
    return { label: 'Main account', className: 'bg-slate-50 text-slate-700 border-slate-200' };
  };

  const statusBadge = (status?: string) => {
    const normalized = normalizeExpenseStatus(status);
    if (normalized === 'PENDING') return { label: 'Pending', className: 'bg-yellow-50 text-yellow-700 border-yellow-100' };
    if (normalized === 'REJECTED') return { label: 'Rejected', className: 'bg-rose-50 text-rose-600 border-rose-100' };
    return { label: 'Approved', className: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
  };

  const expensePeriod = expenseDateBounds(expenseDateRange, expenseStartDate, expenseEndDate);
  const expenseCategories = Array.from(new Set((allExpenses || []).map(e => String(e.category || 'General')))).sort((a, b) => a.localeCompare(b));
  const filteredExpenses = (allExpenses || [])
    .filter(e => {
      const query = expenseSearch.trim().toLowerCase();
      const timestamp = Number(e.timestamp) || 0;
      const status = normalizeExpenseStatus(e.status);
      const source = normalizeExpenseSource(e.source);
      const category = String(e.category || 'General');
      const productName = e.productId ? productById.get(e.productId)?.name || '' : '';
      const searchMatch = query.length === 0
        || `${category} ${e.description || ''} ${e.userName || ''} ${source} ${productName}`.toLowerCase().includes(query);
      const dateMatch = timestamp >= expensePeriod.start && timestamp <= expensePeriod.end;
      const sourceMatch = expenseSourceFilter === 'ALL' || source === expenseSourceFilter;
      const statusMatch = expenseStatusFilter === 'ALL' || status === expenseStatusFilter;
      const categoryMatch = expenseCategoryFilter === 'ALL' || category === expenseCategoryFilter;
      return searchMatch && dateMatch && sourceMatch && statusMatch && categoryMatch;
    })
    .sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  const filteredExpenseTotals = expenseLifecycleTotals(filteredExpenses);
  const filteredExpenseTotal = filteredExpenseTotals.approvedTotal;
  const hasExpenseFilters = expenseSearch.trim().length > 0
    || expenseDateRange !== 'MONTH'
    || expenseSourceFilter !== 'ALL'
    || expenseStatusFilter !== 'ALL'
    || expenseCategoryFilter !== 'ALL';
  const clearExpenseFilters = () => {
    setExpenseSearch('');
    setExpenseDateRange('MONTH');
    setExpenseStartDate(todayInput);
    setExpenseEndDate(todayInput);
    setExpenseSourceFilter('ALL');
    setExpenseStatusFilter('ALL');
    setExpenseCategoryFilter('ALL');
  };

  if (!allExpenses || !products || !expenseAccounts || !rawFinancialAccounts || !allTransactions || !allCashPicks || !allRefunds || !allSupplierPayments || !allCustomerPayments) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <FileMinus size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading expenses...</p>
          </div>
      );
  }

  return (
    <div className="w-full animate-in fade-in space-y-5 pb-24">
      <ExpensesDesktopSubnav
        activeExpenseTab={activeExpenseTab}
        setActiveExpenseTab={setActiveExpenseTab}
        expenseSearch={expenseSearch}
        setExpenseSearch={setExpenseSearch}
        expenseDateRange={expenseDateRange}
        setExpenseDateRange={setExpenseDateRange}
        expenseStartDate={expenseStartDate}
        setExpenseStartDate={setExpenseStartDate}
        expenseEndDate={expenseEndDate}
        setExpenseEndDate={setExpenseEndDate}
        expenseSourceFilter={expenseSourceFilter}
        setExpenseSourceFilter={setExpenseSourceFilter}
        expenseStatusFilter={expenseStatusFilter}
        setExpenseStatusFilter={setExpenseStatusFilter}
        expenseCategoryFilter={expenseCategoryFilter}
        setExpenseCategoryFilter={setExpenseCategoryFilter}
        expenseCategories={expenseCategories}
        filteredExpenseTotal={filteredExpenseTotal}
        filteredExpensesCount={filteredExpenses.length}
        canCreateExpense={canCreateExpense}
        onLogExpense={() => setIsExpenseModalOpen(true)}
        hasExpenseFilters={hasExpenseFilters}
        onClearFilters={clearExpenseFilters}
      />

      {activeExpenseTab === 'SHOP' && (
        <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                <PackageMinus size={20} className="text-blue-700" />
                Expense product from shop
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">Deduct stock and record the product cost as an expense.</p>
            </div>
            <div className="rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-right">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cost value</p>
              <p className="text-lg font-black tabular-nums text-slate-950">Ksh {shopExpenseAmount.toLocaleString()}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_0.6fr]">
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Product</span>
              <SearchableSelect
                value={shopExpenseForm.productId}
                onChange={(value) => setShopExpenseForm(prev => ({ ...prev, productId: value }))}
                options={productOptions}
                placeholder="Select stock item"
                searchPlaceholder="Search product, category, or barcode..."
                emptyText="No eligible in-stock products found"
                buttonClassName="h-12 border-2 border-slate-200 bg-white font-bold"
                menuClassName="z-[160]"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Quantity</span>
              <input
                type="number"
                min="0"
                step="any"
                value={shopExpenseForm.quantity}
                onChange={event => setShopExpenseForm(prev => ({ ...prev, quantity: event.target.value }))}
                className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
            </label>
          </div>

          {selectedShopProduct && (
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border-2 border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Available</p>
                <p className="mt-1 text-sm font-black text-slate-900">{Number(selectedShopProduct.stockQuantity || 0).toLocaleString()} {selectedShopProduct.unit || 'pcs'}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Unit cost</p>
                <p className={`mt-1 text-sm font-black ${shopExpenseUnitCost > 0 ? 'text-slate-900' : 'text-rose-600'}`}>
                  Ksh {shopExpenseUnitCost.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Category</p>
                <p className="mt-1 truncate text-sm font-black text-slate-900">{selectedShopProduct.category || 'General'}</p>
              </div>
            </div>
          )}

          <label className="mt-4 block">
            <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Reason</span>
            <textarea
              rows={3}
              value={shopExpenseForm.description}
              onChange={event => setShopExpenseForm(prev => ({ ...prev, description: event.target.value }))}
              placeholder="e.g. Used for cleaning, office tea, shop repair..."
              className="w-full resize-none rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <button
            type="button"
            onClick={handleSaveShopExpense}
            disabled={!canCreateExpense || !shopExpenseEligibility.ok || isSaving}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[11px] font-black uppercase tracking-widest text-white transition-all hover:bg-blue-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PackageMinus size={17} />
            {isSaving ? 'Saving...' : 'Save product expense'}
          </button>
        </section>
      )}

      {/* Expense List */}
      {activeExpenseTab === 'RECORDS' && <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
         {filteredExpenses.map(expense => {
           const source = sourceBadge(expense.source);
           const status = statusBadge(expense.status);
           const normalizedSource = normalizeExpenseSource(expense.source);
           const normalizedStatus = normalizeExpenseStatus(expense.status);
           const amount = Number(expense.amount) || 0;
           const timestamp = Number(expense.timestamp) || Date.now();
           const product = expense.productId ? productById.get(expense.productId) : null;
           return (
             <div key={expense.id} className="group flex cursor-default flex-col gap-3 border-b border-slate-100 bg-white p-4 transition-colors last:border-b-0 hover:bg-blue-50/30 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-center gap-5 min-w-0">
                   <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
                      <FileMinus size={28} />
                   </div>
                   <div className="min-w-0">
                      <h4 className="text-base font-black text-slate-900 truncate leading-tight">{normalizedSource === 'SHOP' ? product?.name || expense.category || 'Shop product' : expense.category || 'General'}</h4>
                      <div className="flex items-center gap-2.5 mt-1">
                         <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate max-w-[120px] sm:max-w-none">
                           {normalizedSource === 'SHOP' && expense.quantity ? `${Number(expense.quantity).toLocaleString()} ${product?.unit || 'pcs'} - ` : ''}{expense.description || 'General operational cost'}
                         </span>
                         <span className="w-1 h-1 rounded-full bg-slate-200 shrink-0" />
                         <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={10}/> {new Date(timestamp).toLocaleDateString()}</span>
                      </div>
                   </div>
                </div>
                <div className="flex w-full items-center justify-between gap-4 border-t border-slate-100 pt-3 sm:w-auto sm:justify-end sm:border-l sm:border-t-0 sm:border-slate-100 sm:pl-4 sm:pt-0">
                   <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Amount paid</p>
                      <h3 className="text-lg font-black text-slate-950 tabular-nums leading-none">
                         Ksh {amount.toLocaleString()}
                      </h3>
                      <div className="flex items-center justify-end gap-1.5 mt-2">
                         <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${source.className}`}>
                            {source.label}
                         </span>
                         <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${status.className}`}>
                            {status.label}
                         </span>
                         {expense.userName && (
                           <span className="text-[8px] font-black text-slate-400 uppercase flex items-center gap-1">
                             <User size={8}/> {expense.userName.split(' ')[0]}
                           </span>
                         )}
                      </div>
                   </div>
                   {isAdmin && normalizedStatus !== 'APPROVED' && (
                      <button 
                        onClick={() => handleDeleteExpense(expense.id)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-rose-100 bg-rose-50 text-rose-600 transition-all hover:bg-rose-600 hover:text-white"
                      >
                         <Trash2 size={18} />
                      </button>
                   )}
                </div>
             </div>
           );
         })}
         {filteredExpenses.length === 0 && (
            <div className="flex flex-col items-center py-24 text-center">
               <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 text-slate-300">
                 <FileMinus size={44} />
               </div>
               <p className="text-slate-500 font-black text-lg">No expense records found</p>
               <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Logged operational costs will appear here</p>
            </div>
         )}
      </section>}

      {/* Modals */}
      <ExpenseModal 
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        expenseForm={expenseForm}
        setExpenseForm={setExpenseForm}
        handleSaveExpense={handleSaveExpense}
        isSaving={isSaving}
        actualCashDrawer={actualCashDrawer}
        accounts={expenseAccounts || []}
        financialAccounts={financialAccounts || []}
      />
    </div>
  );
}

