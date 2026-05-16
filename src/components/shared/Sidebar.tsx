import React from 'react';
import {
  BarChart3,
  ChevronRight,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  LogOut,
  Package,
  RefreshCw,
  RotateCcw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Users,
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

const navGroups: Array<{
  id: string;
  label: string;
  items: Array<{
    id: string;
    label: string;
    icon: React.ElementType;
    desc: string;
    accent: string;
    adminOnly?: boolean;
  }>;
}> = [
  {
    id: 'ops',
    label: 'Operate',
    items: [
      { id: 'REGISTER', label: 'Register', icon: ShoppingCart, desc: 'Checkout desk', accent: 'text-blue-600 bg-blue-50 border-blue-100' },
      { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard, desc: 'Daily pulse', accent: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
      { id: 'CUSTOMERS', label: 'Customers', icon: Users, desc: 'Credit and CRM', accent: 'text-violet-600 bg-violet-50 border-violet-100' },
      { id: 'INVOICES', label: 'Invoices', icon: FileText, desc: 'Bills and services', accent: 'text-blue-700 bg-blue-50 border-blue-100' },
    ],
  },
  {
    id: 'stock',
    label: 'Stockroom',
    items: [
      { id: 'INVENTORY', label: 'Inventory', icon: Package, desc: 'Products and stock', accent: 'text-slate-700 bg-slate-100 border-slate-200' },
      { id: 'SUPPLIERS', label: 'Suppliers', icon: Truck, desc: 'Supplier list', accent: 'text-cyan-700 bg-cyan-50 border-cyan-100', adminOnly: true },
      { id: 'PURCHASES', label: 'Purchases', icon: ShoppingBag, desc: 'Orders and goods', accent: 'text-amber-700 bg-amber-50 border-amber-100' },
    ],
  },
  {
    id: 'finance',
    label: 'Money',
    items: [
      { id: 'EXPENSES', label: 'Expenses', icon: CircleDollarSign, desc: 'Money spent', accent: 'text-rose-600 bg-rose-50 border-rose-100' },
      { id: 'REFUNDS', label: 'Refunds', icon: RotateCcw, desc: 'Returns queue', accent: 'text-orange-700 bg-orange-50 border-orange-100' },
      { id: 'REPORTS', label: 'Reports', icon: BarChart3, desc: 'Performance', accent: 'text-indigo-600 bg-indigo-50 border-indigo-100', adminOnly: true },
      { id: 'DOCUMENTS', label: 'Documents', icon: FileText, desc: 'Receipts', accent: 'text-teal-700 bg-teal-50 border-teal-100' },
    ],
  },
  {
    id: 'system',
    label: 'Control',
    items: [
      { id: 'ADMIN_PANEL', label: 'Admin Panel', icon: Settings, desc: 'Users and policy', accent: 'text-slate-800 bg-slate-100 border-slate-200', adminOnly: true },
    ],
  },
];

export default function Sidebar({
  activeTab,
  onTabChange,
  onLogout,
  onSync,
  isSyncing,
  currentUser,
  onOpenProfile,
}: SidebarProps) {
  const isAdminOrManager = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';
  const userInitial = currentUser?.name?.charAt(0)?.toUpperCase() || 'U';

  return (
    <aside className="hidden md:flex w-[248px] h-full flex-shrink-0 border-r border-slate-200 bg-slate-50/95">
      <div className="flex h-full w-full flex-col p-3">
        <button
          type="button"
          onClick={() => onTabChange('DASHBOARD')}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white">
            <Store size={20} />
          </span>
          <span className="min-w-0">
            <span className="block stable-title text-sm font-black leading-none text-slate-950">Mtaani POS</span>
            <span className="mt-1 block stable-title text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Fast retail desk
            </span>
          </span>
        </button>

        <nav className="mt-4 flex-1 overflow-y-auto pr-1 custom-scrollbar">
          {navGroups.map(group => {
            const visibleItems = group.items.filter(item => !item.adminOnly || isAdminOrManager);
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.id} className="mb-5">
                <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {visibleItems.map(item => {
                    const Icon = item.icon;
                    const isActive = activeTab === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onTabChange(item.id)}
                        className={`relative w-full rounded-xl border px-2.5 py-2.5 text-left transition-all ${
                          isActive
                            ? 'border-slate-900 bg-slate-950 text-white shadow-lg shadow-slate-950/10'
                            : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-950'
                        }`}
                      >
                        <span className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2">
                          <span
                            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-all ${
                              isActive ? 'border-white/10 bg-white/10 text-white' : item.accent
                            }`}
                          >
                            <Icon size={18} />
                          </span>
                          <span className="min-w-0">
                            <span className="block stable-title text-[13px] font-black leading-tight">{item.label}</span>
                            <span className={`mt-0.5 block stable-title text-[10px] font-bold ${isActive ? 'text-white/55' : 'text-slate-400'}`}>
                              {item.desc}
                            </span>
                          </span>
                          <ChevronRight size={15} className={isActive ? 'text-white/70' : 'text-slate-300'} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <button
            type="button"
            onClick={onOpenProfile}
            className="mb-2 grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 text-left transition-all hover:border-primary/30"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-xs font-black text-white">
              {userInitial}
            </span>
            <span className="min-w-0">
              <span className="block stable-title text-[12px] font-black text-slate-900">{currentUser?.name || 'Current user'}</span>
              <span className="mt-0.5 block stable-title text-[9px] font-black uppercase tracking-widest text-slate-400">
                {currentUser?.role || 'Staff'}
              </span>
            </span>
            <ChevronRight size={15} className="text-slate-300" />
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSync}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                isSyncing
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-primary/30 hover:text-primary'
              }`}
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              Sync
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition-all hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            >
              <LogOut size={14} />
              Exit
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
