import React, { useState } from 'react';
import { Search, Plus, ClipboardList, PackagePlus, CheckSquare, Save, Trash2, Barcode, SlidersHorizontal, TrendingUp, ShoppingBag, Clock, ChevronRight, X, User, ArrowDownLeft, FileText } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product, type PurchaseOrder } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import DocumentDetailsModal from '../modals/DocumentDetailsModalMobile';
import { SearchableSelect } from '../shared/SearchableSelectMobile';
import { belongsToActiveShop } from '../../utils/shopScope';
import { PurchaseService } from '../../services/purchases';
import { productsForSupplier } from '../../utils/supplierProducts';
import { reloadBestEffort } from '../../utils/reloads';
import { dateInputToExpiryMs, expiryMsToDateInput } from '../../utils/expiry';

const inventoryOrderPrice = (product?: Product | null) => {
  const costPrice = Number(product?.costPrice || 0);
  const sellingPrice = Number(product?.sellingPrice || 0);
  return costPrice > 0 ? costPrice : sellingPrice;
};

export default function PurchasesTabMobile() {
  const { error, success } = useToast();
  const currentUser = useStore(state => state.currentUser);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [isReceivePOModalOpen, setIsReceivePOModalOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [selectedPOToEdit, setSelectedPOToEdit] = useState<PurchaseOrder | null>(null);
  const [selectedRecordForDetails, setSelectedRecordForDetails] = useState<any | null>(null);
  
  const [poForm, setPoForm] = useState({ supplierId: '' });
  const [poItems, setPoItems] = useState<{productId: string; name: string; expectedQuantity: number; unitCost: number}[]>([]);
  const [poItemInput, setPoItemInput] = useState({ search: '', productId: '', name: '', qty: '', cost: '' });
  
  const [receiveInvoices, setReceiveInvoices] = useState<{ [poId: string]: string }>({}); 
  const [receiveQuantities, setReceiveQuantities] = useState<{ [productId: string]: number }>({}); 
  const [receiveUnitCosts, setReceiveUnitCosts] = useState<{ [productId: string]: number }>({});
  const [receiveSellingPrices, setReceiveSellingPrices] = useState<{ [productId: string]: number }>({});
  const [receiveExpiryDates, setReceiveExpiryDates] = useState<{ [productId: string]: string }>({});
  const [isSaving, setIsSaving] = useState(false);

  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  
  const allPurchaseOrders = useLiveQuery(() => activeShopId ? db.purchaseOrders.where('shopId').equals(activeShopId).toArray() : Promise.resolve([]), [activeShopId], []) ;
  const allSuppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).filter(s => belongsToActiveShop(s, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeShopId ? db.products.where('businessId').equals(activeBusinessId).filter(p => belongsToActiveShop(p, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const supplierProducts = productsForSupplier(allProducts || [], allPurchaseOrders || [], poForm.supplierId);
  const filteredPurchases = allPurchaseOrders.filter(po => 
      (po.invoiceNumber || '').toLowerCase().includes(purchaseSearch.toLowerCase()) || 
      (allSuppliers.find(s => s.id === po.supplierId)?.company || '').toLowerCase().includes(purchaseSearch.toLowerCase()) ||
      po.id.toLowerCase().includes(purchaseSearch.toLowerCase())
  ).sort((a,b) => (b.orderDate || 0) - (a.orderDate || 0));

  const pendingApproval = allPurchaseOrders.filter(po => po.approvalStatus === 'PENDING').length;
  const awaitingArrival = allPurchaseOrders.filter(po => po.approvalStatus === 'APPROVED' && po.status !== 'RECEIVED').length;
  const totalPurchases = allPurchaseOrders.reduce((sum, po) => sum + (po.totalAmount || 0), 0);

  const handleAddPoItem = () => {
     if (!poItemInput.productId || !poItemInput.qty || !poItemInput.cost) return;
     const newItem = {
        productId: poItemInput.productId,
        name: poItemInput.name,
        expectedQuantity: Number(poItemInput.qty),
        unitCost: Number(poItemInput.cost)
     };
     setPoItems([...poItems, newItem]);
     setPoItemInput({ search: '', productId: '', name: '', qty: '', cost: '' });
  };

  const handleSelectPoProduct = (product: Product) => {
     if (!poForm.supplierId) return error("Select a supplier first.");
     setPoItemInput({ ...poItemInput, search: product.name, productId: product.id, name: product.name, cost: String(inventoryOrderPrice(product)) }); 
  };

  const handleSavePO = async () => {
      if (!poForm.supplierId || poItems.length === 0) return;
      if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
      if (isSaving) return;
      setIsSaving(true);
      try {
        const result = await PurchaseService.saveOrder({
          purchaseOrderId: selectedPOToEdit?.id,
          supplierId: poForm.supplierId,
          items: poItems.map(item => ({
            productId: item.productId,
            expectedQuantity: item.expectedQuantity,
            unitCost: item.unitCost,
          })),
          preparedBy: selectedPOToEdit?.preparedBy || currentUser?.name || 'Staff',
          shopId: activeShopId,
          businessId: activeBusinessId,
        });
        await reloadBestEffort([() => db.purchaseOrders.reload()]);
        setSelectedPOToEdit(null);
        setIsPOModalOpen(false);
        setPoForm({ supplierId: '' });
        setPoItems([]);
        success(result.autoApproved ? "Purchase order approved and ready to receive." : "Purchase order saved successfully.");
      } catch (err: any) {
        error("Failed to save PO: " + err.message);
      } finally {
        setIsSaving(false);
      }
  };

  const initEditPO = (po: PurchaseOrder) => {
      setSelectedPOToEdit(po);
      setPoForm({ supplierId: po.supplierId });
      setPoItems(po.items.map(i => ({
         productId: i.productId,
         name: i.name,
         expectedQuantity: i.expectedQuantity,
         unitCost: inventoryOrderPrice(allProducts?.find(product => product.id === i.productId)) || i.unitCost
      })));
      setIsPOModalOpen(true);
  };

  const initReceivePO = (po: PurchaseOrder) => {
      if (po.approvalStatus !== 'APPROVED') {
          error("This order must be approved by an Admin before it can be received.");
          return;
      }
      setSelectedPO(po);
      const initialQty: {[id: string]: number} = {};
      const initialCost: {[id: string]: number} = {};
      const initialSell: {[id: string]: number} = {};
      const initialExpiry: {[id: string]: string} = {};
      po.items.forEach(item => {
          initialQty[item.productId] = item.expectedQuantity;
          initialCost[item.productId] = item.unitCost;
          const p = allProducts?.find(x => x.id === item.productId);
          if (p) initialSell[item.productId] = p.sellingPrice;
          if ((p as any)?.expiryTracking || (p as any)?.expiryDate) initialExpiry[item.productId] = expiryMsToDateInput((p as any)?.expiryDate);
      });
      setReceiveQuantities(initialQty);
      setReceiveUnitCosts(initialCost);
      setReceiveSellingPrices(initialSell);
      setReceiveExpiryDates(initialExpiry);
      setReceiveInvoices({ ...receiveInvoices, [po.id]: '' });
      setIsReceivePOModalOpen(true);
  };

  const handleReceivePO = async () => {
      if (!selectedPO) return;
      if (isSaving) return;
      const invoiceNumber = receiveInvoices[selectedPO.id];
      if (!invoiceNumber) return error("Invoice number is required");
      if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
      const underCostLine = selectedPO.items.find(item => {
          const product = allProducts?.find(p => p.id === item.productId);
          const unitCost = Number(receiveUnitCosts[item.productId] ?? item.unitCost) || 0;
          const enteredSell = Number(receiveSellingPrices[item.productId]) || 0;
          const sellingPrice = enteredSell > 0 ? enteredSell : Number(product?.sellingPrice || 0);
          const hasDiscount = String((product as any)?.discountType || '').toUpperCase() !== 'NONE' && Number((product as any)?.discountValue || 0) > 0;
          return unitCost > 0 && sellingPrice < unitCost && !hasDiscount;
      });
      if (underCostLine) {
          return error(`Selling price for ${underCostLine.name} cannot be below buying price unless the product has a discount.`);
      }

      setIsSaving(true);
      try {
        const updatedItems = selectedPO.items.map(item => {
            const qty = receiveQuantities[item.productId] || 0;
            const cost = receiveUnitCosts[item.productId] || item.unitCost;
            return { ...item, receivedQuantity: qty, unitCost: cost };
        });
        if (updatedItems.some(item => item.receivedQuantity < 0 || item.unitCost < 0)) {
            return error("Received quantities and costs cannot be negative.");
        }
        const totalReceivedCost = updatedItems.reduce((sum, item) => sum + (item.receivedQuantity * item.unitCost), 0);
        if (totalReceivedCost <= 0) return error("Receive at least one item before confirming arrival.");
        
        await PurchaseService.receiveOrder({
            purchaseOrderId: selectedPO.id,
            invoiceNumber,
            receivedBy: currentUser?.name || 'Staff',
            businessId: activeBusinessId!,
            shopId: activeShopId!,
            items: updatedItems.map(item => ({
                productId: item.productId,
                receivedQuantity: item.receivedQuantity,
                unitCost: item.unitCost,
                sellingPrice: receiveSellingPrices[item.productId],
                expiryDate: dateInputToExpiryMs(receiveExpiryDates[item.productId]),
            })),
        });

        await reloadBestEffort([
            () => db.purchaseOrders.reload(),
            () => db.products.reload(),
            () => db.stockMovements.reload(),
            () => db.suppliers.reload(),
        ]);

        setIsReceivePOModalOpen(false);
        setSelectedPO(null);
        success("Order received and stock updated.");
      } catch (err: any) {
        error("Failed to receive order: " + (err?.message || 'Please try again.'));
      } finally {
        setIsSaving(false);
      }
  };

  const handleDetailsClick = (po: PurchaseOrder) => {
      setSelectedRecordForDetails({ ...po, recordType: 'PURCHASE_ORDER' });
  };

  return (
    <div className="w-full animate-in fade-in space-y-5 pb-24">
      
      {/* Header */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Purchases</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Supplier orders and stock arrivals.</p>
          </div>
        <button
          data-testid="purchase-new-order"
          onClick={() => { setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); setIsPOModalOpen(true); }}
          className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white transition-all hover:bg-blue-800 active:scale-[0.98] md:w-auto"
        >
          <Plus size={18} /> New LPO
        </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Pending approval</p>
            <p className="mt-1 text-xl font-black tabular-nums text-amber-600">{pendingApproval}</p>
          </div>
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Awaiting arrival</p>
            <p className="mt-1 text-xl font-black tabular-nums text-blue-700">{awaitingArrival}</p>
          </div>
          <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total value</p>
            <p className="mt-1 text-xl font-black tabular-nums text-slate-950">Ksh {totalPurchases.toLocaleString()}</p>
          </div>
        </div>
      </section>

      {/* Search Bar */}
      <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
      <div className="border-b-2 border-slate-100 p-4">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-700" size={16} />
          <input
            type="text"
            placeholder="Search by supplier, order number, or invoice number..."
            value={purchaseSearch}
            onChange={(e) => setPurchaseSearch(e.target.value)}
            className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-9 text-sm font-bold outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
          {purchaseSearch && (
            <button onClick={() => setPurchaseSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* PO List */}
      <div>
         {filteredPurchases.length > 0 ? (
           <div className="divide-y divide-slate-100">
             {filteredPurchases.map(po => {
               const supplier = allSuppliers?.find(s => s.id === po.supplierId);
               const isRecv = po.status === 'RECEIVED';
               const isAppr = po.approvalStatus === 'APPROVED';

               return (
                 <button
                   key={po.id}
                   type="button"
                   data-testid={`purchase-row-${po.id}`}
                   onClick={() => po.approvalStatus === 'PENDING' ? initEditPO(po) : handleDetailsClick(po)}
                   className="group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-blue-50/40 sm:px-5"
                 >
                   <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 ${
                     isRecv ? 'border-emerald-100 bg-emerald-50 text-emerald-600' :
                     isAppr ? 'border-blue-100 bg-blue-50 text-blue-700' :
                     'border-amber-100 bg-amber-50 text-amber-600'
                   }`}>
                     {isRecv ? <PackagePlus size={18} /> : (isAppr ? <CheckSquare size={18} /> : <ClipboardList size={18} />)}
                   </div>
                   <div className="min-w-0 flex-1">
                     <h4 className="text-sm font-black text-slate-900 truncate leading-tight">{supplier?.company || 'Unknown supplier'}</h4>
                     <div className="flex items-center gap-2 mt-1 flex-wrap">
                       <span className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                         <FileText size={11} /> {po.poNumber || po.id}
                       </span>
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(po.orderDate).toLocaleDateString()}</span>
                     </div>
                   </div>
                   <span className={`shrink-0 rounded-md border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                     isRecv ? 'border-emerald-100 bg-emerald-50 text-emerald-700' :
                     isAppr ? 'border-blue-100 bg-blue-50 text-blue-700' :
                     'border-amber-100 bg-amber-50 text-amber-700'
                   }`}>
                     {isRecv ? 'Received' : (isAppr ? 'Approved' : 'Pending')}
                   </span>
                   <div className="text-right shrink-0 min-w-[110px]">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Value</p>
                     <p className="text-sm font-black text-slate-900 leading-none tabular-nums">Ksh {po.totalAmount.toLocaleString()}</p>
                   </div>
                   <ChevronRight size={18} className="shrink-0 text-slate-300 transition-colors group-hover:text-blue-700" />
                 </button>
               );
             })}
           </div>
         ) : (
             <div className="flex flex-col items-center py-20 text-center">
             <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 text-slate-300">
               <ClipboardList size={36} />
             </div>
             <p className="text-slate-500 font-black text-base">No purchase orders found</p>
             <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Orders and stock arrivals will appear here</p>
             <button
               data-testid="purchase-empty-new-order"
               onClick={() => { setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); setIsPOModalOpen(true); }}
               className="mt-5 flex items-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition-all active:scale-[0.98] hover:bg-blue-800"
             >
               <Plus size={16} /> Create LPO
             </button>
           </div>
         )}
      </div>
      </section>

      {/* PO Modal */}
      {isPOModalOpen && (
        <div className="mobile-vv-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/45" onClick={() => setIsPOModalOpen(false)} />
           <div className="mobile-vv-panel relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-2 border-slate-200 bg-white shadow-xl animate-in slide-in-from-bottom-full duration-300 sm:rounded-lg sm:zoom-in-95">
              
              <div className="flex shrink-0 items-center gap-4 border-b-2 border-slate-100 px-5 py-5 sm:px-6">
                 <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
                   <ClipboardList size={24} />
                 </div>
                 <div>
                   <h2 className="text-xl font-black text-slate-900 tracking-tight">{selectedPOToEdit ? 'Edit LPO' : 'New LPO'}</h2>
                   <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Local purchase order for supplier stock</p>
                 </div>
              </div>

              <div className="modal-scroll-padding flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Select supplier</label>
                    <SearchableSelect
                      value={poForm.supplierId}
                      onChange={(v) => {
                        setPoForm({ supplierId: v });
                        setPoItems([]);
                        setPoItemInput({ search: '', productId: '', name: '', qty: '', cost: '' });
                      }}
                      placeholder="Select a supplier..."
                      options={(allSuppliers || []).map(s => ({
                        value: s.id,
                        label: `${s.company} (${s.name})`,
                        keywords: `${s.company} ${s.name}`,
                      }))}
                      buttonClassName="rounded-lg border-2 border-slate-200 bg-white px-4 py-3 font-black text-slate-900 hover:border-blue-300"
                      dataTestId="purchase-supplier"
                    />
                 </div>
                 
                 <div className="space-y-4 rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Choose products</h4>
                    <div className="relative group">
                       <input 
                           type="text" 
                           value={poItemInput.search} 
                           onChange={e => setPoItemInput({...poItemInput, search: e.target.value, productId: ''})} 
                           data-testid="purchase-product-search"
                           placeholder={poForm.supplierId ? "Search product by name or barcode..." : "Select supplier first..."} 
                           disabled={!poForm.supplierId}
                           className="w-full rounded-lg border-2 border-slate-200 bg-white py-3 pl-12 pr-4 text-sm font-black text-slate-900 outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100" 
                       />
                       <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-700" size={18} />
                       
                       {poItemInput.search && !poItemInput.productId && (
                          <div className="absolute left-0 right-0 top-full z-10 mt-2 max-h-60 overflow-y-auto rounded-lg border-2 border-slate-200 bg-white shadow-xl animate-in slide-in-from-top-2">
                             {supplierProducts.filter(p => p.name.toLowerCase().includes(poItemInput.search.toLowerCase()) || String(p.barcode || '').includes(poItemInput.search)).slice(0, 5).map(p => (
                                <div key={p.id} data-testid={`purchase-product-option-${p.id}`} onClick={() => handleSelectPoProduct(p)} className="px-5 py-4 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center justify-between">
                                   <span>{p.name}</span>
                                   <span className="text-[10px] text-slate-400 font-mono">Ksh {inventoryOrderPrice(p).toLocaleString()}</span>
                                </div>
                             ))}
                          </div>
                       )}
                    </div>

                    {poItemInput.productId && (
                       <div className="flex gap-3 animate-in zoom-in-95">
                          <div className="flex-1">
                             <input data-testid="purchase-item-qty" type="number" placeholder="Qty" value={poItemInput.qty} onChange={e => setPoItemInput({...poItemInput, qty: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white px-5 py-3 text-center text-sm font-black text-slate-900 outline-none transition-all focus:border-blue-600" />
                          </div>
                          <div className="flex-[2] relative">
                             <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">Ksh</span>
                             <input data-testid="purchase-item-cost" type="number" placeholder="Inventory price" value={poItemInput.cost} readOnly className="w-full rounded-lg border-2 border-slate-200 bg-white py-3 pl-12 pr-5 text-sm font-black text-slate-900 outline-none transition-all read-only:bg-slate-100 read-only:text-slate-500" />
                          </div>
                          <button data-testid="purchase-add-item" onClick={handleAddPoItem} className="flex w-14 items-center justify-center rounded-lg border-2 border-blue-700 bg-blue-700 text-white transition-all active:scale-95 hover:bg-blue-800">
                             <Plus size={24}/>
                          </button>
                       </div>
                    )}
                 </div>

                 {poItems.length > 0 && (
                    <div className="space-y-3">
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Order line items</h3>
                       <div className="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
                          {poItems.map((item, idx) => (
                             <div key={idx} className="group flex items-center justify-between rounded-lg border-2 border-slate-200 bg-white p-4">
                                <div className="min-w-0">
                                   <div className="text-sm font-black text-slate-900 truncate leading-tight">{item.name}</div>
                                   <div className="mt-0.5 text-[10px] font-bold uppercase tracking-tight text-slate-400">{item.expectedQuantity} units x Ksh {item.unitCost}</div>
                                </div>
                                <div className="flex items-center gap-4">
                                   <div className="text-right">
                                      <div className="text-sm font-black text-slate-900">Ksh {(item.expectedQuantity * item.unitCost).toLocaleString()}</div>
                                   </div>
                                   <button onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white">
                                      <Trash2 size={14}/>
                                   </button>
                                </div>
                             </div>
                          ))}
                       </div>
                       <div className="mt-4 flex items-center justify-between rounded-lg border-2 border-slate-200 bg-slate-50 px-5 py-4">
                          <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Total value</span>
                          <span className="text-xl font-black text-slate-950">Ksh {poItems.reduce((acc, item) => acc + (item.expectedQuantity * item.unitCost), 0).toLocaleString()}</span>
                       </div>
                    </div>
                 )}
              </div>

              <div className="mobile-popup-footer grid shrink-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] gap-3 border-t-2 border-slate-100 bg-white px-5 py-5 sm:gap-4 sm:px-6">
                 <button onClick={() => { setIsPOModalOpen(false); setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); }} className="min-w-0 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-600 transition-all press sm:px-8">
                   Cancel
                 </button>
                 <button data-testid="purchase-save-order" onClick={handleSavePO} disabled={!poForm.supplierId || poItems.length === 0 || isSaving} aria-busy={isSaving} data-busy={isSaving ? 'true' : undefined} className="press flex min-w-0 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-3 text-[10px] font-black uppercase tracking-[0.15em] leading-tight text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:gap-3 sm:px-8">
                   {selectedPOToEdit ? <Save size={18}/> : <PackagePlus size={18}/>}
                   {isSaving ? 'Saving...' : selectedPOToEdit ? 'Save LPO' : 'Create LPO'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Receive PO Modal */}
      {isReceivePOModalOpen && selectedPO && (
        <div className="mobile-vv-overlay fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/45" onClick={() => setIsReceivePOModalOpen(false)} />
           <div className="mobile-vv-panel relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border-2 border-slate-200 bg-white shadow-xl animate-in slide-in-from-bottom-full duration-300 sm:rounded-lg sm:zoom-in-95">
              
              <div className="flex shrink-0 items-center gap-4 border-b-2 border-slate-100 px-5 py-5 sm:px-6">
                 <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-emerald-100 bg-emerald-50 text-emerald-700">
                   <PackagePlus size={24} />
                 </div>
                 <div>
                   <h2 className="text-xl font-black text-slate-900 tracking-tight">Receive stock shipment</h2>
                   <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Inventory intake confirmation</p>
                 </div>
              </div>

              <div className="modal-scroll-padding flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Supplier invoice number</label>
                    <input data-testid="purchase-receive-invoice" type="text" value={receiveInvoices[selectedPO.id] || ''} onChange={e => setReceiveInvoices({...receiveInvoices, [selectedPO.id]: e.target.value})} className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900 outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="e.g. INV/2026/001" />
                 </div>

                 <div className="space-y-3">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Line item verification</h3>
                    <div className="space-y-4">
                        {selectedPO.items.map((item, idx) => (
                           <div key={idx} className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                              <div className="flex justify-between items-start mb-4">
                                 <div className="min-w-0">
                                    <div className="text-sm font-black text-slate-900 truncate leading-tight">{item.name}</div>
                                    <div className="text-[9px] font-bold text-slate-400 uppercase mt-1 tracking-tight">Expect: {item.expectedQuantity} @ Ksh {item.unitCost}</div>
                                 </div>
                                 <div className="w-24">
                                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Actual received</label>
                                    <input 
                                        type="number" 
                                        data-testid={`purchase-receive-qty-${item.productId}`}
                                        value={receiveQuantities[item.productId] ?? item.expectedQuantity} 
                                        onChange={e => setReceiveQuantities({...receiveQuantities, [item.productId]: Number(e.target.value)})} 
                                        className="w-full rounded-lg border-2 border-slate-200 bg-white px-2 py-2 text-center text-sm font-black text-slate-900 outline-none focus:border-blue-600" 
                                    />
                                 </div>
                              </div>
                               <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-200/50">
                                 <div>
                                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Verified unit cost</label>
                                    <input 
                                        type="number" 
                                        data-testid={`purchase-receive-cost-${item.productId}`}
                                        value={receiveUnitCosts[item.productId] ?? item.unitCost} 
                                        onChange={e => setReceiveUnitCosts({...receiveUnitCosts, [item.productId]: Number(e.target.value)})} 
                                        className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-[11px] font-black text-slate-900 outline-none focus:border-blue-600" 
                                    />
                                 </div>
                                  <div>
                                     <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Update sell price</label>
                                    <input 
                                        type="number" 
                                        data-testid={`purchase-receive-sell-${item.productId}`}
                                        value={receiveSellingPrices[item.productId] ?? ''} 
                                        onChange={e => setReceiveSellingPrices({...receiveSellingPrices, [item.productId]: Number(e.target.value)})} 
                                        className="w-full rounded-lg border-2 border-slate-200 bg-white px-4 py-2 text-[11px] font-black text-slate-900 outline-none focus:border-blue-600" 
                                        placeholder="No change"
                                     />
                                  </div>
                                  <div className="col-span-2">
                                     <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Expiry date</label>
                                     <input
                                        type="date"
                                        data-testid={`purchase-receive-expiry-${item.productId}`}
                                        value={receiveExpiryDates[item.productId] || ''}
                                        onChange={e => setReceiveExpiryDates({...receiveExpiryDates, [item.productId]: e.target.value})}
                                        className="w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-900 outline-none focus:border-blue-600"
                                     />
                                  </div>
                               </div>
                           </div>
                        ))}
                    </div>
                 </div>
              </div>

              <div className="mobile-popup-footer grid shrink-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)] gap-3 border-t-2 border-slate-100 bg-white px-5 py-5 sm:gap-4 sm:px-6">
                 <button onClick={() => setIsReceivePOModalOpen(false)} className="min-w-0 rounded-lg border-2 border-slate-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-600 transition-all press sm:px-8">
                   Cancel
                 </button>
                 <button data-testid="purchase-confirm-arrival" onClick={handleReceivePO} disabled={!receiveInvoices[selectedPO.id] || isSaving} aria-busy={isSaving} data-busy={isSaving ? 'true' : undefined} className="press flex min-w-0 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 py-3 text-[10px] font-black uppercase tracking-[0.15em] leading-tight text-white transition-all disabled:cursor-not-allowed disabled:opacity-50 sm:gap-3 sm:px-8">
                   {isSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckSquare size={18}/>}
                   {isSaving ? 'Saving...' : 'Confirm goods received'}
                 </button>
              </div>
           </div>
        </div>
      )}

      <DocumentDetailsModal 
        selectedRecord={selectedRecordForDetails} 
        setSelectedRecord={setSelectedRecordForDetails} 
        handleRefund={async () => {}}
        onReceive={initReceivePO}
      />
    </div>
  );
}

const Loader2 = ({ size, className }: { size: number, className?: string }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;

