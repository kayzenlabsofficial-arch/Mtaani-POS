import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import BarcodeScanner from '../shared/BarcodeScanner';
import { ProductCard } from '../shared/ProductCard';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: React.CSSProperties }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
);

export default function RegisterTab({ toggleCart }: { toggleCart?: (val: boolean) => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const searchRef = useRef<HTMLInputElement>(null);

  const { addToCart, activeBusinessId, activeBranchId } = useStore();

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId || !activeBranchId) return Promise.resolve([]);
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
    [searchQuery, selectedCategory, activeBusinessId, activeBranchId],
    []
  );

  const dbCategories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );

  const categories = ['All', ...(dbCategories?.map(c => c.name) || [])];

  // Sort: in-stock first, then low-stock, then out-of-stock
  const sortedProducts = [...(products || [])].sort((a, b) => {
    const stockA = a.stockQuantity || 0;
    const stockB = b.stockQuantity || 0;
    const reorderA = a.reorderPoint || 5;
    const reorderB = b.reorderPoint || 5;
    const scoreA = stockA <= 0 ? 2 : stockA <= reorderA ? 1 : 0;
    const scoreB = stockB <= 0 ? 2 : stockB <= reorderB ? 1 : 0;
    return scoreA - scoreB;
  });

  const handleAddToCart = (product: any) => {
    if ((product.stockQuantity || 0) <= 0) return;
    addToCart(product);
    setRecentlyAdded(prev => new Set([...prev, product.id]));
    setTimeout(() => {
      setRecentlyAdded(prev => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }, 600);
  };

  const inStockCount = products?.filter(p => (p.stockQuantity || 0) > 0).length || 0;
  const outOfStockCount = products?.filter(p => (p.stockQuantity || 0) <= 0).length || 0;

  return (
    <div className="flex flex-col h-full animate-in fade-in">

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-black text-slate-900">Product Catalog</h2>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
            {inStockCount} available · <span className="text-rose-500">{outOfStockCount} out of stock</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 md:w-72 group">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
              <MaterialIcon name="search" style={{ fontSize: '18px' }} />
            </div>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search name or barcode..."
              className="w-full pl-10 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none transition-all shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <MaterialIcon name="close" style={{ fontSize: '16px' }} />
              </button>
            )}
          </div>

          {/* Barcode scanner toggle */}
          <button
            onClick={() => setIsScannerOpen(v => !v)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-[11px] uppercase tracking-widest transition-all border flex-shrink-0 ${
              isScannerOpen
                ? 'bg-primary text-white border-primary shadow-lg shadow-primary/20'
                : 'bg-white text-slate-600 border-slate-200 hover:border-primary/30 hover:text-primary'
            }`}
          >
            <MaterialIcon name="barcode_scanner" style={{ fontSize: '18px' }} />
            <span className="hidden sm:block">Scan</span>
          </button>

          {/* Grid / List view toggle */}
          <div className="flex bg-slate-100 p-1 rounded-xl gap-0.5">
            {(['grid', 'list'] as const).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`p-2 rounded-lg transition-all ${viewMode === v ? 'bg-white shadow text-primary' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <MaterialIcon name={v === 'grid' ? 'grid_view' : 'list'} style={{ fontSize: '18px' }} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-4 flex-shrink-0">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all flex-shrink-0 border ${
              selectedCategory === cat
                ? 'bg-primary text-white border-primary shadow-md'
                : 'bg-white border-slate-200 text-slate-600 hover:border-primary/40 hover:text-primary'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Scanner overlay */}
      {isScannerOpen && (
        <div className="mb-4 flex-shrink-0">
          <div className="bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden relative">
            <div className="relative aspect-video max-h-52">
              <BarcodeScanner onScan={(barcode) => {
                const p = products?.find(prod => prod.barcode === barcode);
                if (p) {
                  handleAddToCart(p);
                  setIsScannerOpen(false);
                }
              }} />
              <div className="absolute inset-0 border border-white/10 rounded-xl pointer-events-none" />
              <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-primary/60 shadow-[0_0_12px_rgba(37,99,235,0.8)] animate-pulse" />
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-t border-slate-800">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Point camera at barcode</p>
              <button
                onClick={() => setIsScannerOpen(false)}
                className="text-[10px] font-bold text-slate-500 hover:text-rose-400 uppercase tracking-widest flex items-center gap-1"
              >
                <MaterialIcon name="close" style={{ fontSize: '14px' }} />
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Products grid / list */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-24">
        {sortedProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-4">
              <MaterialIcon name="inventory" className="text-slate-300" style={{ fontSize: '40px' }} />
            </div>
            <p className="text-base font-bold text-slate-400">No products found</p>
            <p className="text-sm text-slate-400 mt-1 font-medium">
              {searchQuery ? `No results for "${searchQuery}"` : 'Add products in Inventory'}
            </p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-4 px-4 py-2 bg-primary text-white text-sm font-bold rounded-xl"
              >
                Clear Search
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
            {sortedProducts.map(product => (
              <div key={product.id} className="group">
                <ProductCard
                  product={product}
                  onAdd={handleAddToCart}
                  recentlyAdded={recentlyAdded.has(product.id)}
                />
              </div>
            ))}
          </div>
        ) : (
          /* List view */
          <div className="space-y-2">
            {sortedProducts.map(product => {
              const stock = product.stockQuantity || 0;
              const isOut = stock <= 0;
              const isLow = !isOut && stock <= (product.reorderPoint || 5);
              return (
                <div
                  key={product.id}
                  onClick={() => !isOut && handleAddToCart(product)}
                  className={`flex items-center gap-4 bg-white border rounded-xl px-4 py-3 transition-all ${
                    isOut
                      ? 'opacity-60 cursor-not-allowed border-slate-100'
                      : 'cursor-pointer border-slate-100 hover:border-primary/30 hover:shadow-sm active:scale-[0.99]'
                  } ${recentlyAdded.has(product.id) ? 'border-primary/40 shadow' : ''}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isOut ? 'bg-slate-100 text-slate-300' : 'bg-primary/8 text-primary'}`}>
                    <MaterialIcon name="inventory_2" style={{ fontSize: '20px' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{product.name}</p>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{product.category}</p>
                  </div>
                  {product.barcode && (
                    <span className="text-[9px] font-mono text-slate-400 hidden md:block">{product.barcode}</span>
                  )}
                  <span className={`text-[9px] font-black px-2 py-1 rounded-full border flex-shrink-0 ${
                    isOut ? 'bg-rose-50 text-rose-600 border-rose-100' : isLow ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                  }`}>
                    {isOut ? 'Out of Stock' : isLow ? `${stock} left` : `${stock} in stock`}
                  </span>
                  <p className="text-sm font-black text-slate-900 tabular-nums flex-shrink-0">
                    Ksh {product.sellingPrice?.toLocaleString()}
                  </p>
                  {!isOut && (
                    <div className="w-8 h-8 rounded-lg bg-primary/8 text-primary flex items-center justify-center flex-shrink-0 hover:bg-primary hover:text-white transition-colors">
                      <MaterialIcon name="add" style={{ fontSize: '18px' }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
