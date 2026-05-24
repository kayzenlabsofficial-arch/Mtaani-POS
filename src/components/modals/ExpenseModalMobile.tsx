import React from 'react';
import { FileMinus, Landmark, Loader2, Wallet } from 'lucide-react';
import { SearchableSelect } from '../shared/SearchableSelectMobile';
import MobileModal from '../shared/MobileModal';
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

export default function ExpenseModalMobile({
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
      buttonClassName="rounded-lg border-2 border-slate-200 bg-white focus:border-blue-600"
      dataTestId="expense-category"
    />
  );

  return (
    <MobileModal
      onClose={onClose}
      closeOnBackdrop={!isSaving}
      size="lg"
      bodyClassName="modal-scroll-padding"
      header={(
        <>
        <div className="border-b-2 border-slate-100 px-5 py-4 sm:px-6">
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700"><FileMinus size={20} /></span> Add expense
          </h2>
        </div>

        <div className="px-5 pt-5 sm:px-6">
          <div className="grid grid-cols-2 gap-2 rounded-lg border-2 border-slate-200 bg-slate-50 p-1.5">
            {[
              { source: 'TILL' as const, label: 'Till', Icon: Wallet },
              { source: 'ACCOUNT' as const, label: 'Picked account', Icon: Landmark },
            ].map(({ source, label, Icon }) => (
              <button
                key={source}
                type="button"
                data-testid={`expense-source-${source.toLowerCase()}`}
                onClick={() => setMode(source)}
                className={`flex min-h-[4rem] flex-col items-center justify-center gap-1 rounded-lg border-2 px-3 py-2 text-xs font-black transition-all ${
                  expenseForm.source === source
                    ? 'border-blue-700 bg-blue-700 text-white'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-slate-800'
                }`}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        </>
      )}
      footer={(
        <div className="flex gap-3 p-5 sm:p-6">
          <button data-testid="expense-cancel" onClick={onClose} disabled={isSaving} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 font-black text-slate-700 transition-colors disabled:opacity-50">Cancel</button>
          <button
            data-testid="expense-save"
            onClick={handleSaveExpense}
            disabled={amountValue <= 0 || tillOverdrawn || accountOverdrawn || isSaving}
            className="flex flex-[2] items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isSaving ? 'Logging...' : 'Log expense'}
          </button>
        </div>
      )}
    >

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
                className="w-full rounded-lg border-2 border-slate-200 bg-white py-3 pl-12 pr-4 text-xl font-bold text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
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

          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3">
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
              className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              placeholder="e.g. Bought receipt rolls"
            />
          </div>
        </div>
    </MobileModal>
  );
}
