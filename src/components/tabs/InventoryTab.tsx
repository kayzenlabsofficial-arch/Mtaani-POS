import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import BarcodeScanner from '../shared/BarcodeScanner';
import NestedControlPanel from '../shared/NestedControlPanel';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export default function InventoryTab() {
  const [inventorySearch, setInventorySearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);
  
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeBranchId = useStore(state => state.activeBranchId);
  const { success, error } = useToast();
  
  const products = useLiveQuery(
    () => {
      if (!activeBusinessId) return Promise.resolve([]);
      let query = db.products.where('businessId').equals(activeBusinessId);
      if (selectedCategory) {
        return query.filter(p => p.category === selectedCategory && (p.name.toLowerCase().includes(inventorySearch.toLowerCase()) || (p.barcode && p.barcode.includes(inventorySearch)))).toArray();
      }
      return query.filter(p => p.name.toLowerCase().includes(inventorySearch.toLowerCase()) || (p.barcode && p.barcode.includes(inventorySearch))).toArray();
    },
    [inventorySearch, selectedCategory, activeBusinessId],
    []
  );

  const categories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );

  const totalValue = products?.reduce((acc, p) => acc + ((p.stockQuantity || 0) * (p.sellingPrice || 0)), 0) || 0;
  const lowStockCount = products?.filter(p => (p.stockQuantity || 0) <= (p.reorderPoint || 10)).length || 0;

  return (
    <div className="flex flex-col h-full animate-in fade-in pb-24">
      
      {/* Search & Summary Section */}
      <div className="flex flex-col lg:flex-row gap-lg mb-xl">
        <div className="flex-grow relative group">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant group-focus-within:text-primary transition-colors">
            <MaterialIcon name="search" />
          </div>
          <input 
            className="w-full pl-12 pr-4 py-4 bg-white border border-outline-variant rounded-md focus:ring-4 focus:ring-primary/10 focus:border-primary outline-none font-medium transition-all shadow-sm"
            placeholder="Search products by name or barcode..."
            value={inventorySearch}
            onChange={(e) => setInventorySearch(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-md md:flex md:gap-md">
          <div className="bg-white border border-outline-variant p-lg rounded-md flex flex-col justify-center min-w-[200px] shadow-sm">
            <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Total Stock Value</span>
            <span className="text-xl font-bold text-primary tabular-nums">Ksh {totalValue.toLocaleString()}</span>
          </div>
          <div className="bg-white border border-outline-variant p-lg rounded-md flex flex-col justify-center min-w-[200px] shadow-sm">
            <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1">Low Stock</span>
            <span className="text-xl font-bold text-error tabular-nums">{lowStockCount} Items</span>
          </div>
        </div>
      </div>

      {/* Category Toggles */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-6 shrink-0">
        <button
          onClick={() => setSelectedCategory(null)}
          className={`px-6 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all ${!selectedCategory ? 'bg-primary text-white shadow-md' : 'bg-white border border-outline-variant text-on-surface-variant'}`}
        >
          All Categories
        </button>
        {categories?.map(cat => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.name)}
            className={`px-6 py-2.5 rounded-full text-[11px] font-bold uppercase tracking-widest transition-all ${selectedCategory === cat.name ? 'bg-primary text-white shadow-md' : 'bg-white border border-outline-variant text-on-surface-variant'}`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Inventory List Header */}
      <div className="hidden md:grid grid-cols-12 gap-8 px-6 py-4 bg-surface-container-low border border-outline-variant rounded-t-xl">
        <div className="col-span-5 font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Product</div>
        <div className="col-span-2 font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Barcode</div>
        <div className="col-span-2 font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest text-center">Stock Level</div>
        <div className="col-span-2 font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest text-right">Price</div>
        <div className="col-span-1"></div>
      </div>

      {/* Product List */}
      <div className="space-y-2 mt-2">
        {products?.map(product => {
          const isLow = (product.stockQuantity || 0) <= (product.reorderPoint || 10);
          const isOut = (product.stockQuantity || 0) <= 0;
          
          return (
            <div key={product.id} className="bg-white border border-outline-variant hover:border-primary/30 hover:bg-surface-container-lowest transition-all p-4 rounded-md grid grid-cols-1 md:grid-cols-12 gap-y-4 md:gap-8 items-center group">
              <div className="md:col-span-5 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center transition-colors ${isOut ? 'bg-error-container text-error' : 'bg-primary-container text-white'}`}>
                  <MaterialIcon name="inventory_2" />
                </div>
                <div>
                  <p className="text-sm font-bold text-on-background group-hover:text-primary transition-colors">{product.name}</p>
                  <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-tighter">{product.category} • {product.unit || 'pcs'}</p>
                </div>
              </div>
              
              <div className="md:col-span-2">
                <span className="font-mono text-[11px] px-3 py-1 bg-surface-container rounded-md text-on-surface-variant border border-outline-variant">
                  {product.barcode || 'NO-SKU'}
                </span>
              </div>
              
              <div className="md:col-span-2 flex items-center justify-center gap-3">
                <span className={`text-sm font-bold tabular-nums ${isOut ? 'text-error' : isLow ? 'text-amber-600' : 'text-primary'}`}>
                  {product.stockQuantity || 0} units
                </span>
                {isLow && (
                  <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase tracking-tighter ${isOut ? 'bg-error text-white' : 'bg-amber-100 text-amber-700'}`}>
                    {isOut ? 'Depleted' : 'Low'}
                  </span>
                )}
              </div>
              
              <div className="md:col-span-2 text-right font-bold text-sm text-on-background tabular-nums">
                Ksh {product.sellingPrice.toLocaleString()}
              </div>
              
              <div className="md:col-span-1 flex justify-end">
                <button 
                   onClick={() => setIsOpsPanelOpen(true)}
                   className="w-10 h-10 rounded-xl bg-surface-container text-on-surface-variant hover:bg-primary-container hover:text-white transition-all flex items-center justify-center"
                >
                  <MaterialIcon name="more_vert" />
                </button>
              </div>
            </div>
          );
        })}
        
        {(!products || products.length === 0) && (
          <div className="py-20 text-center opacity-30">
            <MaterialIcon name="inventory" className="text-6xl mb-4" />
            <p className="text-lg font-bold">No products found</p>
          </div>
        )}
      </div>

      {/* FAB: Add New Product */}
      <button 
        onClick={() => setIsProductModalOpen(true)}
        className="fixed bottom-28 right-8 bg-primary text-white w-14 h-14 rounded-full shadow-2xl flex items-center justify-center z-50 hover:bg-secondary transition-all active:scale-90 duration-200"
      >
        <MaterialIcon name="add" className="text-3xl" />
      </button>

      {/* Control Center Panel */}
      {isOpsPanelOpen && (
        <NestedControlPanel 
          title="Stock Tools" 
          subtitle="Manage your inventory" 
          onClose={() => setIsOpsPanelOpen(false)}
        >
           <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                 <button className="flex flex-col items-center justify-center p-6 bg-white border border-outline-variant rounded-3xl hover:border-primary transition-all">
                     <MaterialIcon name="add_circle" className="text-primary mb-2" />
                     <span className="font-mono text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">Stock Take</span>
                 </button>
                 <button className="flex flex-col items-center justify-center p-6 bg-white border border-outline-variant rounded-3xl hover:border-secondary transition-all">
                     <MaterialIcon name="history" className="text-secondary mb-2" />
                     <span className="font-mono text-[9px] font-bold text-on-surface-variant uppercase tracking-widest">History</span>
                 </button>
              </div>
           </div>
        </NestedControlPanel>
      )}

    </div>
  );
}
