import { Store, X } from 'lucide-react';
import MobileModal from '../shared/MobileModal';

type TillOption = {
  id: string;
  name: string;
  isActive?: boolean;
};

type OpenShiftModalProps = {
  open: boolean;
  title?: string;
  description?: string;
  notice?: string;
  allowClose?: boolean;
  configuredTills: TillOption[];
  availableTills: TillOption[];
  selectedTillId: string;
  setSelectedTillId: (id: string) => void;
  openingCashAmount: string;
  setOpeningCashAmount: (value: string) => void;
  isOpeningShift: boolean;
  confirmOpenShift: () => void;
  onClose: () => void;
};

export default function OpenShiftModalMobile({
  open,
  title = 'Open shift',
  description = 'Choose the till and opening float for this session.',
  notice,
  allowClose = true,
  configuredTills,
  availableTills,
  selectedTillId,
  setSelectedTillId,
  openingCashAmount,
  setOpeningCashAmount,
  isOpeningShift,
  confirmOpenShift,
  onClose,
}: OpenShiftModalProps) {
  if (!open) return null;

  const canOpen = availableTills.length > 0 && !isOpeningShift;

  return (
    <MobileModal
      onClose={onClose}
      closeOnBackdrop={allowClose && !isOpeningShift}
      size="md"
      panelClassName="rounded-t-lg border border-slate-300"
      bodyClassName="space-y-0 p-5"
      header={(
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-slate-950">{title}</h3>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{description}</p>
          </div>
          {allowClose && (
            <button
              type="button"
              onClick={() => !isOpeningShift && onClose()}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600"
              aria-label="Close open shift"
            >
              <X size={18} />
            </button>
          )}
        </div>
      )}
      footer={(
        <div className={allowClose ? 'grid grid-cols-[0.8fr_1.2fr] gap-2 p-4' : 'p-4'}>
          {allowClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={isOpeningShift}
              className="h-12 rounded-lg border-2 border-slate-300 bg-white text-xs font-black text-slate-600 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={confirmOpenShift}
            disabled={!canOpen}
            className="h-12 w-full rounded-lg border-2 border-blue-700 bg-blue-600 text-xs font-black text-white disabled:border-blue-200 disabled:bg-blue-100 disabled:text-blue-600"
          >
            {isOpeningShift ? 'Opening' : 'Open shift'}
          </button>
        </div>
      )}
    >

        {notice && (
          <div className="mb-4 rounded-lg border-2 border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            {notice}
          </div>
        )}

        <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-500">Till</label>
        <div className="grid gap-2">
          {configuredTills.length === 0 ? (
            <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-500">
              Set up at least one till in Settings before opening a shift.
            </div>
          ) : configuredTills.map(till => {
            const busy = !availableTills.some(item => item.id === till.id);
            const active = selectedTillId === till.id;
            return (
              <button
                key={till.id}
                type="button"
                onClick={() => !busy && setSelectedTillId(till.id)}
                disabled={busy}
                className={`flex items-center justify-between rounded-lg border-2 p-3 text-left transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-50 text-blue-900'
                    : busy
                      ? 'border-slate-200 bg-slate-100 text-slate-400'
                      : 'border-slate-300 bg-white text-slate-800 hover:border-blue-300'
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
                    <Store size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-black">{till.name}</span>
                    <span className="block text-[11px] font-semibold opacity-70">{busy ? 'Already open' : 'Available'}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <label className="mb-2 mt-4 block text-[11px] font-black uppercase tracking-widest text-slate-500">Opening cash</label>
        <input
          type="number"
          min="0"
          step="any"
          value={openingCashAmount}
          onChange={event => setOpeningCashAmount(event.target.value)}
          placeholder="0"
          className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:border-blue-500"
          autoFocus
        />
    </MobileModal>
  );
}
