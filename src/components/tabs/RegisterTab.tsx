import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import BarcodeScanner from '../shared/BarcodeScanner';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: React.CSSProperties }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
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
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl ${color} flex items-center justify-center flex-shrink-0 text-white text-xs font-black shadow-sm`}>
          {initials}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-[13px] sm:text-sm font-black text-slate-900 truncate group-hover:text-primary transition-colors">{product.name}</p>
            {product.isTaxable && (
              <span className="hidden sm:inline-flex text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">VAT</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-x-2 gap-y-1 flex-wrap text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <span className="truncate max-w-[120px] sm:max-w-none">{product.category || 'General'}</span>
            {product.barcode && <span className="font-mono normal-case tracking-normal text-slate-500">#{product.barcode}</span>}
            <span>{product.unit || 'pcs'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
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
            <p className="text-sm sm:text-base font-black text-slate-900 tabular-nums whitespace-nowrap">
              Ksh {product.sellingPrice?.toLocaleString()}
            </p>
            <p className={`text-[9px] font-black uppercase sm:hidden ${isOut ? 'text-rose-500' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
              {isOut ? 'Out' : `${stock} left`}
            </p>
          </div>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
            isOut ? 'bg-slate-200 text-slate-400' : 'bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white'
          }`}>
            <MaterialIcon name={isOut ? 'block' : 'add'} style={{ fontSize: '18px' }} />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function RegisterTab({ toggleCart }: { toggleCart?: (val: boolean) => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const scrollRef = useHorizontalScroll();

  // ✅ Only require activeBusinessId — branch does not filter products
  const { addToCart, activeBusinessId } = useStore();

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

  const categories = ['All', ...(dbCategories?.map(c => c.name) || [])];

  // Sort: in-stock → low-stock → out-of-stock
  const sorted = [...(products || [])].sort((a, b) => {
    const score = (p: any) => {
      const q = p.stockQuantity || 0;
      if (q <= 0) return 2;
      if (q <= (p.reorderPoint || 5)) return 1;
      return 0;
    };
    return score(a) - score(b);
  });

  const handleAddToCart = (product: any) => {
    if ((product.stockQuantity || 0) <= 0) return;
    addToCart(product);
    setRecentlyAdded(prev => new Set([...prev, product.id]));
    setTimeout(() => setRecentlyAdded(prev => { const n = new Set(prev); n.delete(product.id); return n; }), 600);
  };

  const inStock = products?.filter(p => (p.stockQuantity || 0) > 0).length || 0;
  const outOfStock = products?.filter(p => (p.stockQuantity || 0) <= 0).length || 0;

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
              const p = products?.find(prod => prod.barcode === barcode);
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

      {/* Product rows */}
      {activeBusinessId && (
        <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
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
      )}
    </div>
  );
}
