import React, { useRef, useState } from 'react';
import { Ban, Banknote, Calculator, CircleDollarSign, CreditCard, Minus, Package, Percent, Plus, ScanBarcode, Search, ShoppingCart, Smartphone, Split, Store, UserRound, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { useToast } from '../../context/ToastContext';
import BarcodeScanner from '../shared/BarcodeScanner';
import { enrichProductsWithBundleStock, isBundleProduct } from '../../utils/bundleInventory';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: React.CSSProperties }) => (
  (() => {
    const icons: Record<string, React.ElementType> = {
      add: Plus,
      remove: Minus,
      close: X,
      search: Search,
      barcode_scanner: ScanBarcode,
      inventory: Package,
      inventory_2: Package,
      shopping_cart: ShoppingCart,
      payments: CircleDollarSign,
      block: Ban,
      store_mall_directory: Store,
    };
    const Icon = icons[name] || Package;
    const { fontSize, ...rest } = style || {};
    const size = typeof fontSize === 'number' ? fontSize : Number.parseInt(String(fontSize || 20), 10);
    return <Icon className={className} style={rest} size={Number.isFinite(size) ? size : 20} strokeWidth={2.4} />;
  })()
);

// Deterministic color from string
const CARD_COLORS = [
  'bg-blue-600', 'bg-violet-600', 'bg-emerald-600',
  'bg-amber-500', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600', 'bg-orange-500',
];
function colorFor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return CARD_COLORS[Math.abs(hash) % CARD_COLORS.length];
}

interface ProductTileProps {
  key?: React.Key;
  product: any;
  onAdd: (p: any) => void;
  recentlyAdded: boolean;
}

function ProductTile({ product, onAdd, recentlyAdded }: ProductTileProps) {
  const stock = product.stockQuantity || 0;
  const isOut = stock <= 0;
  const isLow = !isOut && stock <= (product.reorderPoint || 5);
  const initials = product.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const color = colorFor(product.name);

  return (
    <button
      type="button"
      onClick={() => !isOut && onAdd(product)}
      disabled={isOut}
      className={`w-full text-left bg-white border rounded-2xl px-3 py-2.5 sm:px-4 transition-all group ${
        isOut ? 'opacity-60 cursor-not-allowed border-slate-100 bg-slate-50/60' : 'cursor-pointer border-slate-100 hover:border-primary/30 hover:bg-blue-50/30 hover:shadow-sm active:scale-[0.995]'
      } ${recentlyAdded ? 'ring-2 ring-primary/30 border-primary/40' : ''}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:gap-3">
        <div className="grid min-w-0 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[2.75rem_minmax(0,1fr)] sm:gap-3">
          <div className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl ${color} flex items-center justify-center flex-shrink-0 text-white text-[11px] sm:text-xs font-black shadow-sm`}>
            {initials}
          </div>

          <div className="stable-row-copy">
            <div className="flex items-center gap-2 min-w-0">
              <p className="stable-title-2 text-[13px] sm:text-sm font-black leading-tight text-slate-900 group-hover:text-primary transition-colors">{product.name}</p>
              {product.isTaxable && (
                <span className="hidden sm:inline-flex text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">VAT</span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <span className="stable-meta max-w-[7rem] sm:max-w-none">{product.category || 'General'}</span>
              {isBundleProduct(product) && <span className="text-emerald-600 flex-shrink-0">bulk</span>}
              {product.barcode && <span className="hidden sm:inline font-mono normal-case tracking-normal text-slate-500 stable-meta">#{product.barcode}</span>}
              <span className="flex-shrink-0">{product.unit || 'pcs'}</span>
            </div>
          </div>
        </div>

        <div className="stable-actions flex items-center justify-end gap-2 sm:gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className={`text-[9px] font-black px-2 py-1 rounded-full border ${
              isOut ? 'bg-rose-50 text-rose-600 border-rose-100'
              : isLow ? 'bg-amber-50 text-amber-700 border-amber-100'
              : 'bg-emerald-50 text-emerald-700 border-emerald-100'
            }`}>
              {isOut ? 'Out' : isLow ? `${stock} left` : `${stock} stock`}
            </span>
          </div>
          <div className="text-right">
            <p className="text-[13px] sm:text-base font-black text-slate-900 tabular-nums whitespace-nowrap">
              Ksh {product.sellingPrice?.toLocaleString()}
            </p>
            <p className={`text-[9px] font-black uppercase sm:hidden ${isOut ? 'text-rose-500' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
              {isOut ? 'Out' : `${stock} left`}
            </p>
          </div>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors flex-shrink-0 ${
            isOut ? 'bg-slate-200 text-slate-400' : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white'
          }`}>
            <MaterialIcon name={isOut ? 'block' : 'add'} style={{ fontSize: '18px' }} />
          </div>
        </div>
      </div>
    </button>
  );
}

type CheckoutOptions = {
  subtotal?: number;
  total?: number;
  discountAmount?: number;
  discountType?: 'FIXED' | 'PERCENT';
  amountTendered?: number;
  changeGiven?: number;
  mpesaRef?: string;
  pdqRef?: string;
  paymentReference?: string;
  customerId?: string;
  customerName?: string;
  splitPayments?: {
    cashAmount: number;
    secondaryAmount: number;
    secondaryMethod: 'MPESA' | 'PDQ' | 'CREDIT';
    secondaryReference?: string;
  };
};

function SalePanel({
  onCheckout,
  isCheckingOut,
  className = '',
  onCheckoutSuccess,
}: {
  onCheckout: (status: 'PAID' | 'UNPAID', method: string, options?: CheckoutOptions) => Promise<any>;
  isCheckingOut: boolean;
  className?: string;
  onCheckoutSuccess?: () => void;
}) {
  const { cart, removeFromCart, updateQuantity, setQuantity, clearCart } = useStore();
  const activeBusinessId = useStore((state) => state.activeBusinessId);
  const { warning } = useToast();
  const [paymentMode, setPaymentMode] = useState<'CASH' | 'MPESA' | 'PDQ' | 'SPLIT' | 'CREDIT'>('CASH');
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [discountValue, setDiscountValue] = useState('');
  const [cashTendered, setCashTendered] = useState('');
  const [mpesaRef, setMpesaRef] = useState('');
  const [pdqRef, setPdqRef] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitSecondaryMethod, setSplitSecondaryMethod] = useState<'MPESA' | 'PDQ' | 'CREDIT'>('MPESA');
  const [splitSecondaryRef, setSplitSecondaryRef] = useState('');
  const checkoutLockRef = useRef(false);

  const customers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).sortBy('name') : Promise.resolve([]),
    [activeBusinessId],
    []
  );

  const subtotal = cart.reduce((sum, item) => sum + ((Number(item.sellingPrice) || 0) * (Number(item.cartQuantity) || 0)), 0);
  const itemCount = cart.reduce((sum, item) => sum + (Number(item.cartQuantity) || 0), 0);
  const rawDiscount = Number(discountValue) || 0;
  const discountAmount = Math.min(
    subtotal,
    discountType === 'PERCENT'
      ? subtotal * Math.min(Math.max(rawDiscount, 0), 100) / 100
      : Math.max(rawDiscount, 0)
  );
  const total = Math.max(0, subtotal - discountAmount);
  const tendered = Number(cashTendered) || 0;
  const changeDue = Math.max(0, tendered - total);
  const splitCashAmount = Math.min(Math.max(Number(splitCash) || 0, 0), total);
  const splitSecondaryAmount = Math.max(0, total - splitCashAmount);
  const selectedCustomer = customers?.find((customer) => customer.id === selectedCustomerId);

  const paymentOptions = [
    { id: 'CASH' as const, label: 'Cash', icon: Banknote },
    { id: 'MPESA' as const, label: 'M-Pesa', icon: Smartphone },
    { id: 'PDQ' as const, label: 'PDQ', icon: CreditCard },
    { id: 'SPLIT' as const, label: 'Split', icon: Split },
    { id: 'CREDIT' as const, label: 'Credit', icon: UserRound },
  ];

  const baseOptions = (): CheckoutOptions => ({
    subtotal,
    total,
    discountAmount,
    discountType,
    customerId: selectedCustomer?.id,
    customerName: selectedCustomer?.name,
  });

  const runCheckout = async (status: 'PAID' | 'UNPAID', method: string, options?: CheckoutOptions) => {
    const result = await onCheckout(status, method, options);
    if (result) onCheckoutSuccess?.();
    return result;
  };

  const submitCheckout = async () => {
    if (cart.length === 0 || isCheckingOut || checkoutLockRef.current) return;
    checkoutLockRef.current = true;

    try {
      if ((paymentMode === 'CREDIT' || (paymentMode === 'SPLIT' && splitSecondaryMethod === 'CREDIT')) && !selectedCustomer) {
        warning('Choose a registered customer before putting any amount on credit.');
        return;
      }

      if (paymentMode === 'CASH') {
        const paid = cashTendered ? tendered : total;
        if (paid < total) {
          warning('Amount received must cover the sale total.');
          return;
        }
        await runCheckout('PAID', 'CASH', { ...baseOptions(), amountTendered: paid, changeGiven: Math.max(0, paid - total) });
        return;
      }

      if (paymentMode === 'MPESA') {
        await runCheckout('PAID', 'MPESA', { ...baseOptions(), mpesaRef: mpesaRef.trim(), paymentReference: mpesaRef.trim() });
        return;
      }

      if (paymentMode === 'PDQ') {
        await runCheckout('PAID', 'PDQ', { ...baseOptions(), pdqRef: pdqRef.trim(), paymentReference: pdqRef.trim() });
        return;
      }

      if (paymentMode === 'SPLIT') {
        if (splitCashAmount <= 0 || splitCashAmount >= total) {
          warning('Enter the cash part so the balance can go to M-Pesa, PDQ, or credit.');
          return;
        }
        await runCheckout(splitSecondaryMethod === 'CREDIT' ? 'UNPAID' : 'PAID', 'SPLIT', {
          ...baseOptions(),
          amountTendered: splitCashAmount,
          changeGiven: 0,
          mpesaRef: splitSecondaryMethod === 'MPESA' ? splitSecondaryRef.trim() : undefined,
          pdqRef: splitSecondaryMethod === 'PDQ' ? splitSecondaryRef.trim() : undefined,
          paymentReference: splitSecondaryRef.trim(),
          splitPayments: {
            cashAmount: splitCashAmount,
            secondaryAmount: splitSecondaryAmount,
            secondaryMethod: splitSecondaryMethod,
            secondaryReference: splitSecondaryRef.trim(),
          },
        });
        return;
      }

      await runCheckout('UNPAID', 'CREDIT', baseOptions());
    } finally {
      checkoutLockRef.current = false;
    }
  };

  return (
    <aside className={`bg-white border border-slate-100 rounded-2xl overflow-hidden flex flex-col min-h-[22rem] lg:sticky lg:top-0 lg:max-h-[calc(100vh-9rem)] shadow-sm ${className}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
        <div>
          <h3 className="text-sm font-black text-slate-900">Current Sale</h3>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{itemCount.toLocaleString()} item{itemCount === 1 ? '' : 's'}</p>
        </div>
        {cart.length > 0 && (
          <button onClick={clearCart} className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:text-rose-700">
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="h-full min-h-52 flex flex-col items-center justify-center text-center text-slate-400">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <MaterialIcon name="shopping_cart" style={{ fontSize: '28px' }} />
            </div>
            <p className="text-sm font-black">Tap an item to add it here</p>
          </div>
        ) : cart.map(item => (
          <div key={item.id} className="border border-slate-100 rounded-2xl p-3 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_2rem] items-start gap-3">
              <div className="stable-row-copy">
                <p className="stable-title-2 text-[13px] font-black leading-tight text-slate-900">{item.name}</p>
                <p className="text-[10px] font-bold text-slate-400 stable-meta mt-0.5">Ksh {item.sellingPrice?.toLocaleString()} each</p>
              </div>
              <button onClick={() => removeFromCart(item.id)} className="w-8 h-8 rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white flex items-center justify-center flex-shrink-0">
                <MaterialIcon name="close" style={{ fontSize: '16px' }} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
              <div className="flex items-center gap-1 bg-slate-50 rounded-xl p-1 stable-actions">
                <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 rounded-lg bg-white text-slate-600 border border-slate-100 flex items-center justify-center">
                  <MaterialIcon name="remove" style={{ fontSize: '16px' }} />
                </button>
                <input
                  type="number"
                  step="any"
                  value={item.cartQuantity}
                  onChange={e => setQuantity(item.id, Number(e.target.value))}
                  className="w-16 bg-transparent text-center text-sm font-black text-slate-900 outline-none"
                />
                <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 rounded-lg bg-white text-slate-600 border border-slate-100 flex items-center justify-center">
                  <MaterialIcon name="add" style={{ fontSize: '16px' }} />
                </button>
              </div>
              <p className="text-right text-sm font-black text-slate-900 whitespace-nowrap stable-actions">
                Ksh {((Number(item.sellingPrice) || 0) * (Number(item.cartQuantity) || 0)).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 p-4 space-y-3 bg-white">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 min-w-0">
            <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Subtotal</span>
            <span className="block text-sm font-black text-slate-900 tabular-nums truncate">Ksh {subtotal.toLocaleString()}</span>
          </div>
          <div className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 min-w-0">
            <span className="block text-[9px] font-black text-rose-500 uppercase tracking-widest">Discount</span>
            <span className="block text-sm font-black text-rose-700 tabular-nums truncate">Ksh {discountAmount.toLocaleString()}</span>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 min-w-0">
            <span className="block text-[9px] font-black text-emerald-700 uppercase tracking-widest">Payable</span>
            <span className="block text-sm font-black text-emerald-950 tabular-nums truncate">Ksh {total.toLocaleString()}</span>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
          <label className="relative min-w-0">
            <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="number"
              min="0"
              value={discountValue}
              onChange={(event) => setDiscountValue(event.target.value)}
              placeholder="Discount"
              data-testid="checkout-discount"
              className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <select
            value={discountType}
            onChange={(event) => setDiscountType(event.target.value as 'FIXED' | 'PERCENT')}
            className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-black text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          >
            <option value="FIXED">Ksh</option>
            <option value="PERCENT">%</option>
          </select>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {paymentOptions.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPaymentMode(id)}
              onPointerUp={(event) => {
                if (event.pointerType === 'touch') {
                  event.preventDefault();
                  setPaymentMode(id);
                }
              }}
              onTouchEnd={(event) => {
                event.preventDefault();
                setPaymentMode(id);
              }}
              data-testid={`payment-${id.toLowerCase()}`}
              className={`h-12 rounded-xl border px-2 flex flex-col items-center justify-center gap-0.5 text-[10px] font-black transition-colors ${
                paymentMode === id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={2.4} />
              <span className="truncate max-w-full">{label}</span>
            </button>
          ))}
        </div>

        {paymentMode === 'CASH' && (
          <div className="grid grid-cols-2 gap-2">
            <label className="relative min-w-0">
              <Calculator className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                min="0"
                value={cashTendered}
                onChange={(event) => setCashTendered(event.target.value)}
                placeholder="Cash received"
                data-testid="cash-received"
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 min-w-0">
              <span className="block text-[9px] font-black text-slate-400 uppercase tracking-widest">Change</span>
              <span className="block text-sm font-black text-slate-900 tabular-nums truncate">Ksh {changeDue.toLocaleString()}</span>
            </div>
          </div>
        )}

        {paymentMode === 'MPESA' && (
          <input
            value={mpesaRef}
            onChange={(event) => setMpesaRef(event.target.value)}
            placeholder="M-Pesa code or phone reference"
            data-testid="mpesa-reference"
            className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        )}

        {paymentMode === 'PDQ' && (
          <input
            value={pdqRef}
            onChange={(event) => setPdqRef(event.target.value)}
            placeholder="PDQ terminal reference"
            data-testid="pdq-reference"
            className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        )}

        {(paymentMode === 'CREDIT' || paymentMode === 'SPLIT') && (
          <select
            value={selectedCustomerId}
            onChange={(event) => setSelectedCustomerId(event.target.value)}
            data-testid="customer-select"
            className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          >
            <option value="">Select registered customer</option>
            {customers?.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` - ${customer.phone}` : ''}</option>
            ))}
          </select>
        )}

        {paymentMode === 'SPLIT' && (
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem] gap-2">
            <input
              type="number"
              min="0"
              max={total}
              value={splitCash}
              onChange={(event) => setSplitCash(event.target.value)}
              placeholder="Cash part"
              data-testid="split-cash"
              className="w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <select
              value={splitSecondaryMethod}
              onChange={(event) => setSplitSecondaryMethod(event.target.value as 'MPESA' | 'PDQ' | 'CREDIT')}
              data-testid="split-method"
              className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-2 text-sm font-black text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="MPESA">M-Pesa</option>
              <option value="PDQ">PDQ</option>
              <option value="CREDIT">Credit</option>
            </select>
            <input
              value={splitSecondaryRef}
              onChange={(event) => setSplitSecondaryRef(event.target.value)}
              placeholder={`${splitSecondaryMethod} reference (Ksh ${splitSecondaryAmount.toLocaleString()})`}
              data-testid="split-reference"
              className="sm:col-span-2 w-full h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
        )}

        <button
          onClick={submitCheckout}
          onMouseDown={(event) => {
            event.preventDefault();
            void submitCheckout();
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            void submitCheckout();
          }}
          onTouchStart={(event) => {
            event.preventDefault();
            void submitCheckout();
          }}
          disabled={cart.length === 0 || isCheckingOut}
          data-testid="complete-sale"
          className="w-full py-3.5 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <MaterialIcon name="payments" style={{ fontSize: '18px' }} />
          {isCheckingOut ? 'Saving Sale...' : `Complete ${paymentMode === 'MPESA' ? 'M-Pesa' : paymentMode} Sale`}
        </button>
      </div>
    </aside>
  );
}

export default function RegisterTab({ toggleCart, handleCheckout }: { toggleCart?: (val: boolean) => void; handleCheckout?: (status: 'PAID' | 'UNPAID', method: string, mpesaRef?: string, customerName?: string, splitData?: any) => Promise<any> }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isMobileCheckoutOpen, setIsMobileCheckoutOpen] = useState(false);
  const scrollRef = useHorizontalScroll();
  const { warning, error } = useToast();

  // ✅ Only require activeBusinessId — branch does not filter products
  const { addToCart, activeBusinessId, cart } = useStore();

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId) return Promise.resolve([]);
      const query = db.products.where('businessId').equals(activeBusinessId);
      if (selectedCategory !== 'All') {
        return query.filter(p =>
          p.category === selectedCategory &&
          (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(searchQuery)))
        ).toArray();
      }
      return query.filter(p =>
        !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(searchQuery))
      ).toArray();
    },
    [searchQuery, selectedCategory, activeBusinessId],
    []
  );

  const dbCategories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );

  const categories = ['All', ...(dbCategories?.map(c => c.name) || [])];
  const displayProducts = enrichProductsWithBundleStock(products || [], productIngredients || []);

  // Sort: in-stock → low-stock → out-of-stock
  const sorted = [...displayProducts].sort((a, b) => {
    const score = (p: any) => {
      const q = p.stockQuantity || 0;
      if (q <= 0) return 2;
      if (q <= (p.reorderPoint || 5)) return 1;
      return 0;
    };
    return score(a) - score(b);
  });

  const handleAddToCart = (product: any) => {
    if ((product.stockQuantity || 0) <= 0) {
      warning(isBundleProduct(product) ? 'This bulk item has no ingredient stock available.' : 'This item is out of stock.');
      return;
    }
    addToCart(product);
    toggleCart?.(true);
    setRecentlyAdded(prev => new Set([...prev, product.id]));
    setTimeout(() => setRecentlyAdded(prev => { const n = new Set(prev); n.delete(product.id); return n; }), 600);
  };

  const completeCheckout = async (status: 'PAID' | 'UNPAID', method: string, options?: CheckoutOptions) => {
    if (!handleCheckout || cart.length === 0 || isCheckingOut) return null;
    setIsCheckingOut(true);
    try {
      const result = await handleCheckout(status, method, options?.mpesaRef || options?.pdqRef || options?.paymentReference, options?.customerName, options);
      if (result) setIsMobileCheckoutOpen(false);
      return result;
    } catch (err: any) {
      error(err?.message || 'Checkout failed.');
      return null;
    } finally {
      setIsCheckingOut(false);
    }
  };

  const inStock = displayProducts.filter(p => (p.stockQuantity || 0) > 0).length || 0;
  const outOfStock = displayProducts.filter(p => (p.stockQuantity || 0) <= 0).length || 0;
  const saleTotal = cart.reduce((sum, item) => sum + ((Number(item.sellingPrice) || 0) * (Number(item.cartQuantity) || 0)), 0);
  const saleItemCount = cart.reduce((sum, item) => sum + (Number(item.cartQuantity) || 0), 0);
  React.useEffect(() => {
    if (cart.length === 0) setIsMobileCheckoutOpen(false);
  }, [cart.length]);

  React.useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (isMobileCheckoutOpen && !event.state?.mobileCheckout) {
        setIsMobileCheckoutOpen(false);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMobileCheckoutOpen]);

  const openMobileCheckout = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    if (!isMobileCheckoutOpen) {
      window.history.pushState({ ...(window.history.state || {}), mobileCheckout: true }, '');
    }
    setIsMobileCheckoutOpen(true);
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in gap-4">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
        <div>
          <h2 className="text-lg font-black text-slate-900">Register</h2>
          <p className="text-[11px] text-slate-500 font-medium">
            {inStock} available · <span className="text-rose-500">{outOfStock} out of stock</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative group flex-1 md:w-64">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
              <MaterialIcon name="search" style={{ fontSize: '18px' }} />
            </div>
            <input
              type="text"
              placeholder="Name or barcode..."
              className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <MaterialIcon name="close" style={{ fontSize: '16px' }} />
              </button>
            )}
          </div>

          {/* Scan */}
          <button
            onClick={() => setIsScannerOpen(v => !v)}
            className={`p-2.5 rounded-xl border flex-shrink-0 transition-all ${isScannerOpen ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20' : 'bg-white text-slate-600 border-slate-200 hover:border-primary/30 hover:text-primary'}`}
            title="Barcode Scanner"
          >
            <MaterialIcon name="barcode_scanner" style={{ fontSize: '20px' }} />
          </button>
        </div>
      </div>

      {/* Category pills */}
      <div ref={scrollRef} className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-shrink-0">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0 border ${
              selectedCategory === cat ? 'bg-primary text-white border-primary shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:border-primary/40 hover:text-primary'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Scanner */}
      {isScannerOpen && (
        <div className="bg-slate-950 rounded-2xl overflow-hidden flex-shrink-0">
          <div className="relative aspect-video max-h-44">
            <BarcodeScanner onScan={barcode => {
              const p = displayProducts.find(prod => prod.barcode === barcode);
              if (p) { handleAddToCart(p); setIsScannerOpen(false); }
            }} />
            <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-primary/60 shadow-[0_0_10px_rgba(37,99,235,0.8)] animate-pulse pointer-events-none" />
          </div>
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-800">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Point at barcode</p>
            <button onClick={() => setIsScannerOpen(false)} className="text-[10px] font-bold text-slate-500 hover:text-rose-400 flex items-center gap-1">
              <MaterialIcon name="close" style={{ fontSize: '14px' }} /> Close
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!activeBusinessId && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
            <MaterialIcon name="store_mall_directory" className="text-slate-300" style={{ fontSize: '32px' }} />
          </div>
          <p className="text-sm font-bold text-slate-400">No business selected</p>
          <p className="text-xs text-slate-400 mt-1">Please log in with a valid business code.</p>
        </div>
      )}

      {activeBusinessId && (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4 min-h-0">
          {/* Product rows */}
          <div className="overflow-y-auto no-scrollbar pb-24 lg:pb-0">
            {sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                  <MaterialIcon name="inventory" className="text-slate-300" style={{ fontSize: '32px' }} />
                </div>
                <p className="text-sm font-bold text-slate-400">No products found</p>
                <p className="text-xs text-slate-400 mt-1 font-medium">
                  {searchQuery ? `No results for "${searchQuery}"` : 'Add products in Inventory'}
                </p>
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="mt-4 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl">Clear Search</button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {sorted.map(p => (
                  <ProductTile key={p.id} product={p} onAdd={handleAddToCart} recentlyAdded={recentlyAdded.has(p.id)} />
                ))}
              </div>
            )}
          </div>

          <div className="hidden lg:block">
            <SalePanel onCheckout={completeCheckout} isCheckingOut={isCheckingOut} />
          </div>
        </div>
      )}

      {cart.length > 0 && (
        <div className="lg:hidden fixed left-3 right-3 bottom-20 z-40 bg-slate-950 text-white rounded-2xl shadow-2xl p-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{saleItemCount.toLocaleString()} item{saleItemCount === 1 ? '' : 's'} in sale</p>
            <p className="text-lg font-black tabular-nums truncate">Ksh {saleTotal.toLocaleString()}</p>
          </div>
          <button 
            onMouseDown={openMobileCheckout}
            onClick={openMobileCheckout}
            onPointerDown={openMobileCheckout}
            onTouchStart={openMobileCheckout}
            disabled={isCheckingOut}
            data-testid="mobile-checkout"
            className="px-4 py-3 bg-primary rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
          >
            {isCheckingOut ? 'Saving' : 'Checkout'}
          </button>
        </div>
      )}

      {isMobileCheckoutOpen && (
        <div className="lg:hidden fixed inset-0 z-[90] bg-slate-950/60 backdrop-blur-sm flex items-end" data-testid="mobile-checkout-sheet">
          <div className="w-full max-h-[calc(100dvh-0.75rem)] bg-white rounded-t-3xl shadow-2xl overflow-hidden pb-safe">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Checkout</p>
                <p className="text-sm font-black text-slate-900 truncate">{saleItemCount.toLocaleString()} item{saleItemCount === 1 ? '' : 's'} - Ksh {saleTotal.toLocaleString()}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.history.state?.mobileCheckout) window.history.back();
                  else setIsMobileCheckoutOpen(false);
                }}
                className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"
                aria-label="Close checkout"
              >
                <X className="w-5 h-5" strokeWidth={2.4} />
              </button>
            </div>
            <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto p-3 pb-8">
              <SalePanel
                onCheckout={completeCheckout}
                onCheckoutSuccess={() => setIsMobileCheckoutOpen(false)}
                isCheckingOut={isCheckingOut}
                className="border-0 shadow-none rounded-2xl min-h-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
