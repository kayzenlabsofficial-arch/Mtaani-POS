import React, { useState } from 'react';
import { Search, Plus, Package, AlertCircle, Tag as TagIcon, Barcode, Trash2, Save, Edit, FileStack, Clock, ArrowDownLeft, ArrowUpRight, Settings, ChevronRight, X, Utensils, GlassWater, ShoppingBag, Lightbulb, DollarSign, SlidersHorizontal, BarChart3, TrendingUp, ChevronDown, CheckCircle2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import BarcodeScanner from '../shared/BarcodeScanner';
import { SearchableSelect } from '../shared/SearchableSelect';
import NestedControlPanel from '../shared/NestedControlPanel';

const ICON_MAP: Record<string, React.ElementType> = {
  Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Tag: TagIcon
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

export default function InventoryTab() {
  const [inventorySearch, setInventorySearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isInventoryScannerOpen, setIsInventoryScannerOpen] = useState(false);
  const [isQuickAdjustOpen, setIsQuickAdjustOpen] = useState(false);
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);
  const [quickAdjustForm, setQuickAdjustForm] = useState({ quantity: '', reason: '' });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProductForDetails, setSelectedProductForDetails] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
      name: '', category: 'Other', barcode: '', sellingPrice: '', stockQuantity: '', reorderPoint: '10', unit: 'pcs', taxCategory: 'A' as 'A'|'C'|'E', reason: '',
      isBundle: false,
      components: [] as { productId: string; quantity: number }[]
  });
  
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const { success, error } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  
  const activeBranchId = useStore(state => state.activeBranchId);
  
  const stockMovementsData = useLiveQuery(
    () => selectedProductForDetails && activeBranchId ? db.stockMovements.where('productId').equals(selectedProductForDetails.id).and(m => m.branchId === activeBranchId).reverse().toArray() : [],
    [selectedProductForDetails, activeBranchId],
    []
  );

  const allProducts = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );
  
  const categories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : [], [activeBranchId], []) || [];

  const performanceData = React.useMemo(() => {
     if (!selectedProductForDetails) return [];
     const salesMap = new Map<string, number>();
     
     for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        salesMap.set(d.toLocaleDateString(), 0);
     }

     allTransactions.forEach(tx => {
         if (tx.status === 'PAID') {
            const dateStr = new Date(tx.timestamp).toLocaleDateString();
            if (salesMap.has(dateStr)) {
               const item = tx.items.find(i => i.productId === selectedProductForDetails.id);
               if (item) {
                  salesMap.set(dateStr, (salesMap.get(dateStr) || 0) + item.quantity);
               }
            }
         }
     });

     return Array.from(salesMap.entries()).map(([date, qty]) => {
         const parts = date.split('/');
         const shortDate = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : date;
         return { date: shortDate, qty };
     });
  }, [selectedProductForDetails, allTransactions]);

  const exportPerformancePDF = async () => {
    if (!selectedProductForDetails) return;
    const element = document.getElementById('performance-chart-container');
    if (!element) return;

    try {
      success("Generating PDF...");
      const canvas = await html2canvas(element, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.setFontSize(20);
      pdf.text(`Performance: ${selectedProductForDetails.name}`, 15, 20);
      
      pdf.setFontSize(12);
      pdf.text(`Barcode: ${selectedProductForDetails.barcode}`, 15, 30);
      pdf.text(`Current Stock: ${selectedProductForDetails.stockQuantity}`, 15, 38);
      
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth() - 30;
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 15, 50, pdfWidth, pdfHeight);
      pdf.save(`${selectedProductForDetails.name}_Performance.pdf`);
    } catch (err) {
      error("Failed to generate PDF");
    }
  };

  const getCategoryConfig = (categoryName: string) => {
      const cat = categories?.find(c => c.name === categoryName);
      if (!cat) return DEFAULT_CONFIG;
      return {
          icon: ICON_MAP[cat.iconName] || Package,
          ...COLOR_MAP[cat.color] || COLOR_MAP.slate
      };
  };

  const calculateVirtualStock = (product: Product) => {
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
  
  if (!allProducts) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
            <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                <Package size={32} className="text-slate-300" />
            </div>
            <p className="text-slate-400 font-black text-xs uppercase tracking-widest">Loading Inventory...</p>
        </div>
    );
  }

  const lowStock = allProducts.filter(p => calculateVirtualStock(p) <= (p.reorderPoint || 0));
  const stockWorth = allProducts
    .filter(p => !p.isBundle)
    .reduce((sum, p) => sum + (p.sellingPrice * p.stockQuantity), 0);
    
  const filteredInventory = allProducts.filter(p => {
      const matchesSearch = p.name.toLowerCase().includes(inventorySearch.toLowerCase()) || p.barcode.includes(inventorySearch);
      const matchesCategory = !selectedCategory || p.category === selectedCategory;
      return matchesSearch && matchesCategory;
  });

  const openAddProduct = () => {
      setSelectedProductForDetails(null);
      setEditingProduct(null);
      setProductForm({ name: '', category: 'Other', barcode: '', sellingPrice: '', stockQuantity: '', reorderPoint: '10', unit: 'pcs', taxCategory: 'A', reason: '', isBundle: false, components: [] });
      setIsProductModalOpen(true);
  };

  const openEditProductFromDetails = () => {
      if (!selectedProductForDetails) return;
      setEditingProduct(selectedProductForDetails);
      setProductForm({
          name: selectedProductForDetails.name, 
          category: selectedProductForDetails.category || 'Other',
          barcode: selectedProductForDetails.barcode,
          sellingPrice: selectedProductForDetails.sellingPrice.toString(),
          stockQuantity: selectedProductForDetails.stockQuantity.toString(),
          unit: selectedProductForDetails.unit || 'pcs',
          taxCategory: selectedProductForDetails.taxCategory,
          reorderPoint: (selectedProductForDetails.reorderPoint || 0).toString(),
          reason: '',
          isBundle: !!selectedProductForDetails.isBundle,
          components: selectedProductForDetails.components || []
      });
      setSelectedProductForDetails(null);
      setIsProductModalOpen(true);
  };

    const handleSaveProduct = async () => {
      if (isSaving) return;
      setIsSaving(true);
      try {
          const payload = {
              name: productForm.name,
              category: productForm.category,
              barcode: productForm.barcode,
              sellingPrice: Number(productForm.sellingPrice),
              stockQuantity: Number(productForm.stockQuantity),
              reorderPoint: Number(productForm.reorderPoint),
              unit: productForm.unit,
              taxCategory: productForm.taxCategory,
              isBundle: productForm.isBundle,
              components: productForm.isBundle ? productForm.components : undefined
           };

          if (editingProduct) {
              const diff = payload.stockQuantity - editingProduct.stockQuantity;
              if (diff !== 0) {
                  await db.stockAdjustmentRequests.add({
                      id: crypto.randomUUID(),
                      productId: editingProduct.id,
                      productName: editingProduct.name,
                      oldQty: editingProduct.stockQuantity,
                      newQty: payload.stockQuantity,
                      reason: productForm.reason || 'Manual Adjustment',
                      timestamp: Date.now(),
                      status: 'PENDING',
                      preparedBy: currentUser?.name,
                      branchId: activeBranchId!,
                      businessId: activeBusinessId!
                  });
                  
                  await db.products.update(editingProduct.id, { 
                    name: payload.name, 
                    category: payload.category,
                    barcode: payload.barcode, 
                    sellingPrice: payload.sellingPrice, 
                    unit: payload.unit,
                    reorderPoint: payload.reorderPoint,
                    taxCategory: payload.taxCategory,
                    isBundle: payload.isBundle,
                    components: payload.components,
                    updated_at: Date.now()
                  });
                  success("Product details saved. Stock adjustment sent for approval.");
              } else {
                  await db.products.update(editingProduct.id, { ...payload, updated_at: Date.now() });
                  success("Product updated successfully.");
              }
          } else {
              const newId = crypto.randomUUID();
              await db.products.add({ id: newId, ...payload, updated_at: Date.now(), businessId: activeBusinessId! } as any);
              await db.stockMovements.add({
                  id: crypto.randomUUID(),
                  productId: newId,
                  type: 'IN',
                  quantity: payload.stockQuantity,
                  timestamp: Date.now(),
                  reference: 'Initial Stock',
                  updated_at: Date.now(),
                  branchId: activeBranchId!,
                  businessId: activeBusinessId!
              });
              success("New product added to inventory.");
          }
          setIsProductModalOpen(false);
      } catch (err: any) {
          console.error("Save failed:", err);
          error("Failed to save product: " + (err.message || "Unknown error"));
      } finally {
          setIsSaving(false);
      }
    };

  const handleDeleteProduct = async () => {
       if (editingProduct && confirm("Are you sure? This deletes the product and all history.")) {
           await db.products.delete(editingProduct.id);
           setIsProductModalOpen(false);
           success("Product removed.");
       }
  };

  const handleQuickAdjust = async () => {
      if (!selectedProductForDetails) return;
      if (isSaving) return;
      const adjustQty = Number(quickAdjustForm.quantity);
      if (isNaN(adjustQty) || adjustQty === 0) return;

      setIsSaving(true);
      try {
        const newStock = selectedProductForDetails.stockQuantity + adjustQty;

        await db.stockAdjustmentRequests.add({
            id: crypto.randomUUID(),
            productId: selectedProductForDetails.id,
            productName: selectedProductForDetails.name,
            oldQty: selectedProductForDetails.stockQuantity,
            newQty: newStock,
            reason: quickAdjustForm.reason || 'Quick adjustment',
            timestamp: Date.now(),
            status: 'PENDING',
            preparedBy: currentUser?.name,
            branchId: activeBranchId!,
            businessId: activeBusinessId!
        });
        success("Adjustment requested. Admin approval required.");
        
        setIsQuickAdjustOpen(false);
        setQuickAdjustForm({ quantity: '', reason: '' });
      } catch (err: any) {
        error("Adjustment request failed.");
      } finally {
        setIsSaving(false);
      }
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Control Center Header */}
      <div className="px-4 pt-2 mb-6">
        <div className="flex items-center justify-between mb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Inventory</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Master Stock Ledger</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Tools</span>
              </button>
              {isAdmin && (
                <button onClick={openAddProduct} className="grad-blue text-white px-4 py-2.5 rounded-xl shadow-blue active:scale-95 transition-all flex items-center gap-2 font-black text-[10px] uppercase">
                   <Plus size={18} /> Add New
                </button>
              )}
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Inventory Operations"
               subtitle="System-wide stock management and analysis"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Stock Health</h4>
                      <div className="grid grid-cols-1 gap-2">
                         <div className={`p-4 rounded-2xl border-2 flex items-center gap-4 transition-all ${lowStock.length > 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${lowStock.length > 0 ? 'bg-rose-600 text-white shadow-rose' : 'bg-emerald-600 text-white shadow-emerald'}`}>
                               <AlertCircle size={20} />
                            </div>
                            <div>
                               <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">Critical Alerts</p>
                               <h3 className={`text-xl font-black ${lowStock.length > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{lowStock.length} Items</h3>
                            </div>
                         </div>
                         <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                               <TrendingUp size={20} />
                            </div>
                            <div>
                               <p className="text-[10px] font-black text-slate-400 uppercase mb-0.5">Inventory Valuation</p>
                               <h3 className="text-xl font-black text-slate-900 leading-none">Ksh {stockWorth.toLocaleString()}</h3>
                            </div>
                         </div>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Quick Actions</h4>
                      <div className="grid grid-cols-2 gap-2">
                         <button onClick={openAddProduct} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 border-slate-100 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all group">
                            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                               <Plus size={18} />
                            </div>
                            <span className="text-[10px] font-black text-slate-900">NEW SKU</span>
                         </button>
                         <button onClick={() => { setIsInventoryScannerOpen(true); setIsOpsPanelOpen(false); }} className="flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 border-slate-100 hover:border-blue-300 hover:bg-blue-50/30 transition-all group">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                               <Barcode size={18} />
                            </div>
                            <span className="text-[10px] font-black text-slate-900">SCAN SKU</span>
                         </button>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Categories</h4>
                      <div className="bg-slate-50 rounded-2xl p-3 max-h-[140px] overflow-y-auto no-scrollbar border border-slate-100">
                         {categories?.map(cat => (
                            <div key={cat.id} className="flex items-center justify-between p-2 rounded-xl hover:bg-white transition-all cursor-pointer group">
                               <div className="flex items-center gap-2">
                                  {React.createElement(ICON_MAP[cat.iconName] || Package, { size: 14, className: 'text-indigo-600' })}
                                  <span className="text-[10px] font-bold text-slate-700">{cat.name}</span>
                               </div>
                               <ChevronRight size={12} className="text-slate-300 group-hover:text-indigo-600" />
                            </div>
                         ))}
                      </div>
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      {/* Category Pills Filter */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar px-4 mb-6">
         <button 
           onClick={() => setSelectedCategory(null)}
           className={`px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-wider transition-all whitespace-nowrap shadow-sm press border-2 ${!selectedCategory ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}
         >
           All Stock
         </button>
         {categories?.map(cat => {
            const isSel = selectedCategory === cat.name;
            const cfg = ICON_MAP[cat.iconName] || Package;
            return (
              <button 
                key={cat.id}
                onClick={() => setSelectedCategory(isSel ? null : cat.name)}
                className={`px-5 py-3 rounded-2xl font-black text-[10px] uppercase tracking-wider transition-all whitespace-nowrap shadow-sm flex items-center gap-2 press border-2 ${isSel ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}
              >
                {React.createElement(cfg, { size: 16 })}
                {cat.name}
              </button>
            );
         })}
      </div>

      {/* Search Bar */}
      <div className="px-4 mb-8">
        <div className="relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
          <input 
            type="text" 
            placeholder="Search by name, barcode or category..."
            className="w-full pl-14 pr-4 py-4.5 bg-white rounded-[1.5rem] border-2 border-slate-100 text-sm font-bold text-slate-800 shadow-sm focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 transition-all outline-none"
            value={inventorySearch}
            onChange={(e) => setInventorySearch(e.target.value)}
          />
          {inventorySearch && (
            <button onClick={() => setInventorySearch('')} className="absolute right-5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-all">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 px-4">
         {filteredInventory.map(product => {
            const cfg = getCategoryConfig(product.category || 'Other');
            const displayStock = calculateVirtualStock(product);
            const isLow = displayStock <= (product.reorderPoint || 0);
            const isCrit = displayStock <= ((product.reorderPoint || 0) * 0.5);

            return (
              <div 
                key={product.id} 
                onClick={() => openProductDetails(product)} 
                className="group bg-white p-6 rounded-[2rem] border-2 border-slate-100 shadow-sm flex flex-col gap-5 hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden"
              >
                <div className="flex justify-between items-start">
                   <div className={`w-14 h-14 rounded-[1.25rem] ${cfg.light} ${cfg.color} border border-slate-50 flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform`}>
                      <cfg.icon size={28} />
                   </div>
                   <div className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                     isCrit ? 'bg-rose-50 text-rose-600 border border-rose-100' : 
                     isLow ? 'bg-amber-50 text-amber-600 border border-amber-100' : 
                     'bg-emerald-50 text-emerald-600 border border-emerald-100'
                   }`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${isCrit ? 'bg-rose-500 animate-pulse' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                      {isCrit ? 'CRITICAL' : isLow ? 'LOW STOCK' : 'IN STOCK'}
                   </div>
                </div>

                <div className="flex-1 min-w-0">
                   <h4 className="text-base font-black text-slate-900 truncate mb-1 leading-tight">{product.name}</h4>
                   <div className="flex items-center gap-2 mb-4">
                      <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100 flex items-center gap-1.5 uppercase tracking-tighter">
                         <Barcode size={12} /> {product.barcode}
                      </span>
                   </div>
                   
                   <div className="flex items-end justify-between pt-4 border-t border-slate-50">
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Selling Price</p>
                         <h3 className="text-lg font-black text-slate-900 leading-none">Ksh {product.sellingPrice.toLocaleString()}</h3>
                      </div>
                      <div className="text-right">
                         <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Available</p>
                         <h3 className={`text-lg font-black leading-none ${isCrit ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-indigo-600'}`}>
                            {displayStock} <span className="text-[10px] opacity-60 ml-0.5">{product.unit || 'pcs'}</span>
                         </h3>
                      </div>
                   </div>
                </div>
              </div>
            );
         })}
         
         {filteredInventory.length === 0 && (
            <div className="col-span-full py-32 text-center flex flex-col items-center">
               <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner">
                 <Search size={44} className="text-slate-200" />
               </div>
               <p className="text-slate-500 font-black text-lg">Inventory search returned nothing</p>
               <p className="text-slate-400 text-xs mt-1 uppercase font-bold tracking-widest">Adjust filters or add new stock</p>
            </div>
         )}
      </div>

      {/* Modals - Same as before but with premium styling */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsProductModalOpen(false)} />
           <div className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center text-white shadow-blue">
                      {editingProduct ? <Edit size={24} /> : <Plus size={24} />}
                   </div>
                   <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight">
                        {editingProduct ? 'Edit Product' : 'New Inventory Entry'}
                     </h2>
                     <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Master SKU Control</p>
                   </div>
                 </div>
                 {editingProduct && isAdmin && (
                    <button onClick={handleDeleteProduct} className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all press">
                       <Trash2 size={20} />
                    </button>
                 )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                  <div className="col-span-1 md:col-span-2">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Product Name</label>
                      <input type="text" value={productForm.name} onChange={(e) => setProductForm({...productForm, name: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="Enter product name..." />
                  </div>
                  <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Category</label>
                      <SearchableSelect
                        value={productForm.category}
                        onChange={(v) => setProductForm({ ...productForm, category: v })}
                        placeholder="Select category..."
                        options={[
                          ...(categories || []).map(cat => ({ value: cat.name, label: cat.name, keywords: cat.name })),
                          ...(!categories?.find(c => c.name === 'Other') ? [{ value: 'Other', label: 'Other', keywords: 'other' }] : []),
                        ]}
                        buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-slate-50 border-transparent hover:border-slate-200"
                        searchInputClassName="bg-white"
                      />
                  </div>
                  <div>
                     <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Barcode / SKU</label>
                     <div className="relative flex gap-2">
                        <div className="relative flex-1">
                           <input type="text" value={productForm.barcode} onChange={(e) => setProductForm({...productForm, barcode: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-12 pr-4 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm font-mono" placeholder="000000000000" />
                           <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        </div>
                        <button 
                           onClick={() => setIsInventoryScannerOpen(true)}
                           className="w-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-indigo-600 transition-all active:scale-95 shadow-lg shadow-black/5"
                        >
                           <Search size={20} />
                        </button>
                     </div>
                  </div>
                  <div>
                     <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Selling Price (Ksh)</label>
                     <div className="relative">
                        <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">KSH</span>
                        <input type="number" value={productForm.sellingPrice} onChange={(e) => setProductForm({...productForm, sellingPrice: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-16 pr-6 py-4.5 text-lg font-black text-slate-900 outline-none transition-all shadow-sm tabular-nums" placeholder="0" />
                     </div>
                  </div>
                  <div>
                     <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Initial Stock</label>
                     <div className="relative">
                        <input type="number" step="any" value={productForm.stockQuantity} onChange={(e) => setProductForm({...productForm, stockQuantity: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-lg font-black text-slate-900 outline-none transition-all shadow-sm tabular-nums" placeholder="0" />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs uppercase tracking-widest">{productForm.unit || 'PCS'}</span>
                     </div>
                  </div>
                  
                  <div className="col-span-1 md:col-span-2 space-y-6 pt-4 border-t border-slate-50">
                      <div className="flex items-center justify-between">
                         <div>
                            <h4 className="text-sm font-black text-slate-900">Bundled Product Configuration</h4>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Derive stock from component items</p>
                         </div>
                         <button 
                            onClick={() => setProductForm({...productForm, isBundle: !productForm.isBundle})}
                            className={`w-14 h-8 rounded-full transition-all relative ${productForm.isBundle ? 'bg-indigo-600' : 'bg-slate-200'}`}
                         >
                            <div className={`absolute top-1.5 w-5 h-5 bg-white rounded-full shadow-md transition-all ${productForm.isBundle ? 'left-7.5' : 'left-1.5'}`} />
                         </button>
                      </div>

                      {productForm.isBundle && (
                         <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                            <div className="space-y-2">
                               {productForm.components.map((comp, idx) => {
                                  const p = allProducts.find(x => x.id === comp.productId);
                                  return (
                                     <div key={idx} className="flex gap-3 items-center bg-slate-50 p-4 rounded-2xl border border-slate-100 group">
                                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center text-indigo-600 shadow-sm shrink-0">
                                           <Package size={14} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                           <p className="text-xs font-black text-slate-900 truncate">{p?.name || 'Select Product...'}</p>
                                        </div>
                                        <div className="flex items-center gap-1.5 bg-white border border-slate-100 rounded-xl px-2 py-1">
                                           <span className="text-[10px] font-bold text-slate-400">×</span>
                                           <input 
                                              type="number" 
                                              step="any"
                                              value={comp.quantity} 
                                              onChange={e => {
                                                 const newComps = [...productForm.components];
                                                 newComps[idx].quantity = Number(e.target.value);
                                                 setProductForm({...productForm, components: newComps});
                                              }}
                                              className="w-10 bg-transparent text-xs font-black text-center outline-none"
                                           />
                                        </div>
                                        <button 
                                          onClick={() => {
                                             const newComps = productForm.components.filter((_, i) => i !== idx);
                                             setProductForm({...productForm, components: newComps});
                                          }}
                                          className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white"
                                        >
                                           <X size={14} />
                                        </button>
                                     </div>
                                  );
                               })}
                               <SearchableSelect
                                 value=""
                                 onChange={(v) => {
                                   if (!v) return;
                                   setProductForm({
                                     ...productForm,
                                     components: [...productForm.components, { productId: v, quantity: 1 }],
                                   });
                                 }}
                                 placeholder="+ Add Component SKU..."
                                 options={allProducts
                                   .filter(p => !productForm.components.find(c => c.productId === p.id) && p.id !== editingProduct?.id)
                                   .map(p => ({
                                     value: p.id,
                                     label: p.name,
                                     keywords: `${p.name} ${p.barcode || ''}`,
                                   }))}
                                 buttonClassName="bg-white border-2 border-dashed border-slate-200 hover:border-indigo-400 hover:text-indigo-600 rounded-2xl px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400"
                                 searchInputClassName="bg-white"
                               />
                            </div>
                         </div>
                      )}
                   </div>

                   <div className="col-span-1 md:col-span-2 pt-6 border-t border-slate-50">
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">KRA Tax Class</label>
                      <div className="grid grid-cols-3 gap-3">
                         {[
                           { id: 'A', label: '16% Standard' },
                           { id: 'C', label: '0% Exempt' },
                           { id: 'E', label: '8% Special' }
                         ].map(tax => (
                           <button 
                             key={tax.id}
                             onClick={() => setProductForm({...productForm, taxCategory: tax.id as any})}
                             className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 ${
                               productForm.taxCategory === tax.id 
                                 ? 'border-indigo-600 bg-indigo-50 text-indigo-700 shadow-indigo' 
                                 : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'
                             }`}
                           >
                             <span className="text-[11px] font-black uppercase tracking-widest">Class {tax.id}</span>
                             <span className="text-[9px] font-bold opacity-60 text-center">{tax.label}</span>
                           </button>
                         ))}
                      </div>
                   </div>

                   {editingProduct && Number(productForm.stockQuantity) !== editingProduct.stockQuantity && (
                    <div className="col-span-1 md:col-span-2 animate-in slide-in-from-top-2 pt-4">
                       <label className="block text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2 ml-2">Audit Reason Required</label>
                       <textarea 
                          value={productForm.reason} 
                          onChange={(e) => setProductForm({...productForm, reason: e.target.value})} 
                          rows={2}
                          className="w-full bg-amber-50/30 border-2 border-amber-100 rounded-2xl px-6 py-4.5 text-sm font-bold text-slate-700 outline-none focus:border-amber-500 transition-all italic shadow-inner" 
                          placeholder="e.g. Breakage, Spoilt, Correcting count..."
                       />
                    </div>
                  )}
              </div>

              <div className="flex gap-4 shrink-0 mt-auto pt-6 border-t border-slate-50">
                 <button onClick={() => setIsProductModalOpen(false)} className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl transition-all press">
                   Dismiss
                 </button>
                 <button 
                    onClick={handleSaveProduct} 
                    disabled={
                      !productForm.name.trim() ||
                      !productForm.sellingPrice ||
                      (editingProduct &&
                        Math.abs(Number(productForm.stockQuantity) - editingProduct.stockQuantity) > 0 &&
                        !productForm.reason.trim())
                    } 
                    className="flex-[2] grad-indigo text-white px-8 py-5 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl disabled:opacity-40 transition-all shadow-indigo press flex items-center justify-center gap-3"
                  >
                    <Save size={18} />
                    {editingProduct && Math.abs(Number(productForm.stockQuantity) - editingProduct.stockQuantity) > 0 ? 'Request Adjustment' : 'Commit Changes'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Detail Modal recovery remains same logic but updated UI */}
      {selectedProductForDetails && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedProductForDetails(null)} />
           <div className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col pt-8 pb-10 px-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[90vh]">
              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">Stock Insight</h2>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Live Tracking Data</p>
                 </div>
                 <div className="flex gap-2">
                    <button onClick={() => { setIsQuickAdjustOpen(true); setQuickAdjustForm({ quantity: '', reason: '' }); }} className="bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all px-5 py-3 rounded-xl font-black text-[10px] uppercase tracking-wide flex items-center gap-2 shadow-sm border border-indigo-100 press">
                       {isAdmin ? 'Adjust' : 'Request Adj'}
                    </button>
                    {isAdmin && (
                      <button onClick={openEditProductFromDetails} className="bg-slate-900 text-white hover:bg-slate-800 transition-all px-5 py-3 rounded-xl font-black text-[10px] uppercase tracking-wide flex items-center gap-2 shadow-lg press">
                         <Edit size={16} /> Edit
                      </button>
                    )}
                 </div>
              </div>

              {/* Summary Hero Card */}
              <div className="grad-indigo rounded-[2.5rem] p-8 text-white shadow-indigo mb-10 shrink-0 relative overflow-hidden">
                 <Package className="absolute -right-12 -bottom-12 w-48 h-48 text-white/10 rotate-12" />
                 <div className="relative z-10">
                   <div className="flex justify-between items-start mb-6">
                     <div className="flex flex-col">
                        <span className="text-indigo-200 text-[10px] font-black tracking-[0.25em] uppercase mb-1">{selectedProductForDetails.barcode || 'NO BARCODE'}</span>
                        <div className="flex items-center gap-2">
                           <h3 className="text-2xl font-black leading-none">{selectedProductForDetails.name}</h3>
                        </div>
                     </div>
                     <span className="bg-white/20 text-white text-[9px] font-black px-4 py-1.5 rounded-full border border-white/20 uppercase tracking-widest backdrop-blur-sm">
                       {selectedProductForDetails.category || 'Other'}
                     </span>
                   </div>
                   
                   <div className="grid grid-cols-2 gap-10">
                      <div className="flex flex-col gap-1">
                         <p className="text-indigo-100 text-[10px] font-black uppercase tracking-widest opacity-80">Available Stock</p>
                         <div className="flex items-baseline gap-2">
                            <p className="text-4xl font-black tabular-nums">{calculateVirtualStock(selectedProductForDetails)}</p>
                            <p className="text-sm font-bold opacity-60 uppercase">{selectedProductForDetails.unit || 'pcs'}</p>
                         </div>
                      </div>
                      <div className="flex flex-col gap-1">
                         <p className="text-indigo-100 text-[10px] font-black uppercase tracking-widest opacity-80">Selling Price</p>
                         <p className="text-3xl font-black tabular-nums">Ksh {selectedProductForDetails.sellingPrice.toLocaleString()}</p>
                      </div>
                   </div>
                 </div>
              </div>

              {/* Performance Section */}
              <div className="flex-1 overflow-y-auto no-scrollbar pb-6">
                 <div className="mb-10" id="performance-chart-container">
                    <div className="flex items-center justify-between mb-5">
                       <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                             <BarChart3 size={16} />
                          </div>
                          <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Velocity (Last 7 Days)</h3>
                       </div>
                       <button onClick={exportPerformancePDF} className="text-[9px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 hover:bg-indigo-600 hover:text-white transition-all">
                          Export Record
                       </button>
                    </div>
                    <div className="bg-slate-50/50 rounded-[2rem] p-6 h-56 border-2 border-slate-50 shadow-inner">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={performanceData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="date" tick={{fontSize: 9, fontWeight: 900, fill: '#94a3b8'}} axisLine={false} tickLine={false} dy={10} />
                                <YAxis hide />
                                <Tooltip cursor={{fill: '#f1f5f9'}} contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)', padding: '12px'}} labelStyle={{fontWeight: 900, color: '#1e293b', marginBottom: '4px', fontSize: '10px'}} itemStyle={{fontWeight: 900, color: '#4f46e5', fontSize: '12px'}} />
                                <Bar dataKey="qty" fill="url(#colorBar)" radius={[6, 6, 0, 0]} barSize={24}>
                                   <defs>
                                      <linearGradient id="colorBar" x1="0" y1="0" x2="0" y2="1">
                                         <stop offset="0%" stopColor="#6366f1" stopOpacity={1}/>
                                         <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.8}/>
                                      </linearGradient>
                                   </defs>
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                 </div>

                 <div className="flex items-center gap-2 mb-6">
                    <div className="w-8 h-8 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
                       <FileStack size={16} />
                    </div>
                    <h3 className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Movement Log</h3>
                 </div>
                 
                 <div className="space-y-3 pb-4">
                    {stockMovementsData.length === 0 ? (
                       <div className="text-center py-16 flex flex-col items-center bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-100">
                          <Clock size={40} className="text-slate-200 mb-4" />
                          <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">No history recorded</p>
                       </div>
                    ) : (
                       stockMovementsData.map(movement => (
                          <div key={movement.id} className="flex items-center justify-between p-5 rounded-[1.5rem] border-2 border-slate-50 bg-white hover:border-indigo-100 transition-all shadow-sm">
                             <div className="flex gap-4 items-center min-w-0">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                                   movement.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 
                                   movement.type === 'OUT' ? 'bg-rose-50 text-rose-600' : 
                                   'bg-blue-50 text-blue-600'
                                }`}>
                                   {movement.type === 'IN' ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
                                </div>
                                <div className="min-w-0">
                                   <p className="text-[11px] font-black text-slate-900 uppercase tracking-tight truncate">{movement.reference || 'Manual Entry'}</p>
                                   <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">{new Date(movement.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</p>
                                </div>
                             </div>
                             <div className={`text-sm font-black tabular-nums ${movement.type === 'IN' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {movement.type === 'IN' ? '+' : ''}{movement.quantity}
                             </div>
                          </div>
                       ))
                    )}
                 </div>
              </div>

              <div className="pt-6 border-t border-slate-50 shrink-0">
                 <button onClick={() => setSelectedProductForDetails(null)} className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-xl hover:bg-slate-800 transition-all press">
                    Dismiss
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Quick Adjust Modal */}
      {isQuickAdjustOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsQuickAdjustOpen(false)} />
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-10 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-[1.5rem] flex items-center justify-center mb-6 mx-auto shadow-sm"> <Package size={32} /> </div>
            <h2 className="text-xl font-black text-slate-900 mb-2 text-center">Quick Adjustment</h2>
            <p className="text-slate-400 text-center text-[10px] font-black uppercase tracking-widest mb-8">Adjust SKU Inventory Level</p>
            
            <div className="space-y-6 mb-10">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Variation Amount</label>
                <div className="relative">
                   <input type="number" className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-2xl font-black text-slate-900 outline-none transition-all" placeholder="e.g. -5 or +10" value={quickAdjustForm.quantity} onChange={(e) => setQuickAdjustForm({ ...quickAdjustForm, quantity: e.target.value })} autoFocus />
                   <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-1">
                      <button onClick={() => setQuickAdjustForm(p => ({...p, quantity: (Number(p.quantity) + 1).toString()}))} className="p-1 hover:text-indigo-600 text-slate-300 transition-colors"> <Plus size={16} /> </button>
                      <button onClick={() => setQuickAdjustForm(p => ({...p, quantity: (Number(p.quantity) - 1).toString()}))} className="p-1 hover:text-indigo-600 text-slate-300 transition-colors"> <Minus size={16} /> </button>
                   </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Adjustment Logic</label>
                <textarea className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-xs font-bold text-slate-700 outline-none transition-all shadow-inner" rows={3} placeholder="Provide audit reasoning..." value={quickAdjustForm.reason} onChange={(e) => setQuickAdjustForm({ ...quickAdjustForm, reason: e.target.value })} />
              </div>
            </div>
            
            <div className="flex gap-4">
              <button onClick={() => setIsQuickAdjustOpen(false)} className="flex-1 py-4.5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-2xl transition-all">Cancel</button>
              <button onClick={handleQuickAdjust} disabled={!quickAdjustForm.quantity || !quickAdjustForm.reason} className="flex-1 py-4.5 grad-blue text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-blue disabled:opacity-40 transition-all">Commit</button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Scanner Overlay */}
      {isInventoryScannerOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 animate-in fade-in duration-300">
           <div className="w-full h-full max-w-lg relative flex flex-col items-center justify-center p-6">
              <div className="absolute top-10 right-6 z-10 flex gap-4">
                  <button onClick={() => setIsInventoryScannerOpen(false)} className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md text-white flex items-center justify-center hover:bg-white/30 transition-all"> <X size={24} /> </button>
              </div>
              <div className="w-full aspect-square relative rounded-[3rem] overflow-hidden border-4 border-indigo-500 shadow-[0_0_50px_rgba(79,70,229,0.3)]">
                 <BarcodeScanner 
                    onScan={async (barcode) => {
                      setProductForm(p => ({ ...p, barcode }));
                      setIsInventoryScannerOpen(false);
                      success(`SKU detected: ${barcode}`);
                    }} 
                    onClose={() => setIsInventoryScannerOpen(false)} 
                    isInline={true}
                 />
                 <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                    <div className="w-4/5 h-1/2 border-2 border-indigo-500/50 rounded-2xl relative">
                       <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-indigo-500 rounded-tl-xl" />
                       <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-indigo-500 rounded-tr-xl" />
                       <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-indigo-500 rounded-bl-xl" />
                       <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-indigo-500 rounded-br-xl" />
                       <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-indigo-500/30 animate-pulse shadow-[0_0_15px_rgba(79,70,229,0.5)]" />
                    </div>
                 </div>
              </div>
              <div className="mt-12 text-center">
                 <h3 className="text-xl font-black text-white mb-2">Align SKU Barcode</h3>
                 <p className="text-indigo-300 text-xs font-bold uppercase tracking-[0.2em]">Automatic Detection Mode</p>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}

const Minus = ({ size, className }: { size: number, className?: string }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><line x1="5" y1="12" x2="19" y2="12"/></svg>;
