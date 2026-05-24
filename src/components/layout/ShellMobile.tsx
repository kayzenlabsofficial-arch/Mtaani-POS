import React from 'react';
import {
  BarChart3,
  CircleDollarSign,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  Package,
  Plus,
  ReceiptText,
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
import MobileModal from '../shared/MobileModal';

const MaterialIcon = ({ name, className = '', style = {} }: { name: string; className?: string; style?: any }) => {
  const icons: Record<string, React.ElementType> = {
    add_shopping_cart: ShoppingCart,
    add: Plus,
    admin_panel_settings: ShieldCheck,
    analytics: BarChart3,
    badge: UserRound,
    dashboard: LayoutDashboard,
    group: Users,
    inventory_2: Package,
    keyboard_return: RotateCcw,
    local_shipping: Truck,
    logout: LogOut,
    more_horiz: MoreHorizontal,
    payments: CircleDollarSign,
    point_of_sale: ShoppingCart,
    receipt_long: ReceiptText,
    settings: Settings,
    shopping_bag: ShoppingBag,
    store: Store,
    storefront: Store,
    sync: RefreshCw,
  };
  const Icon = icons[name] || MoreHorizontal;
  const { fontSize, ...rest } = style || {};
  const size = typeof fontSize === 'number' ? fontSize : Number.parseInt(String(fontSize || 20), 10);
  return <Icon className={className} style={rest} size={Number.isFinite(size) ? size : 20} strokeWidth={2.4} />;
};

export function TopHeaderMobile({
  activeBusiness,
  activeShop,
  isSyncing,
  onSync,
  isOnline,
  onOpenProfile,
  currentUser,
}: any) {
  const shopName = String(activeShop?.name || 'Main shop');

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <div className="flex h-14 w-full items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-white shadow-sm">
            <MaterialIcon name="storefront" style={{ fontSize: '19px' }} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[11px] font-black uppercase leading-none tracking-widest text-slate-900">
              {activeBusiness?.name || 'Mtaani POS'}
            </span>
            <span className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
              {shopName}
            </span>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`}
            aria-label={isOnline ? 'Online' : 'Offline'}
          />
          <button
            onClick={onSync}
            className={`flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-all active:scale-95 ${isSyncing ? 'animate-pulse border-primary/30 bg-primary/5 text-primary' : ''}`}
            title="Sync data"
          >
            <MaterialIcon name="sync" className={isSyncing ? 'animate-spin' : ''} style={{ fontSize: '20px' }} />
          </button>
          <button
            onClick={onOpenProfile}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-[10px] font-black text-white"
            aria-label="Open profile"
          >
            {currentUser?.name?.charAt(0)?.toUpperCase()}
          </button>
        </div>
      </div>
    </header>
  );
}

export function MobileNav({ activeTab, onTabChange, onToggleMore, isMoreMenuOpen }: any) {
  const tabs = [
    { id: 'DASHBOARD', label: 'Dash', icon: 'dashboard' },
    { id: 'REGISTER', label: 'Sale', icon: 'point_of_sale' },
    { id: 'TILLS', label: 'Tills', icon: 'store' },
    { id: 'INVENTORY', label: 'Stock', icon: 'inventory_2' },
    { id: 'MORE', label: 'More', icon: 'more_horiz' },
  ];

  return (
    <nav className="keyboard-hide-when-open fixed bottom-0 left-0 z-50 w-full">
      <div className="border-t border-slate-200 bg-white/95 px-4 pb-safe backdrop-blur-xl">
        <div className="flex h-16 items-center justify-around">
          {tabs.map((item) => {
            const isActive = (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen);
            return (
              <button
                key={item.id}
                onClick={() => { if (item.id === 'MORE') onToggleMore(true); else onTabChange(item.id as any); }}
                className="relative flex h-12 min-w-[60px] flex-col items-center justify-center gap-1 rounded-2xl transition-all duration-200"
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${isActive ? 'bg-primary shadow-lg shadow-primary/25' : ''}`}>
                  <MaterialIcon
                    name={item.icon}
                    className={isActive ? 'text-white' : 'text-slate-500'}
                    style={{ fontSize: '22px' }}
                  />
                </div>
                <span className={`text-[9px] font-bold uppercase leading-none tracking-tight ${isActive ? 'text-primary' : 'text-slate-400'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

export function MoreOptionsMenu({ onTabChange, onLogout, onClose, currentUser }: any) {
  const role = currentUser?.role;
  const isAdmin = role === 'ADMIN';
  const isAdminOrManager = role === 'ADMIN' || role === 'MANAGER';
  const quickAccess = [
    { id: 'TILLS', label: 'Tills', icon: 'store', color: 'bg-blue-600' },
    { id: 'CUSTOMERS', label: 'Customers', icon: 'group', color: 'bg-blue-500' },
    { id: 'INVOICES', label: 'Invoices', icon: 'receipt_long', color: 'bg-cyan-600' },
    { id: 'EXPENSES', label: 'Expenses', icon: 'payments', color: 'bg-rose-500' },
    { id: 'REFUNDS', label: 'Returns', icon: 'keyboard_return', color: 'bg-amber-500' },
    { id: 'DOCUMENTS', label: 'Receipts', icon: 'receipt_long', color: 'bg-violet-500' },
  ];
  const management = [
    { id: 'SUPPLIERS', label: 'Suppliers', icon: 'local_shipping', color: 'bg-teal-500' },
    { id: 'PURCHASES', label: 'LPOs', icon: 'shopping_bag', color: 'bg-indigo-500' },
    { id: 'HR', label: 'HR', icon: 'badge', color: 'bg-sky-600' },
    { id: 'REPORTS', label: 'Reports', icon: 'analytics', color: 'bg-emerald-500' },
    { id: 'SETTINGS', label: 'Settings', icon: 'settings', color: 'bg-slate-600' },
    { id: 'ADMIN_PANEL', label: 'Admin', icon: 'admin_panel_settings', color: 'bg-slate-800' },
  ].filter(item => {
    if (item.id === 'ADMIN_PANEL' || item.id === 'SETTINGS') return isAdmin;
    if (item.id === 'SUPPLIERS' || item.id === 'REPORTS' || item.id === 'HR') return isAdminOrManager;
    return true;
  });

  return (
    <MobileModal
      onClose={onClose}
      zIndexClassName="z-[100]"
      size="full"
      panelClassName="rounded-t-[2rem] border-0"
      bodyClassName="px-5 pb-8"
      footerClassName="px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-4"
      header={(
        <div className="flex flex-shrink-0 justify-center pb-2 pt-4">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
      )}
      footer={(
        <button
          onClick={onLogout}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-rose-100 bg-rose-50 py-4 text-sm font-bold text-rose-600 transition-all hover:border-rose-600 hover:bg-rose-600 hover:text-white active:scale-[0.98]"
        >
          <MaterialIcon name="logout" style={{ fontSize: '18px' }} />
          Sign out
        </button>
      )}
    >
          <div className="mb-6">
            <p className="mb-3 ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Quick access</p>
            <div className="grid grid-cols-4 gap-3">
              {quickAccess.map(item => (
                <button
                  key={item.id}
                  onClick={() => { onTabChange(item.id); onClose(); }}
                  className="group flex flex-col items-center gap-2"
                >
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${item.color} shadow-lg transition-transform group-hover:scale-105`}>
                    <MaterialIcon name={item.icon} className="text-white" style={{ fontSize: '24px' }} />
                  </div>
                  <span className="text-center text-[9px] font-bold uppercase tracking-tight text-slate-500">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <p className="mb-3 ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Management</p>
            <div className="grid grid-cols-4 gap-3">
              {management.map(item => (
                <button
                  key={item.id}
                  onClick={() => { onTabChange(item.id); onClose(); }}
                  className="group flex flex-col items-center gap-2"
                >
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${item.color} shadow-lg transition-transform group-hover:scale-105`}>
                    <MaterialIcon name={item.icon} className="text-white" style={{ fontSize: '24px' }} />
                  </div>
                  <span className="text-center text-[9px] font-bold uppercase tracking-tight text-slate-500">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
    </MobileModal>
  );
}

export function MobileRegisterFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="keyboard-hide-when-open fixed bottom-24 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-2xl transition-transform active:scale-90"
      aria-label="Open register"
    >
      <MaterialIcon name="add_shopping_cart" style={{ fontSize: '28px' }} />
    </button>
  );
}
