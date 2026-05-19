import React from 'react';
import { FileMinus, Loader2 } from 'lucide-react';
import { SearchableSelect } from '../shared/SearchableSelect';
import { isBundleProduct } from '../../utils/bundleInventory';

type ExpenseSource = 'PETTY_CASH' | 'TILL' | 'ACCOUNT' | 'SHOP';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenseForm: { amount: string, category: string, description: string, source: ExpenseSource, accountId?: string, productId?: string, quantity?: string };
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
  const amountValue = Number(expenseForm.amount) || 0;
  const tillOverdrawn = expenseForm.source === 'TILL' && amountValue > 0 && amountValue > actualCashDrawer;
  const accountOptions = (financialAccounts || [])
    .filter(acc => acc.type !== 'CASH')
    .map(acc => ({
      value: acc.id,
      label: `${acc.name} (${acc.type})`,
      keywords: `${acc.name} ${acc.type}`,
    }));
  const sourceOptions: { id: ExpenseSource; label: string; className: string }[] = [
    { id: 'PETTY_CASH', label: 'Petty cash', className: 'bg-amber-50 border-amber-500 text-amber-700' },
    { id: 'TILL', label: 'Money from till', className: 'bg-orange-50 border-orange-500 text-orange-700' },
    { id: 'SHOP', label: 'Expense from stock', className: 'bg-purple-50 border-purple-500 text-purple-700' },
    { id: 'ACCOUNT', label: 'General expense', className: 'bg-blue-50 border-blue-500 text-blue-700' },
  ];
  const sourceHelp: Record<ExpenseSource, string> = {
    PETTY_CASH: 'Paid from petty cash. It will not reduce the till drawer.',
    TILL: 'Deducted from this shift cash sales.',
    SHOP: 'Deducted from shop inventory.',
    ACCOUNT: 'Paid by a bank or M-Pesa account.',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-sm max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl shadow-elevated relative z-10 flex flex-col p-5 sm:p-6 animate-in zoom-in-95 duration-200">
        <h2 className="text-xl font-black text-slate-900 mb-2 flex items-center gap-2">
           <FileMinus className="text-orange-600" /> Add expense
        </h2>
        <p className="text-sm text-slate-500 mb-6">Log petty cash, till, bank, or stock expenses.</p>
        
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
                {tillOverdrawn && (
                   <p className="text-[10px] text-red-500 font-bold mt-1">Exceeds cash sales in this shift!</p>
                )}
             </div>
             <div className="relative">
                <label className="block text-xs font-bold text-slate-500  mb-1.5">Expense account (category)</label>
                <SearchableSelect
                  value={expenseForm.category}
                  onChange={(v) => setExpenseForm({ ...expenseForm, category: v })}
                    placeholder="Select account..."
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
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Source of funds</label>
                 <div className="grid grid-cols-2 gap-2">
                    {sourceOptions.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        data-testid={`expense-source-${option.id.toLowerCase().replace('_', '-')}`}
                        onClick={() => setExpenseForm({
                          ...expenseForm,
                          source: option.id,
                          accountId: option.id === 'ACCOUNT' ? expenseForm.accountId : '',
                          productId: option.id === 'SHOP' ? expenseForm.productId : '',
                          quantity: option.id === 'SHOP' ? (expenseForm.quantity || '1') : '1',
                        })}
                        className={`min-h-[3rem] rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-wider border transition-all ${
                          expenseForm.source === option.id ? option.className : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                 </div>
                 <p className="text-[9px] text-slate-400 mt-1 italic">
                    * {sourceHelp[expenseForm.source]}
                 </p>
              </div>

              {expenseForm.source === 'SHOP' && (
                 <div className="animate-in slide-in-from-top-2 space-y-3">
                    <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 ml-1">Select product</label>
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
                   <label className="block text-xs font-bold text-slate-500  mb-1.5 ml-1">Select bank / M-Pesa account</label>
                   <SearchableSelect
                     value={expenseForm.accountId || ''}
                     onChange={(v) => setExpenseForm({ ...expenseForm, accountId: v })}
                     placeholder="Select account..."
                     emptyText="No bank or M-Pesa accounts found"
                     options={accountOptions}
                     buttonClassName="bg-blue-50 border-blue-200 focus:border-blue-500"
                     searchInputClassName="bg-white"
                     dataTestId="expense-payment-account"
                   />
                </div>
              )}
         </div>

        <div className="flex gap-3">
           <button data-testid="expense-cancel" onClick={onClose} disabled={isSaving} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50">Cancel</button>
           <button data-testid="expense-save" onClick={handleSaveExpense} disabled={!expenseForm.amount || amountValue <= 0 || tillOverdrawn || (expenseForm.source === 'ACCOUNT' && !expenseForm.accountId) || (expenseForm.source === 'SHOP' && !expenseForm.productId) || isSaving} className="flex-[2] bg-orange-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 flex justify-center items-center gap-2">
             {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
             {isSaving ? 'Logging...' : 'Log expense'}
           </button>
        </div>
      </div>
    </div>
  );
}
