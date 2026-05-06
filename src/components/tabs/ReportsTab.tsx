import React from 'react';
import { BarChart3, Activity, Wallet, Package, TrendingDown, Landmark, Scale, Calendar, ChevronRight, ArrowUpRight, ArrowDownRight, CreditCard, Share2, Loader2 } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';

export default function ReportsTab() {
  const [dateRange, setDateRange] = React.useState<'TODAY' | 'WEEK' | 'MONTH' | 'ALL'>('ALL');
  const [isSharing, setIsSharing] = React.useState(false);
  const activeBranchId = useStore(state => state.activeBranchId);
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allProducts = useLiveQuery(() => db.products.toArray(), [], []);
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSuppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const allSupplierPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);

  if (!allTransactions || !allProducts || !allExpenses || !allSuppliers || !allSupplierPayments) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-pulse">
                  <BarChart3 size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-xs  ">Generating Analytics...</p>
          </div>
      );
  }

  // Date Filtering Logic
  const getFilterStartTime = () => {
    const now = new Date();
    if (dateRange === 'TODAY') return new Date().setHours(0,0,0,0);
    if (dateRange === 'WEEK') return now.setDate(now.getDate() - 7);
    if (dateRange === 'MONTH') return now.setMonth(now.getMonth() - 1);
    return 0;
  };

  const startTime = getFilterStartTime();
  const filteredTransactions = allTransactions.filter(t => t.timestamp >= startTime);
  const filteredExpenses = allExpenses.filter(e => e.timestamp >= startTime);

  const revenue = filteredTransactions.reduce((acc, curr) => acc + (curr.total || 0), 0);
  const mpesaRevenue = filteredTransactions.filter(t => t.paymentMethod === 'MPESA').reduce((acc, curr) => acc + (curr.total || 0), 0);
  const cashRevenue = filteredTransactions.filter(t => t.paymentMethod === 'CASH').reduce((acc, curr) => acc + (curr.total || 0), 0);
  const totalTax = filteredTransactions.reduce((acc, curr) => acc + (curr.tax || 0), 0);
  const totalUnits = filteredTransactions.reduce((acc, curr) => acc + curr.items.reduce((sum, item) => sum + item.quantity, 0), 0);

  // Top products Calculation
  const productPerformance: Record<string, { name: string, qty: number, revenue: number }> = {};
  filteredTransactions.forEach(t => {
      t.items.forEach(item => {
          if (!productPerformance[item.productId]) {
              productPerformance[item.productId] = { name: item.name, qty: 0, revenue: 0 };
          }
          productPerformance[item.productId].qty += item.quantity;
          productPerformance[item.productId].revenue += (item.snapshotPrice * item.quantity);
      });
  });

  const topProducts = Object.values(productPerformance)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

  // Business Status Metrics
  const totalRevenue = allTransactions.reduce((acc, curr) => acc + (curr.total || 0), 0);
  const totalStockValue = allProducts.reduce((acc, p) => acc + ((Number(p.sellingPrice) || 0) * (Number(p.stockQuantity) || 0)), 0);
  const totalExpensesAllTime = allExpenses.reduce((acc, e) => acc + (Number(e.amount) || 0), 0);
  const totalSupplierPayments = allSupplierPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  const supplierDebt = allSuppliers.reduce((acc, s) => acc + (Number(s.balance) || 0), 0);
  
  const liquidCashEstimate = totalRevenue - totalExpensesAllTime - totalSupplierPayments;
  const businessNetWorth = totalStockValue + liquidCashEstimate - supplierDebt;

  const handleShareReport = async () => {
    setIsSharing(true);
    try {
      await shareDocument('report-content', `Business-Report-${dateRange}-${new Date().toISOString().split('T')[0]}`, false);
    } catch (err) {
      console.error("Report share failed", err);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="p-6 pb-24 animate-in fade-in max-w-5xl mx-auto w-full">
      <div id="report-content" className="bg-white print:p-8">
      <div className="flex justify-between items-end mb-8">
         <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Business Intelligence</h2>
            <p className="text-slate-500 text-sm font-medium">Performance insights and financial health.</p>
         </div>
         <div className="flex items-center gap-3">
             <button 
               onClick={handleShareReport}
               disabled={isSharing}
               className="bg-slate-900 text-white px-4 py-2.5 rounded-2xl text-[10px] font-black   flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
             >
               {isSharing ? <Loader2 size={12} className="animate-spin" /> : <Share2 size={12} />}
               {isSharing ? 'Wait...' : 'Export PDF'}
             </button>
             <div className="hidden sm:flex bg-slate-100 p-1 rounded-2xl no-print">
                {(['TODAY', 'WEEK', 'MONTH', 'ALL'] as const).map(range => (
                   <button 
                      key={range} 
                      onClick={() => setDateRange(range)}
                      className={`px-4 py-2 rounded-xl text-[10px] font-black   transition-all ${dateRange === range ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                   >
                      {range}
                   </button>
                ))}
             </div>
         </div>
      </div>

      {/* Date selector for mobile */}
      <div className="flex sm:hidden bg-slate-100 p-1 rounded-2xl mb-6 overflow-x-auto no-scrollbar">
         {(['TODAY', 'WEEK', 'MONTH', 'ALL'] as const).map(range => (
            <button 
               key={range} 
               onClick={() => setDateRange(range)}
               className={`flex-1 min-w-[70px] px-3 py-2 rounded-xl text-[10px] font-black   transition-all ${dateRange === range ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}
            >
               {range}
            </button>
         ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="md:col-span-2 grad-blue text-white rounded-[32px] p-8 shadow-blue relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:scale-110 transition-transform">
                <BarChart3 size={120} />
             </div>
             <div className="relative z-10">
                <p className="text-blue-100 text-[10px] font-black  tracking-[0.2em] mb-2 opacity-80">
                   {dateRange === 'ALL' ? 'Lifetime Revenue' : `${dateRange} Sales Volume`}
                </p>
                <h3 className="text-5xl font-black tracking-tighter tabular-nums mb-8 flex items-baseline gap-2">
                  <span className="text-xl font-bold opacity-60">KSH</span> {revenue.toLocaleString()}
                </h3>
                <div className="flex gap-6">
                   <div className="flex items-center gap-2">
                     <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><CreditCard size={16}/></div>
                     <div>
                       <p className="text-[10px]  font-black text-blue-200">M-PESA</p>
                       <p className="text-sm font-black">Ksh {mpesaRevenue.toLocaleString()}</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-2">
                     <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center"><Wallet size={16}/></div>
                     <div>
                       <p className="text-[10px]  font-black text-blue-200">CASH</p>
                       <p className="text-sm font-black">Ksh {cashRevenue.toLocaleString()}</p>
                     </div>
                   </div>
                </div>
             </div>
          </div>
          
          <div className="bg-white rounded-[32px] p-8 shadow-card border border-slate-100 flex flex-col justify-center gap-4">
             <div>
                <p className="text-[10px]   font-black text-slate-400 mb-1">Orders Count</p>
                <div className="flex items-baseline gap-2">
                  <h3 className="text-3xl font-black text-slate-900">{filteredTransactions.length}</h3>
                  <span className="text-green-500 font-bold text-[10px] flex items-center gap-0.5"><ArrowUpRight size={10}/> +12%</span>
                </div>
             </div>
             <div className="h-px bg-slate-100 w-full" />
             <div>
                <p className="text-[10px]   font-black text-slate-400 mb-1">Tax Accrued</p>
                <h3 className="text-xl font-black text-slate-700 tabular-nums">Ksh {totalTax.toLocaleString()}</h3>
             </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
         {/* Top products */}
         <section>
            <h3 className="text-xs font-black text-slate-400  tracking-[0.2em] flex items-center gap-2 mb-4 ml-1">
               <Package size={14} /> Performance Leaderboard
            </h3>
            <div className="bg-white rounded-[32px] shadow-card border border-slate-100 overflow-hidden">
               {topProducts.length === 0 ? (
                  <div className="py-20 text-center text-slate-300">No sales data recorded.</div>
               ) : (
                  <div className="divide-y divide-slate-50">
                     {topProducts.map((p, idx) => (
                        <div key={idx} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors group cursor-default">
                           <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center font-black text-slate-400 text-xs shadow-sm">
                                 #{idx + 1}
                              </div>
                              <div>
                                 <p className="text-sm font-black text-slate-900">{p.name}</p>
                                 <p className="text-[10px] font-bold text-slate-400   mt-0.5">{p.qty} Units Sold</p>
                              </div>
                           </div>
                           <div className="text-right">
                              <p className="text-sm font-black text-blue-600 tabular-nums">Ksh {p.revenue.toLocaleString()}</p>
                              <div className="w-16 h-1 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                 <div className="h-full grad-blue" style={{ width: `${(p.revenue / topProducts[0].revenue) * 100}%` }} />
                              </div>
                           </div>
                        </div>
                     ))}
                  </div>
               )}
            </div>
         </section>

         {/* Business Health */}
         <section>
            <h3 className="text-xs font-black text-slate-400  tracking-[0.2em] flex items-center gap-2 mb-4 ml-1">
               <Activity size={14} /> Financial Health
            </h3>
            <div className="bg-slate-900 p-8 rounded-[32px] text-white shadow-elevated relative overflow-hidden flex flex-col justify-between h-full min-h-[340px]">
               <Scale className="absolute -right-8 -top-8 w-48 h-48 text-white/5 -rotate-12" />
               
               <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-slate-400 font-extrabold  tracking-[0.2em] text-[10px]">Estimated Business Equity</p>
                    <div className="bg-white/10 px-3 py-1 rounded-full border border-white/10 text-[9px] font-black  ">Live Audit</div>
                  </div>
                  <h3 className={`text-4xl sm:text-5xl font-black tracking-tighter mb-4 ${businessNetWorth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                     Ksh {businessNetWorth.toLocaleString()}
                  </h3>
                  <p className="text-slate-500 text-[11px] leading-relaxed font-medium">
                     Consolidated value of physical stock assets and available liquid cash, adjusted for outstanding trade payables.
                  </p>
               </div>

               <div className="grid grid-cols-2 gap-3 mt-8">
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                     <p className="text-[9px] font-black text-slate-500   mb-1">Asset Value</p>
                     <p className="text-sm font-black text-blue-400">Ksh {(totalStockValue + liquidCashEstimate).toLocaleString()}</p>
                  </div>
                  <div className="bg-white/5 border border-white/10 p-4 rounded-2xl">
                     <p className="text-[9px] font-black text-slate-500   mb-1">Liabilities</p>
                     <p className="text-sm font-black text-red-400">Ksh {supplierDebt.toLocaleString()}</p>
                  </div>
               </div>
            </div>
         </section>
      </div>

      {/* Asset Breakdown Cards */}
      <h3 className="text-xs font-black text-slate-400  tracking-[0.2em] mb-4 ml-1">Asset Composition</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
         <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-card flex items-center gap-4 group hover:border-blue-200 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
               <Package size={22} />
            </div>
            <div className="min-w-0">
               <p className="text-[9px]   font-black text-slate-400 mb-0.5">Physical Inventory</p>
               <h4 className="text-lg font-black text-slate-900 truncate">Ksh {totalStockValue.toLocaleString()}</h4>
            </div>
         </div>
         <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-card flex items-center gap-4 group hover:border-green-200 transition-all">
            <div className="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
               <Wallet size={22} />
            </div>
            <div className="min-w-0">
               <p className="text-[9px]   font-black text-slate-400 mb-0.5">Liquid Floating Cash</p>
               <h4 className="text-lg font-black text-green-600 truncate">Ksh {liquidCashEstimate.toLocaleString()}</h4>
            </div>
         </div>
         <div className="bg-red-50 p-6 rounded-3xl border border-red-100 shadow-card flex items-center gap-4 group hover:border-red-300 transition-all md:col-span-2 lg:col-span-1">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
               <TrendingDown size={22} />
            </div>
            <div className="min-w-0">
               <p className="text-[9px]   font-black text-red-400 mb-0.5">Accounts Payable</p>
               <h4 className="text-lg font-black text-red-700 truncate">Ksh {supplierDebt.toLocaleString()}</h4>
            </div>
         </div>
      </div>
      </div>
    </div>
  );
}
