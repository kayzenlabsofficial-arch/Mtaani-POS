import React from 'react';
import { FileMinus, Landmark, Loader2, Package, Wallet } from 'lucide-react';
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

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const moneyInput = (value: number) => {
  const rounded = roundMoney(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, '');
};
const productCost = (product?: any) => Number(product?.costPrice || 0);

export default function ExpenseModal({ isOpen, onClose, expenseForm, setExpenseForm, handleSaveExpense, isSaving, actualCashDrawer, accounts, financialAccounts, products }: ExpenseModalProps) {
  const selectedProduct = (products || []).find(p => p.id === expenseForm.productId);
  const quantity = Number(expenseForm.quantity || 0);
  const unitCost = productCost(selectedProduct);
  const stockAmount = roundMoney(unitCost * quantity);
  const amountValue = expenseForm.source === 'SHOP' ? stockAmount : Number(expenseForm.amount) || 0;
  const tillOverdrawn = expenseForm.source === 'TILL' && amountValue > 0 && amountValue > actualCashDrawer;
  const stockCostMissing = expenseForm.source === 'SHOP' && !!selectedProduct && unitCost <= 0;
  const stockOverdrawn = expenseForm.source === 'SHOP' && !!selectedProduct && quantity > Number(selectedProduct.stockQuantity || 0);

  React.useEffect(() => {
    if (expenseForm.source !== 'SHOP' || !selectedProduct) return;
    const nextAmount = moneyInput(stockAmount);
    const nextDescription = !expenseForm.description || expenseForm.description.startsWith('Expensed:')
      ? `Expensed: ${selectedProduct.name}`
      : expenseForm.description;
    if (expenseForm.amount === nextAmount && expenseForm.category && expenseForm.description === nextDescription) return;
    setExpenseForm({
      ...expenseForm,
      amount: nextAmount,
      category: expenseForm.category || 'Stock',
      description: nextDescription,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenseForm.source, expenseForm.productId, expenseForm.quantity, selectedProduct?.id, stockAmount]);

  if (!isOpen) return null;

  const accountOptions = (financialAccounts || [])
    .filter(acc => acc.type !== 'CASH')
    .map(acc => ({
      value: acc.id,
      label: `${acc.name} (${acc.type})`,
      keywords: `${acc.name} ${acc.type}`,
    }));

  const modeOptions: Array<{ source: Extract<ExpenseSource, 'TILL' | 'SHOP' | 'ACCOUNT'>; label: string; Icon: React.ElementType }> = [
    { source: 'TILL', label: 'Expense from till', Icon: Wallet },
    { source: 'SHOP', label: 'Stock', Icon: Package },
    { source: 'ACCOUNT', label: 'General expense', Icon: Landmark },
  ];

  const setMode = (source: Extract<ExpenseSource, 'TILL' | 'SHOP' | 'ACCOUNT'>) => {
    setExpenseForm({
      ...expenseForm,
      source,
      amount: source === 'SHOP' ? expenseForm.amount : (expenseForm.source === 'SHOP' ? '' : expenseForm.amount),
      category: source === 'SHOP' ? (expenseForm.category || 'Stock') : expenseForm.category,
      accountId: source === 'ACCOUNT' ? expenseForm.accountId : '',
      productId: source === 'SHOP' ? expenseForm.productId : '',
      quantity: source === 'SHOP' ? (expenseForm.quantity || '1') : '1',
    });
  };

  const categorySelect = (
    <SearchableSelect
      value={expenseForm.category}
      onChange={(v) => setExpenseForm({ ...expenseForm, category: v })}
      placeholder="Select account..."
      options={[
        ...(accounts || []).map(acc => ({ value: acc.name, label: acc.name, keywords: acc.name })),
        { value: 'Other', label: 'Other / Miscellaneous', keywords: 'other miscellaneous misc' },
      ]}
      buttonClassName="focus:border-orange-500"
      dataTestId="expense-category"
    />
  );

  const amountInput = (
    <div>
      <label className="block text-xs font-bold text-slate-500 mb-1.5">Amount</label>
      <div className="relative">
        <span className="absolute left-4 top-3 text-slate-400 font-bold">Ksh</span>
        <input
          data-testid="expense-amount"
          type="number"
          value={expenseForm.amount}
          onChange={e => setExpenseForm({ ...expenseForm, amount: e.target.value })}
          className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 text-xl font-bold text-slate-900 focus:outline-none focus:border-orange-500"
          placeholder="0"
          autoFocus={expenseForm.source !== 'SHOP'}
        />
      </div>
      {tillOverdrawn && <p className="text-[10px] text-red-500 font-bold mt-1">Exceeds cash sales in this shift.</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-white w-full max-w-lg max-h-[92dvh] overflow-hidden rounded-t-2xl sm:rounded-xl shadow-elevated relative z-10 flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-5 sm:p-6 border-b border-slate-100">
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <FileMinus className="text-orange-600" /> Add expense
          </h2>
        </div>

        <div className="px-5 sm:px-6 pt-5">
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1.5">
            {modeOptions.map(({ source, label, Icon }) => (
              <button
                key={source}
                type="button"
                data-testid={`expense-source-${source.toLowerCase()}`}
                onClick={() => setMode(source)}
                className={`min-h-[4rem] rounded-xl px-2 py-2 text-[10px] font-black leading-tight transition-all flex flex-col items-center justify-center gap-1 ${
                  expenseForm.source === source ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-5 sm:p-6 space-y-4">
          {expenseForm.source === 'TILL' && (
            <>
              {amountInput}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">Expense account</label>
                {categorySelect}
              </div>
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">Drawer available</p>
                <p className="text-lg font-black text-emerald-700">Ksh {actualCashDrawer.toLocaleString()}</p>
              </div>
            </>
          )}

          {expenseForm.source === 'SHOP' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">Product</label>
                <SearchableSelect
                  value={expenseForm.productId || ''}
                  onChange={(v) => setExpenseForm({ ...expenseForm, productId: v })}
                  placeholder="Choose item..."
                  options={(products || [])
                    .filter(p => !isBundleProduct(p))
                    .map(p => ({
                      value: p.id,
                      label: `${p.name} (${p.stockQuantity} ${p.unit || 'pcs'} left)`,
                      keywords: `${p.name} ${p.barcode || ''}`,
                    }))}
                  buttonClassName="bg-orange-50 border-orange-100 focus:border-orange-500"
                  searchInputClassName="bg-white"
                  dataTestId="expense-product"
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
                <div className="rounded-xl bg-slate-950 px-4 py-3 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Stock cost</p>
                  <p className="text-xl font-black">Ksh {stockAmount.toLocaleString()}</p>
                  {selectedProduct && <p className="text-[10px] font-bold text-slate-300">Ksh {unitCost.toLocaleString()} each</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1.5">Quantity</label>
                  <input
                    data-testid="expense-quantity"
                    type="number"
                    min="0"
                    step="any"
                    value={expenseForm.quantity || '1'}
                    onChange={e => setExpenseForm({ ...expenseForm, quantity: e.target.value })}
                    className="w-full bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-sm font-black text-center focus:outline-none focus:border-orange-500"
                    placeholder="1"
                  />
                </div>
              </div>
              {stockCostMissing && <p className="text-[10px] text-red-500 font-bold">Set a cost price for this product before saving.</p>}
              {stockOverdrawn && <p className="text-[10px] text-red-500 font-bold">Quantity is more than available stock.</p>}
            </>
          )}

          {expenseForm.source === 'ACCOUNT' && (
            <>
              {amountInput}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">Expense account</label>
                {categorySelect}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1.5">Paying account</label>
                <SearchableSelect
                  value={expenseForm.accountId || ''}
                  onChange={(v) => setExpenseForm({ ...expenseForm, accountId: v })}
                  placeholder="Select account..."
                  emptyText="No bank or M-Pesa accounts found"
                  options={accountOptions}
                  buttonClassName="bg-blue-50 border-blue-100 focus:border-blue-500"
                  searchInputClassName="bg-white"
                  dataTestId="expense-payment-account"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Description</label>
            <input
              data-testid="expense-description"
              type="text"
              value={expenseForm.description}
              onChange={e => setExpenseForm({ ...expenseForm, description: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-orange-500"
              placeholder={expenseForm.source === 'SHOP' ? 'e.g. Staff lunch stock use' : 'e.g. Bought receipt rolls'}
            />
          </div>
        </div>

        <div className="flex gap-3 p-5 sm:p-6 border-t border-slate-100 bg-white">
          <button data-testid="expense-cancel" onClick={onClose} disabled={isSaving} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50">Cancel</button>
          <button
            data-testid="expense-save"
            onClick={handleSaveExpense}
            disabled={
              amountValue <= 0 ||
              tillOverdrawn ||
              stockCostMissing ||
              stockOverdrawn ||
              (expenseForm.source === 'ACCOUNT' && !expenseForm.accountId) ||
              (expenseForm.source === 'SHOP' && (!expenseForm.productId || quantity <= 0)) ||
              isSaving
            }
            className="flex-[2] bg-orange-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 flex justify-center items-center gap-2"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isSaving ? 'Logging...' : 'Log expense'}
          </button>
        </div>
      </div>
    </div>
  );
}
