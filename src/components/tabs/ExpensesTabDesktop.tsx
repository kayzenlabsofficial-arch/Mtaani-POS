import React, { useState } from 'react';
import { Search, Plus, FileMinus, Trash2, Calendar, User, X, SlidersHorizontal } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import ExpenseModal from '../modals/ExpenseModalDesktop';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';
import { submitExpenseRecord } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getBusinessSettings } from '../../utils/settings';
import { getCurrentShiftId, getCurrentShiftStart } from '../../utils/shiftSession';
import { ExpenseService } from '../../services/expenses';
import { pickedCashAccountId, singleFinanceAccount } from '../../utils/financeAccount';

type ExpenseDateRange = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM' | 'ALL';
type ExpenseSourceFilter = 'ALL' | 'TILL' | 'ACCOUNT';
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


export default function ExpensesTabDesktop() {
  const todayInput = React.useMemo(() => toDateInputValue(new Date()), []);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [expenseDateRange, setExpenseDateRange] = useState<ExpenseDateRange>('MONTH');
  const [expenseStartDate, setExpenseStartDate] = useState(todayInput);
  const [expenseEndDate, setExpenseEndDate] = useState(todayInput);
  const [expenseSourceFilter, setExpenseSourceFilter] = useState<ExpenseSourceFilter>('ALL');
  const [expenseStatusFilter, setExpenseStatusFilter] = useState<ExpenseStatusFilter>('ALL');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('ALL');
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: '', description: '', source: 'TILL' as 'TILL' | 'ACCOUNT', accountId: '' });
  const [isSaving, setIsSaving] = useState(false);
  
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShift = useStore(state => state.activeShift);
  const { success, error } = useToast();

  const allExpenses = useLiveQuery(() => activeBusinessId && activeShopId ? db.expenses.where('shopId').equals(activeShopId).and(e => e.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []) ;
  const rawFinancialAccounts = useLiveQuery(
    () => activeBusinessId
      ? db.financialAccounts
          .where('businessId')
          .equals(activeBusinessId)
          .toArray()
      : Promise.resolve([]),
    [activeBusinessId],
    [],
  );
  const financialAccounts = React.useMemo(
    () => singleFinanceAccount(rawFinancialAccounts || [], activeBusinessId),
    [rawFinancialAccounts, activeBusinessId],
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const allTransactions = useLiveQuery(() => activeBusinessId && activeShopId ? db.transactions.where('shopId').equals(activeShopId).and(t => t.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
  const allCashPicks = useLiveQuery(() => activeBusinessId && activeShopId ? db.cashPicks.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
  const allRefunds = useLiveQuery(() => activeBusinessId && activeShopId ? db.refunds.where('shopId').equals(activeShopId).and(r => r.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
  const allSupplierPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.supplierPayments.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
  const allCustomerPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.customerPayments.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []) ;
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
  const todayTillExpenses = drawer.tillExpenses;
  const todayAccountExpenses = (allExpenses || []).filter(e => (e.timestamp || 0) >= todayStartMs && e.source === 'ACCOUNT' && e.status !== 'REJECTED').reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const actualCashDrawer = Math.max(0, drawer.actualCashDrawer);

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
    if (source === 'TILL') return { label: 'Till', className: 'bg-slate-50 text-slate-700 border-slate-200' };
    return { label: 'Main account', className: 'bg-slate-50 text-slate-700 border-slate-200' };
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
    <div className="w-full animate-in fade-in space-y-5 pb-24">
      
      {/* Header */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Expenses</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Track till and Main account spending.</p>
          </div>
          {canCreateExpense && (
            <button
              onClick={() => setIsExpenseModalOpen(true)}
              data-testid="expenses-log-expense"
              className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white transition-all hover:bg-blue-800 active:scale-[0.98]"
            >
              <Plus size={18} /> Log expense
            </button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Till expenses</p>
            <p className="mt-1 text-xl font-black tabular-nums text-slate-950">Ksh {todayTillExpenses.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Main account</p>
            <p className="mt-1 text-xl font-black tabular-nums text-slate-950">Ksh {todayAccountExpenses.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cash drawer</p>
            <p className="mt-1 text-xl font-black tabular-nums text-blue-700">Ksh {actualCashDrawer.toLocaleString()}</p>
          </div>
        </div>
      </section>

      {/* Search and filters */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm">
      <div className="space-y-3">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-700" size={16} />
          <input
            type="text"
            placeholder="Search by category, description, user, or source..."
            value={expenseSearch}
            onChange={(e) => setExpenseSearch(e.target.value)}
            className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-9 text-sm font-bold outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
          {expenseSearch && (
            <button onClick={() => setExpenseSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-blue-700">
                <SlidersHorizontal size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filters</p>
                <p className="truncate text-sm font-black text-slate-900">
                  Ksh {filteredExpenseTotal.toLocaleString()} across {filteredExpenses.length} record{filteredExpenses.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <div className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-lg border-2 border-slate-200 bg-white p-1">
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
                    expenseDateRange === option.id ? 'bg-blue-700 text-white' : 'text-slate-500 hover:text-slate-700'
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
                  className="h-11 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
                <input
                  type="date"
                  value={expenseEndDate}
                  onChange={event => setExpenseEndDate(event.target.value)}
                  className="h-11 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                />
              </>
            )}
            <select
              value={expenseSourceFilter}
              onChange={event => setExpenseSourceFilter(event.target.value as ExpenseSourceFilter)}
              className="h-11 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            >
              <option value="ALL">All sources</option>
              <option value="TILL">Till</option>
              <option value="ACCOUNT">Main account</option>
            </select>
            <select
              value={expenseStatusFilter}
              onChange={event => setExpenseStatusFilter(event.target.value as ExpenseStatusFilter)}
              className="h-11 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            >
              <option value="ALL">All statuses</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING">Pending</option>
              <option value="REJECTED">Rejected</option>
            </select>
            <select
              value={expenseCategoryFilter}
              onChange={event => setExpenseCategoryFilter(event.target.value)}
              className="h-11 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
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
                className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-slate-600 transition-all hover:bg-slate-100"
              >
                <X size={14} />
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>
      </section>

      {/* Expense List */}
      <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
         {filteredExpenses.map(expense => {
           const source = sourceBadge(expense.source);
           const status = statusBadge(expense.status);
           const amount = Number(expense.amount) || 0;
           const timestamp = Number(expense.timestamp) || Date.now();
           return (
             <div key={expense.id} className="group flex cursor-default flex-col gap-3 border-b border-slate-100 bg-white p-4 transition-colors last:border-b-0 hover:bg-blue-50/30 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-center gap-5 min-w-0">
                   <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
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
                   {isAdmin && (
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
      </section>

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

