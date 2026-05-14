import React, { useState } from 'react';
import { Search, Plus, FileMinus, Trash2, Wallet, Calendar, User, ChevronRight, X, SlidersHorizontal, TrendingDown, BookOpen, CreditCard, ChevronDown, PieChart, Activity } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import ExpenseModal from '../modals/ExpenseModal';
import ExpenseAccountModal from '../modals/ExpenseAccountModal';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';
import { applyApprovedExpenseEffects, ensureExpenseCanBeApproved } from '../../utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from '../../utils/ownerMode';


export default function ExpensesTab() {
  const [expenseSearch, setExpenseSearch] = useState("");
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: '', description: '', source: 'TILL' as 'TILL' | 'ACCOUNT' | 'SHOP', accountId: '', productId: '', quantity: '1' });
  const [isSaving, setIsSaving] = useState(false);
  
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error } = useToast();

  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const expenseAccounts = useLiveQuery(() => db.expenseAccounts.toArray(), [], []) ;
  const financialAccounts = useLiveQuery(() => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []) ;
  const products = useLiveQuery(() => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []) ;
  const businessSettings = useLiveQuery(() => activeBusinessId ? db.settings.get('core') : Promise.resolve(undefined), [activeBusinessId]);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allCashPicks = useLiveQuery(() => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todaysPaidTransactions = (allTransactions || []).filter(t => (t.timestamp || 0) >= todayStart.getTime() && t.status === 'PAID');
  const cashTotal = todaysPaidTransactions.filter(t => t.paymentMethod === 'CASH').reduce((sum, t) => sum + (t.total || 0), 0);
  const todayTillExpenses = (allExpenses || []).filter(e => (e.timestamp || 0) >= todayStart.getTime() && e.source === 'TILL').reduce((sum, e) => sum + (e.amount || 0), 0);
  const todayAccountExpenses = (allExpenses || []).filter(e => (e.timestamp || 0) >= todayStart.getTime() && e.source === 'ACCOUNT').reduce((sum, e) => sum + (e.amount || 0), 0);
  const todayCashPicks = (allCashPicks || []).filter(c => (c.timestamp || 0) >= todayStart.getTime());
  const totalPickedAmount = todayCashPicks.reduce((acc, p) => acc + (p.amount || 0), 0);
  const actualCashDrawer = cashTotal - totalPickedAmount - todayTillExpenses;

  const handleSaveExpense = async () => {
      if (isSaving) return;
      const amount = Number(expenseForm.amount);
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
           category: expenseForm.category,
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

        if (autoApprove) {
          await ensureExpenseCanBeApproved(expenseRecord);
        }

        await db.expenses.add(expenseRecord);

        if (autoApprove) {
          try {
            await applyApprovedExpenseEffects(expenseRecord, {
              approvedBy: currentUser.name,
              activeBranchId: activeBranchId!,
              activeBusinessId: activeBusinessId!
            });
          } catch (err) {
            await db.expenses.update(expenseRecord.id, { status: 'PENDING', approvedBy: undefined });
            throw err;
          }
        }

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
      if (confirm("Are you sure you want to delete this expense? This action cannot be undone.")) {
          setIsSaving(true);
          try {
            await db.expenses.delete(id);
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

  const filteredExpenses = (allExpenses || [])
    .filter(e => e.description.toLowerCase().includes(expenseSearch.toLowerCase()) || e.category.toLowerCase().includes(expenseSearch.toLowerCase()))
    .sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));

  if (!allExpenses || !allTransactions || !allCashPicks) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <FileMinus size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading Financial Ledger...</p>
          </div>
      );
  }

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Expenses</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">Till: Ksh {todayTillExpenses.toLocaleString()}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">Account: Ksh {todayAccountExpenses.toLocaleString()}</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">Drawer: Ksh {actualCashDrawer.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setIsAccountModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-50 active:scale-[0.98] transition-all self-start"
          >
            <BookOpen size={16} /> Setup Accounts
          </button>
          <button
            onClick={() => setIsExpenseModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
          >
            <Plus size={18} /> Log Expense
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by category or description..."
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
      </div>

      {/* Expense List */}
      <div className="space-y-3">
         {filteredExpenses.map(expense => (
             <div key={expense.id} className="group bg-white p-5 rounded-[2rem] border-2 border-slate-100 shadow-sm flex items-center justify-between hover:border-orange-300 hover:shadow-xl hover:-translate-y-0.5 transition-all cursor-default">
                <div className="flex items-center gap-5 min-w-0">
                   <div className="w-14 h-14 rounded-[1.25rem] bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shadow-sm shrink-0 group-hover:scale-110 transition-transform">
                      <FileMinus size={28} />
                   </div>
                   <div className="min-w-0">
                      <h4 className="text-base font-black text-slate-900 truncate leading-tight">{expense.category}</h4>
                      <div className="flex items-center gap-2.5 mt-1">
                         <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight truncate max-w-[120px] sm:max-w-none">{expense.description || 'General operational cost'}</span>
                         <span className="w-1 h-1 rounded-full bg-slate-200 shrink-0" />
                         <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1"><Calendar size={10}/> {new Date(expense.timestamp).toLocaleDateString()}</span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-5 pl-4 border-l border-slate-50">
                   <div className="text-right">
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Amount Paid</p>
                      <h3 className="text-lg font-black text-orange-600 tabular-nums leading-none">
                         Ksh {expense.amount.toLocaleString()}
                      </h3>
                      <div className="flex items-center justify-end gap-1.5 mt-2">
                         <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border ${expense.source === 'TILL' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                            {expense.source === 'TILL' ? 'TILL' : 'ACC'}
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
         ))}
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
