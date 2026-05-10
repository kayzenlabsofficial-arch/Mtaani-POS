import React, { useState } from 'react';
import { TrendingUp, Smartphone, DollarSign, ConfirmationNumber, TrendingDown, ReceiptLong, LockOpen, Analytics, Payments, KeyboardReturn, Badge, Warning, Sync, Close } from '@mui/icons-material';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import NestedControlPanel from '../shared/NestedControlPanel';

// Mapping Material Symbols to MUI Icons (for easier React usage) or using span
const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

interface DashboardTabProps {
  setActiveTab: (tab: any) => void;
  openExpenseModal: () => void;
}

export default function DashboardTab({ setActiveTab, openExpenseModal }: DashboardTabProps) {
  const [trendView, setTrendView] = useState<'DAY' | 'WEEK'>('DAY');
  const activeBranchId = useStore(state => state.activeBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const branches = useLiveQuery(() => db.branches.toArray(), []);
  const activeBranch = branches?.find(b => b.id === activeBranchId);

  const transactions = useLiveQuery(
    () => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).reverse().limit(10).toArray() : [],
    [activeBranchId],
    []
  );

  const products = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : [],
    [activeBusinessId],
    []
  );

  const lowStockItems = products?.filter(p => (p.stockQuantity || 0) <= (p.reorderPoint || 5)).slice(0, 3) || [];

  return (
    <div className="animate-in fade-in space-y-lg pb-24">
      
      {/* Daily Sales Summary Bento Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-md flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <p className="font-mono text-label-md text-on-surface-variant mb-xs">TOTAL SALES (KSH)</p>
            <h2 className="text-3xl font-bold text-primary">142,580.00</h2>
          </div>
          <div className="mt-md flex items-center gap-xs text-secondary">
            <MaterialIcon name="trending_up" className="text-sm" />
            <span className="font-mono text-label-md">+12.4% vs yesterday</span>
          </div>
        </div>
        
        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-md flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <p className="font-mono text-label-md text-on-surface-variant mb-xs">TOTAL TRANSACTIONS</p>
            <h2 className="text-3xl font-bold text-primary">342</h2>
          </div>
          <div className="mt-md flex items-center gap-xs text-on-surface-variant">
            <MaterialIcon name="confirmation_number" className="text-sm" />
            <span className="font-mono text-label-md">Peak at 14:00 PM</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-md flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <p className="font-mono text-label-md text-on-surface-variant mb-xs">AVG. TICKET VALUE</p>
            <h2 className="text-3xl font-bold text-primary">416.90</h2>
          </div>
          <div className="mt-md flex items-center gap-xs text-error">
            <MaterialIcon name="trending_down" className="text-sm" />
            <span className="font-mono text-label-md">-2.1% vs average</span>
          </div>
        </div>
      </section>

      {/* Main Content Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-gutter">
        
        {/* Left Column: Chart & Recent */}
        <div className="lg:col-span-8 space-y-gutter">
          
          {/* Sales Performance Chart Area */}
          <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-md flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-xl">
              <h3 className="text-xl font-bold text-on-surface">Sales Performance</h3>
              <div className="flex bg-surface-container p-1 rounded-md">
                <button 
                  onClick={() => setTrendView('DAY')}
                  className={`px-md py-xs font-mono text-label-md rounded transition-all ${trendView === 'DAY' ? 'bg-white shadow-sm text-primary' : 'text-on-surface-variant hover:bg-white/50'}`}
                >
                  Today
                </button>
                <button 
                  onClick={() => setTrendView('WEEK')}
                  className={`px-md py-xs font-mono text-label-md rounded transition-all ${trendView === 'WEEK' ? 'bg-white shadow-sm text-primary' : 'text-on-surface-variant hover:bg-white/50'}`}
                >
                  Weekly
                </button>
              </div>
            </div>
            
            <div className="flex-grow">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[
                    { time: '08:00', val: 4000 },
                    { time: '10:00', val: 3000 },
                    { time: '12:00', val: 9000 },
                    { time: '14:00', val: 12000 },
                    { time: '16:00', val: 8000 },
                    { time: '18:00', val: 15000 },
                    { time: '20:00', val: 11000 },
                    { time: '22:00', val: 5000 },
                  ]}>
                    <defs>
                      <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0052cc" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#0052cc" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e8ff" />
                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill: '#737685', fontSize: 10}} dy={10} />
                    <YAxis hide />
                    <Tooltip 
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      labelStyle={{ fontWeight: 'bold', color: '#003d9b' }}
                    />
                    <Area type="monotone" dataKey="val" stroke="#003d9b" strokeWidth={3} fillOpacity={1} fill="url(#colorVal)" />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-md overflow-hidden">
            <div className="px-lg py-md border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
              <h3 className="text-base font-bold text-on-surface">Recent Transactions</h3>
              <button onClick={() => setActiveTab('DOCUMENTS')} className="font-mono text-label-md text-primary hover:underline">View All</button>
            </div>
            <div className="divide-y divide-outline-variant">
              {transactions?.map((tx, idx) => (
                <div key={tx.id} className="px-lg py-md flex items-center justify-between hover:bg-surface-container-low transition-colors group">
                  <div className="flex items-center gap-md">
                    <div className="w-10 h-10 rounded-md bg-surface-container flex items-center justify-center group-hover:bg-primary-container group-hover:text-white transition-colors">
                      <MaterialIcon name="receipt_long" className="text-on-surface-variant group-hover:text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-on-surface">#{tx.id.slice(-8).toUpperCase()}</p>
                      <p className="font-mono text-[10px] text-on-surface-variant uppercase">
                        {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {tx.items.length} ITEMS
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-on-surface">{tx.total.toLocaleString()}</p>
                    <span className={`px-sm py-[2px] text-[10px] font-mono rounded-full ${tx.status === 'PAID' ? 'bg-secondary-container text-on-secondary-container' : 'bg-error-container text-on-error-container'}`}>
                      {tx.status}
                    </span>
                  </div>
                </div>
              ))}
              {(!transactions || transactions.length === 0) && (
                <div className="p-8 text-center text-on-surface-variant font-mono text-label-md">No recent activity</div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Actions & Alerts */}
        <div className="lg:col-span-4 space-y-gutter">
          
          {/* Quick Actions Grid Area */}
          <div className="bg-surface-container-lowest border border-outline-variant p-lg rounded-md">
            <h3 className="text-base font-bold text-on-surface mb-lg">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-md">
              <button 
                onClick={() => setActiveTab('REGISTER')}
                className="flex flex-col items-center justify-center p-md bg-surface-container-low border border-outline-variant rounded-md hover:bg-primary-container hover:text-white group transition-all duration-200"
              >
                <MaterialIcon name="point_of_sale" className="mb-sm text-primary group-hover:text-white" />
                <span className="font-mono text-label-md">New Sale</span>
              </button>
              <button 
                onClick={() => setActiveTab('REPORTS')}
                className="flex flex-col items-center justify-center p-md bg-surface-container-low border border-outline-variant rounded-md hover:bg-primary-container hover:text-white group transition-all duration-200"
              >
                <MaterialIcon name="analytics" className="mb-sm text-primary group-hover:text-white" />
                <span className="font-mono text-label-md">Reports</span>
              </button>
              <button 
                onClick={openExpenseModal}
                className="flex flex-col items-center justify-center p-md bg-surface-container-low border border-outline-variant rounded-md hover:bg-primary-container hover:text-white group transition-all duration-200"
              >
                <MaterialIcon name="payments" className="mb-sm text-primary group-hover:text-white" />
                <span className="font-mono text-label-md">Expenses</span>
              </button>
              <button 
                onClick={() => setActiveTab('REFUNDS')}
                className="flex flex-col items-center justify-center p-md bg-surface-container-low border border-outline-variant rounded-md hover:bg-primary-container hover:text-white group transition-all duration-200"
              >
                <MaterialIcon name="keyboard_return" className="mb-sm text-primary group-hover:text-white" />
                <span className="font-mono text-label-md">Refunds</span>
              </button>
            </div>
          </div>

          {/* Active Register Info */}
          <div className="bg-primary text-on-primary p-lg rounded-md space-y-md shadow-lg">
            <div className="flex justify-between items-start">
              <div>
                <p className="font-mono text-[10px] opacity-80 uppercase tracking-widest">Active Station</p>
                <h4 className="text-xl font-bold">{activeBranch?.name || 'Main Hub'}</h4>
              </div>
              <MaterialIcon name="badge" className="text-white/80" />
            </div>
            <div className="pt-md border-t border-white/20">
              <div className="flex justify-between text-xs font-mono">
                <span className="opacity-80">Cashier:</span>
                <span className="">{currentUser?.name}</span>
              </div>
              <div className="flex justify-between text-xs font-mono mt-xs">
                <span className="opacity-80">Terminal:</span>
                <span className="">TRM-001</span>
              </div>
            </div>
            <button className="w-full py-sm bg-white text-primary rounded-md font-mono text-label-md hover:bg-opacity-90 transition-all active:scale-95 font-bold">
              System Audit
            </button>
          </div>

          {/* Inventory Alert */}
          <div className="bg-error-container text-on-error-container p-lg rounded-md border border-error/10">
            <div className="flex items-center gap-sm mb-xs">
              <MaterialIcon name="warning" className="text-error" />
              <h4 className="text-sm font-bold">Inventory Alerts</h4>
            </div>
            <p className="text-xs mb-md opacity-90 font-medium">Critical stock levels detected in {activeBranch?.name}.</p>
            <ul className="space-y-xs font-mono text-[11px]">
              {lowStockItems.map(item => (
                <li key={item.id} className="flex justify-between border-b border-error/5 pb-xs">
                  <span className="truncate mr-4">{item.name}</span> 
                  <span className="font-bold text-error">{item.stockQuantity} Left</span>
                </li>
              ))}
              {lowStockItems.length === 0 && <li className="text-center py-2 opacity-50">All stock levels optimal</li>}
            </ul>
          </div>

        </div>
      </section>
    </div>
  );
}
