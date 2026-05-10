import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Search, ShoppingCart, Zap, AlertTriangle, Store, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Plus, RotateCcw, Tag as TagIcon, ScanLine, User, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import BarcodeScanner from '../shared/BarcodeScanner';
import { SearchableSelect } from '../shared/SearchableSelect';

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
  const [isSalesControlsOpen, setIsSalesControlsOpen] = useState(false);
  const [isCustomerControlsOpen, setIsCustomerControlsOpen] = useState(false);
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
  const addToCart = useStore((state) => state.addToCart);
  const clearCart = useStore((state) => state.clearCart);
  const cart = useStore((state) => state.cart);
  const { success: toastSuccess, error: toastError } = useStore.getState ? {} : {};
  const { selectedCustomerId, setSelectedCustomerId, activeBusinessId, activeBranchId, activeShift, isAdmin } = useStore();
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );
  const allCustomers = useLiveQuery(() => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []);
  const selectedCustomer = allCustomers?.find(c => c.id === selectedCustomerId);

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId || !activeBranchId) return Promise.resolve([]);
      let query = db.products.where('businessId').equals(activeBusinessId);
      
      // If branch-specific stock is needed, we could filter by branchId here
      // .and(p => !p.branchId || p.branchId === activeBranchId)
      
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
      
      // If we are still loading products, return a placeholder
      if (!allProducts || allProducts.length === 0) return 0;

      let minStock = Infinity;
      for (const comp of product.components) {
         // Fix: Use String comparison to handle cases where ID might be Number vs String
         const freshComp = allProducts.find(p => String(p.id) === String(comp.productId));
         
         if (!freshComp) {
            return 0; // Component missing
         }
         
         const compQty = Number(comp.quantity) || 0;
         if (compQty <= 0) continue;

         // Check if component is also a bundle (recursive)
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
        // DO NOT close scanner — allow continuous scanning
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
    <div className="pb-4 bg-transparent min-h-full text-slate-800">
      
      {/* Shift Warning */}
      {!activeShift && !isAdmin && (
        <div className="mx-4 mt-4 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="w-8 h-8 bg-blue-600 text-white rounded-xl flex items-center justify-center shrink-0 shadow-blue">
            <ShoppingCart size={16} />
          </div>
          <div>
            <p className="text-xs font-black text-blue-900">Shift Required</p>
            <p className="text-[10px] font-bold text-blue-600  ">Please open a shift in the Command Center to start selling.</p>
          </div>
        </div>
      )}


      {/* Inline Scanner */}
      {isScannerOpen && (
        <div className="px-4 animate-in slide-in-from-top duration-300">
           <BarcodeScanner 
             isInline={true}
             onScan={handleScanResult}
             onClose={() => setIsScannerOpen(false)}
           />
        </div>
      )}
      {/* Customer Selection */}
      <div className="px-4 pt-4">
        <div className="relative group">
          <div className={`flex items-center gap-3 p-3 rounded-2xl border-2 transition-all cursor-pointer ${
            selectedCustomer ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-100 hover:border-slate-200'
          }`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              selectedCustomer ? 'bg-blue-600 text-white shadow-blue' : 'bg-slate-50 text-slate-400'
            }`}>
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
                menuClassName="mt-3"
              />
               <p className="text-[10px] font-bold text-slate-400   leading-none mt-1">
                 {selectedCustomer ? `Ksh ${selectedCustomer.balance.toLocaleString()} balance` : 'Select client to link sale'}
               </p>
            </div>
          </div>
        </div>
      </div>
      {/* Search bar */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              placeholder="Search products..."
              className="w-full pl-11 pr-4 py-3.5 bg-white rounded-2xl border border-slate-200 text-sm text-slate-800 font-medium shadow-card focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg font-bold leading-none">
                ×
              </button>
            )}
          </div>
          <button
            onClick={() => setIsScannerOpen(true)}
            className="shrink-0 w-12 h-12 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/30 hover:bg-blue-700 active:scale-95 transition-all"
            title="Scan Barcode"
          >
            <ScanLine size={20} />
          </button>
        </div>

        {/* Scan feedback toast */}
        {scanFeedback && (
          <div className={`mt-2 px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm font-bold animate-in slide-in-from-top-2 duration-200 ${
            scanFeedback.found
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {scanFeedback.found ? <Zap size={16} /> : <AlertTriangle size={16} />}
            {scanFeedback.name}
          </div>
        )}
      </div>

      {/* Nested controls for cleaner mobile and cashier flow */}
      <div className="px-4 pb-3 space-y-2">
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <button
            onClick={() => setIsSalesControlsOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
                <SlidersHorizontal size={16} />
              </div>
              <div>
                <p className="text-xs font-black text-slate-900">Sales Controls</p>
                <p className="text-[10px] font-bold text-slate-400">Scanner, cart reset, quick actions</p>
              </div>
            </div>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isSalesControlsOpen ? 'rotate-180' : ''}`} />
          </button>
          {isSalesControlsOpen && (
            <div className="border-t border-slate-100 p-3 grid grid-cols-2 gap-2 bg-slate-50">
              <button
                onClick={() => setIsScannerOpen(true)}
                className="px-3 py-2.5 rounded-xl bg-blue-600 text-white text-[10px] font-black hover:bg-blue-700 transition-colors"
              >
                Open Scanner
              </button>
              <button
                onClick={() => clearCart()}
                disabled={cart.length === 0}
                className="px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black disabled:opacity-50"
              >
                Clear Cart
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <button
            onClick={() => setIsCustomerControlsOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <User size={16} />
              </div>
              <div>
                <p className="text-xs font-black text-slate-900">Customer Controls</p>
                <p className="text-[10px] font-bold text-slate-400">Select, clear, and quick customer context</p>
              </div>
            </div>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${isCustomerControlsOpen ? 'rotate-180' : ''}`} />
          </button>
          {isCustomerControlsOpen && (
            <div className="border-t border-slate-100 p-3 bg-slate-50">
              <button
                onClick={() => setSelectedCustomerId(null)}
                disabled={!selectedCustomerId}
                className="w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 text-[10px] font-black disabled:opacity-50"
              >
                Clear Customer Link
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Critical low stock warning */}
      {lowStockProducts.length > 0 && (
        <div className="mx-4 mb-2 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
          <AlertTriangle size={16} className="text-amber-600 shrink-0" />
          <span className="text-xs font-bold text-amber-800">
            {lowStockProducts.length} item{lowStockProducts.length > 1 ? 's' : ''} critically low (≤5 units): {lowStockProducts.map(p => p.name).join(', ')}
          </span>
        </div>
      )}

      {/* Category Filters */}
      <div className="flex overflow-x-auto gap-2 px-4 pb-3 no-scrollbar">
        {categories.map(cat => {
          const cfg = getCategoryConfig(cat);
          const isActive = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all border press ${
                isActive
                  ? `${cfg.bg} text-white ${cfg.border} shadow-md`
                  : `bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50`
              }`}
            >
              <cfg.icon size={14} className={isActive ? 'text-white' : cfg.color} />
              {cat}
            </button>
          );
        })}
      </div>

      {/* Product List */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 px-4 pb-8">
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
              className={`group bg-white rounded-2xl border flex items-center p-3 gap-3 transition-all relative overflow-hidden
                ${isOutOfStock ? 'opacity-50 grayscale cursor-not-allowed border-slate-100' : 'cursor-pointer hover:border-blue-300 hover:shadow-sm active:scale-[0.98] border-slate-200'}
                ${isFlashing ? 'add-flash' : ''}
              `}
            >

              {/* Info section */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                   <h4 className="text-sm font-black text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                     {product.name}
                   </h4>
                   {product.taxCategory === 'C' && (
                     <span className="text-[7px] font-black bg-green-50 text-green-600 px-1 py-0.5 rounded border border-green-100 tracking-tighter  whitespace-nowrap">
                       Tax-free
                     </span>
                   )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                   <span className="text-[12px] font-black text-slate-900 tabular-nums">
                     Ksh {product.sellingPrice.toLocaleString()} / {product.unit || 'pcs'}
                   </span>
                    <span className={`text-[10px] font-bold ${
                      isOutOfStock ? 'text-red-500' :
                      isCritical  ? 'text-red-500' :
                      isLow       ? 'text-amber-600' :
                                    'text-slate-400'
                    }`}>
                      • {isOutOfStock ? 'Out of stock' : `${displayStock} ${product.unit || 'pcs'} left`}
                    </span>
                 </div>
                 {product.isBundle && (
                    <div className="mt-1 flex flex-wrap gap-1">
                       {product.components?.map((c: any, i: number) => {
                          const p = allProducts?.find(x => String(x.id) === String(c.productId));
                          const hasStock = p ? p.stockQuantity >= c.quantity : false;
                          return (
                             <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded-md font-bold border ${hasStock ? 'bg-slate-50 text-slate-400 border-slate-100' : 'bg-red-50 text-red-500 border-red-100'}`}>
                                {p?.name || '??'}: {p?.stockQuantity || 0}
                             </span>
                          );
                       })}
                    </div>
                 )}
              </div>

              {/* Add Button */}
              {!isOutOfStock && (
                <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isFlashing ? 'bg-blue-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600'}`}>
                   {isFlashing ? <Zap size={16} /> : <Plus size={20} />}
                   {qtyInCart > 0 && (
                     <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[9px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center border border-white shadow-sm">
                        {qtyInCart}
                     </span>
                   )}
                </div>
              )}
              
              {/* Flashing Overlay */}
              {isFlashing && (
                <div className="absolute inset-0 bg-blue-600/5 animate-pulse rounded-2xl pointer-events-none" />
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {(products || []).length === 0 && (
          <div className="col-span-full py-16 text-center flex flex-col items-center">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-4">
              <Search size={32} className="text-slate-300" />
            </div>
            <p className="text-slate-500 font-bold text-sm">No products found</p>
            <p className="text-slate-400 text-xs mt-1">
              {searchQuery ? `Try a different search term` : `Add products in Inventory`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
