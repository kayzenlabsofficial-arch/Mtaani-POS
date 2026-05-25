import React from 'react';
import {
  BarChart3,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  Landmark,
  LogOut,
  Package,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import { canOpenTab } from '../../utils/accessControl';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  onLogout: () => void;
  onSync: () => void;
  isSyncing: boolean;
  currentUser: any;
  businessSettings?: any;
  onOpenProfile: () => void;
}

const navItems: Array<{
  id: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  managerAllowed?: boolean;
}> = [
  { id: 'DASHBOARD', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'REGISTER', label: 'Register', icon: ShoppingCart },
  { id: 'TILLS', label: 'Tills', icon: Store },
  { id: 'CUSTOMERS', label: 'Customers', icon: Users },
  { id: 'INVOICES', label: 'Invoices', icon: FileText },
  { id: 'INVENTORY', label: 'Inventory', icon: Package },
  { id: 'SUPPLIERS', label: 'Suppliers', icon: Truck, adminOnly: true, managerAllowed: true },
  { id: 'PURCHASES', label: 'Purchases', icon: ShoppingBag },
  { id: 'EXPENSES', label: 'Expenses', icon: CircleDollarSign },
  { id: 'MAIN_ACCOUNT', label: 'Main account', icon: Landmark },
  { id: 'REFUNDS', label: 'Refunds', icon: RotateCcw },
  { id: 'REPORTS', label: 'Reports', icon: BarChart3, adminOnly: true, managerAllowed: true },
  { id: 'DOCUMENTS', label: 'Documents', icon: FileText },
  { id: 'HR', label: 'HR', icon: UserRound, adminOnly: true, managerAllowed: true },
  { id: 'SETTINGS', label: 'Settings', icon: Settings, adminOnly: true },
  { id: 'ADMIN_PANEL', label: 'Admin', icon: ShieldCheck, adminOnly: true },
];

export default function SidebarDesktop({
  activeTab,
  onTabChange,
  onLogout,
  onSync,
  isSyncing,
  currentUser,
  businessSettings,
  onOpenProfile,
}: SidebarProps) {
  const isAdmin = currentUser?.role === 'ADMIN';
  const userInitial = currentUser?.name?.charAt(0)?.toUpperCase() || 'U';
  const visibleItems = navItems.filter(item => {
    if (item.id === 'ADMIN_PANEL' || item.id === 'SETTINGS') return isAdmin;
    return canOpenTab(currentUser, businessSettings, item.id);
  });

  return (
    <aside className="flex h-full w-[248px] flex-shrink-0 bg-slate-950 text-white shadow-2xl shadow-slate-950/20">
      <div className="flex h-full w-full flex-col px-3 py-4">
        <button
          type="button"
          onClick={() => onTabChange('DASHBOARD')}
          className="mb-6 text-left"
        >
          <span className="block text-xl font-black leading-tight text-white">Smart POS</span>
          <span className="mt-1 block text-xs font-semibold text-blue-200/70">Fast retail desk</span>
        </button>

        <nav className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
          <div className="space-y-1">
            {visibleItems.map(item => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  className={`flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold transition-all ${
                    isActive
                      ? 'bg-white/12 text-white shadow-inner'
                      : 'text-blue-100/75 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <Icon size={19} className={isActive ? 'text-white' : 'text-blue-200/80'} />
                  <span className="stable-title">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="mt-3 border-t border-white/10 pt-3">
          <button
            type="button"
            onClick={onOpenProfile}
            className="mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-all hover:bg-white/8"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-xs font-black text-slate-950">
              {userInitial}
            </span>
            <span className="min-w-0">
              <span className="block stable-title text-sm font-bold text-white">{currentUser?.name || 'Current user'}</span>
              <span className="mt-0.5 block stable-title text-[11px] font-semibold text-blue-100/60">
                {currentUser?.role === 'ADMIN' ? 'Admin' : currentUser?.role === 'CASHIER' ? 'Cashier' : currentUser?.role || 'Staff'}
              </span>
            </span>
          </button>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onSync}
              className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-[10px] font-black uppercase tracking-widest transition-all ${
                isSyncing
                  ? 'border-white/25 bg-white/15 text-white'
                  : 'border-white/10 bg-white/5 text-blue-100/75 hover:bg-white hover:text-slate-950'
              }`}
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
              Sync
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-[10px] font-black uppercase tracking-widest text-blue-100/75 transition-all hover:bg-white hover:text-rose-600"
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

