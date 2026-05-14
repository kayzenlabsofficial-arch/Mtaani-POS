import React, { useState } from 'react';
import { Search, Plus, ClipboardList, PackagePlus, CheckSquare, Save, Trash2, Barcode, SlidersHorizontal, TrendingUp, ShoppingBag, Clock, ChevronRight, X, User, ArrowDownLeft, FileText } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product, type PurchaseOrder, type Supplier, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import { SearchableSelect } from '../shared/SearchableSelect';


export default function PurchasesTab() {
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
  const [isSaving, setIsSaving] = useState(false);

  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  
  const allPurchaseOrders = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allSuppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );

  const filteredPurchases = allPurchaseOrders.filter(po => 
      po.invoiceNumber?.toLowerCase().includes(purchaseSearch.toLowerCase()) || 
      allSuppliers.find(s => s.id === po.supplierId)?.company.toLowerCase().includes(purchaseSearch.toLowerCase()) ||
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
     setPoItemInput({ ...poItemInput, search: product.name, productId: product.id, name: product.name, cost: (product.sellingPrice * 0.7).toFixed(0) }); 
  };

  const handleSavePO = async () => {
      if (!poForm.supplierId || poItems.length === 0) return;
      if (isSaving) return;
      setIsSaving(true);
      try {
        const totalAmount = poItems.reduce((acc, item) => acc + (item.expectedQuantity * item.unitCost), 0);
        
        if (selectedPOToEdit) {
           await db.purchaseOrders.update(selectedPOToEdit.id, {
              supplierId: poForm.supplierId,
              items: poItems.map(item => ({ ...item, receivedQuantity: 0 })),
              totalAmount,
              preparedBy: selectedPOToEdit.preparedBy || currentUser?.name || 'Authorized Staff',
              branchId: activeBranchId!
           });
           setSelectedPOToEdit(null);
        } else {
           const allPOs = await db.purchaseOrders.toArray();
           const maxNumber = allPOs.reduce((max, po) => {
              if (!po.id.startsWith('PO-')) return max;
              const num = parseInt(po.id.replace('PO-', ''));
              return !isNaN(num) && num > max ? num : max;
           }, 0);
           const nextId = `PO-${String(maxNumber + 1).padStart(4, '0')}`;

           await db.purchaseOrders.add({
              id: nextId,
              poNumber: nextId,
              supplierId: poForm.supplierId,
              items: poItems.map(item => ({ ...item, receivedQuantity: 0 })),
              totalAmount,
              status: 'PENDING',
              approvalStatus: 'PENDING',
              orderDate: Date.now(),
              preparedBy: currentUser?.name || 'Authorized Staff',
              branchId: activeBranchId!,
              businessId: activeBusinessId!
           } as any);
        }
        setIsPOModalOpen(false);
        setPoForm({ supplierId: '' });
        setPoItems([]);
        success("Purchase order saved successfully.");
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
         unitCost: i.unitCost
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
      po.items.forEach(item => {
          initialQty[item.productId] = item.expectedQuantity;
          initialCost[item.productId] = item.unitCost;
          const p = allProducts?.find(x => x.id === item.productId);
          if (p) initialSell[item.productId] = p.sellingPrice;
      });
      setReceiveQuantities(initialQty);
      setReceiveUnitCosts(initialCost);
      setReceiveSellingPrices(initialSell);
      setReceiveInvoices({ ...receiveInvoices, [po.id]: '' });
      setIsReceivePOModalOpen(true);
  };

  const handleReceivePO = async () => {
      if (!selectedPO) return;
      if (isSaving) return;
      const invoiceNumber = receiveInvoices[selectedPO.id];
      if (!invoiceNumber) return error("Invoice number is required");

      setIsSaving(true);
      try {
        const updatedItems = selectedPO.items.map(item => {
            const qty = receiveQuantities[item.productId] || 0;
            const cost = receiveUnitCosts[item.productId] || item.unitCost;
            return { ...item, receivedQuantity: qty, unitCost: cost };
        });
        
        await db.purchaseOrders.update(selectedPO.id, { 
            status: 'RECEIVED', 
            paymentStatus: 'UNPAID',
            paidAmount: 0,
            items: updatedItems,
            receivedDate: Date.now(),
            invoiceNumber 
        });

        let totalReceivedCost = 0;
        for (const item of updatedItems) {
           if (item.receivedQuantity > 0) {
               const product = await db.products.get(item.productId);
               if (product) {
                   const newSell = receiveSellingPrices[item.productId];
                   await db.products.update(item.productId, {
                       stockQuantity: (product.stockQuantity || 0) + item.receivedQuantity,
                       ...(newSell && newSell !== product.sellingPrice ? { sellingPrice: newSell } : {})
                   });
                   await db.stockMovements.add({
                       id: crypto.randomUUID(),
                       productId: item.productId,
                       type: 'IN',
                       quantity: item.receivedQuantity,
                       timestamp: Date.now(),
                       reference: `PO#${selectedPO.id.split('-')[0].toUpperCase()} Inv:${invoiceNumber}`,
                       branchId: activeBranchId!,
                       businessId: activeBusinessId!
                   });
               }
               totalReceivedCost += (item.receivedQuantity * item.unitCost);
           }
        }

        const supplier = await db.suppliers.get(selectedPO.supplierId);
        if (supplier) {
            await db.suppliers.update(supplier.id, {
                balance: (supplier.balance || 0) + totalReceivedCost
            });
        }

        setIsReceivePOModalOpen(false);
        setSelectedPO(null);
        success("Order received and stock updated.");
      } catch (err: any) {
        error("Failed to receive order.");
      } finally {
        setIsSaving(false);
      }
  };

  const handleDetailsClick = (po: PurchaseOrder) => {
      setSelectedRecordForDetails({ ...po, recordType: 'PURCHASE_ORDER' });
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Procurement</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-amber-600">{pendingApproval} pending</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-blue-600">{awaitingArrival} awaiting arrival</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">Vol: Ksh {totalPurchases.toLocaleString()}</span>
          </div>
        </div>
        <button
          onClick={() => { setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); setIsPOModalOpen(true); }}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
        >
          <Plus size={18} /> New Order
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by vendor, PO # or invoice number..."
            value={purchaseSearch}
            onChange={(e) => setPurchaseSearch(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
          />
          {purchaseSearch && (
            <button onClick={() => setPurchaseSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* PO List */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
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
                   onClick={() => po.approvalStatus === 'PENDING' ? initEditPO(po) : handleDetailsClick(po)}
                   className="w-full text-left px-3 sm:px-5 py-3 flex items-center gap-3 hover:bg-indigo-50/40 transition-colors group"
                 >
                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                     isRecv ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                     isAppr ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                     'bg-amber-50 text-amber-600 border border-amber-100'
                   }`}>
                     {isRecv ? <PackagePlus size={18} /> : (isAppr ? <CheckSquare size={18} /> : <ClipboardList size={18} />)}
                   </div>
                   <div className="min-w-0 flex-1">
                     <h4 className="text-sm font-black text-slate-900 truncate leading-tight">{supplier?.company || 'Unknown Supplier'}</h4>
                     <div className="flex items-center gap-2 mt-1 flex-wrap">
                       <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100 flex items-center gap-1">
                         <FileText size={11} /> {po.poNumber || po.id}
                       </span>
                       <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{new Date(po.orderDate).toLocaleDateString()}</span>
                     </div>
                   </div>
                   <span className={`text-[9px] font-black px-2.5 py-1 rounded-full uppercase tracking-wider shrink-0 ${
                     isRecv ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                     isAppr ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                     'bg-amber-50 text-amber-600 border border-amber-100'
                   }`}>
                     {isRecv ? 'Received' : (isAppr ? 'Approved' : 'Pending')}
                   </span>
                   <div className="text-right shrink-0 min-w-[110px]">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Value</p>
                     <p className="text-sm font-black text-slate-900 leading-none tabular-nums">Ksh {po.totalAmount.toLocaleString()}</p>
                   </div>
                   <ChevronRight size={18} className="text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                 </button>
               );
             })}
           </div>
         ) : (
           <div className="py-20 text-center flex flex-col items-center">
             <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
               <ClipboardList size={36} />
             </div>
             <p className="text-slate-500 font-black text-base">No procurement records found</p>
             <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Orders and stock arrivals will appear here</p>
           </div>
         )}
      </div>

      {/* PO Modal */}
      {isPOModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsPOModalOpen(false)} />
           <div className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center gap-4 mb-8 shrink-0">
                 <div className="w-12 h-12 grad-indigo rounded-2xl flex items-center justify-center text-white shadow-indigo">
                   <ClipboardList size={24} />
                 </div>
                 <div>
                   <h2 className="text-xl font-black text-slate-900 tracking-tight">{selectedPOToEdit ? 'Edit Purchase Order' : 'New Procurement Order'}</h2>
                   <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Supply Chain Request</p>
                 </div>
              </div>

              <div className="space-y-6 mb-10">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Select Registered Vendor</label>
                    <SearchableSelect
                      value={poForm.supplierId}
                      onChange={(v) => setPoForm({ supplierId: v })}
                      placeholder="Select a supplier..."
                      options={(allSuppliers || []).map(s => ({
                        value: s.id,
                        label: `${s.company} (${s.name})`,
                        keywords: `${s.company} ${s.name}`,
                      }))}
                      buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-slate-50 border-transparent hover:border-slate-200"
                    />
                 </div>
                 
                 <div className="bg-slate-50 rounded-[2rem] p-6 border-2 border-slate-100 space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">SKU Selection</h4>
                    <div className="relative group">
                       <input 
                           type="text" 
                           value={poItemInput.search} 
                           onChange={e => setPoItemInput({...poItemInput, search: e.target.value, productId: ''})} 
                           placeholder="Search product by name or barcode..." 
                           className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl pl-12 pr-4 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" 
                       />
                       <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                       
                       {poItemInput.search && !poItemInput.productId && (
                          <div className="absolute top-full left-0 right-0 z-10 bg-white border-2 border-slate-100 rounded-2xl shadow-xl mt-2 max-h-60 overflow-y-auto no-scrollbar animate-in slide-in-from-top-2">
                             {allProducts?.filter(p => p.name.toLowerCase().includes(poItemInput.search.toLowerCase()) || p.barcode.includes(poItemInput.search)).slice(0, 5).map(p => (
                                <div key={p.id} onClick={() => handleSelectPoProduct(p)} className="px-5 py-4 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0 flex items-center justify-between">
                                   <span>{p.name}</span>
                                   <span className="text-[10px] text-slate-400 font-mono">{p.barcode}</span>
                                </div>
                             ))}
                          </div>
                       )}
                    </div>

                    {poItemInput.productId && (
                       <div className="flex gap-3 animate-in zoom-in-95">
                          <div className="flex-1">
                             <input type="number" placeholder="Qty" value={poItemInput.qty} onChange={e => setPoItemInput({...poItemInput, qty: e.target.value})} className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm text-center" />
                          </div>
                          <div className="flex-[2] relative">
                             <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">KSH</span>
                             <input type="number" placeholder="Unit Cost" value={poItemInput.cost} onChange={e => setPoItemInput({...poItemInput, cost: e.target.value})} className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl pl-12 pr-5 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                          </div>
                          <button onClick={handleAddPoItem} className="w-14 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-indigo active:scale-95 transition-all">
                             <Plus size={24}/>
                          </button>
                       </div>
                    )}
                 </div>

                 {poItems.length > 0 && (
                    <div className="space-y-3">
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Order Line Items</h3>
                       <div className="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
                          {poItems.map((item, idx) => (
                             <div key={idx} className="flex items-center justify-between bg-white border-2 border-slate-50 p-4 rounded-2xl shadow-sm group">
                                <div className="min-w-0">
                                   <div className="text-sm font-black text-slate-900 truncate leading-tight">{item.name}</div>
                                   <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mt-0.5">{item.expectedQuantity} units × Ksh {item.unitCost}</div>
                                </div>
                                <div className="flex items-center gap-4">
                                   <div className="text-right">
                                      <div className="text-sm font-black text-indigo-600">Ksh {(item.expectedQuantity * item.unitCost).toLocaleString()}</div>
                                   </div>
                                   <button onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-rose-500 hover:text-white">
                                      <Trash2 size={14}/>
                                   </button>
                                </div>
                             </div>
                          ))}
                       </div>
                       <div className="flex justify-between items-center px-6 py-5 bg-indigo-50 rounded-2xl border-2 border-indigo-100 mt-4">
                          <span className="text-[11px] font-black text-indigo-900 uppercase tracking-widest">Total Valuation</span>
                          <span className="text-xl font-black text-indigo-600">Ksh {poItems.reduce((acc, item) => acc + (item.expectedQuantity * item.unitCost), 0).toLocaleString()}</span>
                       </div>
                    </div>
                 )}
              </div>

              <div className="flex gap-4 mt-auto pt-6 border-t border-slate-50">
                 <button onClick={() => { setIsPOModalOpen(false); setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); }} className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl transition-all press">
                   Dismiss
                 </button>
                 <button onClick={handleSavePO} disabled={!poForm.supplierId || poItems.length === 0} className="flex-[2] grad-indigo text-white px-8 py-5 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl disabled:opacity-40 transition-all shadow-indigo press flex items-center justify-center gap-3">
                   <Save size={18}/>
                   {selectedPOToEdit ? 'Commit Changes' : 'Publish Order'}
                 </button>
              </div>
           </div>
        </div>
      )}

      {/* Receive PO Modal */}
      {isReceivePOModalOpen && selectedPO && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsReceivePOModalOpen(false)} />
           <div className="bg-white w-full max-w-lg rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto no-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center gap-4 mb-8 shrink-0">
                 <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-emerald">
                   <PackagePlus size={24} />
                 </div>
                 <div>
                   <h2 className="text-xl font-black text-slate-900 tracking-tight">Receive Stock Shipment</h2>
                   <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Inventory Intake Confirmation</p>
                 </div>
              </div>

              <div className="space-y-6 mb-10">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Vendor Invoice Number</label>
                    <input type="text" value={receiveInvoices[selectedPO.id] || ''} onChange={e => setReceiveInvoices({...receiveInvoices, [selectedPO.id]: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="e.g. INV/2026/001" />
                 </div>

                 <div className="space-y-3">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Line Item Verification</h3>
                    <div className="space-y-4">
                        {selectedPO.items.map((item, idx) => (
                           <div key={idx} className="bg-slate-50 border-2 border-slate-100 p-5 rounded-[2rem] shadow-inner">
                              <div className="flex justify-between items-start mb-4">
                                 <div className="min-w-0">
                                    <div className="text-sm font-black text-slate-900 truncate leading-tight">{item.name}</div>
                                    <div className="text-[9px] font-bold text-slate-400 uppercase mt-1 tracking-tight">Expect: {item.expectedQuantity} @ Ksh {item.unitCost}</div>
                                 </div>
                                 <div className="w-24">
                                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Actual Recv</label>
                                    <input 
                                        type="number" 
                                        value={receiveQuantities[item.productId] ?? item.expectedQuantity} 
                                        onChange={e => setReceiveQuantities({...receiveQuantities, [item.productId]: Number(e.target.value)})} 
                                        className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl px-2 py-2 text-sm font-black text-slate-900 outline-none text-center shadow-sm" 
                                    />
                                 </div>
                              </div>
                              <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-200/50">
                                 <div>
                                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Verified Unit Cost</label>
                                    <input 
                                        type="number" 
                                        value={receiveUnitCosts[item.productId] ?? item.unitCost} 
                                        onChange={e => setReceiveUnitCosts({...receiveUnitCosts, [item.productId]: Number(e.target.value)})} 
                                        className="w-full bg-white border-2 border-transparent focus:border-emerald-500 rounded-xl px-4 py-2 text-[11px] font-black text-slate-900 outline-none shadow-sm" 
                                    />
                                 </div>
                                 <div>
                                    <label className="block text-[8px] font-black text-slate-400 uppercase mb-1.5 ml-1">Update Sell Price</label>
                                    <input 
                                        type="number" 
                                        value={receiveSellingPrices[item.productId] ?? ''} 
                                        onChange={e => setReceiveSellingPrices({...receiveSellingPrices, [item.productId]: Number(e.target.value)})} 
                                        className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-xl px-4 py-2 text-[11px] font-black text-slate-900 outline-none shadow-sm" 
                                        placeholder="No change"
                                    />
                                 </div>
                              </div>
                           </div>
                        ))}
                    </div>
                 </div>
              </div>

              <div className="flex gap-4 mt-auto pt-6 border-t border-slate-50">
                 <button onClick={() => setIsReceivePOModalOpen(false)} className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl transition-all press">
                   Dismiss
                 </button>
                 <button onClick={handleReceivePO} disabled={!receiveInvoices[selectedPO.id] || isSaving} className="flex-[2] bg-emerald-600 text-white px-8 py-5 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl disabled:opacity-40 transition-all shadow-emerald press flex items-center justify-center gap-3">
                   {isSaving ? <Loader2 size={18} className="animate-spin" /> : <CheckSquare size={18}/>}
                   {isSaving ? 'Processing...' : 'Confirm Arrival'}
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
