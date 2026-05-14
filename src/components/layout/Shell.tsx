import React, { useState } from 'react';
import {
  BarChart3,
  Check,
  ChevronDown,
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
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Users,
} from 'lucide-react';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: any }) => (
  (() => {
    const icons: Record<string, React.ElementType> = {
      storefront: Store,
      store: Store,
      expand_more: ChevronDown,
      check: Check,
      sync: RefreshCw,
      dashboard: LayoutDashboard,
      point_of_sale: ShoppingCart,
      inventory_2: Package,
      more_horiz: MoreHorizontal,
      group: Users,
      payments: CircleDollarSign,
      keyboard_return: RotateCcw,
      receipt_long: ReceiptText,
      local_shipping: Truck,
      shopping_bag: ShoppingBag,
      analytics: BarChart3,
      settings: Settings,
      logout: LogOut,
      add_shopping_cart: ShoppingCart,
      add: Plus,
    };
    const Icon = icons[name] || MoreHorizontal;
    const { fontSize, fontVariationSettings, ...rest } = style || {};
    const size = typeof fontSize === 'number' ? fontSize : Number.parseInt(String(fontSize || 20), 10);
    return <Icon className={className} style={rest} size={Number.isFinite(size) ? size : 20} strokeWidth={2.4} />;
  })()
);

export function TopHeader({ 
  activeBusiness, 
  activeBranch, 
  branches, 
  onBranchChange, 
  isSyncing, 
  onSync, 
  isOnline, 
  onOpenProfile,
  currentUser
}: any) {
  const isAdmin = currentUser?.role === 'ADMIN';
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);

  return (
    <header className="w-full top-0 sticky z-50 bg-white/95 backdrop-blur-xl border-b border-slate-200/80">
       <div className="flex items-center justify-between gap-3 px-3 sm:px-4 md:px-6 h-14 md:h-16 w-full">
          
          {/* Left: Identity */}
          <div className="flex items-center gap-3 min-w-0">
             <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl bg-slate-950 text-white border border-slate-800 flex items-center justify-center flex-shrink-0 shadow-sm">
               <MaterialIcon name="storefront" style={{ fontSize: '20px' }} />
             </div>
             
             <div className="flex flex-col min-w-0">
               <span className="text-[11px] md:text-xs font-black text-slate-900 uppercase tracking-widest leading-none truncate">
                 {activeBusiness?.name || 'Mtaani POS'}
               </span>
               
               {isAdmin && branches?.length > 1 ? (
                 <div className="relative">
                   <button
                     onClick={() => setBranchDropdownOpen(v => !v)}
                     className="flex items-center gap-1 mt-0.5 group max-w-full"
                   >
                     <span className="text-[10px] font-bold text-primary truncate">
                       {activeBranch?.name || 'Select Branch'}
                     </span>
                     <MaterialIcon 
                       name="expand_more" 
                       className={`text-primary transition-transform duration-200 ${branchDropdownOpen ? 'rotate-180' : ''}`}
                       style={{ fontSize: '14px' }} 
                     />
                   </button>
                   
                   {branchDropdownOpen && (
                     <>
                       <div className="fixed inset-0 z-40" onClick={() => setBranchDropdownOpen(false)} />
                       <div className="absolute top-full left-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 min-w-[200px] overflow-hidden">
                         <div className="p-2">
                           <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-3 py-2">Switch Branch</p>
                           {branches.map((b: any) => (
                             <button
                               key={b.id}
                               onClick={() => { onBranchChange(b.id); setBranchDropdownOpen(false); }}
                               className={`w-full grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${activeBranch?.id === b.id ? 'bg-primary text-white' : 'hover:bg-slate-50 text-slate-800'}`}
                             >
                               <MaterialIcon name="store" style={{ fontSize: '16px' }} />
                               <span className="text-[11px] font-bold stable-title">{b.name}</span>
                               {activeBranch?.id === b.id && <MaterialIcon name="check" className="ml-auto" style={{ fontSize: '14px' }} />}
                             </button>
                           ))}
                         </div>
                       </div>
                     </>
                   )}
                 </div>
               ) : (
                 <span className="text-[10px] font-semibold text-slate-500 truncate mt-0.5">
                   {activeBranch?.name || 'Main Shop'}
                 </span>
               )}
             </div>
          </div>

          {/* Right: Status & Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
             {/* Online/Offline pill */}
             <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-widest transition-colors ${isOnline ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                {isOnline ? 'Online' : 'Offline'}
             </div>

             {/* Sync button */}
             <button 
               onClick={onSync}
               className={`w-10 h-10 rounded-xl border border-slate-200 text-slate-600 hover:border-primary/30 hover:text-primary hover:bg-primary/5 transition-all active:scale-95 flex items-center justify-center ${isSyncing ? 'animate-pulse text-primary border-primary/30 bg-primary/5' : ''}`}
               title="Sync data"
             >
                <MaterialIcon name="sync" className={isSyncing ? 'animate-spin' : ''} style={{ fontSize: '20px' }} />
             </button>

             {/* User chip */}
             <button onClick={onOpenProfile} className="hidden md:flex items-center gap-2 pl-2 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-white hover:border-primary/30 transition-all text-left">
               <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center text-white text-[10px] font-black flex-shrink-0">
                 {currentUser?.name?.charAt(0)?.toUpperCase()}
               </div>
               <div className="flex flex-col leading-none min-w-0">
                 <span className="text-[11px] font-bold text-slate-800 stable-title max-w-32">{currentUser?.name}</span>
                 <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{currentUser?.role}</span>
               </div>
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
    { id: 'INVENTORY', label: 'Stock', icon: 'inventory_2' },
    { id: 'MORE', label: 'More', icon: 'more_horiz' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 w-full md:hidden z-50">
      <div className="bg-white/95 backdrop-blur-xl border-t border-slate-200 px-4 pb-safe">
        <div className="flex justify-around items-center h-16">
          {tabs.map((item) => {
            const isActive = (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen);
            return (
              <button 
                key={item.id} 
                onClick={() => { if (item.id === 'MORE') onToggleMore(true); else onTabChange(item.id as any); }} 
                className="flex flex-col items-center justify-center gap-1 min-w-[60px] h-12 rounded-2xl transition-all duration-200 relative"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 ${isActive ? 'bg-primary shadow-lg shadow-primary/25' : ''}`}>
                  <MaterialIcon 
                    name={item.icon} 
                    className={isActive ? 'text-white' : 'text-slate-500'}
                    style={{ 
                      fontSize: '22px',
                      fontVariationSettings: isActive ? "'FILL' 1" : "'FILL' 0"
                    }} 
                  />
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-tight leading-none ${isActive ? 'text-primary' : 'text-slate-400'}`}>
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

export function MoreOptionsMenu({ onTabChange, onLogout, onClose }: any) {
  const quickAccess = [
    { id: 'CUSTOMERS', label: 'Customers', icon: 'group', color: 'bg-blue-500' },
    { id: 'EXPENSES', label: 'Expenses', icon: 'payments', color: 'bg-rose-500' },
    { id: 'REFUNDS', label: 'Returns', icon: 'keyboard_return', color: 'bg-amber-500' },
    { id: 'DOCUMENTS', label: 'Receipts', icon: 'receipt_long', color: 'bg-violet-500' },
  ];
  const management = [
    { id: 'SUPPLIERS', label: 'Suppliers', icon: 'local_shipping', color: 'bg-teal-500' },
    { id: 'PURCHASES', label: 'Purchases', icon: 'shopping_bag', color: 'bg-indigo-500' },
    { id: 'REPORTS', label: 'Reports', icon: 'analytics', color: 'bg-emerald-500' },
    { id: 'ADMIN_PANEL', label: 'Admin', icon: 'settings', color: 'bg-slate-600' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-end">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full bg-white rounded-t-[2rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300 max-h-[85vh] flex flex-col">
        
        {/* Handle */}
        <div className="flex justify-center pt-4 pb-2 flex-shrink-0">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>
        
        <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-8">
          {/* Quick Access */}
          <div className="mb-6">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Quick Access</p>
            <div className="grid grid-cols-4 gap-3">
              {quickAccess.map(item => (
                <button 
                  key={item.id} 
                  onClick={() => { onTabChange(item.id); onClose(); }}
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className={`w-14 h-14 ${item.color} rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                    <MaterialIcon name={item.icon} className="text-white" style={{ fontSize: '24px' }} />
                  </div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight text-center">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Management */}
          <div className="mb-6">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">Management</p>
            <div className="grid grid-cols-4 gap-3">
              {management.map(item => (
                <button 
                  key={item.id} 
                  onClick={() => { onTabChange(item.id); onClose(); }}
                  className="flex flex-col items-center gap-2 group"
                >
                  <div className={`w-14 h-14 ${item.color} rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                    <MaterialIcon name={item.icon} className="text-white" style={{ fontSize: '24px' }} />
                  </div>
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-tight text-center">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sign Out */}
        <div className="px-5 pb-8 pt-4 border-t border-slate-100 flex-shrink-0">
          <button 
            onClick={onLogout} 
            className="w-full py-4 rounded-2xl border-2 border-rose-100 bg-rose-50 text-rose-600 font-bold text-sm hover:bg-rose-600 hover:text-white hover:border-rose-600 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <MaterialIcon name="logout" style={{ fontSize: '18px' }} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
