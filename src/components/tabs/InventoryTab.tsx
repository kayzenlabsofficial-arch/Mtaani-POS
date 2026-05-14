import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product } from '../../db';
import { useStore } from '../../store';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { useToast } from '../../context/ToastContext';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: React.CSSProperties }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
);

const CARD_COLORS = [
  'bg-blue-600', 'bg-violet-600', 'bg-emerald-600',
  'bg-amber-500', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600', 'bg-orange-500',
];
function colorFor(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return CARD_COLORS[Math.abs(hash) % CARD_COLORS.length];
}

const CATEGORY_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500',
  'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500',
];

export default function InventoryTab() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'stock' | 'price'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isRestocking, setIsRestocking] = useState(false);
  const [restockQty, setRestockQty] = useState('');
  const [restockCost, setRestockCost] = useState('');
  const [productForm, setProductForm] = useState({
    name: '',
    category: 'General',
    sellingPrice: '',
    costPrice: '',
    stockQuantity: '',
    unit: 'pcs',
    barcode: '',
    reorderPoint: '5',
    taxCategory: 'A' as 'A' | 'C' | 'E'
  });
  const scrollRef = useHorizontalScroll();
  const activeBusinessId = useStore(s => s.activeBusinessId);
  const activeBranchId = useStore(s => s.activeBranchId);
  const { success, error } = useToast();

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId) return Promise.resolve([]);
      const query = db.products.where('businessId').equals(activeBusinessId);
      if (selectedCategory) {
        return query.filter(p =>
          p.category === selectedCategory &&
          (p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search)))
        ).toArray();
      }
      return query.filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search))
      ).toArray();
    },
    [search, selectedCategory, activeBusinessId], []
  );

  const categories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );

  const selectedMovements = useLiveQuery(
    () => selectedProduct ? db.stockMovements.where('productId').equals(selectedProduct.id).toArray() : Promise.resolve([]),
    [selectedProduct?.id],
    []
  );

  const selectedSales = useLiveQuery(
    () => selectedProduct && activeBranchId
      ? db.transactions.where('branchId').equals(activeBranchId).filter(t => (t.items || []).some((i: any) => i.productId === selectedProduct.id)).toArray()
      : Promise.resolve([]),
    [selectedProduct?.id, activeBranchId],
    []
  );

  const sorted = [...(products || [])].sort((a, b) => {
    let res = 0;
    if (sortBy === 'name') res = a.name.localeCompare(b.name);
    else if (sortBy === 'stock') res = (a.stockQuantity || 0) - (b.stockQuantity || 0);
    else if (sortBy === 'price') res = a.sellingPrice - b.sellingPrice;
    return sortDir === 'asc' ? res : -res;
  });

  const totalValue = products?.reduce((a, p) => a + ((p.stockQuantity || 0) * (p.sellingPrice || 0)), 0) || 0;
  const outOfStock = products?.filter(p => (p.stockQuantity || 0) <= 0).length || 0;
  const lowStock = products?.filter(p => {
    const qty = p.stockQuantity || 0;
    return qty > 0 && qty <= (p.reorderPoint || 5);
  }).length || 0;

  const toggleSort = (col: 'name' | 'stock' | 'price') => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const openProductModal = (product?: Product) => {
    setEditingProduct(product || null);
    setProductForm({
      name: product?.name || '',
      category: product?.category || selectedCategory || 'General',
      sellingPrice: product?.sellingPrice ? String(product.sellingPrice) : '',
      costPrice: (product as any)?.costPrice ? String((product as any).costPrice) : '',
      stockQuantity: product?.stockQuantity !== undefined ? String(product.stockQuantity) : '0',
      unit: product?.unit || 'pcs',
      barcode: product?.barcode || '',
      reorderPoint: product?.reorderPoint !== undefined ? String(product.reorderPoint) : '5',
      taxCategory: product?.taxCategory || 'A'
    });
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!activeBusinessId || !activeBranchId || !productForm.name.trim()) return;
    const payload = {
      name: productForm.name.trim(),
      category: productForm.category.trim() || 'General',
      sellingPrice: Number(productForm.sellingPrice) || 0,
      costPrice: Number(productForm.costPrice) || 0,
      taxCategory: productForm.taxCategory,
      stockQuantity: Number(productForm.stockQuantity) || 0,
      unit: productForm.unit.trim() || 'pcs',
      barcode: productForm.barcode.trim() || `SKU-${Date.now()}`,
      reorderPoint: Number(productForm.reorderPoint) || 5,
      branchId: activeBranchId,
      businessId: activeBusinessId
    };
    try {
      if (editingProduct) {
        await db.products.update(editingProduct.id, payload as any);
        if (selectedProduct?.id === editingProduct.id) setSelectedProduct({ ...selectedProduct, ...payload });
        success('Product updated.');
      } else {
        await db.products.add({ id: crypto.randomUUID(), ...payload } as any);
        success('Product added.');
      }
      setIsProductModalOpen(false);
      setEditingProduct(null);
    } catch (err: any) {
      error('Failed to save product: ' + err.message);
    }
  };

  const handleRestock = async () => {
    if (!selectedProduct || !activeBusinessId || !activeBranchId) return;
    const qty = Number(restockQty);
    if (qty <= 0) return error('Enter a valid restock quantity.');
    try {
      await db.products.update(selectedProduct.id, {
        stockQuantity: (selectedProduct.stockQuantity || 0) + qty,
        ...(restockCost ? { costPrice: Number(restockCost) || 0 } : {})
      } as any);
      await db.stockMovements.add({
        id: crypto.randomUUID(),
        productId: selectedProduct.id,
        type: 'IN',
        quantity: qty,
        timestamp: Date.now(),
        reference: 'Manual restock',
        branchId: activeBranchId,
        businessId: activeBusinessId
      });
      setSelectedProduct({
        ...selectedProduct,
        stockQuantity: (selectedProduct.stockQuantity || 0) + qty,
        ...(restockCost ? { costPrice: Number(restockCost) || 0 } : {})
      });
      setRestockQty('');
      setRestockCost('');
      setIsRestocking(false);
      success('Stock updated.');
    } catch (err: any) {
      error('Failed to restock: ' + err.message);
    }
  };

  const productSales = selectedProduct ? (selectedSales || []).flatMap((tx: any) =>
    (tx.items || [])
      .filter((item: any) => item.productId === selectedProduct.id)
      .map((item: any) => ({ tx, item }))
  ) : [];
  const soldUnits = productSales.reduce((sum, row) => sum + (Number(row.item.quantity) || 0), 0);
  const revenue = productSales.reduce((sum, row) => sum + ((Number(row.item.quantity) || 0) * (Number(row.item.snapshotPrice) || 0)), 0);
  const cost = productSales.reduce((sum, row) => sum + ((Number(row.item.quantity) || 0) * (Number(row.item.snapshotCost ?? selectedProduct?.costPrice ?? 0) || 0)), 0);
  const grossProfit = revenue - cost;
  const movementIn = (selectedMovements || []).filter(m => m.type === 'IN' || m.quantity > 0).reduce((sum, m) => sum + Math.abs(Number(m.quantity) || 0), 0);
  const movementOut = (selectedMovements || []).filter(m => m.type !== 'IN' && m.quantity < 0).reduce((sum, m) => sum + Math.abs(Number(m.quantity) || 0), 0);
  const chartData = Array.from({ length: 8 }).map((_, idx) => {
    const day = new Date();
    day.setDate(day.getDate() - (7 - idx));
    day.setHours(0, 0, 0, 0);
    const next = day.getTime() + 86400000;
    const rows = productSales.filter(row => (row.tx.timestamp || 0) >= day.getTime() && (row.tx.timestamp || 0) < next);
    return {
      label: day.toLocaleDateString('en-KE', { weekday: 'short' }),
      sales: rows.reduce((sum, row) => sum + ((Number(row.item.quantity) || 0) * (Number(row.item.snapshotPrice) || 0)), 0),
      units: rows.reduce((sum, row) => sum + (Number(row.item.quantity) || 0), 0)
    };
  });

  const SortIcon = ({ col }: { col: 'name' | 'stock' | 'price' }) =>
    sortBy === col ? (
      <MaterialIcon name={sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'} className="text-primary" style={{ fontSize: '13px' }} />
    ) : (
      <MaterialIcon name="unfold_more" className="text-slate-300" style={{ fontSize: '13px' }} />
    );

  return (
    <div className="flex flex-col h-full animate-in fade-in pb-24 gap-5">

      {/* Page heading */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900">Inventory</h2>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
            {products?.length || 0} products across {categories?.length || 0} categories
          </p>
        </div>
        <button onClick={() => openProductModal()} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start">
          <MaterialIcon name="add" style={{ fontSize: '20px' }} />
          Add Product
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Products', value: products?.length || 0, icon: 'inventory_2', color: 'bg-primary', unit: '' },
          { label: 'Stock Value', value: `Ksh ${totalValue.toLocaleString()}`, icon: 'payments', color: 'bg-emerald-600', unit: '' },
          { label: 'Low Stock', value: lowStock, icon: 'warning', color: 'bg-amber-500', unit: 'items' },
          { label: 'Out of Stock', value: outOfStock, icon: 'do_not_disturb_on', color: 'bg-rose-600', unit: 'items' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-4 hover:shadow-sm transition-all">
            <div className={`w-10 h-10 ${kpi.color} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm`}>
              <MaterialIcon name={kpi.icon} className="text-white" style={{ fontSize: '20px' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{kpi.label}</p>
              <p className="text-lg font-black text-slate-900 tabular-nums truncate">{kpi.value} <span className="text-xs font-medium text-slate-400">{kpi.unit}</span></p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar: Search + Categories */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative group flex-1">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
            <MaterialIcon name="search" style={{ fontSize: '18px' }} />
          </div>
          <input
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none transition-all shadow-sm"
            placeholder="Search by name or barcode..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <MaterialIcon name="close" style={{ fontSize: '16px' }} />
            </button>
          )}
        </div>

        <div ref={scrollRef} className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border flex-shrink-0 ${
              !selectedCategory ? 'bg-primary text-white border-primary shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:border-primary/30'
            }`}
          >
            All
          </button>
          {categories?.map((cat, i) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.name)}
              className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border flex-shrink-0 ${
                selectedCategory === cat.name ? 'bg-primary text-white border-primary shadow-md' : 'bg-white border-slate-200 text-slate-600 hover:border-primary/30'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden flex-1 flex flex-col min-h-0">

        {/* Table header */}
        <div className="hidden md:flex items-center gap-4 px-6 py-3 bg-slate-50 border-b border-slate-100 flex-shrink-0">
          <button className="flex-[1.6] min-w-0 flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left hover:text-slate-700 transition-colors" onClick={() => toggleSort('name')}>
            Product <SortIcon col="name" />
          </button>
          <div className="w-40 text-[10px] font-black text-slate-400 uppercase tracking-widest">Barcode</div>
          <div className="w-20 text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit</div>
          <button className="w-32 flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-700 transition-colors" onClick={() => toggleSort('stock')}>
            Stock <SortIcon col="stock" />
          </button>
          <button className="w-32 flex items-center gap-1 justify-end text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-700 transition-colors" onClick={() => toggleSort('price')}>
            Price <SortIcon col="price" />
          </button>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-slate-50">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-3">
                <MaterialIcon name="inventory" className="text-slate-300" style={{ fontSize: '32px' }} />
              </div>
              <p className="text-sm font-bold text-slate-400">No products found</p>
            </div>
          ) : sorted.map(product => {
            const stock = product.stockQuantity || 0;
            const isOut = stock <= 0;
            const isLow = !isOut && stock <= (product.reorderPoint || 5);
            const catIdx = categories?.findIndex(c => c.name === product.category) ?? 0;
            const catColor = CATEGORY_COLORS[catIdx % CATEGORY_COLORS.length];

            return (
              <button
                type="button"
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className="w-full text-left flex items-center gap-2 sm:gap-4 flex-wrap md:flex-nowrap px-3 sm:px-4 md:px-6 py-2.5 hover:bg-slate-50 transition-colors cursor-pointer group"
              >
                {/* Product info */}
                <div className="flex-[1.6] min-w-[min(100%,14rem)] flex items-center gap-3">
                  <div className={`w-10 h-10 ${colorFor(product.name)} rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm opacity-90`}>
                    <span className="text-white text-xs font-black">{product.name.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-slate-900 truncate group-hover:text-primary transition-colors">{product.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${catColor}`} />
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide truncate">{product.category || 'General'}</span>
                      {product.taxCategory === 'A' && (
                        <span className="text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">VAT</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Barcode */}
                <div className="w-auto md:w-40">
                  <span className="font-mono text-[10px] text-slate-500 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg">
                    {product.barcode || '---'}
                  </span>
                </div>

                {/* Unit */}
                <div className="w-auto md:w-20">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{product.unit || 'pcs'}</span>
                </div>

                {/* Stock */}
                <div className="w-auto md:w-32 flex items-center gap-2">
                  <span className={`text-[13px] font-black tabular-nums ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                    {stock}
                  </span>
                  {isLow && !isOut && (
                    <span className="text-[8px] font-black bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full">LOW</span>
                  )}
                  {isOut && (
                    <span className="text-[8px] font-black bg-rose-50 text-rose-700 border border-rose-100 px-1.5 py-0.5 rounded-full">OUT</span>
                  )}
                </div>

                {/* Price */}
                <div className="w-auto md:w-32 text-left md:text-right ml-auto">
                  <p className="text-[13px] font-black text-slate-900 tabular-nums">Ksh {product.sellingPrice?.toLocaleString()}</p>
                  {product.costPrice && (
                    <p className="text-[9px] font-medium text-slate-400">Cost: Ksh {product.costPrice.toLocaleString()}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer count */}
        {sorted.length > 0 && (
          <div className="flex-shrink-0 px-6 py-3 border-t border-slate-50 bg-slate-50/50">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Showing {sorted.length} of {products?.length || 0} products
            </p>
          </div>
        )}
      </div>

      {/* FAB */}
      <button onClick={() => openProductModal()} className="fixed bottom-24 md:bottom-8 right-6 md:right-8 w-14 h-14 bg-primary text-white rounded-2xl shadow-2xl shadow-primary/30 flex items-center justify-center z-40 hover:bg-blue-700 active:scale-95 transition-all">
        <MaterialIcon name="add" style={{ fontSize: '28px' }} />
      </button>

      {/* Product detail slide-over */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-end">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setSelectedProduct(null)} />
          <div className="relative bg-white w-full md:w-96 md:h-full md:max-h-full h-auto max-h-[85vh] rounded-t-3xl md:rounded-none shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom md:slide-in-from-right duration-300">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 flex-shrink-0">
              <h3 className="text-base font-black text-slate-900">Product Details</h3>
              <button onClick={() => setSelectedProduct(null)} className="w-9 h-9 rounded-xl hover:bg-slate-100 flex items-center justify-center transition-colors">
                <MaterialIcon name="close" style={{ fontSize: '20px' }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-5">
              {/* Icon + name */}
              <div className="flex items-start gap-4">
                <div className={`w-16 h-16 ${colorFor(selectedProduct.name)} rounded-2xl flex items-center justify-center flex-shrink-0`}>
                  <span className="text-white text-xl font-black">{selectedProduct.name.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase()}</span>
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-900 leading-tight">{selectedProduct.name}</h4>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">{selectedProduct.category}</p>
                  {selectedProduct.taxCategory === 'A' && (
                    <span className="text-[9px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full mt-1 inline-block">VAT Applicable</span>
                  )}
                </div>
              </div>

              {/* Details grid */}
              {[
                { label: 'Selling Price', value: `Ksh ${selectedProduct.sellingPrice?.toLocaleString()}` },
                { label: 'Cost Price', value: selectedProduct.costPrice ? `Ksh ${selectedProduct.costPrice.toLocaleString()}` : '—' },
                { label: 'Stock Qty', value: `${selectedProduct.stockQuantity || 0} ${selectedProduct.unit || 'pcs'}` },
                { label: 'Reorder Point', value: selectedProduct.reorderPoint || 5 },
                { label: 'Barcode', value: selectedProduct.barcode || '---' },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center py-3 border-b border-slate-50">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{row.label}</span>
                  <span className="text-[13px] font-black text-slate-900">{row.value}</span>
                </div>
              ))}

              <div className="grid grid-cols-2 gap-3 pt-2">
                {[
                  { label: 'Units Sold', value: soldUnits.toLocaleString(), color: 'text-blue-600' },
                  { label: 'Revenue', value: `Ksh ${revenue.toLocaleString()}`, color: 'text-emerald-600' },
                  { label: 'Gross Profit', value: `Ksh ${grossProfit.toLocaleString()}`, color: grossProfit >= 0 ? 'text-slate-900' : 'text-rose-600' },
                  { label: 'Stock In / Out', value: `${movementIn.toLocaleString()} / ${movementOut.toLocaleString()}`, color: 'text-indigo-600' },
                ].map(metric => (
                  <div key={metric.label} className="bg-slate-50 border border-slate-100 rounded-2xl p-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{metric.label}</p>
                    <p className={`text-sm font-black tabular-nums mt-1 ${metric.color}`}>{metric.value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-950 rounded-2xl p-4 text-white">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">8-Day Performance</p>
                    <p className="text-xs font-bold text-slate-200">Sales value and unit movement</p>
                  </div>
                  <MaterialIcon name="monitoring" className="text-emerald-300" style={{ fontSize: '20px' }} />
                </div>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#34d399" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#34d399" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#020617', border: '1px solid #334155', borderRadius: 12, color: '#fff' }} />
                      <Area type="monotone" dataKey="sales" stroke="#34d399" strokeWidth={3} fill="url(#salesGlow)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recent Movement</p>
                  <span className="text-[9px] font-bold text-slate-400">{(selectedMovements || []).length} entries</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                  {[...(selectedMovements || [])]
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .slice(0, 8)
                    .map(move => (
                      <div key={move.id} className="flex items-center justify-between bg-white border border-slate-100 rounded-xl px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-slate-800 truncate">{move.reference || move.type}</p>
                          <p className="text-[9px] font-bold text-slate-400">{new Date(move.timestamp).toLocaleString('en-KE')}</p>
                        </div>
                        <span className={`text-xs font-black tabular-nums ${move.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {move.quantity >= 0 ? '+' : ''}{move.quantity}
                        </span>
                      </div>
                    ))}
                  {(selectedMovements || []).length === 0 && (
                    <div className="text-center py-6 text-[10px] font-bold text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      No stock movement recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 p-6 border-t border-slate-100 grid grid-cols-2 gap-3">
              <button onClick={() => openProductModal(selectedProduct)} className="py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
                <MaterialIcon name="edit" style={{ fontSize: '18px' }} /> Edit
              </button>
              <button onClick={() => setIsRestocking(true)} className="py-3 bg-primary text-white rounded-xl text-sm font-bold shadow-md shadow-primary/20 hover:bg-blue-700 transition-all flex items-center justify-center gap-2">
                <MaterialIcon name="add" style={{ fontSize: '18px' }} /> Restock
              </button>
            </div>
          </div>
        </div>
      )}

      {isRestocking && selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setIsRestocking(false)} />
          <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 z-10">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-black text-slate-900">Restock Item</h3>
              <button onClick={() => setIsRestocking(false)} className="w-9 h-9 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-700">
                <MaterialIcon name="close" style={{ fontSize: '20px' }} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Quantity Received</label>
                <input type="number" step="any" value={restockQty} onChange={e => setRestockQty(e.target.value)} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" placeholder="0" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Latest Unit Cost</label>
                <input type="number" step="any" value={restockCost} onChange={e => setRestockCost(e.target.value)} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" placeholder="Optional" />
              </div>
              <button onClick={handleRestock} disabled={!restockQty || Number(restockQty) <= 0} className="w-full py-3.5 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50">
                Update Stock
              </button>
            </div>
          </div>
        </div>
      )}

      {isProductModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsProductModalOpen(false)} />
          <div className="relative bg-white w-full max-w-lg max-h-[92vh] overflow-y-auto no-scrollbar rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 z-10">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-slate-900">{editingProduct ? 'Edit Product' : 'Add Product'}</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inventory master record</p>
              </div>
              <button onClick={() => setIsProductModalOpen(false)} className="w-10 h-10 rounded-xl bg-slate-50 text-slate-400 hover:text-slate-700">
                <MaterialIcon name="close" style={{ fontSize: '20px' }} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Product Name</label>
                <input value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" placeholder="e.g. 2kg Maize Flour" autoFocus />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Category</label>
                <input value={productForm.category} onChange={e => setProductForm({ ...productForm, category: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Barcode</label>
                <input value={productForm.barcode} onChange={e => setProductForm({ ...productForm, barcode: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" placeholder="Auto if blank" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Selling Price</label>
                <input type="number" value={productForm.sellingPrice} onChange={e => setProductForm({ ...productForm, sellingPrice: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cost Price</label>
                <input type="number" value={productForm.costPrice} onChange={e => setProductForm({ ...productForm, costPrice: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Stock Qty</label>
                <input type="number" step="any" value={productForm.stockQuantity} onChange={e => setProductForm({ ...productForm, stockQuantity: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Unit</label>
                <input value={productForm.unit} onChange={e => setProductForm({ ...productForm, unit: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Reorder Point</label>
                <input type="number" step="any" value={productForm.reorderPoint} onChange={e => setProductForm({ ...productForm, reorderPoint: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Tax Category</label>
                <select value={productForm.taxCategory} onChange={e => setProductForm({ ...productForm, taxCategory: e.target.value as any })} className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-xl px-4 py-3 text-sm font-black outline-none">
                  <option value="A">A - VAT</option>
                  <option value="C">C - Zero Rated</option>
                  <option value="E">E - Exempt</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100">
              <button onClick={() => setIsProductModalOpen(false)} className="flex-1 py-3.5 bg-slate-100 text-slate-500 rounded-xl text-xs font-black uppercase tracking-widest">Cancel</button>
              <button onClick={handleSaveProduct} disabled={!productForm.name.trim() || !productForm.sellingPrice} className="flex-[2] py-3.5 bg-primary text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-50">
                {editingProduct ? 'Save Changes' : 'Create Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
