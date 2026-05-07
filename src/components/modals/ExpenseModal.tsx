import React from 'react';
import { FileMinus, Loader2 } from 'lucide-react';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenseForm: { amount: string, category: string, description: string, source: 'TILL' | 'ACCOUNT' };
  setExpenseForm: (form: any) => void;
  handleSaveExpense: () => Promise<void>;
  isSaving?: boolean;
  actualCashDrawer: number;
  accounts: any[];
  financialAccounts: any[];
  products: any[];
}

export default function ExpenseModal({ isOpen, onClose, expenseForm, setExpenseForm, handleSaveExpense, isSaving, actualCashDrawer, accounts, financialAccounts, products }: ExpenseModalProps) {
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
                <label className="block text-xs font-bold text-slate-500  mb-1.5">Amount</label>
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
                {expenseForm.source === 'TILL' && Number(expenseForm.amount) > actualCashDrawer && (
                   <p className="text-[10px] text-red-500 font-bold mt-1">Exceeds cash in drawer!</p>
                )}
             </div>
             <div className="relative">
                <label className="block text-xs font-bold text-slate-500  mb-1.5">Expense Account (Category)</label>
                <select 
                    value={expenseForm.category} 
                    onChange={e => setExpenseForm({...expenseForm, category: e.target.value})} 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-orange-500"
                >
                    <option value="">Select Account...</option>
                    {(accounts || []).map(acc => (
                      <option key={acc.id} value={acc.name}>{acc.name}</option>
                    ))}
                    <option value="Other">Other / Miscellaneous</option>
                </select>
             </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Description</label>
                 <input type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-orange-500" placeholder="e.g. Bought receipt rolls" />
              </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Source of Funds</label>
                 <div className="flex gap-2">
                    <button 
                       onClick={() => setExpenseForm({...expenseForm, source: 'TILL'})}
                       className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${expenseForm.source === 'TILL' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                       Till (Cash)
                    </button>
                    <button 
                       onClick={() => setExpenseForm({...expenseForm, source: 'ACCOUNT'})}
                       className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold border transition-all ${expenseForm.source === 'ACCOUNT' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                       Owner Account
                    </button>
                    <button 
                       onClick={() => setExpenseForm({...expenseForm, source: 'SHOP'})}
                       className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold border transition-all ${expenseForm.source === 'SHOP' ? 'bg-purple-50 border-purple-500 text-purple-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                       Shop Item
                    </button>
                 </div>
                 <p className="text-[9px] text-slate-400 mt-1 italic">
                    {expenseForm.source === 'TILL' ? '* Deducted from cashier drawer.' : (expenseForm.source === 'SHOP' ? '* Deducted from shop inventory.' : '* Direct payment by owner (Bank/M-Pesa).')}
                 </p>
              </div>

              {expenseForm.source === 'SHOP' && (
                 <div className="animate-in slide-in-from-top-2 space-y-3">
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Select Product</label>
                       <select 
                          value={expenseForm.productId || ''} 
                          onChange={e => {
                             const p = products.find(x => x.id === e.target.value);
                             setExpenseForm({
                                ...expenseForm, 
                                productId: e.target.value,
                                amount: p ? String(p.sellingPrice) : expenseForm.amount, 
                                description: p ? `Expensed: ${p.name}` : expenseForm.description
                             });
                          }} 
                          className="w-full bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-purple-500"
                       >
                          <option value="">Choose item...</option>
                          {(products || []).filter(p => !p.isBundle).map(p => (
                            <option key={p.id} value={p.id}>{p.name} ({p.stockQuantity} {p.unit || 'pcs'} left)</option>
                          ))}
                       </select>
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Quantity</label>
                       <input 
                          type="number" 
                          step="any"
                          value={expenseForm.quantity || '1'} 
                          onChange={e => setExpenseForm({...expenseForm, quantity: e.target.value})}
                          className="w-full bg-purple-50 border border-purple-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-purple-500"
                          placeholder="1"
                       />
                    </div>
                 </div>
               )}

              {expenseForm.source === 'ACCOUNT' && (
                <div className="animate-in slide-in-from-top-2">
                   <label className="block text-xs font-bold text-slate-500  mb-1.5 ml-1">Select Payment Account</label>
                   <select 
                      value={expenseForm.accountId || ''} 
                      onChange={e => setExpenseForm({...expenseForm, accountId: e.target.value})} 
                      className="w-full bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-blue-500"
                   >
                      <option value="">Select Account...</option>
                      {(financialAccounts || []).map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name} ({acc.type})</option>
                      ))}
                   </select>
                </div>
              )}
         </div>

        <div className="flex gap-3">
           <button onClick={onClose} disabled={isSaving} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50">Cancel</button>
           <button onClick={handleSaveExpense} disabled={!expenseForm.amount || Number(expenseForm.amount) <= 0 || (expenseForm.source === 'TILL' && Number(expenseForm.amount) > actualCashDrawer) || (expenseForm.source === 'SHOP' && !expenseForm.productId) || isSaving} className="flex-[2] bg-orange-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 flex justify-center items-center gap-2">
             {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
             {isSaving ? 'Logging...' : 'Log Expense'}
           </button>
        </div>
      </div>
    </div>
  );
}
