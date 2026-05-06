import React from 'react';
import { 
  ShoppingCart, LayoutDashboard, Package, Truck, Grid, 
  Users, FileMinus, RotateCcw, ClipboardList, DollarSign, 
  BarChart3, FileText, ShieldCheck, LogOut, RotateCw
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

  const menuItems = [
    { id: 'REGISTER', label: 'Register', icon: ShoppingCart },
    { id: 'DASHBOARD', label: 'Overview', icon: LayoutDashboard, hidden: !isAdminOrManager && currentUser?.role !== 'CASHIER' },
    { id: 'INVENTORY', label: 'Inventory', icon: Package },
    { id: 'SUPPLIERS', label: 'Suppliers', icon: Truck, hidden: !isAdminOrManager },
    { id: 'CUSTOMERS', label: 'Customers', icon: Users },
    { id: 'EXPENSES', label: 'Expenses', icon: FileMinus },
    { id: 'REFUNDS', label: 'Refunds', icon: RotateCcw },
    { id: 'PURCHASES', label: 'LPOs', icon: ClipboardList },
    { id: 'SUPPLIER_PAYMENTS', label: 'Payments', icon: DollarSign, hidden: !isAdminOrManager },
    { id: 'REPORTS', label: 'Reports', icon: BarChart3, hidden: !isAdminOrManager },
    { id: 'DOCUMENTS', label: 'Records', icon: FileText },
    { id: 'ADMIN_PANEL', label: 'Admin', icon: ShieldCheck, hidden: !isAdminOrManager },
  ];

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-slate-900 text-white border-r border-slate-800 h-full shrink-0">
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/40">
            <ShoppingCart size={24} className="text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-none">Mtaani POS</h2>
            <p className="text-[10px] font-medium text-slate-400 mt-1">Version 2.4</p>
          </div>
        </div>

        <nav className="space-y-1">
          {menuItems.filter(item => !item.hidden).map((item) => (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                activeTab === item.id
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <div 
          onClick={onOpenProfile}
          className="p-4 bg-white/5 rounded-2xl border border-white/10 cursor-pointer hover:bg-white/10 transition-all group"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center border border-white/10 group-hover:border-blue-500 group-hover:text-blue-500 transition-colors">
              <ShieldCheck size={16} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-white truncate">{currentUser?.name}</p>
              <p className="text-[10px] font-medium text-slate-400 capitalize">{currentUser?.role?.toLowerCase()}</p>
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onSync(); }}
            disabled={isSyncing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/10 border border-white/10 text-white text-[10px] font-bold hover:bg-white/20 transition-all disabled:opacity-50"
          >
            <RotateCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync cloud'}
          </button>
        </div>

        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold text-red-400 hover:bg-red-400/10 transition-all"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
