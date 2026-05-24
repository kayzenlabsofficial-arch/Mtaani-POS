import React, { useEffect, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Banknote, Ban, CalendarClock, ChevronsUpDown, Pencil, Package, Plus, Search, TriangleAlert, Utensils, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product } from '../../db';
import { useStore } from '../../store';
import { useHorizontalScroll } from '../../hooks/useHorizontalScroll';
import { useToast } from '../../context/ToastContext';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SearchableSelect } from '../shared/SearchableSelectDesktop';
import CategoryManagementModal from '../modals/CategoryManagementModal';
import { enrichProductsWithBundleStock, getProductIngredients, isBundleProduct } from '../../utils/bundleInventory';
import { belongsToActiveShop } from '../../utils/shopScope';
import { StockService } from '../../services/stock';
import { ProductService } from '../../services/products';
import { dateInputToExpiryMs, expiryBadgeClass, expiryMsToDateInput, formatExpiryDate, getExpiryInfo } from '../../utils/expiry';
import { normaliseDiscountType, productDiscountLabel, productSalePrice } from '../../utils/productPricing';
import { normaliseSupplierIds } from '../../utils/supplierProducts';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: React.CSSProperties }) => (
  (() => {
    const icons: Record<string, React.ElementType> = {
      add: Plus,
      close: X,
      search: Search,
      inventory: Package,
      inventory_2: Package,
      payments: Banknote,
      warning: TriangleAlert,
      do_not_disturb_on: Ban,
      unfold_more: ChevronsUpDown,
      arrow_upward: ArrowUp,
      arrow_downward: ArrowDown,
      restaurant: Utensils,
      monitoring: Activity,
      edit: Pencil,
      calendar: CalendarClock,
    };
    const Icon = icons[name] || Package;
    const { fontSize, ...rest } = style || {};
    const size = typeof fontSize === 'number' ? fontSize : Number.parseInt(String(fontSize || 20), 10);
    return <Icon className={className} style={rest} size={Number.isFinite(size) ? size : 20} strokeWidth={2.4} />;
  })()
);

type SortColumn = 'name' | 'stock' | 'price' | 'expiry';
type StockStatusFilter = 'ALL' | 'EXPIRY_RISK' | 'OUT_OF_STOCK' | 'ALMOST_OUT';

export default function InventoryTabDesktop() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [stockStatusFilter, setStockStatusFilter] = useState<StockStatusFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortColumn>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isRestocking, setIsRestocking] = useState(false);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isSavingRestock, setIsSavingRestock] = useState(false);
  const [restockQty, setRestockQty] = useState('');
  const [restockCost, setRestockCost] = useState('');
  const [productForm, setProductForm] = useState({
    name: '',
    category: 'General',
    sellingPrice: '',
    costPrice: '',
    discountType: 'NONE' as 'NONE' | 'FIXED' | 'PERCENT',
    discountValue: '',
    stockQuantity: '',
    unit: 'pcs',
    barcode: '',
    reorderPoint: '5',
    taxCategory: 'A' as 'A' | 'C' | 'E',
    expiryTracking: false,
    expiryDate: '',
    isBundle: false,
    supplierIds: [] as string[],
  });
  const [ingredientRows, setIngredientRows] = useState<{ ingredientProductId: string; quantity: string }[]>([]);
  const scrollRef = useHorizontalScroll();
  const activeBusinessId = useStore(s => s.activeBusinessId);
  const activeShopId = useStore(s => s.activeShopId);
  const { success, error } = useToast();

  const products = useLiveQuery(
    () => {
      if (!activeBusinessId) return Promise.resolve([]);
      const query = db.products.where('businessId').equals(activeBusinessId);
      if (selectedCategory) {
        return query.filter(p =>
          belongsToActiveShop(p, activeShopId) &&
          p.category === selectedCategory &&
          (p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search)))
        ).toArray();
      }
      return query.filter(p =>
        belongsToActiveShop(p, activeShopId) &&
        (p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search)))
      ).toArray();
    },
    [search, selectedCategory, activeBusinessId, activeShopId], []
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId], []
  );

  const categories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).filter(c => belongsToActiveShop(c, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId], []
  );

  useEffect(() => {
    if (selectedCategory && !(categories || []).some(category => category.name === selectedCategory)) {
      setSelectedCategory(null);
    }
  }, [categories, selectedCategory]);

  const suppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).filter(s => belongsToActiveShop(s, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );

  const selectedMovements = useLiveQuery(
    () => selectedProduct ? db.stockMovements.where('productId').equals(selectedProduct.id).toArray() : Promise.resolve([]),
    [selectedProduct?.id],
    []
  );

  const selectedSales = useLiveQuery(
    () => selectedProduct && activeShopId
      ? db.transactions.where('shopId').equals(activeShopId).filter(t => (t.items || []).some((i: any) => i.productId === selectedProduct.id)).toArray()
      : Promise.resolve([]),
    [selectedProduct?.id, activeShopId],
    []
  );

  const displayProducts = enrichProductsWithBundleStock(products || [], productIngredients || []);

  const filteredProducts = displayProducts.filter(product => {
    const stock = product.stockQuantity || 0;
    const expiryStatus = getExpiryInfo(product).status;
    if (stockStatusFilter === 'OUT_OF_STOCK') return stock <= 0;
    if (stockStatusFilter === 'ALMOST_OUT') return stock > 0 && stock <= (product.reorderPoint || 5);
    if (stockStatusFilter === 'EXPIRY_RISK') return expiryStatus === 'EXPIRED' || expiryStatus === 'TODAY' || expiryStatus === 'SOON';
    return true;
  });

  const sorted = [...filteredProducts].sort((a, b) => {
    let res = 0;
    if (sortBy === 'name') res = a.name.localeCompare(b.name);
    else if (sortBy === 'stock') res = (a.stockQuantity || 0) - (b.stockQuantity || 0);
    else if (sortBy === 'price') res = a.sellingPrice - b.sellingPrice;
    else if (sortBy === 'expiry') {
      const aExpiry = getExpiryInfo(a).timestamp ?? Number.MAX_SAFE_INTEGER;
      const bExpiry = getExpiryInfo(b).timestamp ?? Number.MAX_SAFE_INTEGER;
      res = aExpiry - bExpiry;
    }
    return sortDir === 'asc' ? res : -res;
  });

  const totalValue = displayProducts.reduce((a, p) => a + ((p.stockQuantity || 0) * (p.sellingPrice || 0)), 0) || 0;
  const outOfStock = displayProducts.filter(p => (p.stockQuantity || 0) <= 0).length || 0;
  const lowStock = displayProducts.filter(p => {
    const qty = p.stockQuantity || 0;
    return qty > 0 && qty <= (p.reorderPoint || 5);
  }).length || 0;
  const expiringSoon = displayProducts.filter(p => {
    const status = getExpiryInfo(p).status;
    return status === 'SOON' || status === 'TODAY';
  }).length || 0;
  const expired = displayProducts.filter(p => getExpiryInfo(p).status === 'EXPIRED').length || 0;
  const expiryRisk = expired + expiringSoon;
  const stockFilters: { id: StockStatusFilter; label: string; count: number }[] = [
    { id: 'ALL', label: 'All items', count: displayProducts.length },
    { id: 'EXPIRY_RISK', label: 'Close expiry', count: expiryRisk },
    { id: 'OUT_OF_STOCK', label: 'Out of stock', count: outOfStock },
    { id: 'ALMOST_OUT', label: 'Almost out', count: lowStock },
  ];

  const toggleSort = (col: SortColumn) => {
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
      discountType: normaliseDiscountType((product as any)?.discountType),
      discountValue: (product as any)?.discountValue ? String((product as any).discountValue) : '',
      stockQuantity: product?.stockQuantity !== undefined ? String(product.stockQuantity) : '0',
      unit: product?.unit || 'pcs',
      barcode: product?.barcode || '',
      reorderPoint: product?.reorderPoint !== undefined ? String(product.reorderPoint) : '5',
      taxCategory: product?.taxCategory || 'A',
      expiryTracking: Boolean((product as any)?.expiryTracking || (product as any)?.expiryDate),
      expiryDate: expiryMsToDateInput((product as any)?.expiryDate),
      isBundle: isBundleProduct(product),
      supplierIds: normaliseSupplierIds(product),
    });
    const savedIngredients = getProductIngredients(product, productIngredients || []);
    setIngredientRows(savedIngredients.map(row => ({
      ingredientProductId: row.ingredientProductId,
      quantity: String(row.quantity),
    })));
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!activeBusinessId || !activeShopId || !productForm.name.trim() || isSavingProduct) return;
    if (sellingBelowCostBlocked) {
      error('Selling price cannot be below buying price unless you set a product discount.');
      return;
    }
    const cleanIngredients = ingredientRows
      .map(row => ({ ingredientProductId: row.ingredientProductId, quantity: Number(row.quantity) || 0 }))
      .filter(row => row.ingredientProductId && row.quantity > 0);

    if (productForm.isBundle && cleanIngredients.length === 0) {
      error('Add at least one ingredient for this bulk item.');
      return;
    }
    if (productForm.isBundle && editingProduct && cleanIngredients.some(row => row.ingredientProductId === editingProduct.id)) {
      error('A bulk item cannot use itself as an ingredient.');
      return;
    }
    const expiryDate = productForm.expiryTracking ? dateInputToExpiryMs(productForm.expiryDate) : null;
    if (productForm.expiryTracking && !expiryDate) {
      error('Choose an expiry date or turn off expiry tracking.');
      return;
    }

    const payload = {
      name: productForm.name.trim(),
      category: productForm.category.trim() || 'General',
      sellingPrice: Number(productForm.sellingPrice) || 0,
      costPrice: Number(productForm.costPrice) || 0,
      discountType: productForm.discountType,
      discountValue: productForm.discountType === 'NONE' ? 0 : Number(productForm.discountValue) || 0,
      taxCategory: productForm.taxCategory,
      stockQuantity: productForm.isBundle ? 0 : Number(productForm.stockQuantity) || 0,
      unit: productForm.unit.trim() || 'pcs',
      barcode: productForm.barcode.trim() || `SKU-${Date.now()}`,
      reorderPoint: Number(productForm.reorderPoint) || 5,
      supplierIds: productForm.supplierIds,
      expiryTracking: productForm.expiryTracking ? 1 : 0,
      expiryDate,
      isBundle: productForm.isBundle ? 1 : 0,
      components: productForm.isBundle
        ? cleanIngredients.map(row => ({ productId: row.ingredientProductId, quantity: row.quantity }))
        : [],
      shopId: activeShopId,
      businessId: activeBusinessId
    };
    setIsSavingProduct(true);
    try {
      const productId = editingProduct?.id || crypto.randomUUID();
      const result = await ProductService.save({
        product: { id: productId, ...payload } as any,
        ingredients: cleanIngredients,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await Promise.allSettled([
        db.products.reload(),
        db.productIngredients.reload(),
      ]);
      if (selectedProduct?.id === productId) setSelectedProduct(result.product);
      success(editingProduct ? 'Product updated.' : 'Product added.');
      setIsProductModalOpen(false);
      setEditingProduct(null);
      setIngredientRows([]);
    } catch (err: any) {
      error('Failed to save product: ' + err.message);
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleRestock = async () => {
    if (!selectedProduct || !activeBusinessId || !activeShopId || isSavingRestock) return;
    const qty = Number(restockQty);
    if (qty <= 0) return error('Enter a valid stock quantity.');
    setIsSavingRestock(true);
    try {
      const result = await StockService.restock({
        productId: selectedProduct.id,
        quantity: qty,
        costPrice: restockCost ? Number(restockCost) || 0 : undefined,
        reference: 'Manual stock adjustment',
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await Promise.allSettled([
        db.products.reload(),
        db.stockMovements.reload(),
      ]);
      setSelectedProduct({
        ...selectedProduct,
        stockQuantity: result.stockQuantity,
        ...(restockCost ? { costPrice: Number(restockCost) || 0 } : {}),
      });
      setRestockQty('');
      setRestockCost('');
      setIsRestocking(false);
      success('Stock updated.');
    } catch (err: any) {
      error('Failed to adjust stock: ' + err.message);
    } finally {
      setIsSavingRestock(false);
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

  const ingredientOptions = (products || [])
    .filter(p => !isBundleProduct(p) && p.id !== editingProduct?.id)
    .map(p => ({
      value: p.id,
      label: `${p.name} (${p.stockQuantity || 0} ${p.unit || 'pcs'} left)`,
      keywords: `${p.name} ${p.barcode || ''} ${p.category || ''}`,
    }));
  const supplierOptions = (suppliers || []).map(supplier => ({
    value: supplier.id,
    label: `${supplier.company || supplier.name} (${supplier.name || 'Supplier'})`,
    keywords: `${supplier.company || ''} ${supplier.name || ''} ${supplier.phone || ''}`,
    disabled: productForm.supplierIds.includes(supplier.id),
  }));
  const categoryOptions = [
    { value: 'General', label: 'General', keywords: 'Default category' },
    ...Array.from(new Set((categories || []).map(category => category.name.trim()).filter(Boolean)))
      .filter(name => name !== 'General')
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ value: name, label: name, keywords: name })),
  ];
  const selectedFormSuppliers = (suppliers || []).filter(supplier => productForm.supplierIds.includes(supplier.id));
  const supplierNamesForProduct = (product: Product | any) => {
    const ids = normaliseSupplierIds(product);
    return ids
      .map(id => (suppliers || []).find(supplier => supplier.id === id)?.company || (suppliers || []).find(supplier => supplier.id === id)?.name || id)
      .filter(Boolean);
  };
  const formSellingPrice = Number(productForm.sellingPrice) || 0;
  const formCostPrice = Number(productForm.costPrice) || 0;
  const formHasDiscount = productForm.discountType !== 'NONE' && (Number(productForm.discountValue) || 0) > 0;
  const sellingBelowCostBlocked = formCostPrice > 0 && formSellingPrice > 0 && formSellingPrice < formCostPrice && !formHasDiscount;
  const discountedSalePrice = productSalePrice({
    sellingPrice: formSellingPrice,
    discountType: productForm.discountType,
    discountValue: Number(productForm.discountValue) || 0,
  } as Product);
  const discountedBelowCost = formCostPrice > 0 && formHasDiscount && discountedSalePrice < formCostPrice;

  const SortIcon = ({ col }: { col: SortColumn }) =>
    sortBy === col ? (
      <MaterialIcon name={sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'} className="text-blue-700" style={{ fontSize: '13px' }} />
    ) : (
      <MaterialIcon name="unfold_more" className="text-slate-300" style={{ fontSize: '13px' }} />
    );

  return (
    <div className="flex h-full flex-col gap-5 pb-24 animate-in fade-in">

      {/* Page heading */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Inventory</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {products?.length || 0} products across {categories?.length || 0} categories
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button onClick={() => setIsCategoryModalOpen(true)} className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 hover:border-blue-200 hover:text-blue-700">
            <Package size={18} />
            Categories
          </button>
          <button onClick={() => openProductModal()} className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white hover:bg-blue-800">
            <MaterialIcon name="add" style={{ fontSize: '20px' }} />
            Add product
          </button>
        </div>
      </div>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {[
          { label: 'Total products', value: products?.length || 0, icon: 'inventory_2', unit: '' },
          { label: 'Stock value', value: `Ksh ${totalValue.toLocaleString()}`, icon: 'payments', unit: '' },
          { label: 'Almost out', value: lowStock, icon: 'warning', unit: 'items' },
          { label: 'Out of stock', value: outOfStock, icon: 'do_not_disturb_on', unit: 'items' },
          { label: 'Expiry watch', value: `${expired}/${expiringSoon}`, icon: 'calendar', unit: 'expired/soon' },
        ].map(kpi => (
          <div key={kpi.label} className="flex items-center gap-3 rounded-lg border-2 border-slate-200 bg-white p-4">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
              <MaterialIcon name={kpi.icon} className="text-blue-700" style={{ fontSize: '20px' }} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{kpi.label}</p>
              <p className="text-lg font-black text-slate-900 tabular-nums truncate">{kpi.value} <span className="text-xs font-medium text-slate-400">{kpi.unit}</span></p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar: Search + Filters */}
      <div className="flex flex-col gap-3 rounded-lg border-2 border-slate-200 bg-white p-3 shadow-sm md:flex-row">
        <div className="relative group flex-1">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-700">
            <MaterialIcon name="search" style={{ fontSize: '18px' }} />
          </div>
          <input
            className="h-11 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-4 text-sm font-bold outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
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
            className={`flex-shrink-0 whitespace-nowrap rounded-lg border-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
              !selectedCategory ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
            }`}
          >
            All
          </button>
          {categories?.map((cat, i) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.name)}
              className={`flex-shrink-0 whitespace-nowrap rounded-lg border-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                selectedCategory === cat.name ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-300'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      <CategoryManagementModal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} />

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        {stockFilters.map(filter => (
          <button
            key={filter.id}
            type="button"
            onClick={() => setStockStatusFilter(filter.id)}
            className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border flex-shrink-0 flex items-center gap-2 ${
              stockStatusFilter === filter.id ? 'border-blue-700 bg-blue-700 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'
            }`}
          >
            <span>{filter.label}</span>
            <span className={`min-w-5 h-5 px-1.5 rounded-lg flex items-center justify-center text-[9px] ${
              stockStatusFilter === filter.id ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {filter.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border-2 border-slate-200 bg-white">

        {/* Table header */}
        <div className="grid grid-cols-[minmax(0,1.6fr)_9rem_5rem_7rem_8rem_8rem] items-center gap-4 px-6 py-3 bg-slate-50 border-b border-slate-100 flex-shrink-0">
          <button className="min-w-0 flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left hover:text-slate-700 transition-colors" onClick={() => toggleSort('name')}>
            Product <SortIcon col="name" />
          </button>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Barcode</div>
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit</div>
          <button className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-700 transition-colors" onClick={() => toggleSort('stock')}>
            Stock <SortIcon col="stock" />
          </button>
          <button className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-700 transition-colors" onClick={() => toggleSort('expiry')}>
            Expiry <SortIcon col="expiry" />
          </button>
          <button className="flex items-center gap-1 justify-end text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-slate-700 transition-colors" onClick={() => toggleSort('price')}>
            Price <SortIcon col="price" />
          </button>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-slate-50">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
                <MaterialIcon name="inventory" className="text-slate-300" style={{ fontSize: '32px' }} />
              </div>
              <p className="text-sm font-bold text-slate-400">No products found</p>
              {stockStatusFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setStockStatusFilter('ALL')}
                  className="mt-3 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white"
                >
                  Clear stock filter
                </button>
              )}
            </div>
          ) : sorted.map(product => {
            const stock = product.stockQuantity || 0;
            const isOut = stock <= 0;
            const isLow = !isOut && stock <= (product.reorderPoint || 5);
            const expiry = getExpiryInfo(product);

            return (
              <button
                type="button"
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className="w-full text-left grid grid-cols-[minmax(0,1.6fr)_9rem_5rem_7rem_8rem_8rem] items-center gap-4 px-6 py-3 hover:bg-slate-50 transition-colors cursor-pointer group"
              >
                {/* Product info */}
                <div className="min-w-0 flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50">
                    <span className="text-xs font-black text-blue-700">{product.name.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase()}</span>
                  </div>
                  <div className="stable-row-copy">
                    <p className="stable-title-2 text-[13px] font-bold leading-tight text-slate-900 transition-colors group-hover:text-blue-700">{product.name}</p>
                    <div className="flex min-w-0 items-center gap-2 mt-0.5 overflow-hidden">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-700" />
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide stable-meta">{product.category || 'General'}</span>
                      {isBundleProduct(product) && (
                        <span className="text-[8px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded-full flex-shrink-0">Bulk</span>
                      )}
                      {product.taxCategory === 'A' && (
                        <span className="hidden sm:inline-flex text-[8px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full flex-shrink-0">VAT</span>
                      )}
                      {expiry.tracking && (
                        <span className={`text-[8px] font-black border px-1.5 py-0.5 rounded-full flex-shrink-0 ${expiryBadgeClass(expiry.status)}`}>{expiry.label}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Barcode */}
                <div className="block min-w-0">
                  <span className="font-mono text-[10px] text-slate-500 bg-slate-50 border border-slate-100 px-2 py-1 rounded-lg stable-chip">
                    {product.barcode || '---'}
                  </span>
                </div>

                {/* Unit */}
                <div className="block">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">{product.unit || 'pcs'}</span>
                </div>

                {/* Stock */}
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-black tabular-nums ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                    {stock}
                  </span>
                  {isBundleProduct(product) && (
                    <span className="text-[8px] font-black bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded-full">Auto</span>
                  )}
                  {isLow && !isOut && (
                    <span className="text-[8px] font-black bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full">Low</span>
                  )}
                  {isOut && (
                    <span className="text-[8px] font-black bg-rose-50 text-rose-700 border border-rose-100 px-1.5 py-0.5 rounded-full">Out</span>
                  )}
                </div>

                {/* Expiry */}
                <div className="block min-w-0">
                  {expiry.tracking ? (
                    <span className={`inline-flex max-w-full truncate text-[9px] font-black border px-2 py-1 rounded-full ${expiryBadgeClass(expiry.status)}`}>
                      {expiry.label}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold text-slate-300">Not tracked</span>
                  )}
                </div>

                {/* Price */}
                <div className="text-right stable-actions">
                  <p className="text-[13px] font-black text-slate-900 tabular-nums whitespace-nowrap">Ksh {productSalePrice(product).toLocaleString()}</p>
                  {productDiscountLabel(product) && (
                    <p className="hidden sm:block text-[9px] font-black text-rose-500 whitespace-nowrap">{productDiscountLabel(product)}</p>
                  )}
                  {product.costPrice && (
                    <p className="hidden sm:block text-[9px] font-medium text-slate-400 whitespace-nowrap">Cost: Ksh {product.costPrice.toLocaleString()}</p>
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
              Showing {sorted.length} of {displayProducts.length} products
            </p>
          </div>
        )}
      </div>

      {/* FAB */}
      <button onClick={() => openProductModal()} className="fixed bottom-24 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-lg border-2 border-blue-700 bg-blue-700 text-white shadow-xl transition-all hover:bg-blue-800 active:scale-95 md:bottom-8 md:right-8">
        <MaterialIcon name="add" style={{ fontSize: '28px' }} />
      </button>

      {/* Product detail slide-over */}
      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-end md:items-stretch md:justify-center">
          <div className="absolute inset-0 bg-slate-900/45" onClick={() => setSelectedProduct(null)} />
          <div className="relative flex h-auto max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl border-2 border-slate-200 bg-white shadow-xl animate-in slide-in-from-bottom duration-300 md:h-full md:max-h-full md:w-full md:rounded-none md:border-0 md:slide-in-from-right">
            <div className="flex flex-shrink-0 items-center justify-between border-b-2 border-slate-100 px-6 py-5 md:px-8">
              <h3 className="text-base font-black text-slate-900">Product Details</h3>
              <button onClick={() => setSelectedProduct(null)} className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-300">
                <MaterialIcon name="close" style={{ fontSize: '20px' }} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-6 md:mx-auto md:w-full md:max-w-[1440px] md:p-8 space-y-5">
              {/* Icon + name */}
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50">
                  <span className="text-xl font-black text-blue-700">{selectedProduct.name.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase()}</span>
                </div>
                <div>
                  <h4 className="text-lg font-black text-slate-900 leading-tight">{selectedProduct.name}</h4>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-1">{selectedProduct.category}</p>
                  {selectedProduct.taxCategory === 'A' && (
                    <span className="text-[9px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-2 py-0.5 rounded-full mt-1 inline-block">VAT applicable</span>
                  )}
                  {getExpiryInfo(selectedProduct).tracking && (
                    <span className={`ml-1 text-[9px] font-black border px-2 py-0.5 rounded-full mt-1 inline-block ${expiryBadgeClass(getExpiryInfo(selectedProduct).status)}`}>
                      {getExpiryInfo(selectedProduct).label}
                    </span>
                  )}
                </div>
              </div>

              {/* Details grid */}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Selling price', value: `Ksh ${selectedProduct.sellingPrice?.toLocaleString()}` },
                { label: 'Register price', value: `Ksh ${productSalePrice(selectedProduct).toLocaleString()}` },
                { label: 'Discount', value: productDiscountLabel(selectedProduct) || 'None' },
                { label: 'Cost price', value: selectedProduct.costPrice ? `Ksh ${selectedProduct.costPrice.toLocaleString()}` : '—' },
                { label: isBundleProduct(selectedProduct) ? 'Available from ingredients' : 'Stock qty', value: `${selectedProduct.stockQuantity || 0} ${selectedProduct.unit || 'pcs'}` },
                { label: 'Reorder point', value: selectedProduct.reorderPoint || 5 },
                { label: 'Expiry', value: getExpiryInfo(selectedProduct).tracking ? getExpiryInfo(selectedProduct).dateLabel : 'Not tracked' },
                { label: 'Suppliers', value: supplierNamesForProduct(selectedProduct).join(', ') || 'Not assigned' },
                { label: 'Barcode', value: selectedProduct.barcode || '---' },
              ].map(row => (
                <div key={row.label} className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                  <span className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">{row.label}</span>
                  <span className="mt-2 block break-words text-sm font-black text-slate-900">{row.value}</span>
                </div>
              ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2 md:grid-cols-4">
                {[
                  { label: 'Units sold', value: soldUnits.toLocaleString(), color: 'text-blue-600' },
                  { label: 'Revenue', value: `Ksh ${revenue.toLocaleString()}`, color: 'text-emerald-600' },
                  { label: 'Gross profit', value: `Ksh ${grossProfit.toLocaleString()}`, color: grossProfit >= 0 ? 'text-slate-900' : 'text-rose-600' },
                  { label: 'Stock in / out', value: `${movementIn.toLocaleString()} / ${movementOut.toLocaleString()}`, color: 'text-blue-700' },
                ].map(metric => (
                  <div key={metric.label} className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{metric.label}</p>
                    <p className={`text-sm font-black tabular-nums mt-1 ${metric.color}`}>{metric.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">8-day performance</p>
                    <p className="text-xs font-bold text-slate-500">Sales value and unit movement</p>
                  </div>
                  <MaterialIcon name="monitoring" className="text-blue-700" style={{ fontSize: '20px' }} />
                </div>
                <div className="h-44 min-w-0">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="salesGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#1d4ed8" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#1d4ed8" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: '#ffffff', border: '2px solid #e2e8f0', borderRadius: 8, color: '#0f172a' }} />
                      <Area type="monotone" dataKey="sales" stroke="#1d4ed8" strokeWidth={3} fill="url(#salesGlow)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Recent movement</p>
                  <span className="text-[9px] font-bold text-slate-400">{(selectedMovements || []).length} entries</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto no-scrollbar">
                  {[...(selectedMovements || [])]
                    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                    .slice(0, 8)
                    .map(move => (
                      <div key={move.id} className="flex items-center justify-between rounded-lg border-2 border-slate-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-slate-800 truncate">{move.reference || move.type}</p>
                          <p className="text-[9px] font-bold text-slate-400">{new Date(move.timestamp).toLocaleString('en-KE')}</p>
                          {move.expiryDate && (
                            <p className="text-[9px] font-black text-amber-600">Exp: {formatExpiryDate(move.expiryDate)}</p>
                          )}
                        </div>
                        <span className={`text-xs font-black tabular-nums ${move.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {move.quantity >= 0 ? '+' : ''}{move.quantity}
                        </span>
                      </div>
                    ))}
                  {(selectedMovements || []).length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-6 text-center text-[10px] font-bold text-slate-400">
                      No stock movement recorded yet.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex-shrink-0 border-t border-slate-100">
              <div className="mx-auto grid w-full max-w-[1440px] grid-cols-2 gap-3 p-6 md:px-8">
                <button onClick={() => openProductModal(selectedProduct)} className="flex items-center justify-center gap-2 rounded-lg border-2 border-slate-200 py-3 text-sm font-bold text-slate-700 transition-all hover:border-blue-300 hover:text-blue-700">
                  <MaterialIcon name="edit" style={{ fontSize: '18px' }} /> Edit
                </button>
                {isBundleProduct(selectedProduct) ? (
                  <button onClick={() => openProductModal(selectedProduct)} className="flex items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 py-3 text-sm font-bold text-white transition-all hover:bg-blue-800">
                    <MaterialIcon name="restaurant" style={{ fontSize: '18px' }} /> Ingredients
                  </button>
                ) : (
                  <button onClick={() => setIsRestocking(true)} className="flex items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 py-3 text-sm font-bold text-white transition-all hover:bg-blue-800">
                    <MaterialIcon name="add" style={{ fontSize: '18px' }} /> Adjust stock
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isRestocking && selectedProduct && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/45" onClick={() => setIsRestocking(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-lg border-2 border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-black text-slate-900">Adjust stock</h3>
              <button onClick={() => setIsRestocking(false)} className="h-9 w-9 rounded-lg border-2 border-slate-200 bg-white text-slate-500 hover:border-blue-300">
                <MaterialIcon name="close" style={{ fontSize: '20px' }} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Quantity to add</label>
                <input type="number" step="any" value={restockQty} onChange={e => setRestockQty(e.target.value)} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" placeholder="0" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Latest unit cost</label>
                <input type="number" step="any" value={restockCost} onChange={e => setRestockCost(e.target.value)} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" placeholder="Optional" />
              </div>
              <button
                onClick={handleRestock}
                disabled={!restockQty || Number(restockQty) <= 0 || isSavingRestock}
                aria-busy={isSavingRestock}
                data-busy={isSavingRestock ? 'true' : undefined}
                className="w-full rounded-lg border-2 border-blue-700 bg-blue-700 py-3.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-blue-800"
              >
                {isSavingRestock ? 'Saving...' : 'Save stock adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isProductModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-slate-900/45" onClick={() => setIsProductModalOpen(false)} />
          <div className="relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border-2 border-slate-200 bg-white p-6 shadow-xl sm:rounded-lg">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-xl font-black text-slate-900">{editingProduct ? 'Edit product' : 'Add product'}</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Inventory master record</p>
              </div>
              <button onClick={() => setIsProductModalOpen(false)} className="h-10 w-10 rounded-lg border-2 border-slate-200 bg-white text-slate-500 hover:border-blue-300">
                <MaterialIcon name="close" style={{ fontSize: '20px' }} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Product name</label>
                <input value={productForm.name} onChange={e => setProductForm({ ...productForm, name: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" placeholder="e.g. 2kg Maize Flour" autoFocus />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Category</label>
                <SearchableSelect
                  value={productForm.category}
                  onChange={category => setProductForm({ ...productForm, category: category || 'General' })}
                  placeholder="Select category..."
                  searchPlaceholder="Search categories..."
                  options={categoryOptions}
                  buttonClassName="bg-white border-2 border-slate-200 rounded-lg px-4 py-3 text-sm font-black outline-none focus:border-blue-600"
                  searchInputClassName="bg-white"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Barcode</label>
                <input value={productForm.barcode} onChange={e => setProductForm({ ...productForm, barcode: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" placeholder="Auto if blank" />
              </div>
              <div className="sm:col-span-2 rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Suppliers</label>
                <SearchableSelect
                  value=""
                  onChange={(supplierId) => {
                    if (!supplierId || productForm.supplierIds.includes(supplierId)) return;
                    setProductForm({ ...productForm, supplierIds: [...productForm.supplierIds, supplierId] });
                  }}
                  placeholder={(suppliers || []).length ? 'Add supplier for this product...' : 'Add suppliers first...'}
                  options={supplierOptions}
                  disabled={(suppliers || []).length === 0}
                  buttonClassName="bg-white border-transparent"
                  searchInputClassName="bg-white"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedFormSuppliers.length > 0 ? selectedFormSuppliers.map(supplier => (
                    <span key={supplier.id} className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700">
                      {supplier.company || supplier.name}
                      <button
                        type="button"
                        onClick={() => setProductForm({ ...productForm, supplierIds: productForm.supplierIds.filter(id => id !== supplier.id) })}
                        className="flex h-5 w-5 items-center justify-center rounded-lg bg-white text-blue-400 hover:text-rose-500"
                        aria-label={`Remove ${supplier.company || supplier.name}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  )) : (
                    <span className="text-[10px] font-bold text-slate-400">No supplier assigned yet. Receiving stock will also link suppliers automatically.</span>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Selling price</label>
                <input type="number" value={productForm.sellingPrice} onChange={e => setProductForm({ ...productForm, sellingPrice: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Cost price</label>
                <input type="number" value={productForm.costPrice} onChange={e => setProductForm({ ...productForm, costPrice: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Register discount</label>
                <select
                  value={productForm.discountType}
                  onChange={e => setProductForm({ ...productForm, discountType: e.target.value as any, discountValue: e.target.value === 'NONE' ? '' : productForm.discountValue })}
                  className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600"
                >
                  <option value="NONE">No discount</option>
                  <option value="FIXED">Ksh off</option>
                  <option value="PERCENT">Percent off</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Discount value</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={productForm.discountValue}
                  disabled={productForm.discountType === 'NONE'}
                  onChange={e => setProductForm({ ...productForm, discountValue: e.target.value })}
                  className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-400"
                  placeholder={productForm.discountType === 'PERCENT' ? '0 - 100' : '0'}
                />
              </div>
              {(sellingBelowCostBlocked || discountedBelowCost) && (
                <div className={`sm:col-span-2 rounded-lg border px-4 py-3 text-[11px] font-bold ${
                  sellingBelowCostBlocked
                    ? 'border-rose-100 bg-rose-50 text-rose-700'
                    : 'border-amber-100 bg-amber-50 text-amber-800'
                }`}>
                  {sellingBelowCostBlocked
                    ? 'Selling price is below buying price. Set the selling price above cost or add a product discount.'
                    : `Discounted register price will be Ksh ${discountedSalePrice.toLocaleString()}, below the buying price.`}
                </div>
              )}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{editingProduct ? 'Current stock' : 'Opening stock'}</label>
                {productForm.isBundle ? (
                  <div className="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700">
                    Auto from ingredients
                  </div>
                ) : editingProduct ? (
                  <div className="w-full rounded-lg border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-600">
                    {productForm.stockQuantity || 0} {productForm.unit || 'pcs'}
                  </div>
                ) : (
                  <input type="number" step="any" value={productForm.stockQuantity} onChange={e => setProductForm({ ...productForm, stockQuantity: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" />
                )}
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Unit</label>
                <input value={productForm.unit} onChange={e => setProductForm({ ...productForm, unit: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Reorder point</label>
                <input type="number" step="any" value={productForm.reorderPoint} onChange={e => setProductForm({ ...productForm, reorderPoint: e.target.value })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Tax category</label>
                <select value={productForm.taxCategory} onChange={e => setProductForm({ ...productForm, taxCategory: e.target.value as any })} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600">
                  <option value="A">A - VAT</option>
                  <option value="C">C - Zero Rated</option>
                  <option value="E">E - Exempt</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 rounded-lg border-2 border-slate-200 bg-slate-50 p-4 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_180px]">
                <button
                  type="button"
                  onClick={() => setProductForm({ ...productForm, expiryTracking: !productForm.expiryTracking, expiryDate: productForm.expiryTracking ? '' : productForm.expiryDate })}
                  className="flex items-center justify-between gap-4 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-lg border-2 ${productForm.expiryTracking ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-400'}`}>
                      <MaterialIcon name="calendar" style={{ fontSize: '20px' }} />
                    </span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">Track expiry</p>
                      <p className="text-xs font-bold text-slate-500 mt-0.5">Show expired and soon-to-expire stock in inventory and register.</p>
                    </div>
                  </div>
                  <div className={`flex h-7 w-12 rounded-full p-1 transition-all ${productForm.expiryTracking ? 'justify-end bg-blue-700' : 'justify-start bg-slate-300'}`}>
                    <span className="w-5 h-5 rounded-full bg-white shadow-sm" />
                  </div>
                </button>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Expiry date</label>
                  <input
                    type="date"
                    value={productForm.expiryDate}
                    disabled={!productForm.expiryTracking}
                    onChange={e => setProductForm({ ...productForm, expiryDate: e.target.value })}
                    className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setProductForm({ ...productForm, isBundle: !productForm.isBundle })}
                  className={`flex w-full items-center justify-between gap-4 rounded-lg border-2 p-4 transition-all ${productForm.isBundle ? 'border-blue-700 bg-blue-50 text-blue-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                >
                  <div className="flex items-center gap-3 text-left">
                    <span className={`flex h-10 w-10 items-center justify-center rounded-lg border-2 ${productForm.isBundle ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-400'}`}>
                      <MaterialIcon name="restaurant" style={{ fontSize: '20px' }} />
                    </span>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest">Bulk / recipe item</p>
                      <p className="text-xs font-bold mt-0.5">Stock is calculated from ingredients</p>
                    </div>
                  </div>
                  <div className={`flex h-7 w-12 rounded-full p-1 transition-all ${productForm.isBundle ? 'justify-end bg-blue-700' : 'justify-start bg-slate-300'}`}>
                    <span className="w-5 h-5 rounded-full bg-white shadow-sm" />
                  </div>
                </button>
              </div>

              {productForm.isBundle && (
                <div className="space-y-3 rounded-lg border-2 border-slate-200 bg-slate-50 p-4 sm:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-800">Ingredients</h4>
                      <p className="mt-0.5 text-[10px] font-bold text-slate-500">Quantity is the amount used to sell one bulk item.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIngredientRows([...ingredientRows, { ingredientProductId: '', quantity: '1' }])}
                      className="rounded-lg border-2 border-blue-700 bg-blue-700 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white"
                    >
                      Add ingredient
                    </button>
                  </div>

                  {ingredientRows.length === 0 && (
                    <div className="rounded-lg border-2 border-dashed border-slate-200 bg-white py-6 text-center text-[10px] font-bold text-slate-400">
                      Add the products that make up this bulk item.
                    </div>
                  )}

                  {ingredientRows.map((row, idx) => (
                    <div key={idx} className="grid grid-cols-1 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white p-3 sm:grid-cols-[1fr_120px_40px]">
                      <SearchableSelect
                        value={row.ingredientProductId}
                        onChange={(v) => setIngredientRows(rows => rows.map((r, i) => i === idx ? { ...r, ingredientProductId: v } : r))}
                        placeholder="Select ingredient..."
                        options={ingredientOptions}
                        buttonClassName="bg-slate-50 border-transparent"
                        searchInputClassName="bg-white"
                      />
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={row.quantity}
                        onChange={e => setIngredientRows(rows => rows.map((r, i) => i === idx ? { ...r, quantity: e.target.value } : r))}
                        className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black outline-none focus:border-blue-600"
                        placeholder="Qty"
                      />
                      <button
                        type="button"
                        onClick={() => setIngredientRows(rows => rows.filter((_, i) => i !== idx))}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-rose-100 bg-rose-50 text-rose-600"
                      >
                        <MaterialIcon name="close" style={{ fontSize: '18px' }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6 pt-4 border-t border-slate-100">
              <button onClick={() => setIsProductModalOpen(false)} disabled={isSavingProduct} className="flex-1 rounded-lg border-2 border-slate-200 bg-white py-3.5 text-xs font-black uppercase tracking-widest text-slate-600 disabled:opacity-50">Cancel</button>
              <button
                onClick={handleSaveProduct}
                disabled={!productForm.name.trim() || !productForm.sellingPrice || sellingBelowCostBlocked || isSavingProduct}
                aria-busy={isSavingProduct}
                data-busy={isSavingProduct ? 'true' : undefined}
                className="flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 py-3.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-blue-800"
              >
                {isSavingProduct ? 'Saving...' : editingProduct ? 'Save changes' : 'Create product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
