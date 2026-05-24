import { MaterialIcon } from './RegisterSharedDesktop';
import type { RegisterHeaderProps } from './RegisterHeaderTypes';

export default function RegisterHeaderDesktop({
  searchQuery,
  setSearchQuery,
  selectedProductCount,
  saleItemCount,
  saleTotal,
  scannerProducts,
  handleBarcodeScan,
}: RegisterHeaderProps) {
  return (
    <div className="z-30 flex-shrink-0 border-b border-slate-200 bg-white px-8 py-3">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-950">Register</h2>
            <p className="text-xs font-semibold text-slate-500">
              {selectedProductCount.toLocaleString()} product{selectedProductCount === 1 ? '' : 's'}
              {saleItemCount > 0 && (
                <span className="text-slate-700">
                  {' '} / {saleItemCount.toLocaleString()} item{saleItemCount === 1 ? '' : 's'} / Ksh {saleTotal.toLocaleString()}
                </span>
              )}
            </p>
          </div>
          <div className="group relative w-64">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-blue-600">
              <MaterialIcon name="search" style={{ fontSize: '18px' }} />
            </div>
            <input
              type="text"
              placeholder="Search product or barcode"
              className="h-11 w-full rounded-lg border-2 border-slate-300 bg-white pl-10 pr-9 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter') return;
                const code = searchQuery.trim();
                const product = scannerProducts.find(item => String(item.barcode || '').trim() === code);
                if (product) {
                  event.preventDefault();
                  handleBarcodeScan(code);
                }
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label="Clear search"
              >
                <MaterialIcon name="close" style={{ fontSize: '16px' }} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
