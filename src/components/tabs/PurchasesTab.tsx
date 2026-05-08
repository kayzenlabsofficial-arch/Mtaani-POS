import React, { useState } from 'react';
import { Search, Plus, ClipboardList, PackagePlus, CheckSquare, Save, Trash2, Barcode } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Product, type PurchaseOrder, type Supplier, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import { SearchableSelect } from '../shared/SearchableSelect';

export default function PurchasesTab() {
  const { error } = useToast();
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
  const allSuppliers = useLiveQuery(() => db.suppliers.toArray(), [], []) ;
  const allProducts = useLiveQuery(() => db.products.toArray(), [], []) ;

  const filteredPurchases = allPurchaseOrders.filter(po => 
      po.invoiceNumber?.toLowerCase().includes(purchaseSearch.toLowerCase()) || 
      allSuppliers.find(s => s.id === po.supplierId)?.company.toLowerCase().includes(purchaseSearch.toLowerCase())
  );

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
        success("Purchase order saved.");
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
      if (!invoiceNumber) return;

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
                       stockQuantity: product.stockQuantity + item.receivedQuantity,
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

  const handleRefundStub = async (t: Transaction) => {
      // Purchase orders don't support the sales refund flow
      console.log("Refund not applicable for POs");
  };

  return (
    <div className="p-5 pb-8 animate-in fade-in max-w-5xl mx-auto w-full flex flex-col">
      <div className="flex justify-between items-center mb-6 mt-2">
         <div>
           <h2 className="text-xl font-extrabold text-slate-900 mb-1">Purchases</h2>
           <p className="text-sm text-slate-500">Manage supplier orders & stock receiving.</p>
         </div>
         <button onClick={() => { setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); setIsPOModalOpen(true); }} className="bg-slate-900 text-white p-3 rounded-2xl shadow-lg shadow-slate-900/20 active:scale-95 transition-transform flex items-center gap-2 font-bold text-sm">
           <Plus size={18} /> New Order
         </button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
        <input 
          type="text" placeholder="Search orders..." value={purchaseSearch} onChange={(e) => setPurchaseSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white rounded-2xl border border-slate-200 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all font-medium"
        />
      </div>

      <div className="space-y-2 pb-24">
         {filteredPurchases.map(po => (
            <div 
                key={po.id} 
                onClick={() => {
                    if (po.approvalStatus === 'PENDING') {
                        initEditPO(po);
                    } else {
                        handleDetailsClick(po);
                    }
                }} 
                className={`bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between transition-transform active:scale-[0.98] cursor-pointer hover:border-slate-300`}>
               <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 
                    ${po.status === 'RECEIVED' ? 'bg-green-50 border border-green-100 text-green-600' : 
                      (po.approvalStatus === 'APPROVED' ? 'bg-blue-50 border border-blue-100 text-blue-600' : 'bg-orange-50 border border-orange-100 text-orange-600')}`}>
                     {po.status === 'RECEIVED' ? <PackagePlus size={18} /> : (po.approvalStatus === 'APPROVED' ? <CheckSquare size={18} /> : <ClipboardList size={18} />)}
                  </div>
                  <div>
                     <h4 className="text-sm font-bold text-slate-900">{allSuppliers?.find(s => s.id === po.supplierId)?.company || 'Unknown Supplier'}</h4>
                     <div className="text-[11px] font-semibold text-slate-500 mt-0.5">
                        {po.id.startsWith('PO-') ? '' : 'PO #'}{po.id.startsWith('PO-') ? po.id : po.id.split('-')[0].toUpperCase()} • {new Date(po.orderDate).toLocaleDateString()}
                        {po.approvalStatus === 'PENDING' && <span className="ml-2 text-orange-600 font-bold">(Needs Admin Approval)</span>}
                     </div>
                  </div>
               </div>
               <div className="text-right flex flex-col items-end gap-1">
                  <div className="text-sm font-black text-slate-900">
                     Ksh {po.totalAmount.toLocaleString()}
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded  
                    ${po.status === 'RECEIVED' ? 'bg-green-100 text-green-700' : 
                      (po.approvalStatus === 'APPROVED' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700')}`}>
                     {po.status === 'RECEIVED' ? 'RECEIVED' : (po.approvalStatus === 'APPROVED' ? 'APPROVED' : 'AWAITING APPROVAL')}
                  </span>
               </div>
            </div>
         ))}
         {filteredPurchases.length === 0 && (
            <div className="py-10 text-center text-slate-400 flex flex-col items-center">
               <ClipboardList size={40} className="mb-3 opacity-20" />
               <p className="text-sm">No purchase orders found.</p>
            </div>
         )}
      </div>

      {/* Purchase Order Modal */}
      {isPOModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsPOModalOpen(false)} />
          <div className="bg-white w-full max-w-lg rounded-[24px] shadow-2xl relative z-10 flex flex-col p-6 animate-in zoom-in-95 duration-200 overflow-hidden max-h-[90vh]">
            <h2 className="text-xl font-black text-slate-900 mb-2 flex items-center gap-2">
               <ClipboardList className="text-blue-600" /> {selectedPOToEdit ? 'Edit Purchase Order' : 'New Purchase Order'}
            </h2>
            <p className="text-sm text-slate-500 mb-4">{selectedPOToEdit ? 'Modify the requested items.' : 'Create a new order to send to a supplier.'}</p>
            
            <div className="space-y-4 mb-4 flex-1 overflow-y-auto no-scrollbar">
                 <div>
                    <label className="block text-xs font-bold text-slate-500  mb-1.5">Supplier</label>
                    <SearchableSelect
                      value={poForm.supplierId}
                      onChange={(v) => setPoForm({ supplierId: v })}
                      placeholder="Select a supplier..."
                      options={(allSuppliers || []).map(s => ({
                        value: s.id,
                        label: `${s.company} (${s.name})`,
                        keywords: `${s.company} ${s.name}`,
                      }))}
                    />
                 </div>
                 
                 <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-3">
                    <label className="block text-xs font-bold text-slate-500 ">Add Item to Order</label>
                    <div className="flex flex-col gap-2">
                       <input 
                           type="text" 
                           value={poItemInput.search} 
                           onChange={e => setPoItemInput({...poItemInput, search: e.target.value, productId: ''})} 
                           placeholder="Search product to add..." 
                           className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" 
                       />
                       {poItemInput.search && !poItemInput.productId && (
                          <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-h-40 overflow-y-auto mt-1">
                             {allProducts?.filter(p => p.name.toLowerCase().includes(poItemInput.search.toLowerCase())).slice(0, 3).map(p => (
                                <div key={p.id} onClick={() => handleSelectPoProduct(p)} className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0">{p.name}</div>
                             ))}
                             {allProducts?.filter(p => p.name.toLowerCase().includes(poItemInput.search.toLowerCase())).length === 0 && (
                                <div className="px-3 py-2 text-sm text-slate-500 italic">No exact matches found</div>
                             )}
                          </div>
                       )}
                    </div>
                    {poItemInput.productId && (
                       <div className="flex gap-2">
                          <input type="number" placeholder="Qty" value={poItemInput.qty} onChange={e => setPoItemInput({...poItemInput, qty: e.target.value})} className="w-[60px] min-w-0 shrink border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-blue-500" />
                          <input type="number" placeholder="Unit Cost" value={poItemInput.cost} onChange={e => setPoItemInput({...poItemInput, cost: e.target.value})} className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" />
                          <button onClick={handleAddPoItem} className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 font-bold text-sm flex items-center justify-center gap-1 transition-colors"><Plus size={16}/> Add</button>
                       </div>
                    )}
                 </div>

                 {poItems.length > 0 && (
                    <div className="mt-4">
                       <h3 className="text-xs font-bold text-slate-500  mb-2">Order Items</h3>
                       <div className="space-y-2">
                          {poItems.map((item, idx) => (
                             <div key={idx} className="flex justify-between items-center bg-white border border-slate-200 p-2 rounded-lg text-sm">
                                <div>
                                   <div className="font-semibold">{item.name}</div>
                                   <div className="text-xs text-slate-500">{item.expectedQuantity} units @ Ksh {item.unitCost}</div>
                                </div>
                                <div className="font-bold">Ksh {(item.expectedQuantity * item.unitCost).toLocaleString()}</div>
                                <button onClick={() => setPoItems(poItems.filter((_, i) => i !== idx))} className="text-red-500 p-1"><Trash2 size={14}/></button>
                             </div>
                          ))}
                       </div>
                       <div className="flex justify-between items-center text-sm font-black mt-3 pt-3 border-t border-slate-200">
                          <span>Total amount</span>
                          <span>Ksh {poItems.reduce((acc, item) => acc + (item.expectedQuantity * item.unitCost), 0).toLocaleString()}</span>
                       </div>
                    </div>
                 )}
            </div>

            <div className="flex gap-3 mt-auto pt-4">
               <button onClick={() => { setIsPOModalOpen(false); setSelectedPOToEdit(null); setPoForm({supplierId: ''}); setPoItems([]); }} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
               <button onClick={handleSavePO} disabled={!poForm.supplierId || poItems.length === 0} className="flex-[2] bg-blue-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95"><Save size={16}/> {selectedPOToEdit ? 'Save Changes' : 'Create Order'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Receive Purchase Order Modal */}
      {isReceivePOModalOpen && selectedPO && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsReceivePOModalOpen(false)} />
          <div className="bg-white w-full max-w-lg rounded-[24px] shadow-2xl relative z-10 flex flex-col p-6 animate-in zoom-in-95 duration-200 overflow-hidden max-h-[90vh]">
            <h2 className="text-xl font-black text-slate-900 mb-2 flex items-center gap-2">
               <PackagePlus className="text-green-600" /> Receive Order
            </h2>
            <p className="text-sm text-slate-500 mb-4">Confirm received quantities and specify invoice number to update stock.</p>
            
            <div className="space-y-4 mb-4 flex-1 overflow-y-auto no-scrollbar">
                 <div>
                    <label className="block text-xs font-bold text-slate-500  mb-1.5">Supplier Invoice Number</label>
                    <input type="text" value={receiveInvoices[selectedPO.id] || ''} onChange={e => setReceiveInvoices({...receiveInvoices, [selectedPO.id]: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-green-500" placeholder="e.g. INV-2023-001" />
                 </div>

                 <div className="mt-4">
                    <h3 className="text-xs font-bold text-slate-500  mb-2">Items to Receive</h3>
                    <div className="space-y-3">
                        {selectedPO.items.map((item, idx) => (
                           <div key={idx} className="bg-white border border-slate-200 p-3 rounded-lg text-sm flex flex-col gap-3">
                              <div className="flex justify-between items-start">
                                 <div>
                                    <div className="font-semibold text-slate-900">{item.name}</div>
                                    <div className="text-xs text-slate-500">Ordered: {item.expectedQuantity} @ Ksh {item.unitCost}</div>
                                 </div>
                                 <div className="w-20 shrink-0">
                                    <label className="block text-[9px]  font-bold text-slate-400 mb-1">Recv Qty</label>
                                    <input 
                                        type="number" 
                                        value={receiveQuantities[item.productId] ?? item.expectedQuantity} 
                                        onChange={e => setReceiveQuantities({...receiveQuantities, [item.productId]: Number(e.target.value)})} 
                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-bold focus:outline-none focus:border-green-500 text-center" 
                                    />
                                 </div>
                              </div>
                              <div className="flex gap-2 pt-2 border-t border-slate-100">
                                 <div className="flex-1">
                                    <label className="block text-[9px]  font-bold text-slate-400 mb-1">Actual Unit Cost</label>
                                    <input 
                                        type="number" 
                                        value={receiveUnitCosts[item.productId] ?? item.unitCost} 
                                        onChange={e => setReceiveUnitCosts({...receiveUnitCosts, [item.productId]: Number(e.target.value)})} 
                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold focus:outline-none focus:border-green-500" 
                                    />
                                 </div>
                                 <div className="flex-1">
                                    <label className="block text-[9px]  font-bold text-slate-400 mb-1">Update Sell Price</label>
                                    <input 
                                        type="number" 
                                        value={receiveSellingPrices[item.productId] ?? ''} 
                                        onChange={e => setReceiveSellingPrices({...receiveSellingPrices, [item.productId]: Number(e.target.value)})} 
                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-semibold focus:outline-none focus:border-blue-500" 
                                    />
                                 </div>
                              </div>
                           </div>
                        ))}
                     </div>
                 </div>
            </div>

            <div className="flex gap-3 mt-auto pt-4">
               <button onClick={() => setIsReceivePOModalOpen(false)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
               <button onClick={handleReceivePO} disabled={!receiveInvoices[selectedPO.id]} className="flex-[2] bg-green-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-green-600/20 active:scale-95"><CheckSquare size={16}/> Receive Stock</button>
            </div>
          </div>
        </div>
      )}

      <DocumentDetailsModal 
        selectedRecord={selectedRecordForDetails} 
        setSelectedRecord={setSelectedRecordForDetails} 
        handleRefund={handleRefundStub}
        onReceive={initReceivePO}
      />
    </div>
  );
}
