import { Archive } from 'lucide-react';
import type { CartItem, HeldOrder } from '../../store';
import RegisterPaymentPanel from './RegisterPaymentPanel';
import { CartLineItem, MaterialIcon } from './RegisterShared';
import type { RegisterCheckoutHandler } from './types';

export default function RegisterDesktop({
  activeBusinessId,
  cart,
  selectedProductCount,
  saleItemCount,
  saleTotal,
  heldOrders,
  isCheckingOut,
  onCheckout,
  onHoldOrder,
  onOpenHeldOrders,
  clearCart,
  removeFromCart,
  updateQuantity,
  setQuantity,
}: {
  activeBusinessId: string | null;
  cart: CartItem[];
  selectedProductCount: number;
  saleItemCount: number;
  saleTotal: number;
  heldOrders: HeldOrder[];
  isCheckingOut: boolean;
  onCheckout: RegisterCheckoutHandler;
  onHoldOrder: () => void;
  onOpenHeldOrders: () => void;
  clearCart: () => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, delta: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
}) {
  if (!activeBusinessId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center py-20 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-white">
          <MaterialIcon name="store_mall_directory" className="text-slate-300" style={{ fontSize: '32px' }} />
        </div>
        <p className="text-sm font-bold text-slate-400">No business selected</p>
        <p className="mt-1 text-xs text-slate-400">Please log in with a valid business code.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] flex-1 min-h-0 px-3 pb-24 pt-4 sm:px-4 md:px-6 md:pb-6 lg:px-8">
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="h-full min-h-0 overflow-y-auto no-scrollbar">
          {cart.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white py-20 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                <MaterialIcon name="shopping_cart" className="text-slate-300" style={{ fontSize: '32px' }} />
              </div>
              <p className="text-sm font-bold text-slate-500">No items yet</p>
              {heldOrders.length > 0 && (
                <button
                  type="button"
                  onClick={onOpenHeldOrders}
                  className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:border-slate-400"
                >
                  <Archive size={16} />
                  Held ({heldOrders.length})
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 rounded-lg border-2 border-slate-300 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-950">Cart</p>
                  <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    {selectedProductCount.toLocaleString()} product{selectedProductCount === 1 ? '' : 's'} / {saleItemCount.toLocaleString()} item{saleItemCount === 1 ? '' : 's'} / Ksh {saleTotal.toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={onHoldOrder} className="inline-flex h-10 items-center gap-2 rounded-lg border-2 border-amber-200 bg-amber-50 px-4 text-xs font-black text-amber-700 transition-colors hover:bg-amber-100">
                    <Archive size={16} />
                    Hold
                  </button>
                  <button type="button" onClick={onOpenHeldOrders} className="inline-flex h-10 items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-4 text-xs font-black text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-700">
                    Held ({heldOrders.length})
                  </button>
                  <button type="button" onClick={clearCart} className="h-10 rounded-lg border-2 border-rose-200 bg-white px-4 text-xs font-black text-rose-600 transition-colors hover:bg-rose-50">
                    Clear
                  </button>
                </div>
              </div>

              {cart.map(item => (
                <CartLineItem
                  key={item.id}
                  item={item}
                  onRemove={removeFromCart}
                  onDecrease={(id) => updateQuantity(id, -1)}
                  onIncrease={(id) => updateQuantity(id, 1)}
                  onQuantityChange={setQuantity}
                />
              ))}
            </div>
          )}
        </div>

        <div className="hidden h-full min-h-0 lg:block">
          <RegisterPaymentPanel onCheckout={onCheckout} isCheckingOut={isCheckingOut} showCartItems={false} />
        </div>
      </div>
    </div>
  );
}
