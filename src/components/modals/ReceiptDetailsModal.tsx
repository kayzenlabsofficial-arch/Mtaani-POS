import React, { useState } from 'react';
import { ReceiptText, RotateCcw, Minus, Plus, Printer, Share2, Loader2 } from 'lucide-react';
import { type Transaction } from '../../db';
import { shareDocument } from '../../utils/shareUtils';

interface ReceiptDetailsModalProps {
  selectedReceipt: Transaction | null;
  setSelectedReceipt: (receipt: Transaction | null) => void;
  handleRefund: (t: Transaction, itemsToReturn?: { productId: string, quantity: number }[]) => Promise<void>;
}

export default function ReceiptDetailsModal({ selectedReceipt, setSelectedReceipt, handleRefund }: ReceiptDetailsModalProps) {
  const [returnQuantities, setReturnQuantities] = useState<{ [productId: string]: number }>({});
  const [isReturnMode, setIsReturnMode] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  if (!selectedReceipt) return null;

  const updateReturnQty = (productId: string, delta: number, max: number) => {
     const current = returnQuantities[productId] || 0;
     const next = Math.max(0, Math.min(max, current + delta));
     setReturnQuantities({ ...returnQuantities, [productId]: next });
  }

  const onConfirmRefund = () => {
      const itemsToReturn = Object.entries(returnQuantities)
          .filter(([_, qty]) => (qty as number) > 0)
          .map(([productId, quantity]) => ({ productId, quantity: quantity as number }));
      
      if (itemsToReturn.length === 0 && isReturnMode) return;
      
      handleRefund(selectedReceipt, isReturnMode ? itemsToReturn : undefined);
      setIsReturnMode(false);
      setReturnQuantities({});
  };

  const handleShare = async () => {
    if (!selectedReceipt) return;
    setIsSharing(true);
    try {
      await shareDocument('printable-content', `Receipt-${selectedReceipt.id.split('-')[0].toUpperCase()}`, true);
    } catch (err) {
      console.error('Sharing failed', err);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedReceipt(null)} />
      <div className="bg-white w-full max-w-sm rounded-xl shadow-elevated relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
         <div id="printable-content" className="print-receipt-80mm">
           <div className="p-6 bg-white sm:bg-slate-50 border-b border-slate-100 flex flex-col items-center">
               <ReceiptText size={32} className="text-slate-400 mb-2 no-print" />
               <h2 className="text-lg font-black text-slate-900  tracking-tighter">Mtaani POS Receipt</h2>
               <p className="text-[10px] font-bold text-slate-500 ">Transaction ID: {selectedReceipt.id.split('-')[0].toUpperCase()}</p>
               <p className="text-[10px] font-bold text-slate-400 mt-0.5">{new Date(selectedReceipt.timestamp).toLocaleString()}</p>
               <div className={`mt-3 text-[10px] font-black px-2 py-0.5 rounded border  no-print ${selectedReceipt.status === 'PAID' ? 'bg-green-100 text-green-700 border-green-200' : selectedReceipt.status === 'QUOTE' ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-orange-100 text-orange-700 border-orange-200'}`}>
                  {selectedReceipt.status}
               </div>
           </div>
           
           <div className="p-6 space-y-4 max-h-[40vh] overflow-y-auto no-scrollbar print:max-h-none print:overflow-visible">
              <div className="flex justify-between items-center text-[10px] font-black text-slate-400   border-b border-slate-100 pb-2">
                 <span>Item / Qty</span>
                 <span>Total</span>
              </div>
              {selectedReceipt.items.map((item, idx) => {
                 const alreadyReturned = item.returnedQuantity || 0;
                 const availableToReturn = item.quantity - alreadyReturned;
                 
                 return (
                  <div key={idx} className="flex justify-between items-start text-sm">
                     <div className="flex-1 pr-4">
                        <p className="font-bold text-slate-900 leading-tight">{item.name}</p>
                        <p className="text-[10px] text-slate-500 font-bold mt-0.5">
                          {item.quantity} x Ksh {item.snapshotPrice.toLocaleString()} {alreadyReturned > 0 ? `(-${alreadyReturned} returned)` : ''}
                        </p>
                     </div>
                     {isReturnMode ? (
                        <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1 border border-slate-200 no-print">
                           <button onClick={() => updateReturnQty(item.productId, -1, availableToReturn)} className="p-1 hover:bg-slate-200 rounded"><Minus size={12} /></button>
                           <span className="w-4 text-center font-bold text-xs">{returnQuantities[item.productId] || 0}</span>
                           <button onClick={() => updateReturnQty(item.productId, 1, availableToReturn)} className="p-1 hover:bg-slate-200 rounded"><Plus size={12} /></button>
                        </div>
                     ) : (
                        <span className="font-black text-slate-900 tabular-nums shrink-0">Ksh {(item.quantity * item.snapshotPrice).toLocaleString()}</span>
                     )}
                  </div>
                 );
              })}
              
              {!isReturnMode && (
                <div className="border-t-2 border-dashed border-slate-200 mt-4 pt-4 space-y-2">
                   <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-500  ">Subtotal</span>
                      <span className="text-sm font-black text-slate-900">Ksh {selectedReceipt.total.toLocaleString()}</span>
                   </div>
                   {selectedReceipt.amountTendered !== undefined && selectedReceipt.paymentMethod === 'CASH' && (
                     <>
                        <div className="flex justify-between items-center">
                           <span className="text-xs font-bold text-slate-500  ">Cash Tendered</span>
                           <span className="text-sm font-black text-slate-900">Ksh {selectedReceipt.amountTendered.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center bg-slate-900 text-white px-3 py-2 rounded-xl mt-2 print:bg-white print:text-black print:border print:border-black">
                           <span className="text-xs font-black  ">Change Due</span>
                           <span className="text-lg font-black tabular-nums">Ksh {(selectedReceipt.amountTendered - selectedReceipt.total).toLocaleString()}</span>
                        </div>
                     </>
                   )}
                   <div className="flex justify-between items-center pt-2">
                      <span className="text-[10px] font-black text-slate-400  ">Payment Method</span>
                      <span className="text-[10px] font-black text-slate-900 ">{selectedReceipt.paymentMethod}</span>
                   </div>
                   <div className="text-center pt-6 no-print-only">
                      <p className="text-[10px] font-bold text-slate-400 ">Thank you for your business!</p>
                   </div>
                </div>
              )}
           </div>
         </div>

         <div className="p-4 grid grid-cols-2 gap-2 bg-slate-50 border-t border-slate-100 no-print">
            <div className="col-span-2 grid grid-cols-2 gap-2 mb-2">
               <button 
                  onClick={handleShare} 
                  disabled={isSharing}
                  className="py-3 bg-slate-900 text-white font-black rounded-xl text-xs   flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
               >
                  {isSharing ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Share2 size={16} />
                  )}
                  {isSharing ? 'Generating...' : 'Share / PDF'}
               </button>
               <button 
                  onClick={() => window.print()}
                  className="py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs   flex items-center justify-center gap-2 transition-colors active:bg-slate-100"
               >
                  <Printer size={16} /> Print
               </button>
               <button onClick={() => { setIsReturnMode(false); setSelectedReceipt(null); }} className="py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs   transition-colors active:bg-slate-100 col-span-2">
                  {isReturnMode ? 'Cancel' : 'Close'}
               </button>
            </div>
            
            {isReturnMode ? (
               <button 
                onClick={onConfirmRefund}
                disabled={Object.values(returnQuantities).every(q => q === 0)}
                className="col-span-2 py-3 bg-red-600 text-white font-black rounded-xl text-xs   disabled:opacity-50 transition-colors active:scale-95 flex items-center justify-center gap-2"
               >
                 <RotateCcw size={16} /> Confirm Return
               </button>
            ) : (
               <button 
                onClick={() => setIsReturnMode(true)} 
                disabled={selectedReceipt.status !== 'PAID' && selectedReceipt.status !== 'PARTIAL_REFUND'}
                className="col-span-2 py-3 bg-orange-600 text-white font-black rounded-xl text-xs   disabled:opacity-50 transition-colors active:scale-95 flex items-center justify-center gap-2"
               >
                 <RotateCcw size={16} /> Process Returns
               </button>
            )}
         </div>
      </div>
    </div>
  );
}

