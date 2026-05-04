import React from 'react';
import { FileMinus } from 'lucide-react';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenseForm: { amount: string, category: string, description: string };
  setExpenseForm: (form: any) => void;
  handleSaveExpense: () => Promise<void>;
  actualCashDrawer: number;
}

export default function ExpenseModal({ isOpen, onClose, expenseForm, setExpenseForm, handleSaveExpense, actualCashDrawer }: ExpenseModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl relative z-10 flex flex-col p-6 animate-in zoom-in-95 duration-200">
        <h2 className="text-xl font-black text-slate-900 mb-2 flex items-center gap-2">
           <FileMinus className="text-orange-600" /> Add Expense
        </h2>
        <p className="text-sm text-slate-500 mb-6">Log daily expenditures taken from cash drawer.</p>
        
        <div className="space-y-4 mb-6">
             <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Amount</label>
                <div className="relative">
                   <span className="absolute left-4 top-3 text-slate-400 font-bold">Ksh</span>
                   <input 
                      type="number" 
                      value={expenseForm.amount} 
                      onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 text-xl font-bold text-slate-900 focus:outline-none focus:border-orange-500" 
                      placeholder="0" 
                      autoFocus 
                   />
                </div>
                {Number(expenseForm.amount) > actualCashDrawer && (
                   <p className="text-[10px] text-red-500 font-bold mt-1">Exceeds cash in drawer!</p>
                )}
             </div>
             <div className="relative">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Category</label>
                <input 
                    type="text" 
                    list="expense-categories"
                    value={expenseForm.category} 
                    onChange={e => setExpenseForm({...expenseForm, category: e.target.value})} 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-orange-500"
                    placeholder="e.g. Supplies, Wages..."
                />
                <datalist id="expense-categories">
                   <option value="Supplies" />
                   <option value="Utilities" />
                   <option value="Wages" />
                   <option value="Logistics / Transport" />
                   <option value="Other" />
                </datalist>
             </div>
             <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Description</label>
                <input type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-orange-500" placeholder="e.g. Bought receipt rolls" />
             </div>
        </div>

        <div className="flex gap-3">
           <button onClick={onClose} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
           <button onClick={handleSaveExpense} disabled={!expenseForm.amount || Number(expenseForm.amount) <= 0 || Number(expenseForm.amount) > actualCashDrawer} className="flex-[2] bg-orange-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50">Log Expense</button>
        </div>
      </div>
    </div>
  );
}
