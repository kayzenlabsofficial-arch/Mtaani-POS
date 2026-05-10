import React from 'react';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: React.CSSProperties }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
);

const PAYMENT_ICONS: Record<string, string> = {
  VAT: 'receipt',
};

interface ProductCardProps {
  product: any;
  onAdd: (p: any) => void;
  recentlyAdded?: boolean;
}

export function ProductCard({ product, onAdd, recentlyAdded }: ProductCardProps) {
  const stock = product.stockQuantity || 0;
  const isOutOfStock = stock <= 0;
  const isLowStock = !isOutOfStock && stock <= (product.reorderPoint || 5);

  const stockColor = isOutOfStock
    ? 'text-rose-600 bg-rose-50 border-rose-100'
    : isLowStock
    ? 'text-amber-600 bg-amber-50 border-amber-100'
    : 'text-emerald-600 bg-emerald-50 border-emerald-100';

  const stockDot = isOutOfStock ? 'bg-rose-500' : isLowStock ? 'bg-amber-500' : 'bg-emerald-500';

  const stockLabel = isOutOfStock
    ? 'Out of Stock'
    : isLowStock
    ? `Low — ${stock} left`
    : `${stock} in stock`;

  return (
    <div
      onClick={() => !isOutOfStock && onAdd(product)}
      className={`
        relative flex flex-col bg-white border rounded-2xl p-4 transition-all duration-200 select-none
        ${isOutOfStock
          ? 'opacity-60 cursor-not-allowed border-slate-100'
          : 'cursor-pointer border-slate-100 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 active:scale-[0.98]'
        }
        ${recentlyAdded ? 'scale-95 border-primary/50 shadow-primary/10 shadow-md' : ''}
      `}
    >
      {/* Top: Category tag + VAT badge */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-0.5 rounded-full border border-slate-100">
          {product.category || 'General'}
        </span>
        {product.isTaxable && (
          <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
            VAT
          </span>
        )}
      </div>

      {/* Product icon */}
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors flex-shrink-0 ${
        isOutOfStock
          ? 'bg-slate-100 text-slate-300'
          : 'bg-primary/8 text-primary'
      }`}>
        <MaterialIcon name="inventory_2" style={{ fontSize: '24px' }} />
      </div>

      {/* Name */}
      <h3 className="text-[13px] font-bold text-slate-900 leading-tight mb-0.5 line-clamp-2 flex-1">
        {product.name}
      </h3>

      {/* Barcode if present */}
      {product.barcode && (
        <p className="text-[9px] font-mono text-slate-400 mb-2 truncate">{product.barcode}</p>
      )}

      {/* Price */}
      <p className="text-base font-black text-primary tabular-nums mt-1">
        Ksh {product.sellingPrice?.toLocaleString()}
      </p>

      {/* Stock badge */}
      <div className={`mt-3 pt-3 border-t border-slate-50 flex items-center gap-1.5`}>
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${stockDot} ${isLowStock || isOutOfStock ? 'animate-pulse' : ''}`} />
        <span className={`text-[9px] font-bold uppercase tracking-wide ${
          isOutOfStock ? 'text-rose-500' : isLowStock ? 'text-amber-600' : 'text-emerald-600'
        }`}>
          {stockLabel}
        </span>
      </div>

      {/* Add overlay icon on hover */}
      {!isOutOfStock && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="w-7 h-7 bg-primary rounded-full flex items-center justify-center shadow-md shadow-primary/30">
            <MaterialIcon name="add" className="text-white" style={{ fontSize: '16px' }} />
          </div>
        </div>
      )}

      {/* Out of stock overlay */}
      {isOutOfStock && (
        <div className="absolute inset-0 rounded-2xl flex items-end justify-center pb-3 pointer-events-none">
          <div className="bg-slate-900/70 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full backdrop-blur-sm">
            Out of Stock
          </div>
        </div>
      )}
    </div>
  );
}
