import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, ShoppingCart, Zap, AlertTriangle, Store, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Plus, RotateCcw, Tag as TagIcon, ScanLine, User, ChevronDown, SlidersHorizontal, Trash2, BadgePercent, ChevronRight, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import BarcodeScanner from '../shared/BarcodeScanner';
import { SearchableSelect } from '../shared/SearchableSelect';
import NestedControlPanel from '../shared/NestedControlPanel';

const ICON_MAP: Record<string, React.ElementType> = {
  Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Tag: TagIcon, Store
};

const COLOR_MAP: Record<string, { color: string; bg: string; border: string; light: string }> = {
  orange: { color: 'text-orange-700', bg: 'bg-orange-600', border: 'border-orange-600', light: 'bg-orange-50' },
  blue:   { color: 'text-blue-700',   bg: 'bg-blue-600',   border: 'border-blue-600',   light: 'bg-blue-50'   },
  purple: { color: 'text-purple-700', bg: 'bg-purple-600', border: 'border-purple-600', light: 'bg-purple-50' },
  yellow: { color: 'text-yellow-700', bg: 'bg-yellow-500', border: 'border-yellow-500', light: 'bg-yellow-50' },
  slate:  { color: 'text-slate-600',  bg: 'bg-slate-600',  border: 'border-slate-600',  light: 'bg-slate-50'  },
  green:  { color: 'text-green-700',  bg: 'bg-green-600',  border: 'border-green-600',  light: 'bg-green-50'  },
  red:    { color: 'text-red-700',    bg: 'bg-red-600',    border: 'border-red-600',    light: 'bg-red-50'    },
};

const DEFAULT_CONFIG = { icon: Package, color: 'text-slate-600', bg: 'bg-slate-600', border: 'border-slate-600', light: 'bg-slate-50' };

export default function RegisterTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<{ found: boolean; name: string } | null>(null);
  
  const scanBufferRef = useRef('');
  const scanTimerRef = useRef<number | null>(null);
  
  const scannerDebounceMs = React.useMemo(() => {
    try {
      const raw = localStorage.getItem('mtaani_hardware_profile_v1');
      if (!raw) return 120;
      const parsed = JSON.parse(raw);
      return Number(parsed.scannerDebounceMs) || 120;
    } catch {
      return 120;
    }
  }, []);

  const { 
    addToCart, 
    clearCart, 
    cart, 
    selectedCustomerId, 
    setSelectedCustomerId, 
    activeBusinessId, 
    activeBranchId, 
    activeShift, 
    isAdmin 
  } = useStore();

  const allProducts = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );
  
  const allCustomers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), 
    [activeBusinessId], 
    []
  );
  
  const selectedCustomer = allCustomers?.find(c => c.id === selectedCustomerId);

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId || !activeBranchId) return Promise.resolve([]);
      let query = db.products.where('businessId').equals(activeBusinessId);
      
      if (selectedCategory !== 'All') {
        return query.filter(p => p.category === selectedCategory && (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.barcode.includes(searchQuery))).toArray();
      }
      
      return query.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.barcode.includes(searchQuery)).toArray();
    },
    [searchQuery, selectedCategory, activeBusinessId, activeBranchId],
    []
  );

  const dbCategories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  
  const categories = ['All', ...(dbCategories?.map(c => c.name) || [])];

  const getCategoryConfig = (categoryName: string) => {
    if (categoryName === 'All') return { icon: Store, color: 'text-slate-700', bg: 'bg-slate-900', border: 'border-slate-900', light: 'bg-slate-50' };
    const cat = dbCategories?.find(c => c.name === categoryName);
    if (!cat) return DEFAULT_CONFIG;
    return {
        icon: ICON_MAP[cat.iconName] || Package,
        ...COLOR_MAP[cat.color] || COLOR_MAP.slate
    };
  };

  const calculateVirtualStock = (product: any) => {
      if (!product.isBundle || !product.components?.length) return product.stockQuantity || 0;
      if (!allProducts || allProducts.length === 0) return 0;

      let minStock = Infinity;
      for (const comp of product.components) {
         const freshComp = allProducts.find(p => String(p.id) === String(comp.productId));
         if (!freshComp) return 0;
         const compQty = Number(comp.quantity) || 0;
         if (compQty <= 0) continue;
         const availableStock = freshComp.isBundle ? calculateVirtualStock(freshComp) : (Number(freshComp.stockQuantity) || 0);
         const possible = Math.floor(availableStock / compQty);
         if (possible < minStock) minStock = possible;
      }
      return minStock === Infinity ? 0 : minStock;
  };

  const handleAddToCart = useCallback((product: any) => {
    addToCart(product);
    setRecentlyAdded(prev => {
      const next = new Set(prev);
      next.add(product.id);
      setTimeout(() => {
        setRecentlyAdded(s => { const n = new Set(s); n.delete(product.id); return n; });
      }, 380);
      return next;
    });
  }, [addToCart]);

  const handleScanResult = useCallback(async (barcode: string) => {
    const all = allProducts || [];
    const found = all.find(p => p.barcode === barcode || p.barcode.trim() === barcode.trim());
    if (found) {
      if (found.stockQuantity <= 0) {
        setScanFeedback({ found: false, name: `${found.name} — Out of stock!` });
      } else {
        handleAddToCart(found);
        setScanFeedback({ found: true, name: found.name });
      }
    } else {
      setScanFeedback({ found: false, name: `No product with barcode: ${barcode}` });
    }
    setTimeout(() => setScanFeedback(null), 3000);
  }, [handleAddToCart, allProducts]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (e.key === 'Enter') {
        const code = scanBufferRef.current.trim();
        scanBufferRef.current = '';
        if (code.length >= 4) void handleScanResult(code);
        return;
      }
      if (/^[a-zA-Z0-9\-]$/.test(e.key)) {
        scanBufferRef.current += e.key;
        if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
        scanTimerRef.current = window.setTimeout(() => {
          scanBufferRef.current = '';
        }, scannerDebounceMs);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    };
  }, [handleScanResult, scannerDebounceMs]);

  const lowStockProducts = (products || []).filter(p => {
    const vStock = calculateVirtualStock(p);
    return vStock > 0 && vStock <= 5;
  });

  return (
    <div className="pb-4 bg-transparent min-h-full">
      
      {/* Control Center Header */}
      <div className="px-4 pt-2">
        <div className="flex items-center justify-between mb-4">
           <h2 className="text-xl font-black text-slate-900 tracking-tight">Register</h2>
           <button 
             onClick={() => setIsControlCenterOpen(!isControlCenterOpen)}
             className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isControlCenterOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
           >
             <SlidersHorizontal size={18} />
             <span className="text-[10px] font-black uppercase">Controls</span>
           </button>
        </div>

        {isControlCenterOpen && (
          <div className="mb-4 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Register Configuration"
               subtitle="Manage scanner, customers, and active session"
               onClose={() => setIsControlCenterOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Customer Context</h4>
                      <div className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all ${selectedCustomer ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-transparent'}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedCustomer ? 'bg-indigo-600 text-white shadow-indigo' : 'bg-white text-slate-300'}`}>
                          <User size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <SearchableSelect
                            value={selectedCustomerId ?? ''}
                            onChange={(v) => setSelectedCustomerId(v || null)}
                            placeholder="Walk-in customer"
                            options={(allCustomers || []).map(c => ({
                              value: c.id,
                              label: `${c.name} (${c.phone})`,
                              keywords: `${c.name} ${c.phone}`,
                            }))}
                            className="w-full"
                            buttonClassName="bg-transparent border-none p-0 rounded-none text-sm font-black text-slate-900"
                            searchInputClassName="bg-white"
                          />
                          {selectedCustomer && <p className="text-[9px] font-bold text-indigo-600 mt-0.5">Ksh {selectedCustomer.balance.toLocaleString()} balance</p>}
                        </div>
                        {selectedCustomer && (
                          <button onClick={() => setSelectedCustomerId(null)} className="w-8 h-8 rounded-lg bg-white/50 text-indigo-600 flex items-center justify-center hover:bg-white transition-all">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                   </div>

                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Session Actions</h4>
                      <div className="grid grid-cols-2 gap-2">
                         <button 
                           onClick={() => { setIsScannerOpen(true); setIsControlCenterOpen(false); }}
                           className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group"
                         >
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                               <ScanLine size={18} />
                            </div>
                            <span className="text-[10px] font-black text-slate-900">OPEN SCANNER</span>
                         </button>
                         <button 
                           onClick={() => { if(confirm("Clear current cart?")) clearCart(); }}
                           disabled={cart.length === 0}
                           className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 border-slate-100 hover:border-rose-300 hover:bg-rose-50/30 transition-all group disabled:opacity-40 disabled:hover:border-slate-100 disabled:hover:bg-transparent"
                         >
                            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                               <RotateCcw size={18} />
                            </div>
                            <span className="text-[10px] font-black text-slate-900">CLEAR CART</span>
                         </button>
                      </div>
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      {/* Shift Warning */}
      {!activeShift && !isAdmin && (
        <div className="mx-4 mb-4 bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-4 flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
          <div className="w-12 h-12 bg-indigo-600 text-white rounded-[1.25rem] flex items-center justify-center shrink-0 shadow-indigo ring-4 ring-indigo-500/10">
            <ShoppingCart size={20} />
          </div>
          <div>
            <p className="text-sm font-black text-indigo-900">Shift Required</p>
            <p className="text-[10px] font-bold text-indigo-600 mt-0.5 uppercase tracking-wide">Please open a shift in the Dashboard to start selling.</p>
          </div>
        </div>
      )}

      {/* Inline Scanner */}
      {isScannerOpen && (
        <div className="px-4 mb-4 animate-in slide-in-from-top-4 duration-300">
           <div className="rounded-[2.5rem] overflow-hidden border-2 border-indigo-600 shadow-indigo ring-8 ring-indigo-500/5">
              <BarcodeScanner 
                isInline={true}
                onScan={handleScanResult}
                onClose={() => setIsScannerOpen(false)}
              />
           </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="px-4 pb-4">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
            <input
              type="text"
              placeholder="Search products by name or barcode..."
              className="w-full pl-12 pr-4 py-4 bg-white rounded-[1.5rem] border-2 border-slate-100 text-sm text-slate-800 font-bold shadow-sm focus:outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all">
                <X size={14} />
              </button>
            )}
          </div>
          
          <div className="flex overflow-x-auto gap-2 no-scrollbar pb-1 md:pb-0">
            {categories.map(cat => {
              const cfg = getCategoryConfig(cat);
              const isActive = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all border-2 press ${
                    isActive
                      ? `${cfg.bg} text-white ${cfg.border} shadow-lg shadow-black/5`
                      : `bg-white border-slate-100 text-slate-400 hover:border-slate-200 hover:bg-slate-50`
                  }`}
                >
                  <cfg.icon size={16} className={isActive ? 'text-white' : cfg.color} />
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scan feedback toast */}
        {scanFeedback && (
          <div className={`mt-3 px-5 py-3 rounded-2xl flex items-center gap-3 text-xs font-black animate-in slide-in-from-top-2 duration-200 shadow-sm border-2 ${
            scanFeedback.found
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}>
            {scanFeedback.found ? <Check size={18} /> : <AlertTriangle size={18} />}
            <span className="uppercase tracking-wide">{scanFeedback.name}</span>
          </div>
        )}
      </div>

      {/* Critical low stock warning */}
      {lowStockProducts.length > 0 && (
        <div className="mx-4 mb-4 bg-amber-50 border-2 border-amber-100 rounded-2xl px-5 py-3 flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
             <AlertTriangle size={16} />
          </div>
          <p className="text-[10px] font-black text-amber-800 uppercase tracking-wide">
            {lowStockProducts.length} item{lowStockProducts.length > 1 ? 's' : ''} critically low stock (≤5 units)
          </p>
        </div>
      )}

      {/* Product Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 px-4 pb-32">
        {(products || []).map(product => {
          const cfg = getCategoryConfig(product.category);
          const displayStock = calculateVirtualStock(product);
          const isFlashing = recentlyAdded.has(product.id);
          const isOutOfStock = displayStock <= 0;
          const isCritical = displayStock > 0 && displayStock <= 5;
          const isLow = displayStock > 5 && displayStock <= 10;
          const cartItem = cart.find(i => i.id === product.id);
          const qtyInCart = cartItem ? cartItem.cartQuantity : 0;

          return (
            <div
              key={product.id}
              onClick={() => !isOutOfStock && handleAddToCart(product)}
              className={`group bg-white rounded-[2rem] border-2 flex flex-col p-5 gap-4 transition-all relative overflow-hidden
                ${isOutOfStock ? 'opacity-50 grayscale cursor-not-allowed border-slate-100' : 'cursor-pointer border-slate-100 hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 active:scale-[0.98]'}
                ${isFlashing ? 'ring-4 ring-indigo-500/20 bg-indigo-50/30' : ''}
              `}
            >
              <div className="flex justify-between items-start">
                 <div className={`w-12 h-12 rounded-[1.25rem] flex items-center justify-center ${cfg.light} ${cfg.color} group-hover:scale-110 transition-transform`}>
                    <cfg.icon size={24} />
                 </div>
                 {qtyInCart > 0 && (
                   <div className="bg-indigo-600 text-white text-[10px] font-black min-w-[24px] h-6 px-2 rounded-full flex items-center justify-center border-2 border-white shadow-indigo animate-bounce-in">
                      {qtyInCart}
                   </div>
                 )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                   <h4 className="text-base font-black text-slate-900 truncate leading-tight">
                     {product.name}
                   </h4>
                   {product.taxCategory === 'C' && (
                     <span className="shrink-0 bg-emerald-100 text-emerald-700 text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-tighter">
                       E-Tax
                     </span>
                   )}
                </div>
                
                <div className="flex items-baseline gap-1.5 mb-3">
                   <span className="text-lg font-black text-slate-900">
                     Ksh {product.sellingPrice.toLocaleString()}
                   </span>
                   <span className="text-[10px] font-bold text-slate-400">/ {product.unit || 'pcs'}</span>
                </div>

                <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                  isOutOfStock ? 'bg-rose-50 text-rose-600' :
                  isCritical  ? 'bg-rose-50 text-rose-600' :
                  isLow       ? 'bg-amber-50 text-amber-600' :
                                'bg-slate-50 text-slate-500'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isOutOfStock ? 'bg-rose-500' :
                    isCritical  ? 'bg-rose-500 animate-pulse' :
                    isLow       ? 'bg-amber-500' :
                                  'bg-slate-300'
                  }`} />
                  {isOutOfStock ? 'Out of Stock' : `${displayStock} in stock`}
                </div>
              </div>

              {product.isBundle && (
                 <div className="mt-auto pt-4 border-t border-slate-50 flex flex-wrap gap-2">
                    {product.components?.map((c: any, i: number) => {
                       const p = allProducts?.find(x => String(x.id) === String(c.productId));
                       const hasStock = p ? p.stockQuantity >= c.quantity : false;
                       return (
                          <div key={i} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border ${hasStock ? 'bg-slate-50 border-slate-100' : 'bg-rose-50 border-rose-100'}`}>
                             <span className={`text-[8px] font-black ${hasStock ? 'text-slate-500' : 'text-rose-600'}`}>
                                {p?.name || 'Item'}: {p?.stockQuantity || 0}
                             </span>
                          </div>
                       );
                    })}
                 </div>
              )}

              <button className={`mt-4 w-full py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                isOutOfStock ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-indigo-600 shadow-lg active:scale-95'
              }`}>
                 {isFlashing ? <Zap size={14} className="animate-pulse" /> : <Plus size={16} />}
                 {isOutOfStock ? 'Unavailable' : 'Add to sale'}
              </button>
            </div>
          );
        })}

        {(products || []).length === 0 && (
          <div className="col-span-full py-24 text-center flex flex-col items-center">
            <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner">
              <Search size={40} className="text-slate-200" />
            </div>
            <p className="text-slate-500 font-black text-lg">No results found</p>
            <p className="text-slate-400 text-xs mt-1 font-bold uppercase tracking-widest">
              Try adjusting your filters or search terms
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
