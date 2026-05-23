import React from 'react';
import { FileMinus, Landmark, Loader2, Wallet } from 'lucide-react';
import { SearchableSelect } from '../shared/SearchableSelect';
import { PICKED_CASH_ACCOUNT_NAME } from '../../utils/financeAccount';

type ExpenseSource = 'TILL' | 'ACCOUNT';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expenseForm: { amount: string, category: string, description: string, source: ExpenseSource, accountId?: string };
  setExpenseForm: (form: any) => void;
  handleSaveExpense: () => Promise<void>;
  isSaving?: boolean;
  actualCashDrawer: number;
  accounts: any[];
  financialAccounts: any[];
}

export default function ExpenseModal({
  isOpen,
  onClose,
  expenseForm,
  setExpenseForm,
  handleSaveExpense,
  isSaving,
  actualCashDrawer,
  accounts,
  financialAccounts,
}: ExpenseModalProps) {
  if (!isOpen) return null;

  const pickedAccount = financialAccounts?.[0];
  const amountValue = Number(expenseForm.amount) || 0;
  const tillOverdrawn = expenseForm.source === 'TILL' && amountValue > 0 && amountValue > actualCashDrawer;
  const accountOverdrawn = expenseForm.source === 'ACCOUNT' && pickedAccount && amountValue > Number(pickedAccount.balance || 0);

  const setMode = (source: ExpenseSource) => {
    setExpenseForm({
      ...expenseForm,
      source,
      accountId: source === 'ACCOUNT' ? pickedAccount?.id || expenseForm.accountId || '' : '',
    });
  };

  const categorySelect = (
    <SearchableSelect
      value={expenseForm.category}
      onChange={(v) => setExpenseForm({ ...expenseForm, category: v })}
      placeholder="Select category..."
      options={[
        ...(accounts || []).map(acc => ({ value: acc.name, label: acc.name, keywords: acc.name })),
        { value: 'General', label: 'General', keywords: 'general' },
        { value: 'Other', label: 'Other / Miscellaneous', keywords: 'other miscellaneous misc' },
      ]}
      buttonClassName="focus:border-slate-700"
      dataTestId="expense-category"
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg animate-in flex-col overflow-hidden rounded-t-2xl bg-white shadow-elevated duration-200 sm:rounded-2xl">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
            <FileMinus className="text-slate-700" size={20} /> Add expense
          </h2>
        </div>

        <div className="px-5 pt-5 sm:px-6">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5">
            {[
              { source: 'TILL' as const, label: 'Till', Icon: Wallet },
              { source: 'ACCOUNT' as const, label: 'Picked account', Icon: Landmark },
            ].map(({ source, label, Icon }) => (
              <button
                key={source}
                type="button"
                data-testid={`expense-source-${source.toLowerCase()}`}
                onClick={() => setMode(source)}
                className={`min-h-[4rem] rounded-xl border px-3 py-2 text-xs font-black transition-all flex flex-col items-center justify-center gap-1 ${
                  expenseForm.source === source
                    ? 'border-slate-900 bg-white text-slate-900 shadow-sm'
                    : 'border-transparent text-slate-500 hover:border-slate-200 hover:text-slate-800'
                }`}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5 no-scrollbar sm:p-6">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Amount</label>
            <div className="relative">
              <span className="absolute left-4 top-3 text-slate-400 font-bold">Ksh</span>
              <input
                data-testid="expense-amount"
                type="number"
                value={expenseForm.amount}
                onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-12 pr-4 text-xl font-bold text-slate-900 outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-900/10"
                placeholder="0"
                autoFocus
              />
            </div>
            {tillOverdrawn && <p className="mt-1 text-[10px] font-bold text-red-500">Exceeds cash sales in this shift.</p>}
            {accountOverdrawn && <p className="mt-1 text-[10px] font-bold text-red-500">Exceeds the picked cash account balance.</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Expense category</label>
            {categorySelect}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              {expenseForm.source === 'TILL' ? 'Till available' : PICKED_CASH_ACCOUNT_NAME}
            </p>
            <p className="text-lg font-black text-slate-900">
              Ksh {Number(expenseForm.source === 'TILL' ? actualCashDrawer : pickedAccount?.balance || 0).toLocaleString()}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-500">Description</label>
            <input
              data-testid="expense-description"
              type="text"
              value={expenseForm.description}
              onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-slate-700 focus:ring-2 focus:ring-slate-900/10"
              placeholder="e.g. Bought receipt rolls"
            />
          </div>
        </div>

        <div className="flex gap-3 border-t border-slate-200 bg-white p-5 sm:p-6">
          <button data-testid="expense-cancel" onClick={onClose} disabled={isSaving} className="flex-1 rounded-xl bg-slate-100 px-4 py-3 font-bold text-slate-700 transition-colors disabled:opacity-50">Cancel</button>
          <button
            data-testid="expense-save"
            onClick={handleSaveExpense}
            disabled={amountValue <= 0 || tillOverdrawn || accountOverdrawn || isSaving}
            className="flex-[2] rounded-xl bg-slate-900 px-4 py-3 font-bold text-white disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isSaving ? 'Logging...' : 'Log expense'}
          </button>
        </div>
      </div>
    </div>
  );
}
