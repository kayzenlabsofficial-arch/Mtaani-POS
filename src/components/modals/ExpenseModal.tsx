import React from 'react';
import { FileMinus, Loader2 } from 'lucide-react';
import { SearchableSelect } from '../shared/SearchableSelect';
import { isBundleProduct } from '../../utils/bundleInventory';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenseForm: { amount: string, category: string, description: string, source: 'TILL' | 'ACCOUNT' | 'SHOP', accountId?: string, productId?: string, quantity?: string };
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
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-sm max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl shadow-elevated relative z-10 flex flex-col p-5 sm:p-6 animate-in zoom-in-95 duration-200">
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
                      data-testid="expense-amount"
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
                <SearchableSelect
                  value={expenseForm.category}
                  onChange={(v) => setExpenseForm({ ...expenseForm, category: v })}
                  placeholder="Select Account..."
                  options={[
                    ...(accounts || []).map(acc => ({ value: acc.name, label: acc.name, keywords: acc.name })),
                    ...(financialAccounts || []).map(acc => ({ value: `Finance: ${acc.name}`, label: `Finance: ${acc.name}`, keywords: `${acc.name} ${acc.type} finance account` })),
                    { value: 'Other', label: 'Other / Miscellaneous', keywords: 'other miscellaneous misc' },
                  ]}
                  buttonClassName="focus:border-orange-500"
                  dataTestId="expense-category"
                />
             </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Description</label>
                 <input data-testid="expense-description" type="text" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-orange-500" placeholder="e.g. Bought receipt rolls" />
              </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Source of Funds</label>
                 <div className="flex gap-2">
                    <button 
                       data-testid="expense-source-till"
                       onClick={() => setExpenseForm({...expenseForm, source: 'TILL'})}
                       className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${expenseForm.source === 'TILL' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                       Till (Cash)
                    </button>
                    <button 
                       data-testid="expense-source-account"
                       onClick={() => setExpenseForm({...expenseForm, source: 'ACCOUNT'})}
                       className={`flex-1 py-2.5 rounded-xl text-[10px] font-bold border transition-all ${expenseForm.source === 'ACCOUNT' ? 'bg-blue-50 border-blue-500 text-blue-700' : 'bg-white border-slate-200 text-slate-500'}`}
                    >
                       Owner Account
                    </button>
                    <button 
                       data-testid="expense-source-shop"
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
                       <SearchableSelect
                         value={expenseForm.productId || ''}
                         onChange={(v) => {
                           const p = products.find(x => x.id === v);
                           setExpenseForm({
                             ...expenseForm,
                             productId: v,
                             amount: p ? String(p.sellingPrice) : expenseForm.amount,
                             description: p ? `Expensed: ${p.name}` : expenseForm.description,
                           });
                         }}
                         placeholder="Choose item..."
                         options={(products || [])
                           .filter(p => !isBundleProduct(p))
                           .map(p => ({
                             value: p.id,
                             label: `${p.name} (${p.stockQuantity} ${p.unit || 'pcs'} left)`,
                             keywords: `${p.name} ${p.barcode || ''}`,
                           }))}
                         buttonClassName="bg-purple-50 border-purple-200 focus:border-purple-500"
                         searchInputClassName="bg-white"
                         dataTestId="expense-product"
                       />
                    </div>
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Quantity</label>
                       <input 
                          data-testid="expense-quantity"
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
                   <SearchableSelect
                     value={expenseForm.accountId || ''}
                     onChange={(v) => setExpenseForm({ ...expenseForm, accountId: v })}
                     placeholder="Select Account..."
                     options={(financialAccounts || []).map(acc => ({
                       value: acc.id,
                       label: `${acc.name} (${acc.type})`,
                       keywords: `${acc.name} ${acc.type}`,
                     }))}
                     buttonClassName="bg-blue-50 border-blue-200 focus:border-blue-500"
                     searchInputClassName="bg-white"
                     dataTestId="expense-payment-account"
                   />
                </div>
              )}
         </div>

        <div className="flex gap-3">
           <button data-testid="expense-cancel" onClick={onClose} disabled={isSaving} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50">Cancel</button>
           <button data-testid="expense-save" onClick={handleSaveExpense} disabled={!expenseForm.amount || Number(expenseForm.amount) <= 0 || (expenseForm.source === 'TILL' && Number(expenseForm.amount) > actualCashDrawer) || (expenseForm.source === 'ACCOUNT' && !expenseForm.accountId) || (expenseForm.source === 'SHOP' && !expenseForm.productId) || isSaving} className="flex-[2] bg-orange-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 flex justify-center items-center gap-2">
             {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
             {isSaving ? 'Logging...' : 'Log Expense'}
           </button>
        </div>
      </div>
    </div>
  );
}

