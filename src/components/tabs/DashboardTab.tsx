import React, { useState } from 'react';
import { LayoutDashboard, TrendingUp, Smartphone, DollarSign, Banknote, ArrowUpRight, FileMinus, RotateCcw, CalendarCheck, Package, Clock, Activity, Search, AlertCircle, Lock, Check, CheckCircle2, ShieldAlert, ChevronRight } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

interface DashboardTabProps {
  setActiveTab: (tab: any) => void;
  openExpenseModal: () => void;
}

export default function DashboardTab({ setActiveTab, openExpenseModal }: DashboardTabProps) {
  const [trendView, setTrendView] = useState<'DAY' | 'WEEK'>('DAY');
  const [isPickCashOpen, setIsPickCashOpen] = useState(false);
  const [pickAmount, setPickAmount] = useState("");
  const [isCloseDayOpen, setIsCloseDayOpen] = useState(false);
  const [reportedCash, setReportedCash] = useState("");
  const [isDailySummaryOpen, setIsDailySummaryOpen] = useState(false);
  const isAdmin = useStore(state => state.isAdmin);
  const isManager = useStore(state => state.isManager);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const setActiveShift = useStore(state => state.setActiveShift);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const { success, error } = useToast();

  // Live Queries - Filtered by Active Branch
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allProducts = useLiveQuery(() => db.products.toArray(), [], []) ;
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allCashPicks = useLiveQuery(() => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;

  // Metrics Logic - Filtered by Active Shift
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const shiftStartTime = activeShift?.startTime || todayStart.getTime();

  const sortedTransactions = [...allTransactions].sort((a, b) => b.timestamp - a.timestamp);
  const shiftTransactions = sortedTransactions.filter(t => t.timestamp >= shiftStartTime && (t.status === 'PAID' || t.status === 'PARTIAL_REFUND'));
  
  const getNetSales = (t: Transaction) => {
      if (t.status === 'PARTIAL_REFUND') {
          const netSubtotal = t.items.reduce((sum, i) => sum + (i.snapshotPrice * (i.quantity - (i.returnedQuantity || 0))), 0);
          const netTax = netSubtotal * 0.16;
          return { subtotal: netSubtotal, tax: netTax, total: netSubtotal + netTax };
      }
      return { subtotal: Number(t.subtotal) || 0, tax: Number(t.tax) || 0, total: Number(t.total) || 0 };
  };

  const todaySales = shiftTransactions.reduce((sum, t) => sum + getNetSales(t).total, 0);
  const totalTax = shiftTransactions.reduce((sum, t) => sum + getNetSales(t).tax, 0);
  const totalGross = shiftTransactions.reduce((sum, t) => sum + getNetSales(t).subtotal, 0);
  
  const cashTotal = shiftTransactions.filter(t => t.paymentMethod === 'CASH').reduce((sum, t) => sum + getNetSales(t).total, 0);
  const mpesaTotal = shiftTransactions.filter(t => t.paymentMethod === 'MPESA').reduce((sum, t) => sum + getNetSales(t).total, 0);
  const shiftExpenses = allExpenses.filter(e => e.timestamp >= shiftStartTime).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const shiftCashPicks = allCashPicks.filter(c => c.timestamp >= shiftStartTime);
  const totalPickedAmount = shiftCashPicks.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const lowStock = (allProducts || []).filter(p => p.stockQuantity <= 10);
  
  // EXPECTED CASH = (Opening Float + Cash Sales) - (Expenses + Confirmed Picks)
  const openingFloat = activeShift?.openingFloat || 0;
  const expectedCashDrawer = (openingFloat + cashTotal) - (shiftExpenses + totalPickedAmount);

  const recentActivity = sortedTransactions.filter(t => t.timestamp >= todayStart.getTime()).slice(0, 10);
  const pendingQuotes = sortedTransactions.filter(t => t.status === 'QUOTE').length;

  // Payment Breakdown for Donut Chart
  const paymentData = [
    { name: 'CASH', value: cashTotal, color: '#10B981' },
    { name: 'M-PESA', value: mpesaTotal, color: '#3B82F6' }
  ];

  // Top Selling Products Calculation
  const productPerformance: Record<string, { name: string, qty: number, revenue: number }> = {};
  shiftTransactions.forEach(t => {
      t.items.forEach(item => {
          if (!productPerformance[item.productId]) {
              productPerformance[item.productId] = { name: item.name, qty: 0, revenue: 0 };
          }
          productPerformance[item.productId].qty += item.quantity;
          productPerformance[item.productId].revenue += (item.snapshotPrice * item.quantity);
      });
  });

  const topSellingProducts = Object.values(productPerformance)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

  // Daily Master Summary Query (For Today) - Filtered by Branch
  const todaysReports = useLiveQuery(
    () => activeBranchId ? db.endOfDayReports.where('branchId').equals(activeBranchId).and(r => r.timestamp > todayStart.getTime()).toArray() : Promise.resolve([]),
    [activeBranchId],
    []
  );
  
  const existingDailySummary = useLiveQuery(
    () => activeBranchId ? db.dailySummaries.where('branchId').equals(activeBranchId).and(s => s.date === todayStart.getTime()).first() : Promise.resolve(undefined),
    [activeBranchId]
  );

  const pendingBankingCount = shiftCashPicks.filter(p => p.status === 'PENDING').length;
  const isCloseDayBlocked = pendingBankingCount > 0;
  const unbankedCash = shiftCashPicks.filter(p => p.status === 'PENDING').reduce((sum, p) => sum + p.amount, 0);

  // Chart Data logic
  let chartData: any[] = [];
  if (trendView === 'DAY') {
    chartData = Array.from({ length: 15 }).map((_, i) => ({ label: `${i + 6}:00`, sales: 0 }));
    shiftTransactions.forEach(t => {
        const h = new Date(t.timestamp).getHours();
        if (h >= 6 && h <= 20) chartData[h - 6].sales += getNetSales(t).total;
    });
  } else {
    chartData = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return { dateObj: d, label: d.toLocaleDateString('en-US', { weekday: 'short' }), sales: 0 };
    });
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0,0,0,0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sortedTransactions.forEach(t => {
       if (t.timestamp >= sevenDaysAgo.getTime() && (t.status === 'PAID' || t.status === 'PARTIAL_REFUND')) {
          const tDate = new Date(t.timestamp).toDateString();
          const dayBin = chartData.find(d => d.dateObj.toDateString() === tDate);
          if (dayBin) dayBin.sales += getNetSales(t).total;
       }
    });
  }

  const handlePickCash = async () => {
    const amount = Number(pickAmount);
    if (amount <= 0 || amount > expectedCashDrawer || !currentUser || !activeBranchId) {
        error("Invalid pickup request.");
        return;
    }
    await db.cashPicks.add({ id: crypto.randomUUID(), amount, timestamp: Date.now(), status: 'PENDING', userName: currentUser.name, branchId: activeBranchId, businessId: activeBusinessId! });
    setPickAmount("");
    setIsPickCashOpen(false);
    success("Cash pickup awaiting admin approval.");
  };

  const handleCloseDay = async () => {
    if (!activeShift) return;
    if (!activeBranchId || !activeBusinessId) {
      error("Missing business/branch context. Please try logging in again.");
      return;
    }
    
    if (isCloseDayBlocked) {
      error("Cannot close shift. You have pending cash picks that must be approved by an Admin.");
      return;
    }

    if (!reportedCash) {
      error("Please enter the actual counted cash in the drawer.");
      return;
    }
    
    const reported = Number(reportedCash);
    
    try {
      // Create Zed Report
      await db.endOfDayReports.add({
        id: crypto.randomUUID(),
        shiftId: activeShift.id,
        timestamp: Date.now(),
        openingFloat: activeShift.openingFloat,
        totalSales: todaySales,
        grossSales: totalGross,
        taxTotal: totalTax,
        cashSales: cashTotal,
        mpesaSales: mpesaTotal,
        totalExpenses: shiftExpenses,
        totalPicks: totalPickedAmount,
        expectedCash: expectedCashDrawer,
        reportedCash: reported,
        difference: reported - expectedCashDrawer,
        cashierName: activeShift.cashierName,
        branchId: activeBranchId,
        businessId: activeBusinessId!
      });

      // Close Shift in DB
      await db.shifts.update(activeShift.id, { 
         status: 'CLOSED', 
         endTime: Date.now() 
      });

      // Reset Store
      setActiveShift(null);
      setReportedCash("");
      setIsCloseDayOpen(false);
      success("Shift closed successfully.");
    } catch (err: any) {
      console.error("Shift closure failed:", err);
      error("Failed to submit shift: " + (err.message || "Unknown error"));
    }
  };

  const handleFinalizeDay = async () => {
    if (!todaysReports || todaysReports.length === 0 || !activeBranchId) return;
    
    try {
      await db.dailySummaries.add({
        id: crypto.randomUUID(),
        date: todayStart.getTime(),
        shiftIds: (todaysReports || []).map(r => r.shiftId || ''),
        totalSales: (todaysReports || []).reduce((s: number, r) => s + (Number(r.totalSales) || 0), 0),
        grossSales: (todaysReports || []).reduce((s: number, r) => s + (Number(r.grossSales) || 0), 0),
        taxTotal: (todaysReports || []).reduce((s: number, r) => s + (Number(r.taxTotal) || 0), 0),
        totalExpenses: (todaysReports || []).reduce((s: number, r) => s + (Number(r.totalExpenses) || 0), 0),
        totalPicks: (todaysReports || []).reduce((s: number, r) => s + (Number(r.totalPicks) || 0), 0),
        totalVariance: (todaysReports || []).reduce((s: number, r) => s + (Number(r.difference) || 0), 0),
        timestamp: Date.now(),
        branchId: activeBranchId,
        businessId: activeBusinessId!
      });
      
      setIsDailySummaryOpen(false);
      success("Business Day Finalized successfully.");
    } catch (err: any) {
      console.error("Day finalization failed:", err);
      error("Failed to finalize day: " + (err.message || "Unknown error"));
    }
  };

  const pendingAdjustments = useLiveQuery(() => activeBranchId ? db.stockAdjustmentRequests.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingPicks = useLiveQuery(() => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingRefunds = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).and(x => x.status === 'PENDING_REFUND').toArray() : Promise.resolve([]), [activeBranchId], []);
  const pendingPOs = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).and(x => x.approvalStatus === 'PENDING').toArray() : Promise.resolve([]), [activeBranchId], []);

  const totalPending = (pendingAdjustments?.length || 0) + (pendingPicks?.length || 0) + (pendingExpenses?.length || 0) + (pendingRefunds?.length || 0) + (pendingPOs?.length || 0);

  return (
    <div className="p-5 pb-24 animate-in fade-in max-w-5xl mx-auto w-full">
      {/* Admin/Manager Approvals Alert */}
      {(isAdmin || isManager) && totalPending > 0 && (
          <div 
             onClick={() => setActiveTab('ADMIN_PANEL')}
             className="mb-6 bg-red-600 p-4 rounded-3xl flex items-center justify-between cursor-pointer active:scale-95 transition-all shadow-lg shadow-red-600/30 border border-red-500"
          >
             <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-2xl flex items-center justify-center text-white">
                   <ShieldAlert size={20} />
                </div>
                <div>
                   <p className="text-white font-black text-sm">Approvals Needed</p>
                   <p className="text-red-100 text-[11px] font-medium uppercase tracking-wider">{totalPending} requests awaiting your authorization</p>
                </div>
             </div>
             <ChevronRight className="text-white/50" size={24} />
          </div>
      )}

      <h2 className="text-xl font-extrabold text-slate-900 mb-1 flex items-center gap-2"><LayoutDashboard size={20} className="text-blue-600" /> Command Center</h2>
      <p className="text-sm text-slate-500 mb-6">Real-time business insights and daily operations.</p>
      
      {/* Financial & Sales KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
         {/* Hero Revenue Card */}
         <div className="col-span-2 md:col-span-4 grad-blue text-white rounded-3xl p-5 shadow-blue relative overflow-hidden">
            <div className="absolute top-0 right-0 w-48 h-48 opacity-10 -translate-y-6 translate-x-6">
              <TrendingUp className="w-full h-full" />
            </div>
            <div className="relative z-10 flex justify-between items-start">
               <div>
                 <div className="flex items-center gap-2 mb-3">
                   <p className="text-blue-100 text-xs font-bold uppercase tracking-widest">Shift Revenue</p>
                   {activeShift && (
                     <span className="flex items-center gap-1 bg-green-400/20 text-green-300 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                       <div className="w-1.5 h-1.5 bg-green-400 rounded-full" style={{ animation: 'pulse 2s infinite' }} /> Live
                     </span>
                   )}
                 </div>
                 <h3 className="text-4xl font-black leading-none">Ksh {todaySales.toLocaleString()}</h3>
                 <p className="text-blue-200 text-xs font-semibold mt-2">{shiftTransactions.length} transactions this shift</p>
               </div>
               <div className="text-right">
                 <p className="text-blue-200 text-[10px] font-bold uppercase tracking-wider mb-1">Shifts Today</p>
                 <h3 className="text-3xl font-black">{todaysReports?.length || 0}</h3>
                 {pendingQuotes > 0 && <p className="text-amber-300 text-[10px] font-bold mt-1">{pendingQuotes} pending quotes</p>}
               </div>
            </div>
         </div>
         
         {/* M-Pesa */}
         <div className="grad-purple text-white rounded-3xl p-4 shadow-purple relative overflow-hidden">
            <Smartphone className="absolute right-3 top-3 text-white/20 w-10 h-10" />
            <p className="text-purple-100 text-[10px] font-bold uppercase tracking-widest mb-2">M-Pesa</p>
            <h3 className="text-xl font-black">Ksh {mpesaTotal.toLocaleString()}</h3>
         </div>

         <div className="grad-green text-white rounded-3xl p-4 shadow-green relative overflow-hidden">
            <DollarSign className="absolute right-3 top-3 text-white/20 w-10 h-10" />
            <p className="text-green-100 text-[10px] font-bold uppercase tracking-widest mb-2">Cash Receipts</p>
            <h3 className="text-xl font-black">Ksh {cashTotal.toLocaleString()}</h3>
         </div>

         {/* Drawer & Tax */}
         <div className="bg-white col-span-2 rounded-3xl p-4 border border-slate-200 shadow-card flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-[10px] uppercase tracking-widest font-black mb-1">Expected Cash in Drawer</p>
              <h3 className={`text-xl font-black ${expectedCashDrawer < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                Ksh {expectedCashDrawer.toLocaleString()}
              </h3>
              <p className="text-[10px] text-slate-400 font-semibold mt-1">Float {openingFloat.toLocaleString()} + Sales − Expenses − Picks</p>
            </div>
            <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center border border-slate-100">
              <Banknote className="text-slate-300 w-6 h-6" />
            </div>
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
         <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-extrabold text-slate-900 mb-4">Payment Method Split</h3>
            <div className="h-[180px] w-full flex items-center">
               <div className="w-1/2 h-full">
                  <ResponsiveContainer width="100%" height="100%">
                     <PieChart>
                        <Pie
                           data={paymentData}
                           innerRadius={45}
                           outerRadius={65}
                           paddingAngle={5}
                           dataKey="value"
                        >
                           {paymentData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                           ))}
                        </Pie>
                        <Tooltip />
                     </PieChart>
                  </ResponsiveContainer>
               </div>
               <div className="w-1/2 space-y-3">
                  {paymentData.map((data, idx) => (
                     <div key={idx} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
                        <div>
                           <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">{data.name}</p>
                           <p className="text-sm font-black text-slate-900">Ksh {data.value.toLocaleString()}</p>
                        </div>
                     </div>
                  ))}
               </div>
            </div>
         </div>

         <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm">
            <h3 className="text-sm font-extrabold text-slate-900 mb-4">Current Shift: Top Products</h3>
            {topSellingProducts.length === 0 ? (
               <div className="h-[180px] flex flex-col items-center justify-center text-slate-400 grayscale transition-all opacity-40">
                  <TrendingUp size={32} className="mb-2" />
                  <p className="text-xs font-bold uppercase tracking-widest">No Sales Yet</p>
               </div>
            ) : (
               <div className="space-y-4">
                  {topSellingProducts.map((p, idx) => (
                     <div key={idx} className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                           <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-xs">
                              {idx + 1}
                           </div>
                           <p className="text-xs font-black text-slate-900 truncate max-w-[120px]">{p.name}</p>
                        </div>
                        <div className="text-right">
                           <p className="text-[10px] font-black text-slate-900">{p.qty} Sold</p>
                           <p className="text-[9px] font-bold text-slate-400">Total: Ksh {p.revenue.toLocaleString()}</p>
                        </div>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* Daily Performance Graph */}
      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm mb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-extrabold text-slate-900">Sales Trend</h3>
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button onClick={() => setTrendView('DAY')} className={`text-[10px] px-3 py-1 font-bold rounded-lg transition-colors ${trendView === 'DAY' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>DAY</button>
              <button onClick={() => setTrendView('WEEK')} className={`text-[10px] px-3 py-1 font-bold rounded-lg transition-colors ${trendView === 'WEEK' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}>WEEK</button>
            </div>
          </div>
          <div className="h-[200px] w-full">
             <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                   <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }} dy={10} />
                   <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748B', fontWeight: 600 }} tickFormatter={(value) => `Ksh ${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`} />
                   <Tooltip cursor={{ fill: '#F1F5F9' }} contentStyle={{ borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} labelStyle={{ fontWeight: 'bold', color: '#0F172A', marginBottom: '4px' }} />
                   <Bar dataKey="sales" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
             </ResponsiveContainer>
          </div>
      </div>

      {/* Daily Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
         <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3">
            <h3 className="text-sm font-extrabold text-slate-900 flex justify-between">
               Daily Actions
               <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-md font-bold">{pendingQuotes} Quotes</span>
            </h3>
            <div className="grid grid-cols-2 gap-2 h-full items-end mt-2">
               <button onClick={() => setIsPickCashOpen(true)} className="bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold py-3 rounded-2xl transition-colors text-center border border-slate-200 flex flex-col items-center justify-center gap-1">
                  <ArrowUpRight size={16} /> Pick Cash
               </button>
               <button onClick={openExpenseModal} className="bg-orange-50 hover:bg-orange-100 text-orange-700 text-[11px] font-bold py-3 rounded-2xl transition-colors text-center border border-orange-200 flex flex-col items-center justify-center gap-1">
                  <FileMinus size={16} /> Expense
               </button>
               <button onClick={() => setActiveTab('REFUNDS')} className="bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold py-3 rounded-2xl transition-colors text-center border border-blue-200 flex flex-col items-center justify-center gap-1">
                  <RotateCcw size={16} /> Refund
               </button>
               <button onClick={() => setIsCloseDayOpen(true)} className="bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold py-3 rounded-2xl transition-colors text-center shadow-lg shadow-slate-900/10 flex flex-col items-center justify-center gap-1 relative overflow-hidden">
                  <CalendarCheck size={16} /> Close Shift
                  {isCloseDayBlocked && <div className="absolute inset-0 bg-red-600/20 backdrop-blur-[1px] flex items-center justify-center"><Lock size={12} className="text-red-600" /></div>}
               </button>
               {(isAdmin || isManager) && (
                  <button 
                     onClick={() => setIsDailySummaryOpen(true)} 
                     disabled={!!existingDailySummary}
                     className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold py-3 rounded-2xl transition-colors text-center shadow-lg shadow-blue-600/20 flex flex-col items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                     {existingDailySummary ? <CheckCircle2 size={16} /> : <TrendingUp size={16} />}
                     {existingDailySummary ? 'Day Closed' : 'Close Day'}
                  </button>
               )}
            </div>
         </div>

         {/* Inventory Tracker */}
         <div className="bg-white rounded-3xl p-4 border border-slate-200 shadow-sm flex flex-col gap-3">
            <h3 className="text-sm font-extrabold text-slate-900">Inventory Status</h3>
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
               <Package className="text-slate-400" size={20} />
               <div>
                  <p className="text-xs font-semibold text-slate-600">Active Products</p>
                  <p className="text-sm font-black text-slate-900">{allProducts.length}</p>
               </div>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-2xl border ${lowStock.length > 0 ? 'bg-orange-50 border-orange-100' : 'bg-slate-50 border-slate-100'}`}>
               <span className={`text-xs font-semibold ${lowStock.length > 0 ? 'text-orange-800' : 'text-slate-600'}`}>Low Stock Alerts</span>
               {lowStock.length > 0 ? (
                  <button onClick={() => setActiveTab('INVENTORY')} className="text-[10px] font-bold text-white bg-orange-500 px-2 py-1 rounded-lg shadow-sm">
                     {lowStock.length} ITEM(S)
                  </button>
               ) : (
                  <span className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-1 rounded-lg">ALL GOOD</span>
               )}
            </div>
         </div>
      </div>

      {/* Recent Activity List */}
      <div>
         <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2 mb-3">
            <Clock size={16} className="text-slate-500" /> Live Sales Feed
         </h3>
         <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
            {recentActivity.length === 0 ? (
               <div className="p-6 text-center text-slate-500 text-sm">No transactions yet today.</div>
            ) : (
               <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto no-scrollbar">
                  {recentActivity.map(t => (
                     <div key={t.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                        <div className="flex-1 min-w-0 pr-3">
                           <p className="text-sm font-bold text-slate-900 truncate">Receipt #{t.id.split('-')[0].toUpperCase()}</p>
                           <p className="text-xs font-medium text-slate-500 mt-0.5">{new Date(t.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} • {t.items.reduce((acc, item) => acc + item.quantity, 0)} items</p>
                        </div>
                        <div className="text-right">
                           <p className="text-sm font-black text-slate-900">Ksh {t.total.toLocaleString()}</p>
                           <p className={`text-[9px] font-bold mt-1 px-1.5 py-0.5 rounded tracking-widest inline-block ${t.paymentMethod === 'MPESA' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-700'}`}>
                              {t.paymentMethod || 'UNKNOWN'}
                           </p>
                        </div>
                     </div>
                  ))}
               </div>
            )}
         </div>
      </div>

      {/* Pick Cash Modal */}
      {isPickCashOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsPickCashOpen(false)} />
          <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl relative z-10 flex flex-col p-6 animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold text-slate-900 mb-2">Pick Cash</h2>
            <p className="text-sm text-slate-500 mb-6">Remove cash from the drawer for deposit.</p>
            <div className="bg-blue-50 p-4 rounded-xl mb-6 border border-blue-100 flex justify-between items-center text-blue-900">
               <span className="font-semibold text-sm">Expected Drawer:</span>
               <span className="text-lg font-black">Ksh {expectedCashDrawer.toLocaleString()}</span>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Amount to Pick</label>
              <div className="relative">
                <span className="absolute left-4 top-3 text-slate-400 font-bold">Ksh</span>
                <input type="number" className="w-full bg-white border-2 border-slate-200 rounded-xl pl-12 pr-4 py-3 text-xl font-bold text-slate-900 shadow-sm focus:outline-none focus:border-blue-500 transition-all font-bold" placeholder="0" value={pickAmount} onChange={(e) => setPickAmount(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="flex gap-3">
               <button onClick={() => setIsPickCashOpen(false)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
               <button onClick={handlePickCash} disabled={!pickAmount || Number(pickAmount) <= 0 || Number(pickAmount) > expectedCashDrawer} className="flex-[2] bg-blue-600 text-white px-4 py-3 font-bold rounded-xl disabled:opacity-50 transition-colors shadow-lg active:scale-95">Save Pick</button>
            </div>
          </div>
        </div>
      )}

      {/* Close Day Modal */}
      {isCloseDayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsCloseDayOpen(false)} />
          <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl relative z-10 flex flex-col p-6 animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-black text-slate-900 mb-2 flex items-center gap-2"><div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center"><CalendarCheck size={18} /></div> Z-Report / Close Shift</h2>
            <p className="text-sm text-slate-500 mb-6 flex items-center gap-1">Finalizing <span className="font-bold text-slate-900">{activeShift?.cashierName}</span>'s active shift ledger.</p>
             <div className="space-y-2 mb-6 text-sm">
               <div className="flex justify-between text-slate-500"><span>Shift Start (Float)</span><span className="font-bold text-slate-900">Ksh {openingFloat.toLocaleString()}</span></div>
               <div className="flex justify-between text-slate-500"><span>Gross Sales</span><span className="font-bold text-slate-900">Ksh {todaySales.toLocaleString()}</span></div>
               <div className="flex justify-between text-slate-500"><span>M-Pesa Receipts</span><span className="font-bold text-slate-600">- Ksh {mpesaTotal.toLocaleString()}</span></div>
               <div className="flex justify-between text-slate-500"><span>Total Picked (Banked)</span><span className="font-bold text-slate-600">- Ksh {totalPickedAmount.toLocaleString()}</span></div>
               <div className="flex justify-between text-slate-500"><span>Expenses</span><span className="font-bold text-red-600">- Ksh {shiftExpenses.toLocaleString()}</span></div>
               <div className="border-t border-dashed border-slate-200 my-2 pt-2 flex justify-between text-slate-900 font-black">
                  <span>Expected Drawer Cash</span>
                  <span>Ksh {expectedCashDrawer.toLocaleString()}</span>
               </div>
            </div>
            <div className="mb-6">
              <label className="block text-sm font-semibold text-slate-700 mb-2">Counted Custom Cash</label>
              <div className="relative">
                <span className="absolute left-4 top-3 text-slate-400 font-bold">Ksh</span>
                <input type="number" className="w-full bg-slate-50 border-2 border-slate-100 rounded-xl pl-12 pr-4 py-3 text-xl font-black text-slate-900 shadow-sm focus:outline-none focus:border-slate-500 transition-all" placeholder="0" value={reportedCash} onChange={(e) => setReportedCash(e.target.value)} autoFocus />
              </div>
              {reportedCash && Number(reportedCash) !== expectedCashDrawer && (
                 <div className="flex justify-between items-center bg-red-50 p-2 rounded-lg mt-2">
                    <span className="text-[10px] font-bold text-red-600 uppercase">Cashier Variance</span>
                    <span className="text-xs font-black text-red-700">Ksh {(Number(reportedCash) - expectedCashDrawer).toLocaleString()}</span>
                 </div>
              )}
            </div>
            <div className="flex gap-3">
               <button onClick={() => setIsCloseDayOpen(false)} className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 font-bold rounded-xl transition-colors">Cancel</button>
               <button 
                  onClick={handleCloseDay} 
                  className={`flex-[2] text-white px-4 py-3 font-bold rounded-xl transition-colors shadow-lg active:scale-95 flex items-center justify-center gap-2 ${isCloseDayBlocked ? 'bg-red-600 opacity-50 cursor-not-allowed' : (!reportedCash ? 'bg-slate-400' : 'bg-slate-900')}`}
               >
                  {isCloseDayBlocked ? <Lock size={16}/> : <Check size={16}/>}
                  {isCloseDayBlocked ? 'Banking Pending' : (!reportedCash ? 'Enter Cash Count' : 'Submit Shift')}
               </button>
            </div>
            {isCloseDayBlocked && (
               <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl flex gap-2">
                  <AlertCircle size={14} className="text-red-500 shrink-0" />
                  <p className="text-[10px] font-bold text-red-600 leading-tight">Access Denied: All cash picks (Ksh {unbankedCash.toLocaleString()}) must be confirmed and banked by the Admin before you can close this day.</p>
               </div>
            )}
          </div>
        </div>
      )}

      {/* Daily Master Summary Modal */}
      {isDailySummaryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsDailySummaryOpen(false)} />
          <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
             <div className="p-6 bg-blue-600 text-white text-center">
                <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                   <TrendingUp size={24} />
                </div>
                <h2 className="text-xl font-black">Daily Master Summary</h2>
                <p className="text-blue-100 text-xs font-semibold uppercase tracking-widest mt-1">{new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
             </div>
             
             <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Total Sales (Today)</p>
                      <p className="text-lg font-black text-slate-900">Ksh {(todaysReports || []).reduce((s: number, r) => s + (Number(r.totalSales) || 0), 0).toLocaleString()}</p>
                   </div>
                   <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Total Variance</p>
                      <p className={`text-lg font-black ${(todaysReports || []).reduce((s: number, r) => s + (Number(r.difference) || 0), 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                         Ksh {(todaysReports || []).reduce((s: number, r) => s + (Number(r.difference) || 0), 0).toLocaleString()}
                      </p>
                   </div>
                </div>

                <div className="space-y-3">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider ml-1">Shifts Summarized</p>
                   {todaysReports?.map((r, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2 border-b border-dashed border-slate-100 last:border-0">
                         <div>
                            <p className="text-xs font-bold text-slate-800">{r.cashierName}</p>
                            <p className="text-[9px] text-slate-400 font-semibold">{new Date(r.timestamp).toLocaleTimeString()}</p>
                         </div>
                         <div className="text-right">
                            <p className="text-xs font-black text-slate-900">Ksh {(Number(r.totalSales) || 0).toLocaleString()}</p>
                            <p className={`text-[9px] font-bold ${(Number(r.difference) || 0) < 0 ? 'text-red-500' : 'text-green-500'}`}>{(Number(r.difference) || 0) !== 0 ? `Var: ${Number(r.difference) || 0}` : 'Balanced'}</p>
                         </div>
                      </div>
                   ))}
                </div>

                <div className="bg-slate-900 text-white p-5 rounded-2xl space-y-3">
                   <div className="flex justify-between text-xs font-bold opacity-60 uppercase tracking-widest text-[9px]">
                      <span>Aggregated Metrics</span>
                      <span>Amount</span>
                   </div>
                   <div className="flex justify-between text-sm font-bold"><span>Total Expenses</span><span>- Ksh {(todaysReports || []).reduce((s: number, r) => s + (Number(r.totalExpenses) || 0), 0).toLocaleString()}</span></div>
                   <div className="flex justify-between text-sm font-bold"><span>Total Banked</span><span>- Ksh {(todaysReports || []).reduce((s: number, r) => s + (Number(r.totalPicks) || 0), 0).toLocaleString()}</span></div>
                   <div className="pt-2 border-t border-white/10 flex justify-between items-end">
                      <span className="text-sm font-black uppercase tracking-widest text-slate-400">Total VAT (16%)</span>
                      <span className="text-xl font-black">Ksh {(todaysReports || []).reduce((s: number, r) => s + (Number(r.taxTotal) || 0), 0).toLocaleString()}</span>
                   </div>
                </div>
             </div>

             <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3">
                <button onClick={() => setIsDailySummaryOpen(false)} className="flex-1 py-4 bg-white border border-slate-200 text-slate-700 font-black text-xs uppercase tracking-widest rounded-2xl">Cancel</button>
                <button onClick={handleFinalizeDay} className="flex-[2] py-4 bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-blue-600/20 active:scale-95">Finalize Business Day</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}
