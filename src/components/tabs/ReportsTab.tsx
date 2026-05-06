import React from 'react';
import { 
  BarChart3, Activity, Wallet, Package, TrendingDown, 
  Landmark, Scale, Calendar, ChevronRight, ArrowUpRight, 
  ArrowDownRight, CreditCard, Share2, Loader2, TrendingUp,
  Target, Info, Search, Box, PieChart as PieIcon, Layers,
  Users, Clock, ShoppingBag, ShieldAlert
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend,
  ComposedChart, Line
} from 'recharts';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F43F5E'];

export default function ReportsTab() {
  const [dateRange, setDateRange] = React.useState<'TODAY' | 'WEEK' | 'MONTH' | 'ALL'>('ALL');
  const [selectedProductId, setSelectedProductId] = React.useState<string | null>(null);
  const [isSharing, setIsSharing] = React.useState(false);
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);

  // Core Data Queries
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allProducts = useLiveQuery(() => db.products.toArray(), [], []);
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allSuppliers = useLiveQuery(() => db.suppliers.toArray(), [], []);
  const allPurchases = useLiveQuery(() => activeBranchId ? db.purchaseOrders.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []);
  const allUsers = useLiveQuery(() => db.users.toArray(), [], []);

  if (!allTransactions || !allProducts || !allExpenses || !allSuppliers) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-20 h-20 bg-slate-50 rounded-[40px] flex items-center justify-center animate-pulse">
          <BarChart3 size={40} className="text-slate-200" />
        </div>
        <p className="text-slate-400 font-black text-xs uppercase tracking-[0.2em]">Synthesizing Intelligence...</p>
      </div>
    );
  }

  // 1. Date Filtering Logic
  const getFilterStartTime = () => {
    const now = new Date();
    if (dateRange === 'TODAY') return new Date().setHours(0,0,0,0);
    if (dateRange === 'WEEK') return now.setDate(now.getDate() - 7);
    if (dateRange === 'MONTH') return now.setMonth(now.getMonth() - 1);
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
    
    // Cashier performance
    const cashier = t.cashierName || 'Unknown';
    if (!cashierPerf[cashier]) cashierPerf[cashier] = { revenue: 0, orders: 0 };
    cashierPerf[cashier].revenue += (t.total || 0);
    cashierPerf[cashier].orders += 1;

    // Hourly heatmap
    const hour = new Date(t.timestamp).getHours();
    hourlySales[hour].revenue += (t.total || 0);

    t.items.forEach(item => {
      // COGS Calculation
      const purchase = allPurchases?.find(p => p.items.some(pi => pi.productId === item.productId));
      const cost = purchase?.items.find(pi => pi.productId === item.productId)?.unitCost || (item.snapshotPrice * 0.7);
      const itemProfit = (item.snapshotPrice - cost) * item.quantity;
      estimatedCOGS += (cost * item.quantity);

      // Product performance
      if (!productPerf[item.productId]) {
        productPerf[item.productId] = { name: item.name, qty: 0, revenue: 0, profit: 0 };
      }
      productPerf[item.productId].qty += item.quantity;
      productPerf[item.productId].revenue += (item.snapshotPrice * item.quantity);
      productPerf[item.productId].profit += itemProfit;

      // Category performance
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

  const topProducts = Object.values(productPerf).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const topCashiers = Object.entries(cashierPerf).map(([name, data]) => ({ name, ...data })).sort((a,b) => b.revenue - a.revenue);

  // Individual Product Pulse
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
        await (window as any).shareDocument('report-content', `Business-Report-${dateRange}-${new Date().toISOString().split('T')[0]}`, false);
      }
    } catch (err) {
      console.error("Report share failed", err);
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="p-6 pb-24 max-w-7xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
      <div id="report-content" className="bg-white print:p-8 space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 no-print">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Business Intelligence</h1>
            <p className="text-slate-500 font-medium">Full spectrum operational & financial auditing.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={handleShareReport}
              disabled={isSharing}
              className="bg-slate-900 text-white px-6 py-3 rounded-2xl text-xs font-black flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg active:scale-95 disabled:opacity-50"
            >
              {isSharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
              {isSharing ? 'Processing...' : 'Export Intelligence'}
            </button>
            <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
              {(['TODAY', 'WEEK', 'MONTH', 'ALL'] as const).map(range => (
                <button 
                  key={range} 
                  onClick={() => setDateRange(range)}
                  className={`px-5 py-2.5 rounded-xl text-[10px] font-black transition-all ${dateRange === range ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Global Financial Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard title="Total Revenue" value={totalRevenue} icon={<TrendingUp size={20}/>} color="blue" subtitle={`${filteredTransactions.length} total orders`} />
          <StatCard title="Net Profit" value={netProfit} icon={<Target size={20}/>} color={netProfit >= 0 ? "green" : "red"} subtitle="Post-COGS & Expenses" />
          <StatCard title="Gross Margin" value={((grossProfit / (totalRevenue || 1)) * 100)} unit="%" icon={<Layers size={20}/>} color="indigo" subtitle="Product profitability" />
          <StatCard title="Op. Efficiency" value={((netProfit / (totalRevenue || 1)) * 100)} unit="%" icon={<Activity size={20}/>} color="purple" subtitle="Retention of revenue" />
        </div>

        {/* High-Level Trends */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 bg-white rounded-[40px] p-8 border border-slate-100 shadow-card relative">
            <h3 className="font-black text-slate-900 text-lg flex items-center gap-2 mb-8">
              <BarChart3 size={20} className="text-blue-500"/> Revenue & Profit Growth
            </h3>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={salesTrendData}>
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 600}} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 600}} tickFormatter={(v) => `Ksh ${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '24px', border: 'none', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }} 
                    labelStyle={{ fontWeight: 'black', color: '#0f172a' }}
                  />
                  <Bar dataKey="revenue" barSize={40} fill="#3B82F6" radius={[8, 8, 0, 0]} />
                  <Area type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={4} fillOpacity={1} fill="url(#colorRev)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-card">
            <h3 className="font-black text-slate-900 text-lg flex items-center gap-2 mb-8">
              <PieIcon size={20} className="text-orange-500"/> Expense Distribution
            </h3>
            <div className="h-[260px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expenseData} innerRadius={70} outerRadius={95} paddingAngle={8} dataKey="value" stroke="none">
                    {expenseData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-8 space-y-3">
              {expenseData.map((item, idx) => (
                <div key={idx} className="flex justify-between items-center group">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}} />
                    <span className="text-xs font-bold text-slate-600 group-hover:text-slate-900 transition-colors truncate max-w-[120px]">{item.name}</span>
                  </div>
                  <span className="text-xs font-black text-slate-900">Ksh {item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Operational Intelligence */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Category Performance */}
          <section className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-card">
             <h3 className="font-black text-slate-900 text-lg flex items-center gap-2 mb-8">
                <ShoppingBag size={20} className="text-emerald-500"/> Category Intelligence
             </h3>
             <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={categoryData} layout="vertical" margin={{ left: 30, right: 30 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748B', fontWeight: 800}} width={100} />
                      <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '16px', border: 'none' }} />
                      <Bar dataKey="revenue" fill="#10B981" radius={[0, 10, 10, 0]} barSize={20} />
                      <Bar dataKey="profit" fill="#3B82F6" radius={[0, 10, 10, 0]} barSize={20} />
                   </BarChart>
                </ResponsiveContainer>
             </div>
             <div className="mt-4 flex justify-center gap-6">
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-emerald-500 rounded-sm"/> <span className="text-[10px] font-black text-slate-400">REVENUE</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded-sm"/> <span className="text-[10px] font-black text-slate-400">PROFIT</span></div>
             </div>
          </section>

          {/* Cashier Leaderboard */}
          <section className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-card">
             <h3 className="font-black text-slate-900 text-lg flex items-center gap-2 mb-8">
                <Users size={20} className="text-blue-500"/> Team Performance
             </h3>
             <div className="space-y-4">
                {topCashiers.map((c, idx) => (
                   <div key={idx} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex items-center gap-4">
                         <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-sm">
                            {c.name.charAt(0)}
                         </div>
                         <div>
                            <p className="text-sm font-black text-slate-900">{c.name}</p>
                            <p className="text-[10px] font-bold text-slate-400">{c.orders} Orders processed</p>
                         </div>
                      </div>
                      <div className="text-right">
                         <p className="text-sm font-black text-blue-600">Ksh {c.revenue.toLocaleString()}</p>
                         <p className="text-[9px] font-black text-slate-400 uppercase">Total Sales</p>
                      </div>
                   </div>
                ))}
             </div>
          </section>
        </div>

        {/* Peak Hours Heatmap */}
        <section className="bg-white rounded-[40px] p-8 border border-slate-100 shadow-card">
           <h3 className="font-black text-slate-900 text-lg flex items-center gap-2 mb-8">
              <Clock size={20} className="text-orange-500"/> Traffic & Sales Heatmap (Daily Average)
           </h3>
           <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={hourlySales}>
                    <XAxis dataKey="hour" tickFormatter={(h) => `${h}:00`} axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8'}} />
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }} />
                    <Area type="monotone" dataKey="revenue" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.1} strokeWidth={3} />
                 </AreaChart>
              </ResponsiveContainer>
           </div>
        </section>

        {/* Product Pulse - Searchable Deep Dive */}
        <section className="bg-slate-900 rounded-[48px] p-10 text-white shadow-elevated overflow-hidden relative group">
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none group-hover:bg-blue-600/20 transition-all duration-700" />
          
          <div className="relative z-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 mb-12">
              <div>
                <h3 className="text-3xl font-black flex items-center gap-4 tracking-tight">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/30">
                    <Activity size={24} className="text-white"/>
                  </div>
                  Product Lifecycle Pulse
                </h3>
                <p className="text-slate-400 text-sm font-medium mt-2 max-w-md">Deep audit for individual inventory items. Select a product to begin.</p>
              </div>
              <div className="relative w-full md:w-80">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <select 
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full bg-white/10 border-2 border-white/10 hover:border-blue-500/50 rounded-[20px] pl-14 pr-6 py-4 text-sm font-black focus:outline-none appearance-none transition-all cursor-pointer"
                  value={selectedProductId || ""}
                >
                  <option value="" className="text-slate-900">Select product for deep-dive...</option>
                  {allProducts.map(p => <option key={p.id} value={p.id} className="text-slate-900">{p.name}</option>)}
                </select>
              </div>
            </div>

            {selectedProduct ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-in slide-in-from-bottom-8 duration-500">
                 <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-[32px] hover:bg-white/10 transition-all">
                    <p className="text-blue-400 text-[10px] font-black uppercase tracking-[0.2em] mb-6 flex items-center gap-2"><Layers size={12}/> Volume Sold</p>
                    <div className="flex items-baseline gap-2"><h4 className="text-5xl font-black tabular-nums">{productStats.totalQty}</h4><span className="text-sm font-bold text-slate-500">{selectedProduct.unit || 'Units'}</span></div>
                 </div>
                 <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-[32px] hover:bg-white/10 transition-all">
                    <p className="text-purple-400 text-[10px] font-black uppercase tracking-[0.2em] mb-6 flex items-center gap-2"><TrendingUp size={12}/> Revenue</p>
                    <h4 className="text-4xl font-black tabular-nums">Ksh {productStats.totalRevenue.toLocaleString()}</h4>
                 </div>
                 <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-8 rounded-[32px] hover:bg-white/10 transition-all">
                    <p className="text-orange-400 text-[10px] font-black uppercase tracking-[0.2em] mb-6 flex items-center gap-2"><Package size={12}/> Current Stock</p>
                    <h4 className={`text-4xl font-black tabular-nums ${selectedProduct.stockQuantity < 10 ? 'text-red-400' : 'text-white'}`}>{selectedProduct.stockQuantity}</h4>
                 </div>
                 <div className="bg-blue-600 p-8 rounded-[32px] shadow-lg shadow-blue-600/20 flex flex-col justify-between">
                    <div><p className="text-blue-200 text-[10px] font-black uppercase tracking-[0.2em] mb-2">Profit Contribution</p><h4 className="text-2xl font-black truncate">Ksh {(productPerf[selectedProduct.id]?.profit || 0).toLocaleString()}</h4></div>
                    <div className="text-[10px] font-black bg-white/20 px-3 py-1 rounded-full w-fit">NET MARGIN: {(( (productPerf[selectedProduct.id]?.profit || 0) / (productStats.totalRevenue || 1) ) * 100).toFixed(1)}%</div>
                 </div>
              </div>
            ) : (
              <div className="py-24 border-2 border-dashed border-white/10 rounded-[32px] flex flex-col items-center justify-center text-slate-500">
                <Box size={48} className="opacity-10 mb-4" />
                <p className="text-xs font-black uppercase tracking-widest opacity-40">Awaiting Selection</p>
              </div>
            )}
          </div>
        </section>

        {/* Overall Leaderboards */}
        <section>
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 ml-2 flex items-center gap-2">
            <BarChart3 size={14} /> Performance Leaderboard (Top 5 Products)
          </h3>
          <div className="bg-white rounded-[40px] border border-slate-100 shadow-card overflow-hidden">
             {topProducts.length > 0 ? (
               <div className="divide-y divide-slate-50">
                  {topProducts.map((p, idx) => (
                    <div key={idx} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-all group">
                      <div className="flex items-center gap-5">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${idx === 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>#{idx + 1}</div>
                        <div><p className="text-sm font-black text-slate-900">{p.name}</p><p className="text-[10px] font-bold text-slate-400">{p.qty} sold</p></div>
                      </div>
                      <p className="text-sm font-black text-slate-900">Ksh {p.revenue.toLocaleString()}</p>
                    </div>
                  ))}
               </div>
             ) : (
               <div className="py-20 text-center text-slate-300 font-bold">No data available for this range.</div>
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
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-green-50 text-green-600 border-green-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    red: "bg-red-50 text-red-600 border-red-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
  };

  return (
    <div className={`p-6 rounded-[32px] border-2 bg-white hover:shadow-lg transition-all`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${colors[color]}`}>
        {icon}
      </div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
      <h3 className="text-xl font-black text-slate-900">{unit !== '%' ? 'Ksh ' : ''}{Math.floor(value).toLocaleString()}{unit || ''}</h3>
      <p className="text-[10px] font-bold text-slate-500 mt-1 opacity-70">{subtitle}</p>
    </div>
  );
}
