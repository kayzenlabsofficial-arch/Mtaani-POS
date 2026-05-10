import React from 'react';
import { 
  BarChart3, Activity, Wallet, Package, TrendingDown, 
  Landmark, Scale, Calendar, ChevronRight, ArrowUpRight, 
  ArrowDownRight, CreditCard, Share2, Loader2, TrendingUp,
  Target, Info, Search, Box, PieChart as PieIcon, Layers,
  Users, Clock, ShoppingBag, ShieldAlert, SlidersHorizontal, Download, FileText, ChevronDown
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend,
  ComposedChart, Line
} from 'recharts';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { SearchableSelect } from '../shared/SearchableSelect';
import { canPerform } from '../../utils/accessControl';
import NestedControlPanel from '../shared/NestedControlPanel';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e'];

export default function ReportsTab() {
  const [dateRange, setDateRange] = React.useState<'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'ALL'>('ALL');
  const [selectedProductId, setSelectedProductId] = React.useState<string | null>(null);
  const [isSharing, setIsSharing] = React.useState(false);
  const [isOpsPanelOpen, setIsOpsPanelOpen] = React.useState(false);
  
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);

  if (!canPerform(currentUser, 'report.view')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
        <div className="w-20 h-20 bg-rose-50 rounded-[2rem] flex items-center justify-center text-rose-500 shadow-sm border border-rose-100">
           <ShieldAlert size={40} />
        </div>
        <div className="text-center">
           <h2 className="text-xl font-black text-slate-900 tracking-tight">Access Restricted</h2>
           <p className="text-sm font-bold text-slate-400 mt-1 uppercase tracking-widest">Enterprise Clearance Required</p>
        </div>
      </div>
    );
  }

  // Core Data Queries
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allProducts = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSuppliers = useLiveQuery(() => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []);
  const allPurchases = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);

  if (!allTransactions || !allProducts || !allExpenses || !allSuppliers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center animate-spin-slow">
          <BarChart3 size={40} className="text-slate-200" />
        </div>
        <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Synthesizing Intelligence...</p>
      </div>
    );
  }

  // 1. Date Filtering Logic
  const getFilterStartTime = () => {
    const now = new Date();
    if (dateRange === 'TODAY') return new Date().setHours(0,0,0,0);
    if (dateRange === 'WEEK') return now.setDate(now.getDate() - 7);
    if (dateRange === 'MONTH') return now.setMonth(now.getMonth() - 1);
    if (dateRange === 'QUARTER') return now.setMonth(now.getMonth() - 3);
    return 0;
  };
  const startTime = getFilterStartTime();
  const filteredTransactions = allTransactions.filter(t => t.timestamp >= startTime && t.status !== 'VOIDED');
  const filteredExpenses = allExpenses.filter(e => e.timestamp >= startTime && (e.status === 'APPROVED' || e.status === 'PENDING'));

  // 2. Complex Financial & Operational Analytics
  let totalRevenue = 0;
  let estimatedCOGS = 0;
  let totalTax = 0;
  const productPerf: Record<string, { name: string, qty: number, revenue: number, profit: number }> = {};
  const categoryPerf: Record<string, { revenue: number, profit: number }> = {};
  const cashierPerf: Record<string, { revenue: number, orders: number }> = {};
  const hourlySales = Array.from({ length: 24 }).map((_, i) => ({ hour: i, revenue: 0 }));
  
  filteredTransactions.forEach(t => {
    totalRevenue += (t.total || 0);
    totalTax += (t.tax || 0);
    
    const cashier = t.cashierName || 'Unknown';
    if (!cashierPerf[cashier]) cashierPerf[cashier] = { revenue: 0, orders: 0 };
    cashierPerf[cashier].revenue += (t.total || 0);
    cashierPerf[cashier].orders += 1;

    const hour = new Date(t.timestamp).getHours();
    hourlySales[hour].revenue += (t.total || 0);

    t.items.forEach(item => {
      const purchase = allPurchases?.find(p => p.items.some(pi => pi.productId === item.productId));
      const cost = purchase?.items.find(pi => pi.productId === item.productId)?.unitCost || (item.snapshotPrice * 0.7);
      const itemProfit = (item.snapshotPrice - cost) * item.quantity;
      estimatedCOGS += (cost * item.quantity);

      if (!productPerf[item.productId]) {
        productPerf[item.productId] = { name: item.name, qty: 0, revenue: 0, profit: 0 };
      }
      productPerf[item.productId].qty += item.quantity;
      productPerf[item.productId].revenue += (item.snapshotPrice * item.quantity);
      productPerf[item.productId].profit += itemProfit;

      const productObj = allProducts.find(p => p.id === item.productId);
      const category = productObj?.category || 'Uncategorized';
      if (!categoryPerf[category]) categoryPerf[category] = { revenue: 0, profit: 0 };
      categoryPerf[category].revenue += (item.snapshotPrice * item.quantity);
      categoryPerf[category].profit += itemProfit;
    });
  });

  const totalExpenseAmount = filteredExpenses.reduce((acc, e) => acc + (e.amount || 0), 0);
  const grossProfit = totalRevenue - estimatedCOGS - totalTax;
  const netProfit = grossProfit - totalExpenseAmount;
  const averageBasket = filteredTransactions.length > 0 ? totalRevenue / filteredTransactions.length : 0;
  const topProducts = Object.values(productPerf).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topProductShare = topProducts.length > 0 && totalRevenue > 0 ? (topProducts[0].revenue / totalRevenue) * 100 : 0;
  const lowStockCount = allProducts.filter(p => (p.stockQuantity || 0) <= 5).length;
  const creditTransactions = filteredTransactions.filter(
    t => t.paymentMethod === 'CREDIT' || (t.paymentMethod === 'SPLIT' && t.splitPayments?.secondaryMethod === 'CREDIT')
  ).length;

  // Chart Data Formatting
  const salesTrendData = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayStart = new Date(d).setHours(0,0,0,0);
    const dayEnd = new Date(d).setHours(23,59,59,999);
    const daySales = allTransactions.filter(t => t.timestamp >= dayStart && t.timestamp <= dayEnd && t.status !== 'VOIDED').reduce((s, t) => s + (t.total || 0), 0);
    return { name: d.toLocaleDateString('en-US', { weekday: 'short' }), revenue: daySales };
  });

  const categoryData = Object.entries(categoryPerf).map(([name, data]) => ({ name, ...data })).sort((a,b) => b.revenue - a.revenue).slice(0, 6);
  const expenseData = Array.from(new Set(filteredExpenses.map(e => e.category))).map(cat => ({
    name: cat,
    value: filteredExpenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0)
  })).sort((a,b) => b.value - a.value).slice(0, 5);

  const topCashiers = Object.entries(cashierPerf).map(([name, data]) => ({ name, ...data })).sort((a,b) => b.revenue - a.revenue);

  const selectedProduct = allProducts.find(p => p.id === selectedProductId);
  const selectedProductSales = filteredTransactions.filter(t => t.items.some(i => i.productId === selectedProductId));
  const productStats = {
    totalQty: selectedProductSales.reduce((acc, t) => acc + t.items.filter(i => i.productId === selectedProductId).reduce((s, i) => s + i.quantity, 0), 0),
    totalRevenue: selectedProductSales.reduce((acc, t) => acc + t.items.filter(i => i.productId === selectedProductId).reduce((s, i) => s + (i.snapshotPrice * i.quantity), 0), 0)
  };

  const handleShareReport = async () => {
    setIsSharing(true);
    try {
      if ((window as any).shareDocument) {
        await (window as any).shareDocument('report-content', `Intelligence-Report-${dateRange}-${new Date().toISOString().split('T')[0]}`, false);
      }
      success("Report exported successfully");
    } catch (err) {
      console.error("Report share failed", err);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Intelligence Header */}
      <div className="px-4 pt-2 mb-6 no-print">
        <div className="flex items-center justify-between mb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Intelligence</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Enterprise Analytics & Insights</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Filters</span>
              </button>
              <button onClick={handleShareReport} disabled={isSharing} className="grad-blue text-white px-4 py-2.5 rounded-xl shadow-blue active:scale-95 transition-all flex items-center gap-2 font-black text-[10px] uppercase">
                 {isSharing ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                 {isSharing ? 'Working...' : 'Export'}
              </button>
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300">
             <NestedControlPanel
               title="Report Configuration"
               subtitle="Adjust temporal scope and analytical focus"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Temporal Scope</h4>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { id: 'TODAY', label: 'Day' },
                          { id: 'WEEK', label: 'Week' },
                          { id: 'MONTH', label: 'Month' },
                          { id: 'QUARTER', label: 'Quarter' },
                          { id: 'ALL', label: 'Infinite' }
                        ].map(range => (
                          <button 
                            key={range.id} 
                            onClick={() => setDateRange(range.id as any)}
                            className={`px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 transition-all press ${dateRange === range.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-200'}`}
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                   </div>

                   <div className="space-y-4">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Quick Exports</h4>
                      <div className="grid grid-cols-2 gap-2">
                         <button className="flex items-center justify-center gap-2 p-4 rounded-2xl border-2 border-slate-100 bg-white hover:border-blue-300 transition-all font-black text-[9px] uppercase tracking-widest text-slate-600">
                            <FileText size={16} className="text-blue-500" /> PDF Summary
                         </button>
                         <button className="flex items-center justify-center gap-2 p-4 rounded-2xl border-2 border-slate-100 bg-white hover:border-emerald-300 transition-all font-black text-[9px] uppercase tracking-widest text-slate-600">
                            <Download size={16} className="text-emerald-500" /> Excel Data
                         </button>
                      </div>
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      <div id="report-content" className="space-y-8 px-4">
        
        {/* Global Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Revenue" value={totalRevenue} icon={<TrendingUp size={24}/>} color="indigo" subtitle={`${filteredTransactions.length} orders processed`} />
          <StatCard title="Net Profit" value={netProfit} icon={<Target size={24}/>} color={netProfit >= 0 ? "emerald" : "rose"} subtitle="Post-COGS & Expenses" />
          <StatCard title="Gross Margin" value={((grossProfit / (totalRevenue || 1)) * 100)} unit="%" icon={<Layers size={24}/>} color="blue" subtitle="Efficiency of goods" />
          <StatCard title="Expense Rate" value={((totalExpenseAmount / (totalRevenue || 1)) * 100)} unit="%" icon={<Activity size={24}/>} color="amber" subtitle="Burn vs Revenue" />
        </div>

        {/* Primary Analytical Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white rounded-[2.5rem] p-8 border-2 border-slate-100 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-bl-[100px] pointer-events-none -mr-8 -mt-8 group-hover:scale-110 transition-transform duration-500" />
            <div className="relative z-10">
              <h3 className="font-black text-slate-900 text-lg flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center"> <BarChart3 size={20} /> </div>
                Revenue Growth Velocity
              </h3>
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={salesTrendData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} tickFormatter={(v) => `Ksh ${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                    <Tooltip contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', fontWeight: 900 }} />
                    <Bar dataKey="revenue" barSize={32} fill="#6366f1" radius={[8, 8, 0, 0]} opacity={0.6} />
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[2.5rem] p-8 border-2 border-slate-100 shadow-sm">
            <h3 className="font-black text-slate-900 text-lg flex items-center gap-3 mb-8">
              <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center"> <PieIcon size={20} /> </div>
              Expense Matrix
            </h3>
            <div className="h-[260px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expenseData} innerRadius={75} outerRadius={105} paddingAngle={8} dataKey="value" stroke="none">
                    {expenseData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', fontWeight: 900 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                 <p className="text-[10px] font-black text-slate-400 uppercase">Total Burn</p>
                 <p className="text-lg font-black text-slate-900 leading-none">Ksh {totalExpenseAmount.toLocaleString()}</p>
              </div>
            </div>
            <div className="mt-8 space-y-3">
              {expenseData.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}} />
                    <span className="text-[11px] font-black text-slate-500 group-hover:text-slate-900 transition-colors truncate max-w-[120px]">{item.name}</span>
                  </div>
                  <span className="text-[11px] font-black text-slate-900 tabular-nums">Ksh {item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Audit & Category Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white rounded-[2.5rem] p-8 border-2 border-slate-100 shadow-sm">
             <h3 className="font-black text-slate-900 text-lg flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center"> <ShoppingBag size={20} /> </div>
                Category Performance Intelligence
             </h3>
             <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={categoryData} layout="vertical" margin={{ left: 20, right: 20 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 900}} width={90} />
                      <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '16px', border: 'none', fontWeight: 900 }} />
                      <Bar dataKey="revenue" fill="#10b981" radius={[0, 8, 8, 0]} barSize={20} />
                      <Bar dataKey="profit" fill="#6366f1" radius={[0, 8, 8, 0]} barSize={20} />
                   </BarChart>
                </ResponsiveContainer>
             </div>
             <div className="mt-6 flex justify-center gap-6">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-sm"/> <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Revenue</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-indigo-500 rounded-sm"/> <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Profit Contribution</span></div>
             </div>
          </section>

          <section className="bg-white rounded-[2.5rem] overflow-hidden border-2 border-slate-100 shadow-sm">
            <div className="px-8 py-6 border-b-2 border-slate-50 bg-slate-50/50">
              <h3 className="text-lg font-black text-slate-900">Executive Audit Ledger</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Target Compliance & Health Check</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <tbody className="divide-y-2 divide-slate-50 text-sm">
                  <SummaryRow metric="Net Profitability" value={`Ksh ${Math.floor(netProfit).toLocaleString()}`} target="Positive" ok={netProfit >= 0} />
                  <SummaryRow metric="Gross Margin %" value={`${((grossProfit / (totalRevenue || 1)) * 100).toFixed(1)}%`} target="> 25%" ok={((grossProfit / (totalRevenue || 1)) * 100) >= 25} />
                  <SummaryRow metric="Avg. Basket Size" value={`Ksh ${Math.floor(averageBasket).toLocaleString()}`} target="Ksh 500+" ok={averageBasket >= 500} />
                  <SummaryRow metric="Stock Health" value={`${lowStockCount} Low SKU`} target="< 10" ok={lowStockCount < 10} />
                  <SummaryRow metric="Credit Exposure" value={`${creditTransactions} Tx`} target="< 15%" ok={creditTransactions <= (filteredTransactions.length * 0.15)} />
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Product Pulse Section */}
        <section className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-elevated relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none -mr-48 -mt-48 group-hover:bg-indigo-600/20 transition-all duration-700" />
          
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
              <div>
                <h3 className="text-3xl font-black tracking-tight flex items-center gap-4">
                  <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-indigo">
                    <Activity size={28} />
                  </div>
                  SKU Lifecycle Pulse
                </h3>
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-3 opacity-60">High-Resolution Inventory Deep-Dive</p>
              </div>
              <div className="w-full md:w-96">
                <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-3 ml-2">Identify SKU for Analysis</label>
                <SearchableSelect
                  value={selectedProductId || ''}
                  onChange={(v) => setSelectedProductId(v || null)}
                  placeholder="Scan or select product SKU..."
                  options={allProducts.map(p => ({
                    value: p.id,
                    label: p.name,
                    keywords: `${p.name} ${p.barcode || ''} ${p.category || ''}`,
                  }))}
                  buttonClassName="bg-white/5 border-white/10 hover:border-indigo-500/50 rounded-2xl px-6 py-5 text-sm font-black text-white"
                  searchInputClassName="bg-white"
                />
              </div>
            </div>

            {selectedProduct ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-in slide-in-from-bottom-8 duration-500">
                 <div className="bg-white/5 backdrop-blur-sm border-2 border-white/5 p-8 rounded-[2rem] hover:bg-white/10 transition-all">
                    <p className="text-indigo-400 text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2"><Layers size={14}/> Volume Sales</p>
                    <div className="flex items-baseline gap-2">
                       <h4 className="text-5xl font-black tabular-nums">{productStats.totalQty}</h4>
                       <span className="text-sm font-bold text-slate-500 uppercase">{selectedProduct.unit || 'Units'}</span>
                    </div>
                 </div>
                 <div className="bg-white/5 backdrop-blur-sm border-2 border-white/5 p-8 rounded-[2rem] hover:bg-white/10 transition-all">
                    <p className="text-emerald-400 text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2"><TrendingUp size={14}/> SKU Revenue</p>
                    <h4 className="text-4xl font-black tabular-nums">Ksh {productStats.totalRevenue.toLocaleString()}</h4>
                 </div>
                 <div className="bg-white/5 backdrop-blur-sm border-2 border-white/5 p-8 rounded-[2rem] hover:bg-white/10 transition-all">
                    <p className="text-amber-400 text-[10px] font-black uppercase tracking-widest mb-6 flex items-center gap-2"><Package size={14}/> Stock Health</p>
                    <h4 className={`text-4xl font-black tabular-nums ${selectedProduct.stockQuantity < 10 ? 'text-rose-500' : 'text-white'}`}>{selectedProduct.stockQuantity}</h4>
                 </div>
                 <div className="grad-indigo p-8 rounded-[2rem] shadow-indigo flex flex-col justify-between">
                    <div>
                       <p className="text-indigo-200 text-[10px] font-black uppercase tracking-widest mb-2">Profit Contribution</p>
                       <h4 className="text-3xl font-black truncate">Ksh {(productPerf[selectedProduct.id]?.profit || 0).toLocaleString()}</h4>
                    </div>
                    <div className="text-[10px] font-black bg-white/20 px-4 py-1.5 rounded-full w-fit uppercase tracking-widest">Net Margin: {(( (productPerf[selectedProduct.id]?.profit || 0) / (productStats.totalRevenue || 1) ) * 100).toFixed(1)}%</div>
                 </div>
              </div>
            ) : (
              <div className="py-32 border-4 border-dashed border-white/5 rounded-[3rem] flex flex-col items-center justify-center text-slate-700">
                <Box size={64} className="opacity-10 mb-6" />
                <p className="text-[11px] font-black uppercase tracking-[0.3em] opacity-40">Intelligence Data Awaiting Selection</p>
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
}

// ── UI Helpers ─────────────────────────────────────────────────────────────

interface StatCardProps {
  title: string;
  value: number;
  unit?: string;
  icon: React.ReactNode;
  color: string;
  subtitle: string;
}

function StatCard({ title, value, unit, icon, color, subtitle }: StatCardProps) {
  const colors: any = {
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100 shadow-indigo/5",
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100 shadow-emerald/5",
    rose: "bg-rose-50 text-rose-600 border-rose-100 shadow-rose/5",
    amber: "bg-amber-50 text-amber-600 border-amber-100 shadow-amber/5",
    blue: "bg-blue-50 text-blue-600 border-blue-100 shadow-blue/5",
  };

  return (
    <div className="p-7 rounded-[2rem] border-2 border-slate-100 bg-white hover:border-indigo-300 hover:shadow-xl hover:-translate-y-1 transition-all group">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform ${colors[color]}`}>
        {icon}
      </div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{title}</p>
      <h3 className="text-2xl font-black text-slate-900 tabular-nums">
        {unit !== '%' ? 'Ksh ' : ''}{Math.floor(value).toLocaleString()}{unit || ''}
      </h3>
      <p className="text-[11px] font-bold text-slate-500 mt-2 opacity-60 leading-tight">{subtitle}</p>
    </div>
  );
}

function SummaryRow({ metric, value, target, ok }: { metric: string; value: string; target: string; ok: boolean }) {
  return (
    <tr className="group hover:bg-slate-50/50 transition-colors">
      <td className="px-8 py-5 font-black text-slate-900 text-sm">{metric}</td>
      <td className="px-8 py-5 font-black text-slate-700 tabular-nums text-sm">{value}</td>
      <td className="px-8 py-5 text-slate-400 font-bold text-[11px] uppercase tracking-wider">{target}</td>
      <td className="px-8 py-5">
        <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center justify-center w-fit border ${
          ok ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100'
        }`}>
          {ok ? 'Target Met' : 'Off Track'}
        </div>
      </td>
    </tr>
  );
}
