import React from 'react';
import { Banknote, Clock, Lock, Store, UserRound } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { calculateCashDrawer, getTodayStartMs } from '../../utils/cashDrawer';
import { getBusinessSettings } from '../../utils/settings';
import { parseSalesTillRows, parseSalesTills, tillNameForShift } from '../../utils/tills';

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

function inShift(record: any, since: number, shiftId?: string) {
  if (shiftId && record?.shiftId) return record.shiftId === shiftId;
  return Number(record?.timestamp || record?.issueDate || 0) >= since;
}

function splitDetails(record: any) {
  const raw = record?.splitPayments || record?.splitData?.splitPayments;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw;
}

function paymentAmount(record: any, method: 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT') {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === method) return Number(record?.total || 0);
  if (paymentMethod !== 'SPLIT') return 0;
  const split = splitDetails(record);
  if (method === 'CASH') return Number(split?.cashAmount || 0);
  return String(split?.secondaryMethod || '').toUpperCase() === method ? Number(split?.secondaryAmount || 0) : 0;
}

function TillCard({ till, shift, rows }: { key?: React.Key; till: any; shift: any; rows: any }) {
  const isOpen = !!shift;
  return (
    <section className={`rounded-lg border-2 bg-white p-5 shadow-sm ${isOpen ? 'border-blue-200' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${isOpen ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
            <Store size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-black text-slate-950">{till.name}</h3>
            <p className={`mt-0.5 text-[11px] font-black uppercase tracking-widest ${isOpen ? 'text-emerald-700' : 'text-slate-400'}`}>
              {isOpen ? 'Open' : 'Closed'}
            </p>
          </div>
        </div>
        <span className={`rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${isOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
          {isOpen ? 'Live' : 'Ready'}
        </span>
      </div>

      {isOpen ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <UserRound size={15} className="mb-2 text-slate-500" />
              <p className="truncate">{shift.cashierName || 'Staff'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <Clock size={15} className="mb-2 text-slate-500" />
              <p>{new Date(Number(shift.startTime || Date.now())).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Expected drawer</p>
            <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{money(rows.expectedCash)}</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              ['Opening', rows.openingCash],
              ['Cash sales', rows.cashSales],
              ['Payments', rows.customerCashPayments],
              ['Expenses', rows.tillExpenses],
              ['Supplier paid', rows.supplierTillPayments],
              ['Picked', rows.cashPicks],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-black tabular-nums text-slate-900">{money(value)}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-5 flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-600">
          <Lock size={17} />
          No open session on this till.
        </div>
      )}
    </section>
  );
}

export default function TillsTabDesktop() {
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const currentUser = useStore(state => state.currentUser);
  const canSeeBreakdown = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER' || currentUser?.role === 'ROOT';
  const settings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const salesTillRows = useLiveQuery(
    () => activeBusinessId
      ? db.salesTills.where('businessId').equals(activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const tills = React.useMemo(() => {
    const tableTills = parseSalesTillRows(salesTillRows);
    return tableTills.length ? tableTills : parseSalesTills(settings);
  }, [settings, salesTillRows]);
  const transactions = useLiveQuery(() => activeBusinessId && activeShopId ? db.transactions.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const expenses = useLiveQuery(() => activeBusinessId && activeShopId ? db.expenses.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const cashPicks = useLiveQuery(() => activeBusinessId && activeShopId ? db.cashPicks.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const refunds = useLiveQuery(() => activeBusinessId && activeShopId ? db.refunds.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const supplierPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.supplierPayments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const customerPayments = useLiveQuery(() => activeBusinessId && activeShopId ? db.customerPayments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const shifts = useLiveQuery(() => activeBusinessId && activeShopId ? db.shifts.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const reports = useLiveQuery(() => activeBusinessId && activeShopId ? db.endOfDayReports.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);

  const openByTill = new Map((shifts || [])
    .filter(shift => String(shift.status || '').toUpperCase() === 'OPEN')
    .map(shift => [String(shift.tillId || ''), shift]));

  const tillRows = tills.map(till => {
    const shift = openByTill.get(till.id);
    if (!shift) return { till, shift: null, rows: null };
    const since = Number(shift.startTime || getTodayStartMs());
    const drawer = calculateCashDrawer({
      transactions: transactions || [],
      expenses: expenses || [],
      cashPicks: cashPicks || [],
      refunds: refunds || [],
      supplierPayments: supplierPayments || [],
      customerPayments: customerPayments || [],
      openingCash: Number(shift.openingCash || 0),
      since,
      shiftId: shift.id,
    });
    const txs = (transactions || []).filter(tx => inShift(tx, since, shift.id) && tx.status !== 'VOIDED' && tx.status !== 'QUOTE');
    return {
      till,
      shift,
      rows: {
        ...drawer,
        expectedCash: Math.max(0, drawer.actualCashDrawer),
        totalSales: txs.reduce((sum, tx) => sum + Number(tx.total || 0), 0),
        mpesaSales: txs.reduce((sum, tx) => sum + paymentAmount(tx, 'MPESA'), 0),
      },
    };
  });

  const openCount = tillRows.filter(row => row.shift).length;
  const totalExpectedCash = tillRows.reduce((sum, row) => sum + Number(row.rows?.expectedCash || 0), 0);
  const todayStart = getTodayStartMs();
  const recentReports = (reports || [])
    .filter(report => Number(report.timestamp || 0) >= todayStart)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, 6);

  return (
    <div className="animate-in fade-in pb-24">
      <div className="mb-5 rounded-lg border-2 border-slate-200 bg-white p-5">
        <p className="text-[11px] font-black uppercase tracking-widest text-blue-700">Till sessions</p>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Tills</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">Open tills, cashiers, and live drawer position.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-80">
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Open tills</p>
              <p className="mt-1 text-xl font-black text-slate-950">{openCount}/{tills.length}</p>
            </div>
            <div className="rounded-lg border border-slate-300 bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Expected cash</p>
              <p className="mt-1 text-xl font-black tabular-nums text-slate-950">{canSeeBreakdown ? money(totalExpectedCash) : 'Locked'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {tillRows.map(row => (
          <TillCard key={row.till.id} till={row.till} shift={row.shift} rows={row.rows || {}} />
        ))}
      </div>

      {canSeeBreakdown && (
        <section className="mt-5 rounded-lg border-2 border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Banknote size={18} className="text-blue-700" />
            <h3 className="text-sm font-black text-slate-950">Closed today</h3>
          </div>
          {recentReports.length ? (
            <div className="grid gap-2">
              {recentReports.map((report, index) => (
                <div key={report.id || index} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700 sm:grid-cols-[1.2fr_1fr_1fr_1fr] sm:items-center">
                  <span>{report.tillName || tillNameForShift(report, tills)}</span>
                  <span>{report.cashierName || 'Staff'}</span>
                  <span>{new Date(Number(report.timestamp || Date.now())).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className={Number(report.difference || 0) === 0 ? 'text-emerald-700' : 'text-rose-700'}>
                    Variance {money(report.difference)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-500">No shifts have been closed today.</p>
          )}
        </section>
      )}
    </div>
  );
}
