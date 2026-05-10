import React, { useState } from 'react';
import { 
  ShoppingCart, LayoutDashboard, Package, Truck, Grid, 
  Users, FileMinus, RotateCcw, ClipboardList, DollarSign, 
  BarChart3, FileText, ShieldCheck, LogOut, RotateCw,
  ChevronDown, ChevronRight, Settings, Briefcase, BarChart, Wallet, ShoppingBag
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  onLogout: () => void;
  onSync: () => void;
  isSyncing: boolean;
  currentUser: any;
  onOpenProfile: () => void;
}

export default function Sidebar({ 
  activeTab, 
  onTabChange, 
  onLogout, 
  onSync, 
  isSyncing,
  currentUser,
  onOpenProfile
}: SidebarProps) {
  const isAdminOrManager = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    operations: true,
    inventory: true,
    finance: false,
    admin: false
  });

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const groups = [
    {
      id: 'operations',
      label: 'Operations',
      icon: ShoppingBag,
      items: [
        { id: 'REGISTER', label: 'Register (POS)', icon: ShoppingCart },
        { id: 'REFUNDS', label: 'Refunds & Returns', icon: RotateCcw },
        { id: 'CUSTOMERS', label: 'Customer Directory', icon: Users },
      ]
    },
    {
      id: 'inventory',
      label: 'Inventory',
      icon: Package,
      items: [
        { id: 'INVENTORY', label: 'Stock Manager', icon: Package },
        { id: 'SUPPLIERS', label: 'Supplier List', icon: Truck, hidden: !isAdminOrManager },
        { id: 'PURCHASES', label: 'Purchase Orders', icon: ClipboardList },
      ]
    },
    {
      id: 'finance',
      label: 'Finance & Analysis',
      icon: Wallet,
      items: [
        { id: 'DASHBOARD', label: 'Analytics Hub', icon: LayoutDashboard, hidden: !isAdminOrManager && currentUser?.role !== 'CASHIER' },
        { id: 'EXPENSES', label: 'Expense Tracker', icon: FileMinus },
        { id: 'SUPPLIER_PAYMENTS', label: 'Supplier Payments', icon: DollarSign, hidden: !isAdminOrManager },
        { id: 'REPORTS', label: 'Sales Reports', icon: BarChart3, hidden: !isAdminOrManager },
        { id: 'DOCUMENTS', label: 'Digital Records', icon: FileText },
      ]
    },
    {
      id: 'admin',
      label: 'Administration',
      icon: ShieldCheck,
      hidden: !isAdminOrManager,
      items: [
        { id: 'ADMIN_PANEL', label: 'System Settings', icon: Settings },
      ]
    }
  ];

  return (
    <aside className="hidden lg:flex flex-col w-72 bg-slate-950 text-slate-300 border-r border-slate-900 h-full shrink-0">
      <div className="p-8 flex items-center gap-4 border-b border-slate-900/50 mb-4">
        <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center shadow-blue ring-4 ring-blue-600/10">
          <ShoppingCart size={24} className="text-white" />
        </div>
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Mtaani POS</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Enterprise v2.4</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 pb-6">
        <nav className="space-y-6">
          {groups.filter(g => !g.hidden).map((group) => (
            <div key={group.id} className="space-y-2">
              <button 
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] hover:text-slate-300 transition-colors"
              >
                <div className="flex items-center gap-2">
                   <group.icon size={12} />
                   {group.label}
                </div>
                {expandedGroups[group.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              
              {expandedGroups[group.id] && (
                <div className="space-y-1 animate-in slide-in-from-top-1 duration-200">
                  {group.items.filter(item => !item.hidden).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all relative group ${
                        activeTab === item.id
                          ? 'bg-blue-600/10 text-blue-500 shadow-sm border border-blue-600/20'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border border-transparent'
                      }`}
                    >
                      <item.icon size={18} className={activeTab === item.id ? 'text-blue-500' : 'text-slate-500 group-hover:text-slate-300 transition-colors'} />
                      <span className="flex-1 text-left">{item.label}</span>
                      {activeTab === item.id && (
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="p-6 bg-slate-900/40 border-t border-slate-900 mt-auto">
        <div 
          onClick={onOpenProfile}
          className="p-4 bg-slate-950/50 rounded-2xl border border-slate-800 cursor-pointer hover:border-slate-700 hover:bg-slate-950 transition-all group mb-4"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 grad-slate rounded-xl flex items-center justify-center border border-slate-800 text-slate-400 group-hover:border-blue-500/30 group-hover:text-blue-400 transition-all">
              <ShieldCheck size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-white truncate">{currentUser?.name}</p>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">{currentUser?.role}</p>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onSync(); }}
            disabled={isSyncing}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              isSyncing 
                ? 'bg-blue-600/20 text-blue-500 border border-blue-600/20' 
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
            }`}
          >
            <RotateCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing Data' : 'Sync Cloud'}
          </button>
        </div>

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-rose-500 hover:bg-rose-500/10 hover:text-rose-400 transition-all"
        >
          <LogOut size={18} />
          Sign Out System
        </button>
      </div>
    </aside>
  );
}
