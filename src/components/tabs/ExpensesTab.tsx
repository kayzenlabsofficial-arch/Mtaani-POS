import React, { useState } from 'react';
import { Search, Plus, FileMinus, Trash2, Wallet, Calendar, User, ChevronRight, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import ExpenseModal from '../modals/ExpenseModal';
import ExpenseAccountModal from '../modals/ExpenseAccountModal';
import { BookOpen } from 'lucide-react';
import { canPerform } from '../../utils/accessControl';
import { recordAuditEvent } from '../../utils/auditLog';

export default function ExpensesTab() {
  const [expenseSearch, setExpenseSearch] = useState("");
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ amount: '', category: '', description: '', source: 'TILL' as 'TILL' | 'ACCOUNT' });
  const [isSaving, setIsSaving] = useState(false);
  
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error } = useToast();

  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const expenseAccounts = useLiveQuery(() => db.expenseAccounts.toArray(), [], []) ;

  // Need actualCashDrawer for validation
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
      if (!currentUser) return;
      if (!canPerform(currentUser, 'expense.create')) {
          error("You do not have permission to create expenses.");
          return;
      }

      setIsSaving(true);
      try {
        await db.expenses.add({
           id: crypto.randomUUID(),
           amount,
           category: expenseForm.category,
           description: expenseForm.description,
           timestamp: Date.now(),
           userName: currentUser.name,
           preparedBy: currentUser.name,
           status: 'PENDING',
           source: expenseForm.source,
           branchId: activeBranchId!,
           businessId: activeBusinessId!
        });
        recordAuditEvent({
          userId: currentUser.id,
          userName: currentUser.name,
          action: 'expense.create',
          entity: 'expense',
          severity: 'WARN',
          details: `Created pending expense for Ksh ${amount.toLocaleString()} (${expenseForm.category || 'Uncategorized'})`,
        });
        setIsExpenseModalOpen(false);
        setExpenseForm({ amount: '', category: '', description: '', source: 'TILL' });
        success("Expense logged successfully.");
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
              <p className="text-slate-400 font-black text-xs  ">Loading Ledger...</p>
          </div>
      );
  }

  return (
    <div className="p-6 pb-24 animate-in fade-in max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-end mb-8">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Financial Outflow</h2>
            <p className="text-slate-500 text-sm font-medium">Track operational costs and petty cash expenses.</p>
         </div>
         <div className="flex gap-2">
            <button onClick={() => setIsAccountModalOpen(true)} className="bg-white text-slate-700 border border-slate-200 px-5 py-3.5 rounded-2xl shadow-sm active:scale-95 transition-all flex items-center gap-2 font-black text-xs  ">
               <BookOpen size={18} /> Accounts
            </button>
            <button onClick={() => setIsExpenseModalOpen(true)} className="bg-orange-600 text-white px-5 py-3.5 rounded-2xl shadow-lg shadow-orange-600/20 active:scale-95 transition-all flex items-center gap-2 font-black text-xs  ">
               <Plus size={18} /> New Expense
            </button>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
         <div className="bg-white rounded-2xl p-5 shadow-card border border-slate-100 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center shadow-sm">
               <Wallet size={24} />
            </div>
            <div>
               <p className="text-slate-400 text-[10px] font-black   mb-0.5">Cash in Drawer</p>
               <h3 className="text-xl font-black text-slate-900 leading-none">Ksh {actualCashDrawer.toLocaleString()}</h3>
            </div>
         </div>
         <div className="bg-orange-600 rounded-2xl p-5 shadow-lg shadow-orange-600/20 flex items-center gap-4 text-white">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shadow-sm">
               <FileMinus size={24} />
            </div>
             <div>
                <p className="text-orange-100 text-[10px] font-black   mb-0.5">Today's Till Outflow</p>
                <h3 className="text-xl font-black leading-none">Ksh {todayTillExpenses.toLocaleString()}</h3>
             </div>
         </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder="Search by category or description..." 
          value={expenseSearch} 
          onChange={(e) => setExpenseSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-4 bg-white rounded-xl border border-slate-200 text-sm text-slate-700 shadow-card focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 outline-none transition-all font-bold"
        />
      </div>

      <div className="space-y-3">
         {filteredExpenses.map(expense => (
             <div key={expense.id} className="group bg-white p-4 rounded-xl border border-slate-100 shadow-card flex items-center justify-between hover:border-orange-200 transition-all cursor-default press">
                <div className="flex items-center gap-4">
                   <div className="w-14 h-14 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                      <FileMinus size={22} />
                   </div>
                   <div className="min-w-0">
                      <h4 className="text-[15px] font-black text-slate-900 truncate">{expense.category}</h4>
                      <p className="text-[11px] font-bold text-slate-400 mt-1 flex items-center gap-2 truncate">
                         {expense.description || 'Petty cash expense'} 
                         <span className="w-1 h-1 rounded-full bg-slate-300" />
                         <span className="flex items-center gap-1"><Calendar size={10}/> {new Date(expense.timestamp).toLocaleDateString()}</span>
                      </p>
                   </div>
                </div>
                <div className="flex items-center gap-4 pl-3">
                   <div className="text-right">
                      <p className="text-[10px] font-black text-slate-300   leading-none mb-1">Amount</p>
                      <p className="text-[17px] font-black text-orange-600 tabular-nums">
                         Ksh {expense.amount.toLocaleString()}
                      </p>
                      <p className="text-[8px] font-black text-slate-400 opacity-60">
                         via {expense.source === 'TILL' ? 'TILL' : 'ACC'}
                      </p>
                      {expense.userName && (
                        <p className="text-[9px] font-black text-blue-500  flex items-center justify-end gap-1 mt-0.5">
                          <User size={8}/> {expense.userName}
                        </p>
                      )}
                   </div>
                   {isAdmin && (
                      <button 
                        onClick={() => handleDeleteExpense(expense.id)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-all"
                        title="Delete record"
                      >
                         <Trash2 size={18} />
                      </button>
                   )}
                </div>
             </div>
         ))}
         {filteredExpenses.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center slide-up">
               <div className="w-20 h-20 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 text-slate-200">
                 <FileMinus size={40} />
               </div>
               <p className="text-slate-500 font-black text-sm  ">No Records</p>
               <p className="text-slate-400 text-xs mt-1">Operational costs will appear here when logged.</p>
            </div>
         )}
      </div>

      <ExpenseModal 
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        expenseForm={expenseForm}
        setExpenseForm={setExpenseForm}
        handleSaveExpense={handleSaveExpense}
        isSaving={isSaving}
        actualCashDrawer={actualCashDrawer}
        accounts={expenseAccounts || []}
      />

      <ExpenseAccountModal 
        isOpen={isAccountModalOpen}
        onClose={() => setIsAccountModalOpen(false)}
      />
    </div>
  );
}

