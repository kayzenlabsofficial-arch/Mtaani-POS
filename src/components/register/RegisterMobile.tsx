import type React from 'react';
import { X } from 'lucide-react';
import type { CartItem } from '../../store';
import MobileModal from '../shared/MobileModal';
import RegisterPaymentPanel from './RegisterPaymentPanelMobile';
import type { RegisterCheckoutHandler } from './types';

export default function RegisterMobile({
  cart,
  saleItemCount,
  saleTotal,
  isCheckingOut,
  isMobileCheckoutOpen,
  onOpenMobileCheckout,
  onCloseMobileCheckout,
  onCheckout,
}: {
  cart: CartItem[];
  saleItemCount: number;
  saleTotal: number;
  isCheckingOut: boolean;
  isMobileCheckoutOpen: boolean;
  onOpenMobileCheckout: (event?: React.SyntheticEvent) => void;
  onCloseMobileCheckout: () => void;
  onCheckout: RegisterCheckoutHandler;
}) {
  return (
    <>
      {cart.length > 0 && (
        <div className="keyboard-hide-when-open fixed bottom-20 left-3 right-3 z-40 flex items-center gap-3 rounded-lg border-2 border-slate-300 bg-white p-3 text-slate-950 shadow-xl">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{saleItemCount.toLocaleString()} item{saleItemCount === 1 ? '' : 's'} in sale</p>
            <p className="truncate text-lg font-black tabular-nums">Ksh {saleTotal.toLocaleString()}</p>
          </div>
          <button
            onMouseDown={onOpenMobileCheckout}
            onClick={onOpenMobileCheckout}
            onPointerDown={onOpenMobileCheckout}
            onTouchStart={onOpenMobileCheckout}
            disabled={isCheckingOut}
            aria-busy={isCheckingOut}
            data-busy={isCheckingOut ? 'true' : undefined}
            data-testid="mobile-checkout"
            className="rounded-lg border-2 border-blue-700 bg-blue-600 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white disabled:border-slate-500 disabled:bg-slate-400"
          >
            {isCheckingOut ? 'Saving' : 'Checkout'}
          </button>
        </div>
      )}

      {isMobileCheckoutOpen && (
        <MobileModal
          onClose={onCloseMobileCheckout}
          closeOnBackdrop={!isCheckingOut}
          zIndexClassName="z-[90]"
          size="full"
          dataTestId="mobile-checkout-sheet"
          panelClassName="rounded-t-lg border-x-0 border-b-0 border-t-2 border-slate-300"
          bodyClassName="p-3"
          header={(
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Checkout</p>
                <p className="truncate text-sm font-black text-slate-900">{saleItemCount.toLocaleString()} item{saleItemCount === 1 ? '' : 's'} - Ksh {saleTotal.toLocaleString()}</p>
              </div>
              <button
                type="button"
                onClick={onCloseMobileCheckout}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-600"
                aria-label="Close checkout"
              >
                <X className="h-5 w-5" strokeWidth={2.4} />
              </button>
            </div>
          )}
        >
            <div className="h-full min-h-[26rem]">
              <RegisterPaymentPanel
                onCheckout={onCheckout}
                onCheckoutSuccess={onCloseMobileCheckout}
                isCheckingOut={isCheckingOut}
                showCartItems={false}
                className="h-full max-h-full min-h-0 rounded-lg border-0 shadow-none"
              />
            </div>
        </MobileModal>
      )}
    </>
  );
}
