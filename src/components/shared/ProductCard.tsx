import React from 'react';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export function ProductCard({ product, onAdd, recentlyAdded }: any) {
  const isOutOfStock = (product.stockQuantity || 0) <= 0;
  const isLowStock = !isOutOfStock && (product.stockQuantity || 0) <= (product.reorderPoint || 5);
  
  return (
    <div 
      onClick={() => !isOutOfStock && onAdd(product)}
      className={`bg-white rounded-3xl p-6 border-2 transition-all group relative cursor-pointer flex flex-col items-start ${recentlyAdded ? 'scale-95 border-primary shadow-inner' : 'border-slate-50 hover:border-primary/30 hover:shadow-xl hover:-translate-y-1'}`}
    >
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-colors ${isOutOfStock ? 'bg-surface-container text-outline' : 'bg-surface-container-low text-primary group-hover:bg-primary group-hover:text-white'}`}>
        <MaterialIcon name="inventory_2" className="text-2xl" />
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
         {product.isTaxable && (
           <span className="text-[9px] font-bold bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full uppercase tracking-tighter">VAT</span>
         )}
         <span className="text-[9px] font-bold bg-surface-container text-on-surface-variant px-2 py-0.5 rounded-full uppercase tracking-tighter">{product.category}</span>
      </div>

      <h3 className="text-base font-bold text-on-surface leading-tight mb-1 truncate w-full">{product.name}</h3>
      <p className="text-lg font-bold text-primary mb-4 tabular-nums">Ksh {product.sellingPrice.toLocaleString()}</p>

      <div className="mt-auto pt-4 border-t border-slate-50 w-full flex items-center justify-between">
          <div className="flex items-center gap-1.5">
             <div className={`w-1.5 h-1.5 rounded-full ${isOutOfStock ? 'bg-error' : isLowStock ? 'bg-amber-500' : 'bg-primary'}`} />
             <span className={`text-[9px] font-bold uppercase tracking-wide ${isOutOfStock ? 'text-error' : isLowStock ? 'text-amber-600' : 'text-primary'}`}>
               {isOutOfStock ? 'Out of Stock' : isLowStock ? `${product.stockQuantity} Left` : 'In Stock'}
             </span>
          </div>
      </div>

      {!isOutOfStock && (
        <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center shadow-lg">
            <MaterialIcon name="add" className="text-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
