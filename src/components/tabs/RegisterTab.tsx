import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import BarcodeScanner from '../shared/BarcodeScanner';
import NestedControlPanel from '../shared/NestedControlPanel';
import { ProductCard } from '../shared/ProductCard';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export default function RegisterTab({ toggleCart }: { toggleCart?: (val: boolean) => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  
  const { 
    addToCart, 
    selectedCustomerId, 
    setSelectedCustomerId, 
    activeBusinessId, 
    activeBranchId, 
  } = useStore();

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId || !activeBranchId) return Promise.resolve([]);
      let query = db.products.where('businessId').equals(activeBusinessId);
      
      if (selectedCategory !== 'All') {
        return query.filter(p => p.category === selectedCategory && (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(searchQuery)))).toArray();
      }
      
      return query.filter(p => !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.barcode && p.barcode.includes(searchQuery))).toArray();
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
    }, 500);
  };

  return (
    <div className="flex flex-col h-full animate-in fade-in max-w-full overflow-hidden">
      
      {/* Search & Action Bar */}
      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="relative flex-1 group">
          <div className="absolute left-6 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">
            <MaterialIcon name="search" className="text-xl" />
          </div>
          <input 
            type="text" 
            placeholder="Search products by name or barcode..." 
            className="w-full pl-16 pr-6 py-4.5 bg-white border border-outline-variant rounded-full text-sm font-medium focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none transition-all shadow-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
           <button 
             onClick={() => setIsScannerOpen(!isScannerOpen)}
             className={`flex items-center gap-2 px-6 py-4 rounded-full font-bold text-xs uppercase tracking-widest transition-all ${isScannerOpen ? 'bg-primary text-white shadow-lg' : 'bg-surface-container text-primary hover:bg-surface-container-high'}`}
           >
              <MaterialIcon name="barcode_scanner" className="text-xl" />
              Scan
           </button>
           <button 
             onClick={() => setIsControlCenterOpen(true)}
             className="flex md:hidden items-center gap-2 px-6 py-4 bg-surface-container text-secondary rounded-full font-bold text-xs uppercase tracking-widest"
           >
              <MaterialIcon name="tune" className="text-xl" />
           </button>
        </div>
      </div>

      {/* Category Scrollbar */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-6 shrink-0">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-6 py-3 rounded-full text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-primary text-white shadow-md scale-105' : 'bg-white border border-outline-variant text-on-surface-variant hover:border-primary/30'}`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Main Grid Section */}
      <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {products?.map(product => (
            <ProductCard 
              key={product.id} 
              product={product} 
              onAdd={handleAddToCart} 
              recentlyAdded={recentlyAdded.has(product.id)} 
            />
          ))}
        </div>

        {(!products || products.length === 0) && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-30 py-20">
             <MaterialIcon name="inventory" className="text-6xl mb-4" />
             <p className="text-lg font-bold">No products found matching your search</p>
          </div>
        )}
      </div>

      {/* Control Center Panel */}
      {isControlCenterOpen && (
        <NestedControlPanel 
          title="Tools" 
          subtitle="Register Tools" 
          onClose={() => setIsControlCenterOpen(false)}
        >
          <div className="space-y-8">
            <div className="bg-surface-container-low p-6 rounded-3xl border border-outline-variant">
               <h4 className="font-mono text-[9px] font-bold text-outline uppercase tracking-widest mb-4">Scanner</h4>
               <button 
                 onClick={() => setIsScannerOpen(!isScannerOpen)}
                 className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all ${isScannerOpen ? 'bg-primary text-white border-primary shadow-lg' : 'bg-white border-outline-variant text-on-surface hover:border-primary/30'}`}
               >
                  <div className="flex items-center gap-3">
                     <MaterialIcon name="barcode_scanner" />
                     <span className="font-bold text-sm">Use Scanner</span>
                  </div>
                  <div className={`w-2.5 h-2.5 rounded-full ${isScannerOpen ? 'bg-white' : 'bg-outline-variant'}`} />
               </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
               <button className="flex flex-col items-center justify-center p-6 bg-white border border-outline-variant rounded-2xl hover:border-primary/30 transition-all">
                  <MaterialIcon name="payments" className="text-primary mb-2" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Sales Today</span>
               </button>
               <button className="flex flex-col items-center justify-center p-6 bg-white border border-outline-variant rounded-2xl hover:border-primary/30 transition-all">
                  <MaterialIcon name="history" className="text-secondary mb-2" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-on-surface-variant">Recent Sales</span>
               </button>
            </div>
          </div>
        </NestedControlPanel>
      )}

      {/* Barcode Scanner Viewport Overlay */}
      {isScannerOpen && (
        <div className="fixed inset-x-0 top-24 z-50 px-6 animate-in slide-in-from-top-4">
          <div className="max-w-xl mx-auto bg-slate-950/90 backdrop-blur-md rounded-3xl border-4 border-primary shadow-2xl p-2 relative overflow-hidden">
            <div className="relative aspect-video rounded-2xl overflow-hidden bg-black">
               <BarcodeScanner onScan={(barcode) => { 
                 const p = products?.find(prod => prod.barcode === barcode);
                 if (p) handleAddToCart(p);
               }} />
               {/* Decorative Scanning UI */}
               <div className="absolute inset-0 border-2 border-white/10 rounded-2xl pointer-events-none" />
               <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-primary/50 animate-pulse shadow-[0_0_15px_rgba(37,99,235,1)]" />
            </div>
            <button 
              onClick={() => setIsScannerOpen(false)}
              className="absolute top-4 right-4 w-10 h-10 bg-white/20 hover:bg-white/40 text-white rounded-full flex items-center justify-center transition-all"
            >
              <MaterialIcon name="close" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
