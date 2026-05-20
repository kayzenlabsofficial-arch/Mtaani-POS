import React, { useState } from 'react';
import { Search, Plus, FileMinus, Trash2, Wallet, Calendar, User, ChevronRight, X, SlidersHorizontal, TrendingDown, BookOpen, CreditCard, ChevronDown, PieChart, Activity } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import ExpenseModal from '../modals/ExpenseModal';
import ExpenseAccountModal from '../modals/ExpenseAccountModal';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';
import { submitExpenseRecord } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getBusinessSettings } from '../../utils/settings';
import { belongsToActiveBranch } from '../../utils/branchScope';
import { ExpenseService } from '../../services/expenses';

type ExpenseDateRange = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM' | 'ALL';
type ExpenseSourceFilter = 'ALL' | 'TILL' | 'PETTY_CASH' | 'SHOP' | 'ACCOUNT';
type ExpenseStatusFilter = 'ALL' | 'APPROVED' | 'PENDING' | 'REJECTED';

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


export default function ExpensesTab() {
  const todayInput = React.useMemo(() => toDateInputValue(new Date()), []);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseDateRange, setExpenseDateRange] = useState<ExpenseDateRange>('MONTH');
  const [expenseStartDate, setExpenseStartDate] = useState(todayInput);
  const [expenseEndDate, setExpenseEndDate] = useState(todayInput);
  const [expenseSourceFilter, setExpenseSourceFilter] = useState<ExpenseSourceFilter>('ALL');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<ExpenseStatusFilter>('ALL');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('ALL');
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: '', description: '', source: 'TILL' as 'PETTY_CASH' | 'TILL' | 'ACCOUNT' | 'SHOP', accountId: '', productId: '', quantity: '1' });
  const [isSaving, setIsSaving] = useState(false);
  
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error } = useToast();

  const allExpenses = useLiveQuery(() => activeBusinessId && activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).and(e => e.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []) ;
  const financialAccounts = useLiveQuery(
    () => activeBusinessId
      ? db.financialAccounts
          .where('businessId')
          .equals(activeBusinessId)
          .filter(account => !account.branchId || account.branchId === activeBranchId)
          .toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    [],
  );
  const products = useLiveQuery(() => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).filter(p => belongsToActiveBranch(p, activeBranchId)).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const allTransactions = useLiveQuery(() => activeBusinessId && activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).and(t => t.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  const allCashPicks = useLiveQuery(() => activeBusinessId && activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  const allRefunds = useLiveQuery(() => activeBusinessId && activeBranchId ? db.refunds.where('branchId').equals(activeBranchId).and(r => r.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  const allSupplierPayments = useLiveQuery(() => activeBusinessId && activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeBranchId], []) ;
  
  const todayStartMs = getTodayStartMs();
  const drawer = calculateCashDrawer({
    transactions: allTransactions || [],
    expenses: allExpenses || [],
    cashPicks: allCashPicks || [],
    refunds: allRefunds || [],
    supplierPayments: allSupplierPayments || [],
    since: todayStartMs,
  });
  const todayTillExpenses = drawer.tillExpenses;
  const todayPettyCashExpenses = (allExpenses || []).filter(e => (e.timestamp || 0) >= todayStartMs && e.source === 'PETTY_CASH' && e.status !== 'REJECTED').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const todayStockExpenses = (allExpenses || []).filter(e => (e.timestamp || 0) >= todayStartMs && e.source === 'SHOP' && e.status !== 'REJECTED').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const todayAccountExpenses = (allExpenses || []).filter(e => (e.timestamp || 0) >= todayStartMs && e.source === 'ACCOUNT' && e.status !== 'REJECTED').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const actualCashDrawer = drawer.actualCashDrawer;

  const productCost = (product?: Product) => Number(product?.costPrice || 0);
  const stockExpenseAmount = () => {
    if (expenseForm.source !== 'SHOP') return Number(expenseForm.amount);
    const product = (products || []).find(p => p.id === expenseForm.productId);
    const quantity = Number(expenseForm.quantity || 0);
    return Math.round(productCost(product) * quantity * 100) / 100;
  };

  const handleSaveExpense = async () => {
      if (isSaving) return;
      const amount = stockExpenseAmount();
      if (amount <= 0) {
          error("Invalid amount.");
          return;
      }
      if (expenseForm.source === 'TILL' && amount > actualCashDrawer) {
          error("Insufficient cash in drawer.");
          return;
      }
      if (expenseForm.source === 'ACCOUNT' && !expenseForm.accountId) {
          error("Select the account paying this expense.");
          return;
      }
      if (expenseForm.source === 'SHOP' && !expenseForm.productId) {
          error("Select the stock item being expensed.");
          return;
      }
      if (expenseForm.source === 'SHOP') {
          const product = (products || []).find(p => p.id === expenseForm.productId);
          const quantity = Number(expenseForm.quantity || 0);
          if (!product) return error("Selected stock item was not found.");
          if (quantity <= 0) return error("Enter a valid stock quantity.");
          if (productCost(product) <= 0) return error(`Set a cost price for ${product.name} before expensing it from stock.`);
          if (quantity > Number(product.stockQuantity || 0)) return error(`Insufficient stock for ${product.name}.`);
      }
      if (!currentUser) return;
      if (!canPerform(currentUser, 'expense.create')) {
          error("You do not have permission to create expenses.");
          return;
      }

      setIsSaving(true);
      try {
        const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
        const expenseRecord = {
           id: crypto.randomUUID(),
           amount,
           category: expenseForm.source === 'SHOP' ? (expenseForm.category || 'Stock') : expenseForm.category,
           description: expenseForm.description,
           timestamp: Date.now(),
           userName: currentUser.name,
           preparedBy: currentUser.name,
           status: autoApprove ? 'APPROVED' : 'PENDING',
           approvedBy: autoApprove ? currentUser.name : undefined,
           source: expenseForm.source,
           accountId: expenseForm.source === 'ACCOUNT' ? expenseForm.accountId : undefined,
           productId: expenseForm.source === 'SHOP' ? expenseForm.productId : undefined,
           quantity: expenseForm.source === 'SHOP' ? Number(expenseForm.quantity || 1) : undefined,
           branchId: activeBranchId!,
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
        setExpenseForm({ amount: '', category: '', description: '', source: 'TILL', accountId: '', productId: '', quantity: '1' });
        success(autoApprove ? "Expense logged and approved." : "Expense logged successfully.");
      } catch (err: any) {
        error("Failed to log expense: " + err.message);
      } finally {
        setIsSaving(false);
      }
  };

  const handleDeleteExpense = async (id: string) => {
      if (!isAdmin || isSaving) return;
      if (!activeBusinessId || !activeBranchId) return error("Select a branch before deleting an expense.");
      if (confirm("Are you sure you want to delete this expense? This action cannot be undone.")) {
          setIsSaving(true);
          try {
            await ExpenseService.delete({
              expenseId: id,
              businessId: activeBusinessId,
              branchId: activeBranchId,
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
    if (source === 'PETTY_CASH') return { label: 'Petty cash', className: 'bg-amber-50 text-amber-700 border-amber-100' };
    if (source === 'TILL') return { label: 'Till', className: 'bg-emerald-50 text-emerald-600 border-emerald-100' };
    if (source === 'SHOP') return { label: 'Stock', className: 'bg-orange-50 text-orange-600 border-orange-100' };
    return { label: 'General', className: 'bg-indigo-50 text-indigo-600 border-indigo-100' };
  };

  const statusBadge = (status?: string) => {
    const normalized = String(status || 'APPROVED').toUpperCase();
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
      const status = String(e.status || 'APPROVED').toUpperCase();
      const source = String(e.source || 'ACCOUNT').toUpperCase();
      const category = String(e.category || 'General');
      const searchMatch = query.length === 0
        || `${category} ${e.description || ''} ${e.userName || ''} ${source}`.toLowerCase().includes(query);
      const dateMatch = timestamp >= expensePeriod.start && timestamp <= expensePeriod.end;
      const sourceMatch = expenseSourceFilter === 'ALL' || source === expenseSourceFilter;
      const statusMatch = expenseStatusFilter === 'ALL' || status === expenseStatusFilter;
      const categoryMatch = expenseCategoryFilter === 'ALL' || category === expenseCategoryFilter;
      return searchMatch && dateMatch && sourceMatch && statusMatch && categoryMatch;
    })
    .sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
  const filteredExpenseTotal = filteredExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
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

  if (!allExpenses || !allTransactions || !allCashPicks || !allSupplierPayments) {
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
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Expenses</h2>
          <div className="hidden">
            {todayPettyCashExpenses > 0 && <span className="text-[10px] font-bold text-slate-500">Petty: Ksh {todayPettyCashExpenses.toLocaleString()}</span>}
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">Till: Ksh {todayTillExpenses.toLocaleString()}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">Stock: Ksh {todayStockExpenses.toLocaleString()}</span>
            {todayPettyCashExpenses > 0 && <span className="text-slate-300">Â·</span>}
            <span className="text-[10px] font-bold text-slate-500">General: Ksh {todayAccountExpenses.toLocaleString()}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">Drawer: Ksh {actualCashDrawer.toLocaleString()}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {todayPettyCashExpenses > 0 && (
              <>
                <span className="text-[10px] font-bold text-slate-500">Petty: Ksh {todayPettyCashExpenses.toLocaleString()}</span>
                <span className="text-slate-300">/</span>
              </>
            )}
            <span className="text-[10px] font-bold text-slate-500">Till: Ksh {todayTillExpenses.toLocaleString()}</span>
            <span className="text-slate-300">/</span>
            <span className="text-[10px] font-bold text-slate-500">Stock: Ksh {todayStockExpenses.toLocaleString()}</span>
            <span className="text-slate-300">/</span>
            <span className="text-[10px] font-bold text-slate-500">General: Ksh {todayAccountExpenses.toLocaleString()}</span>
            <span className="text-slate-300">/</span>
            <span className="text-[10px] font-bold text-emerald-600">Drawer: Ksh {actualCashDrawer.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAccountModalOpen(true)}
            data-testid="expenses-setup-accounts"
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 active:scale-[0.98] transition-all self-start"
          >
            <BookOpen size={16} /> Setup accounts
          </button>
          <button
            onClick={() => setIsExpenseModalOpen(true)}
            data-testid="expenses-log-expense"
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
          >
            <Plus size={18} /> Log expense
          </button>
        </div>
      </div>

      {/* Search and filters */}
      <div className="mb-6 space-y-3">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by category, description, user, or source..."
            value={expenseSearch}
            onChange={(e) => setExpenseSearch(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
          />
          {expenseSearch && (
            <button onClick={() => setExpenseSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <SlidersHorizontal size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filters</p>
                <p className="truncate text-sm font-black text-slate-900">
                  Ksh {filteredExpenseTotal.toLocaleString()} across {filteredExpenses.length} record{filteredExpenses.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
              {[
                { id: 'TODAY', label: 'Today' },
                { id: 'WEEK', label: 'Week' },
                { id: 'MONTH', label: 'Month' },
                { id: 'CUSTOM', label: 'Custom' },
                { id: 'ALL', label: 'All' },
              ].map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setExpenseDateRange(option.id as ExpenseDateRange)}
                  className={`h-9 flex-shrink-0 rounded-lg px-3 text-[11px] font-black transition-all ${
                    expenseDateRange === option.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {expenseDateRange === 'CUSTOM' && (
              <>
                <input
                  type="date"
                  value={expenseStartDate}
                  onChange={event => setExpenseStartDate(event.target.value)}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                <input
                  type="date"
                  value={expenseEndDate}
                  onChange={event => setExpenseEndDate(event.target.value)}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </>
            )}
            <select
              value={expenseSourceFilter}
              onChange={event => setExpenseSourceFilter(event.target.value as ExpenseSourceFilter)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="ALL">All sources</option>
              <option value="TILL">Till</option>
              <option value="PETTY_CASH">Petty cash</option>
              <option value="SHOP">Stock</option>
              <option value="ACCOUNT">General account</option>
            </select>
            <select
              value={expenseStatusFilter}
              onChange={event => setExpenseStatusFilter(event.target.value as ExpenseStatusFilter)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="ALL">All statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Pending</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select
              value={expenseCategoryFilter}
              onChange={event => setExpenseCategoryFilter(event.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="ALL">All categories</option>
              {expenseCategories.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            {hasExpenseFilters && (
              <button
                type="button"
                onClick={clearExpenseFilters}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-[11px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-100"
              >
                <X size={14} />
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expense List */}
      <div className="space-y-3">
         {filteredExpenses.map(expense => {
           const source = sourceBadge(expense.source);
           const status = statusBadge(expense.status);
           const amount = Number(expense.amount) || 0;
           const timestamp = Number(expense.timestamp) || Date.now();
           return (
             <div key={expense.id} className="group bg-white p-5 rounded-[2rem] border-2 border-slate-100 shadow-sm flex items-center justify-between hover:border-orange-300 hover:shadow-xl hover:-translate-y-0.5 transition-all cursor-default">
                <div className="flex items-center gap-5 min-w-0">
                   <div className="w-14 h-14 rounded-[1.25rem] bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shadow-sm shrink-0 group-hover:scale-110 transition-transform">
                      <FileMinus size={28} />
                   </div>
                   <div className="min-w-0">
                      <h4 className="text-base font-black text-slate-900 truncate leading-tight">{expense.category || 'General'}</h4>
                      <div className="flex items-center gap-2.5 mt-1">
                         <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate max-w-[120px] sm:max-w-none">{expense.description || 'General operational cost'}</span>
                         <span className="w-1 h-1 rounded-full bg-slate-200 shrink-0" />
                         <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={10}/> {new Date(timestamp).toLocaleDateString()}</span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-5 pl-4 border-l border-slate-50">
                   <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Amount paid</p>
                      <h3 className="text-lg font-black text-orange-600 tabular-nums leading-none">
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
                   {isAdmin && (
                      <button 
                        onClick={() => handleDeleteExpense(expense.id)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                      >
                         <Trash2 size={18} />
                      </button>
                   )}
                </div>
             </div>
           );
         })}
         {filteredExpenses.length === 0 && (
            <div className="py-32 text-center flex flex-col items-center">
               <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner text-slate-200">
                 <FileMinus size={44} />
               </div>
               <p className="text-slate-500 font-black text-lg">No expense records found</p>
               <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Logged operational costs will appear here</p>
            </div>
         )}
      </div>

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
        products={products || []}
      />

      <ExpenseAccountModal 
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
      />
    </div>
  );
}
