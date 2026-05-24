import { X } from 'lucide-react';
import OpenShiftModal from '../shift/OpenShiftModalDesktop';
import type { DashboardModalsProps } from './types';

export default function DashboardModalsDesktop({
  isOpenShiftModalOpen,
  setIsOpenShiftModalOpen,
  configuredTills,
  availableTills,
  selectedTillId,
  setSelectedTillId,
  openingCashAmount,
  setOpeningCashAmount,
  isOpeningShift,
  confirmOpenShift,
  isCashPickModalOpen,
  isPickingCash,
  setIsCashPickModalOpen,
  cashPickAmount,
  setCashPickAmount,
  cashPickValue,
  canOperateOwnShift,
  handleCreateCashPick,
  shiftClosePreview,
  shiftClosingCash,
  setShiftClosingCash,
  isClosingShift,
  setShiftClosePreview,
  confirmCloseShift,
}: DashboardModalsProps) {
  return (
    <>
      <OpenShiftModal
        open={isOpenShiftModalOpen}
        onClose={() => setIsOpenShiftModalOpen(false)}
        configuredTills={configuredTills}
        availableTills={availableTills}
        selectedTillId={selectedTillId}
        setSelectedTillId={setSelectedTillId}
        openingCashAmount={openingCashAmount}
        setOpeningCashAmount={setOpeningCashAmount}
        isOpeningShift={isOpeningShift}
        confirmOpenShift={confirmOpenShift}
      />

      {isCashPickModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => !isPickingCash && setIsCashPickModalOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-t-lg border border-slate-300 bg-white p-5 shadow-2xl sm:rounded-lg">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-950">Pick cash</h3>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">Record money removed from the drawer.</p>
              </div>
              <button
                type="button"
                onClick={() => !isPickingCash && setIsCashPickModalOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600"
                aria-label="Close cash pick"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mb-4 rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Protected drawer check</p>
              <p className="mt-2 text-sm font-semibold text-slate-700">
                {canOperateOwnShift
                  ? 'Enter the amount to remove. The system will check the drawer limit after you save.'
                  : 'Open your own shift before picking cash.'}
              </p>
            </div>

            {!canOperateOwnShift && (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                Open your own shift before picking cash.
              </p>
            )}

            <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-500">Amount to pick</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={cashPickAmount}
                onChange={event => setCashPickAmount(event.target.value)}
                placeholder="0"
                className="min-w-0 flex-1 rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:border-blue-500"
                disabled={!canOperateOwnShift}
                autoFocus
              />
            </div>

            <div className="mt-5 grid grid-cols-[0.8fr_1.2fr] gap-2">
              <button
                type="button"
                onClick={() => setIsCashPickModalOpen(false)}
                disabled={isPickingCash}
                className="h-12 rounded-lg border-2 border-slate-300 bg-white text-xs font-black text-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCashPick}
                disabled={!canOperateOwnShift || isPickingCash || cashPickValue <= 0}
                className="h-12 rounded-lg border-2 border-emerald-700 bg-emerald-600 text-xs font-black text-white disabled:border-emerald-200 disabled:bg-emerald-100 disabled:text-emerald-600"
              >
                {isPickingCash ? 'Saving' : 'Save cash pick'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shiftClosePreview && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => !isClosingShift && setShiftClosePreview(null)} />
          <div className="relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-lg border border-slate-300 bg-white shadow-2xl sm:rounded-lg">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-950">Close shift</h3>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">
                  {new Date(shiftClosePreview.since).toLocaleString()} - {new Date(shiftClosePreview.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !isClosingShift && setShiftClosePreview(null)}
                disabled={isClosingShift}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600 disabled:opacity-50"
                aria-label="Close shift review"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mb-4 rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Protected close</p>
                <p className="mt-2 text-sm font-semibold text-slate-700">
                  Count the cash physically and enter the amount below. Sales totals, expected cash, and variance will be calculated only after the shift is closed.
                </p>
              </div>

              <div className="rounded-lg border-2 border-slate-300 bg-white p-4">
                <label className="block text-[11px] font-black uppercase tracking-widest text-slate-500">Counted closing cash</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={shiftClosingCash}
                  onChange={event => setShiftClosingCash(event.target.value)}
                  className="mt-2 w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-xl font-black tabular-nums text-slate-950 outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-[0.8fr_1.2fr] gap-2 border-t border-slate-200 p-4">
              <button
                type="button"
                onClick={() => setShiftClosePreview(null)}
                disabled={isClosingShift}
                className="h-12 rounded-lg border-2 border-slate-300 bg-white text-xs font-black text-slate-600 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmCloseShift}
                disabled={isClosingShift}
                className="h-12 rounded-lg border-2 border-blue-700 bg-blue-600 text-xs font-black text-white disabled:border-blue-200 disabled:bg-blue-100 disabled:text-blue-600"
              >
                {isClosingShift ? 'Closing' : 'Close shift'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
