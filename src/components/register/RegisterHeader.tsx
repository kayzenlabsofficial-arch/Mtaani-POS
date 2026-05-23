import { MaterialIcon } from './RegisterShared';

export default function RegisterHeader({
  searchQuery,
  setSearchQuery,
  selectedProductCount,
  saleItemCount,
  saleTotal,
  scannerProducts,
  handleBarcodeScan,
  isScannerOpen,
  onToggleScanner,
}: {
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  selectedProductCount: number;
  saleItemCount: number;
  saleTotal: number;
  scannerProducts: any[];
  handleBarcodeScan: (barcode: string) => void;
  isScannerOpen: boolean;
  onToggleScanner: () => void;
}) {
  return (
    <div className="z-30 flex-shrink-0 border-b border-slate-200 bg-white px-3 py-3 sm:px-4 md:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
          <div className="flex items-center gap-2">
            <div className="group relative flex-1 md:w-64">
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
            <button
              onClick={onToggleScanner}
              className={`h-11 w-11 flex-shrink-0 rounded-lg border-2 transition-all lg:hidden ${isScannerOpen ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'}`}
              title="Barcode Scanner"
            >
              <MaterialIcon name="barcode_scanner" style={{ fontSize: '20px' }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
