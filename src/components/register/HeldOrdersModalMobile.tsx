import { Archive, Trash2, X } from 'lucide-react';
import type { HeldOrder } from '../../store';
import { calculateCartTotals } from '../../utils/productPricing';

export default function HeldOrdersModalMobile({
  open,
  orders,
  onClose,
  onResume,
  onDelete,
}: {
  open: boolean;
  orders: HeldOrder[];
  onClose: () => void;
  onResume: (orderId: string) => void;
  onDelete: (orderId: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="mobile-vv-overlay fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="mobile-vv-panel flex max-h-[82dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-slate-300 bg-slate-50 shadow-2xl sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-slate-300 px-5 py-5">
          <div className="flex items-center gap-3">
            <Archive size={24} className="text-slate-950" />
            <h3 className="text-lg font-medium text-slate-950">Held Orders</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-md text-slate-950 hover:bg-slate-200"
            aria-label="Close held orders"
          >
            <X size={24} />
          </button>
        </div>
        <div className="modal-scroll-padding min-h-0 flex-1 overflow-y-auto p-5">
          {orders.length === 0 ? (
            <div className="rounded-md border-2 border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
              No held orders
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(order => {
                const heldTotal = calculateCartTotals(order.items).total || order.total;
                return (
                  <div key={order.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-md border-2 border-slate-300 bg-white px-4 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-medium text-slate-950">{order.name}</p>
                      <p className="mt-1 text-sm text-slate-600">Ksh {heldTotal.toLocaleString()}.00</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onResume(order.id)}
                      className="h-10 rounded-md bg-slate-950 px-4 text-sm font-bold text-white"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(order.id)}
                      className="flex h-10 w-10 items-center justify-center rounded-md text-rose-600 hover:bg-rose-50"
                      aria-label={`Delete ${order.name}`}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
