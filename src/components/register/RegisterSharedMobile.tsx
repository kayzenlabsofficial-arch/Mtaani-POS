import React from 'react';
import { Ban, CircleDollarSign, Minus, Package, Plus, ScanBarcode, Search, ShoppingCart, Store, X } from 'lucide-react';
import type { CartItem } from '../../store';
import { isBundleProduct } from '../../utils/bundleInventory';
import { expiryBadgeClass, getExpiryInfo } from '../../utils/expiry';
import { isLowStockProduct } from '../../utils/inventoryIntegrity';
import { productDiscountLabel, productSalePrice, productUnitDiscount } from '../../utils/productPricing';

export const MaterialIcon = ({ name, className = '', style = {} }: { name: string; className?: string; style?: React.CSSProperties }) => {
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
};

export function ProductTile({ product, onAdd, recentlyAdded }: { key?: React.Key; product: any; onAdd: (product: any) => void; recentlyAdded: boolean }) {
  const stock = product.stockQuantity || 0;
  const isOut = stock <= 0;
  const isLow = isLowStockProduct(product);
  const expiry = getExpiryInfo(product);
  const salePrice = productSalePrice(product);
  const discountLabel = productDiscountLabel(product);

  return (
    <button
      type="button"
      onClick={() => !isOut && onAdd(product)}
      disabled={isOut}
      className={`w-full rounded-lg border-2 bg-white px-3 py-3 text-left transition-all ${
        isOut
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
          : 'border-slate-200 text-slate-950 hover:border-blue-300 hover:bg-blue-50/40 active:scale-[0.997]'
      } ${recentlyAdded ? 'border-blue-500 ring-2 ring-blue-100' : ''}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="stable-title-2 text-sm font-bold leading-tight text-slate-950">{product.name}</p>
            {isBundleProduct(product) && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700">Bulk</span>}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 overflow-hidden text-[10px] font-semibold text-slate-500">
            {product.barcode && <span className="hidden font-mono sm:inline">#{product.barcode}</span>}
            <span>{product.unit || 'pcs'}</span>
            {expiry.tracking && <span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black ${expiryBadgeClass(expiry.status)}`}>{expiry.label}</span>}
          </div>
        </div>

        <div className="text-right">
          <p className="whitespace-nowrap text-sm font-black tabular-nums text-slate-950">Ksh {salePrice.toLocaleString()}</p>
          {discountLabel && <p className="text-[9px] font-black uppercase text-rose-500">{discountLabel}</p>}
          <p className={`mt-0.5 text-[10px] font-bold ${isOut ? 'text-rose-500' : isLow ? 'text-amber-600' : 'text-emerald-700'}`}>
            {isOut ? 'Out' : `${stock} left`}
          </p>
        </div>

        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isOut ? 'bg-slate-200 text-slate-400' : 'bg-slate-950 text-white'}`}>
          <MaterialIcon name={isOut ? 'block' : 'add'} style={{ fontSize: '17px' }} />
        </div>
      </div>
    </button>
  );
}

export function CartLineItem({
  item,
  onRemove,
  onDecrease,
  onIncrease,
  onQuantityChange,
  compact = false,
}: {
  key?: React.Key;
  item: CartItem;
  onRemove: (id: string) => void;
  onDecrease: (id: string) => void;
  onIncrease: (id: string) => void;
  onQuantityChange: (id: string, quantity: number) => void;
  compact?: boolean;
}) {
  const quantity = Number(item.cartQuantity) || 0;
  const unitPrice = Number(item.sellingPrice) || 0;
  const unitDiscount = productUnitDiscount(item);
  const unitSalePrice = productSalePrice(item);
  const lineTotal = unitSalePrice * quantity;
  const initials = item.name.split(' ').map((word: string) => word[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className={`border-2 border-slate-200 bg-white shadow-sm ${compact ? 'rounded-lg p-3' : 'rounded-lg p-3 sm:p-4'}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className={`grid min-w-0 items-center gap-3 ${compact ? 'grid-cols-[2.25rem_minmax(0,1fr)]' : 'grid-cols-[2.5rem_minmax(0,1fr)]'}`}>
          <div className={`${compact ? 'h-9 w-9' : 'h-10 w-10'} flex flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-xs font-black text-slate-700`}>
            {initials}
          </div>
          <div className="stable-row-copy">
            <p className={`${compact ? 'text-[13px]' : 'text-sm'} stable-title-2 font-bold leading-tight text-slate-950`}>{item.name}</p>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-[10px] font-semibold text-slate-500">
              <span className="flex-shrink-0">Ksh {unitSalePrice.toLocaleString()} each</span>
              {unitDiscount > 0 && <span className="flex-shrink-0 text-rose-500">was Ksh {unitPrice.toLocaleString()}</span>}
              {item.unit && <span className="flex-shrink-0">{item.unit}</span>}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(item.id)}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
          aria-label={`Remove ${item.name}`}
        >
          <MaterialIcon name="close" style={{ fontSize: '16px' }} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <div className="stable-actions flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button type="button" onClick={() => onDecrease(item.id)} className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-700" aria-label={`Reduce ${item.name}`}>
            <MaterialIcon name="remove" style={{ fontSize: '16px' }} />
          </button>
          <input
            type="number"
            step="any"
            value={item.cartQuantity}
            onChange={event => onQuantityChange(item.id, Number(event.target.value))}
            className={`${compact ? 'w-14' : 'w-16'} bg-transparent text-center text-sm font-black text-slate-950 outline-none`}
            aria-label={`${item.name} quantity`}
          />
          <button type="button" onClick={() => onIncrease(item.id)} className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-700" aria-label={`Add one ${item.name}`}>
            <MaterialIcon name="add" style={{ fontSize: '16px' }} />
          </button>
        </div>
        <div className="stable-actions text-right">
          <p className="text-[10px] font-bold text-slate-500">Total</p>
          <p className={`${compact ? 'text-sm' : 'text-base'} whitespace-nowrap font-black tabular-nums text-slate-950`}>
            Ksh {lineTotal.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
