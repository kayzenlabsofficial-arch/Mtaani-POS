import React, { useState } from 'react';
import { Search, Plus, Package, AlertCircle, Tag as TagIcon, Barcode, Trash2, Save, Edit, FileStack, Clock, ArrowDownLeft, ArrowUpRight, Settings, ChevronRight, X, Utensils, GlassWater, ShoppingBag, Lightbulb } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import BarcodeScanner from '../shared/BarcodeScanner';

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
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isInventoryScannerOpen, setIsInventoryScannerOpen] = useState(false);
  const [isQuickAdjustOpen, setIsQuickAdjustOpen] = useState(false);
  const [quickAdjustForm, setQuickAdjustForm] = useState({ quantity: '', reason: '' });
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [selectedProductForDetails, setSelectedProductForDetails] = useState<Product | null>(null);
  const [productForm, setProductForm] = useState({
      name: '', category: 'Other', barcode: '', sellingPrice: '', stockQuantity: '', unit: 'pcs', taxCategory: 'A' as 'A'|'C'|'E', reason: '', imageUrl: ''
  });
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const { success, error } = useToast();
  
  const activeBranchId = useStore(state => state.activeBranchId);
  const stockMovementsData = useLiveQuery(
    () => selectedProductForDetails && activeBranchId ? db.stockMovements.where('productId').equals(selectedProductForDetails.id).and(m => m.branchId === activeBranchId).reverse().toArray() : [],
    [selectedProductForDetails, activeBranchId],
    []
  );

  const allProducts = useLiveQuery(() => db.products.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : [], [activeBranchId], []) || [];

  const performanceData = React.useMemo(() => {
     if (!selectedProductForDetails) return [];
     const salesMap = new Map<string, number>();
     
     // Last 7 days
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
  
  if (!allProducts) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
            <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                <Package size={32} className="text-slate-300" />
            </div>
            <p className="text-slate-400 font-black text-xs  ">Loading Inventory...</p>
        </div>
    );
  }

  const lowStock = allProducts.filter(p => p.stockQuantity <= 10);
  const filteredInventory = allProducts.filter(p => 
      p.name.toLowerCase().includes(inventorySearch.toLowerCase()) || 
      p.barcode.includes(inventorySearch)
  );

  const openAddProduct = () => {
      setSelectedProductForDetails(null);
      setEditingProduct(null);
      setProductForm({ name: '', category: 'Other', barcode: '', sellingPrice: '', stockQuantity: '', unit: 'pcs', taxCategory: 'A', reason: '', imageUrl: '' });
      setIsProductModalOpen(true);
  };

  const openProductDetails = (p: Product) => setSelectedProductForDetails(p);

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
          reason: '',
          imageUrl: selectedProductForDetails.imageUrl || ''
      });
      setSelectedProductForDetails(null);
      setIsProductModalOpen(true);
  };

   const handleSaveProduct = async () => {
      try {
          const payload = {
              name: productForm.name,
              category: productForm.category,
              barcode: productForm.barcode,
              sellingPrice: Number(productForm.sellingPrice),
              stockQuantity: Number(productForm.stockQuantity),
              unit: productForm.unit,
              taxCategory: productForm.taxCategory,
              imageUrl: productForm.imageUrl
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
                  
                  // Only update non-stock properties directly
                  await db.products.update(editingProduct.id, { 
                    name: payload.name, 
                    category: payload.category,
                    barcode: payload.barcode, 
                    sellingPrice: payload.sellingPrice, 
                    unit: payload.unit,
                    taxCategory: payload.taxCategory,
                    imageUrl: payload.imageUrl,
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
      } catch (err) {
          console.error("Save failed:", err);
          error("Failed to save product. Please try again.");
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
      const adjustQty = Number(quickAdjustForm.quantity);
      if (isNaN(adjustQty) || adjustQty === 0) return;

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
  };

  return (
    <div className="p-6 pb-24 animate-in fade-in max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-end mb-8">
         <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Inventory</h2>
            <p className="text-slate-500 text-sm font-medium">Control stock levels and product pricing.</p>
         </div>
         <button onClick={openAddProduct} className="grad-blue text-white px-5 py-3.5 rounded-2xl shadow-blue active:scale-95 transition-all flex items-center gap-2 font-black text-xs  ">
            <Plus size={18} /> New Product
         </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
         <div className="bg-white rounded-[28px] p-5 shadow-card border border-slate-100 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-sm">
               <Package size={24} />
            </div>
            <div>
               <p className="text-slate-400 text-[10px] font-black   mb-0.5">Total SKU</p>
               <h3 className="text-xl font-black text-slate-900 leading-none">{allProducts.length}</h3>
            </div>
         </div>
         <div className={`bg-white rounded-[28px] p-5 shadow-card border flex items-center gap-4 transition-colors ${lowStock.length > 0 ? 'border-amber-200' : 'border-slate-100'}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm transition-colors ${lowStock.length > 0 ? 'bg-amber-100 text-amber-600' : 'bg-green-100 text-green-600'}`}>
               <AlertCircle size={24} />
            </div>
            <div>
               <p className="text-slate-400 text-[10px] font-black   mb-0.5">Alerts</p>
               <h3 className={`text-xl font-black leading-none transition-colors ${lowStock.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{lowStock.length}</h3>
            </div>
         </div>
      </div>

      {/* Search Input */}
      <div className="relative mb-6">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder="Filter by name, category or barcode..."
          className="w-full pl-12 pr-4 py-4 bg-white rounded-[20px] border border-slate-200 text-sm text-slate-700 shadow-card focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-bold"
          value={inventorySearch}
          onChange={(e) => setInventorySearch(e.target.value)}
        />
      </div>

      {/* Product Table-like List */}
      <div className="space-y-3">
         {filteredInventory.map(product => {
            const cfg = getCategoryConfig(product.category || 'Other');
            const isLow = product.stockQuantity <= 10;
            const isCrit = product.stockQuantity <= 5;

            return (
              <div 
                key={product.id} 
                onClick={() => openProductDetails(product)} 
                className="group bg-white p-4 rounded-[24px] border border-slate-100 shadow-card flex items-center justify-between hover:border-blue-200 transition-all cursor-pointer press"
              >
                <div className="flex items-center gap-4">
                   <div className={`w-14 h-14 rounded-2xl ${cfg.light} border border-slate-100 flex items-center justify-center shadow-sm shrink-0 group-hover:scale-105 transition-transform`}>
                      <cfg.icon size={26} className={cfg.color} />
                   </div>
                   <div className="min-w-0">
                      <h4 className="text-[15px] font-black text-slate-900 truncate">{product.name}</h4>
                      <div className="flex items-center gap-3 mt-1.5 font-bold">
                         <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-1 rounded-lg border border-slate-100 flex items-center gap-1  tracking-tight">
                            <Barcode size={10} /> {product.barcode}
                         </span>
                         <span className="text-xs text-blue-600 tabular-nums">
                            Ksh {product.sellingPrice.toLocaleString()}
                         </span>
                      </div>
                   </div>
                </div>
                <div className="flex items-center gap-4">
                   <div className="text-right hidden sm:block">
                     <p className="text-[10px] font-black text-slate-400   leading-none mb-1">Status</p>
                     <p className={`text-xs font-black  tracking-tighter ${isLow ? 'text-amber-500' : 'text-green-500'}`}>
                        {isLow ? 'Low Stock' : 'Good'}
                     </p>
                   </div>
                   <div className={`w-20 py-2.5 rounded-2xl text-center flex flex-col items-center justify-center border ${
                      isCrit ? 'bg-red-50 border-red-100 text-red-600' : 
                      isLow ? 'bg-amber-50 border-amber-100 text-amber-600' : 
                      'bg-green-50 border-green-100 text-green-600'
                   }`}>
                      <span className="text-sm font-black leading-none">{product.stockQuantity}</span>
                      <span className="text-[8px] font-black   mt-1 opacity-70">{product.unit || 'Units'}</span>
                   </div>
                   <ChevronRight className="text-slate-300 group-hover:text-blue-400 transition-colors" size={20} />
                </div>
              </div>
            );
         })}
         
         {filteredInventory.length === 0 && (
            <div className="py-20 text-center flex flex-col items-center slide-up">
               <div className="w-20 h-20 bg-slate-50 rounded-[32px] flex items-center justify-center mb-4 transition-transform hover:rotate-12 cursor-default">
                 <Search size={40} className="text-slate-200" />
               </div>
               <p className="text-slate-500 font-black text-sm  ">No Matches</p>
               <p className="text-slate-400 text-xs mt-1">Try a different search term or add a product.</p>
            </div>
         )}
      </div>

      {/* Product Management Modal */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsProductModalOpen(false)} />
           <div className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[32px] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto custom-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center text-white shadow-blue">
                     {editingProduct ? <Edit size={24} /> : <Plus size={24} />}
                   </div>
                   <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight">
                        {editingProduct ? 'Update Product' : 'New Product Entry'}
                     </h2>
                     <p className="text-slate-400 text-xs font-bold  ">Master Inventory Record</p>
                   </div>
                 </div>
                 {editingProduct && (
                    <button onClick={handleDeleteProduct} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors press">
                       <Trash2 size={20} />
                    </button>
                 )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                  <div className="col-span-1 md:col-span-2">
                      <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Product Designation</label>
                      <input type="text" value={productForm.name} onChange={(e) => setProductForm({...productForm, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all" placeholder="e.g. Premium White Rice 1kg" />
                  </div>
                  <div>
                      <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Market Category</label>
                      <div className="relative">
                        <select value={productForm.category} onChange={(e) => setProductForm({...productForm, category: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 appearance-none">
                           {categories?.map(cat => (
                             <option key={cat.id} value={cat.name}>{cat.name}</option>
                           ))}
                           {!categories?.find(c => c.name === 'Other') && <option value="Other">Other</option>}
                        </select>
                        <Settings className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                      </div>
                  </div>
                  <div>
                     <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Universal Barcode / SKU</label>
                     <div className="relative flex gap-2">
                        <div className="relative flex-1">
                           <input type="text" value={productForm.barcode} onChange={(e) => setProductForm({...productForm, barcode: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-4 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all font-mono " placeholder="000000000000" />
                           <Barcode className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        </div>
                        <button 
                           onClick={() => setIsInventoryScannerOpen(true)}
                           className="w-14 bg-slate-900 text-white rounded-2xl flex items-center justify-center hover:bg-slate-800 transition-all active:scale-95"
                           title="Scan Product Barcode"
                        >
                           <Search size={18} />
                        </button>
                     </div>
                  </div>
                  <div>
                     <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Unit Selling Price</label>
                     <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black text-xs">KSH</span>
                        <input type="number" value={productForm.sellingPrice} onChange={(e) => setProductForm({...productForm, sellingPrice: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-14 pr-4 py-4 text-[17px] font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all tabular-nums" placeholder="0" />
                     </div>
                  </div>
                  <div className="col-span-1 md:col-span-2">
                       <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Product Visual (KV Storage)</label>
                       <div className="flex gap-4 items-center">
                          <div className="w-24 h-24 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex items-center justify-center relative overflow-hidden group">
                             {productForm.imageUrl ? (
                                <img src={productForm.imageUrl} className="w-full h-full object-cover" />
                             ) : (
                                <Package size={32} className="text-slate-200 group-hover:scale-110 transition-transform" />
                             )}
                             <input 
                               type="file" 
                               accept="image/*" 
                               className="absolute inset-0 opacity-0 cursor-pointer" 
                               onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const formData = new FormData();
                                  formData.append('file', file);
                                  try {
                                    const res = await fetch('/api/images', { method: 'POST', body: formData });
                                    const data = await res.json() as any;
                                    setProductForm({ ...productForm, imageUrl: data.url });
                                  } catch (err) {
                                    console.error("Upload failed:", err);
                                  }
                               }}
                             />
                          </div>
                          <div>
                             <p className="text-xs font-bold text-slate-600">Upload to Cloudflare KV</p>
                             <p className="text-[10px] text-slate-400 mt-1 max-w-[200px]">Optimal size 512x512px. Images are served from the edge.</p>
                          </div>
                       </div>
                  </div>
                  <div className="flex gap-4">
                     <div className="flex-1">
                        <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Inventory Level</label>
                        <input type="number" step="any" value={productForm.stockQuantity} onChange={(e) => setProductForm({...productForm, stockQuantity: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-[17px] font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all tabular-nums" placeholder="0" />
                     </div>
                     <div className="w-32">
                        <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">Unit</label>
                        <input type="text" value={productForm.unit} onChange={(e) => setProductForm({...productForm, unit: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-[17px] font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all" placeholder="pcs" />
                     </div>
                  </div>
                  <div className="col-span-1 md:col-span-2">
                     <label className="block text-[11px] font-black text-slate-400   mb-2 ml-1">KRA e-TIMS Tax Class</label>
                     <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'A', label: '16% Standard' },
                          { id: 'C', label: '0% Exempt' },
                          { id: 'E', label: '8% Special' }
                        ].map(tax => (
                          <button 
                            key={tax.id}
                            onClick={() => setProductForm({...productForm, taxCategory: tax.id as any})}
                            className={`py-3.5 rounded-2xl border-2 text-[10px] font-black   transition-all ${
                              productForm.taxCategory === tax.id 
                                ? 'border-blue-600 bg-blue-50 text-blue-700' 
                                : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'
                            }`}
                          >
                            Class {tax.id} <br/> <span className="opacity-70">{tax.label}</span>
                          </button>
                        ))}
                     </div>
                  </div>

                  {editingProduct && Number(productForm.stockQuantity) !== editingProduct.stockQuantity && (
                    <div className="col-span-1 md:col-span-2 animate-in slide-in-from-top-2">
                       <label className="block text-[11px] font-black text-amber-600   mb-2 ml-1">Audit Reason Required</label>
                       <textarea 
                          value={productForm.reason} 
                          onChange={(e) => setProductForm({...productForm, reason: e.target.value})} 
                          rows={2}
                          className="w-full bg-amber-50/50 border border-amber-200 rounded-2xl px-5 py-4 text-sm font-bold text-slate-700 focus:outline-none focus:border-amber-500 transition-all italic" 
                          placeholder="Why is this stock level being adjusted? (e.g. Breakage, Spoilt, Correcting count)"
                       />
                    </div>
                  )}
              </div>

              <div className="flex gap-4 shrink-0">
                 <button onClick={() => setIsProductModalOpen(false)} className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-black text-xs   rounded-2xl transition-all press">
                   Close
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
                    className="flex-[2] grad-blue text-white px-6 py-4 font-black text-xs   rounded-2xl disabled:opacity-40 transition-all shadow-blue press flex items-center justify-center gap-2"
                  >
                    <Save size={18} />
                    {editingProduct &&
                     Math.abs(Number(productForm.stockQuantity) - editingProduct.stockQuantity) > 0
                       ? 'Submit & Request Approval'
                       : 'Save Changes'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Product Details & Movements Modal */}
      {selectedProductForDetails && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedProductForDetails(null)} />
           <div className="bg-white w-full max-w-md rounded-t-[40px] sm:rounded-[32px] shadow-elevated relative z-10 flex flex-col pt-8 pb-10 px-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[90vh]">
              <button 
                onClick={() => setSelectedProductForDetails(null)}
                className="absolute top-8 right-8 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors sm:hidden"
              >
                <X size={18} />
              </button>

              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div>
                   <h2 className="text-xl font-black text-slate-900 tracking-tight">Stock Insight</h2>
                   <p className="text-slate-400 text-xs font-bold   mt-0.5">Inventory Tracking Ledger</p>
                 </div>
                 <div className="flex gap-2">
                    <button 
                        onClick={() => { setIsQuickAdjustOpen(true); setQuickAdjustForm({ quantity: '', reason: '' }); }} 
                        className="bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all px-4 py-2.5 rounded-xl font-bold text-[10px] flex items-center gap-2   press"
                    >
                        Adjust
                    </button>
                    <button onClick={openEditProductFromDetails} className="bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all px-4 py-2.5 rounded-xl font-bold text-[10px] flex items-center gap-2   press">
                        <Edit size={14} /> Edit
                    </button>
                 </div>
              </div>

              {/* Summary Card */}
              <div className="grad-blue rounded-[28px] p-6 text-white shadow-blue mb-8 shrink-0 relative overflow-hidden">
                 <Package className="absolute -right-6 -bottom-6 w-32 h-32 text-white/10 rotate-12" />
                 <div className="relative z-10">
                   <div className="flex justify-between items-start mb-4">
                     <span className="text-blue-100 text-[10px] font-black  tracking-[0.2em]">{selectedProductForDetails.barcode}</span>
                     <span className="bg-white/20 text-white text-[10px] font-black px-2.5 py-1 rounded-lg border border-white/10  ">
                       {selectedProductForDetails.category || 'Standard'}
                     </span>
                   </div>
                   <h3 className="text-xl font-black mb-6 pr-10">{selectedProductForDetails.name}</h3>
                   <div className="grid grid-cols-2 gap-6">
                      <div>
                         <p className="text-blue-200 text-[10px] font-black   mb-1">Available Qty</p>
                         <p className="text-3xl font-black tabular-nums">{selectedProductForDetails.stockQuantity} <span className="text-sm opacity-60">{selectedProductForDetails.unit || 'pcs'}</span></p>
                      </div>
                      <div>
                         <p className="text-blue-200 text-[10px] font-black   mb-1">Selling Price</p>
                         <p className="text-3xl font-black tabular-nums">Ksh {selectedProductForDetails.sellingPrice.toLocaleString()}</p>
                      </div>
                   </div>
                 </div>
              </div>

              {/* Performance & History Section */}
              <div className="flex-1 overflow-y-auto no-scrollbar pb-4 pr-1">
                 <div className="mb-6" id="performance-chart-container">
                    <div className="flex items-center justify-between mb-4">
                       <h3 className="text-[11px] font-black text-slate-400  tracking-[0.2em] flex items-center gap-2">
                          <BarChart size={14} /> Performance (Last 7 Days)
                       </h3>
                       <button onClick={exportPerformancePDF} className="text-[10px] bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg font-bold hover:bg-slate-200 transition-colors">
                          Export PDF
                       </button>
                    </div>
                    <div className="bg-slate-50 rounded-2xl p-4 h-48 border border-slate-100">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={performanceData}>
                                <XAxis dataKey="date" tick={{fontSize: 10}} axisLine={false} tickLine={false} />
                                <YAxis hide />
                                <Tooltip cursor={{fill: 'transparent'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                                <Bar dataKey="qty" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                 </div>

                 <h3 className="text-[11px] font-black text-slate-400  tracking-[0.2em] flex items-center gap-2 mb-4 shrink-0">
                    <FileStack size={14} /> Movement Logs
                 </h3>
                 <div className="flex-1 min-h-0">
                    {stockMovementsData.length === 0 ? (
                       <div className="text-center py-12 flex flex-col items-center">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-200">
                            <Clock size={32} />
                          </div>
                          <p className="text-slate-400 font-bold text-xs  ">No activities found</p>
                       </div>
                    ) : (
                       <div className="space-y-3 pb-4">
                          {stockMovementsData.map(movement => (
                             <div key={movement.id} className="flex items-center justify-between p-4 rounded-2xl border border-slate-50 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                <div className="flex gap-4 items-center min-w-0">
                                   <div className={`w-9 h-9 rounded-[14px] flex items-center justify-center shrink-0 shadow-sm ${
                                      movement.type === 'IN' ? 'bg-green-100 text-green-600' : 
                                      movement.type === 'OUT' ? 'bg-orange-100 text-orange-600' : 
                                      'bg-blue-100 text-blue-600'
                                   }`}>
                                      {movement.type === 'IN' ? <ArrowDownLeft size={16} /> : 
                                       movement.type === 'OUT' ? <ArrowUpRight size={16} /> : 
                                       <Settings size={16} />}
                                   </div>
                                   <div className="min-w-0">
                                      <p className="text-[13px] font-black text-slate-900 truncate">{movement.reference}</p>
                                      <p className="text-[10px] font-bold text-slate-400 mt-0.5">{new Date(movement.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p>
                                   </div>
                                </div>
                                <div className={`text-[15px] font-black tabular-nums transition-colors ${movement.quantity > 0 ? 'text-green-600' : 'text-orange-600'}`}>
                                   {movement.quantity > 0 ? '+' : ''}{movement.quantity} <span className="text-[10px] opacity-50">{selectedProductForDetails.unit || 'pcs'}</span>
                                </div>
                             </div>
                          ))}
                       </div>
                    )}
                 </div>
              </div>
              <button onClick={() => setSelectedProductForDetails(null)} className="mt-8 w-full bg-slate-900 text-white font-black text-xs   py-4 rounded-2xl active:scale-95 transition-all shadow-lg shadow-slate-900/10 shrink-0">
                 Finish View
              </button>
           </div>
        </div>
       )}

       {/* Quick Adjust Modal */}
       {isQuickAdjustOpen && selectedProductForDetails && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
             <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsQuickAdjustOpen(false)} />
             <div className="bg-white w-full max-w-sm rounded-[28px] shadow-elevated relative z-10 flex flex-col p-6 animate-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-blue-50 text-blue-600 flex items-center justify-center rounded-xl">
                        <Settings size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-black text-slate-900 leading-none">Quick Adjust</h3>
                        <p className="text-[10px] text-slate-400 font-bold   mt-1">{selectedProductForDetails.name}</p>
                    </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl mb-6 flex justify-between items-center border border-slate-100">
                    <span className="text-xs font-bold text-slate-500  ">Current Stock</span>
                    <span className="text-xl font-black text-slate-900 tabular-nums">{selectedProductForDetails.stockQuantity}</span>
                </div>

                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Adjustment Amount (+/-)</label>
                        <input 
                            type="number" 
                            value={quickAdjustForm.quantity} 
                            onChange={(e) => setQuickAdjustForm({...quickAdjustForm, quantity: e.target.value})}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all tabular-nums" 
                            placeholder="+10 or -5" 
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-amber-600   mb-1.5 ml-1">Reason (Required)</label>
                        <input 
                            type="text" 
                            value={quickAdjustForm.reason} 
                            onChange={(e) => setQuickAdjustForm({...quickAdjustForm, reason: e.target.value})}
                            className="w-full bg-amber-50/50 border border-amber-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:outline-none focus:border-amber-500 transition-all italic" 
                            placeholder="Why adjusting?" 
                        />
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={() => setIsQuickAdjustOpen(false)} className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold text-[10px]   rounded-xl transition-all press">Cancel</button>
                    <button 
                        onClick={handleQuickAdjust}
                        disabled={!quickAdjustForm.quantity || Number(quickAdjustForm.quantity) === 0 || !quickAdjustForm.reason}
                        className="flex-[2] py-3.5 bg-blue-600 text-white font-bold text-[10px]   rounded-xl disabled:opacity-50 transition-all shadow-lg shadow-blue-600/20 press"
                    >
                        Confirm Adjust
                    </button>
                </div>
             </div>
          </div>
       )}

      {/* Barcode Scanner for Inventory */}
      {isInventoryScannerOpen && (
         <BarcodeScanner 
            onClose={() => setIsInventoryScannerOpen(false)}
            onScan={(barcode) => {
               setProductForm({ ...productForm, barcode });
               setIsInventoryScannerOpen(false);
               success("Barcode scanned successfully.");
            }}
         />
      )}
    </div>
  );
}
