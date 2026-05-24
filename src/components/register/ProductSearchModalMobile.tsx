import { X } from 'lucide-react';
import { MaterialIcon, ProductTile } from './RegisterSharedMobile';

export default function ProductSearchModalMobile({
  open,
  query,
  products,
  recentlyAdded,
  onAdd,
  onClose,
}: {
  open: boolean;
  query: string;
  products: any[];
  recentlyAdded: Set<string>;
  onAdd: (product: any) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="mobile-vv-overlay fixed inset-0 z-[95] flex items-start justify-center bg-slate-950/55 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="mobile-vv-panel flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl sm:max-h-[86dvh]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-950">Choose product</p>
            <p className="mt-0.5 text-[11px] font-bold text-slate-500">
              {products.length.toLocaleString()} match{products.length === 1 ? '' : 'es'} for "{query.trim()}"
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
            aria-label="Close product search"
          >
            <X size={20} />
          </button>
        </div>

        <div className="modal-scroll-padding min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          {products.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-16 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg border border-slate-200 bg-white">
                <MaterialIcon name="inventory" className="text-slate-300" style={{ fontSize: '32px' }} />
              </div>
              <p className="text-sm font-bold text-slate-500">No product found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {products.map(product => (
                <ProductTile
                  key={product.id}
                  product={product}
                  onAdd={onAdd}
                  recentlyAdded={recentlyAdded.has(product.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
