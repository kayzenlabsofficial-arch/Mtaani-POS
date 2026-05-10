import React from 'react';

const MaterialIcon = ({ name, className = "", style = {} }: { name: string, className?: string, style?: any }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>{name}</span>
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

  return (
    <header className="w-full top-0 sticky bg-white border-b border-outline-variant z-50 shadow-sm">
       <div className="flex items-center justify-between px-6 py-4 w-full md:px-12">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-2xl border border-outline-variant overflow-hidden bg-surface-container cursor-pointer hover:ring-4 hover:ring-primary/10 transition-all flex-shrink-0" onClick={onOpenProfile}>
                <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBanTVrDxgpc9k9_6zty19qXOLkfASYjRkPwQ_ImJ3zEw6tzpyfs7xlMCV1IitVdQ7l1jfwp4DlnS9ATDcQKEJWJ-uq0CWDgk5KkKbpEGNmzP4ld_l4eoeTKGNw70t2T7rIu_M2yTlJNVPd6UXlmcDvkMwlA4K3bf1CDnO8dRt5b1BYZ8b1jbVZ6N4yJQFXev6xV13LNa3awM1O2xkB3Hs7xcWlwHWy2RMXWZ-YWif-Jp2HhuiJRJxSswmn-zRE8ugFa13qjDYidMo" className="w-full h-full object-cover" />
             </div>
              <div className="flex flex-col min-w-0">
                 <h1 className="text-sm font-black text-slate-900 truncate uppercase tracking-tight">
                    {activeBusiness?.name || 'Mtaani POS'}
                 </h1>
                 
                 {isAdmin ? (
                   <div className="relative flex items-center gap-1 group">
                      <select 
                        value={activeBranch?.id} 
                        onChange={(e) => onBranchChange(e.target.value)}
                        className="appearance-none bg-transparent text-[10px] font-bold text-primary uppercase tracking-widest outline-none pr-4 cursor-pointer"
                      >
                         {branches?.map((b: any) => (
                           <option key={b.id} value={b.id} className="text-slate-900">{b.name}</option>
                         ))}
                      </select>
                      <div className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2">
                         <MaterialIcon name="expand_more" className="text-xs text-primary" />
                      </div>
                   </div>
                 ) : (
                   <p className="text-[10px] font-bold text-primary uppercase tracking-widest truncate">
                      {activeBranch?.name || 'Main Shop'}
                   </p>
                 )}
              </div>
          </div>
          
          <div className="flex items-center gap-4">
             <button 
               onClick={onSync}
               className="p-2.5 text-primary hover:bg-surface-container rounded-lg transition-all active:scale-90"
             >
                <MaterialIcon name="sync" className={isSyncing ? 'animate-spin' : ''} />
             </button>
             <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-surface-container rounded-full border border-outline-variant">
                <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{isOnline ? 'Online' : 'Offline'}</span>
                <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-primary' : 'bg-outline'}`} />
             </div>
          </div>
       </div>
    </header>
  );
}

export function MobileNav({ activeTab, onTabChange, onToggleMore, isMoreMenuOpen }: any) {
  return (
    <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center bg-surface-container-lowest/95 backdrop-blur-md px-2 pb-safe border-t border-outline-variant h-20 md:hidden z-50">
       {[
         { id: 'DASHBOARD', label: 'Dash', icon: 'dashboard' },
         { id: 'REGISTER', label: 'Sale', icon: 'point_of_sale' },
         { id: 'INVENTORY', label: 'Stock', icon: 'inventory_2' },
         { id: 'MORE', label: 'More', icon: 'more_horiz' },
       ].map((item) => (
         <button 
            key={item.id} 
            onClick={() => { if (item.id === 'MORE') onToggleMore(true); else onTabChange(item.id as any); }} 
            className={`flex flex-col items-center justify-center min-w-[64px] h-12 rounded-2xl transition-all duration-300 ${ (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen) ? 'bg-primary-container text-white scale-105 shadow-lg' : 'text-on-surface-variant' }`}
          >
            <MaterialIcon name={item.icon} style={ (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen) ? { fontVariationSettings: "'FILL' 1" } : {} } />
            <span className="font-mono text-[9px] mt-1 font-bold uppercase tracking-tight">{item.label}</span>
          </button>
       ))}
    </nav>
  );
}

export function MoreOptionsMenu({ onTabChange, onLogout, onClose }: any) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white rounded-t-[2.5rem] shadow-2xl flex flex-col p-10 animate-in slide-in-from-bottom duration-500 max-h-[85vh]">
        <div className="w-12 h-1.5 bg-outline-variant rounded-full mx-auto mb-8 shrink-0" />
        
        <div className="flex-1 overflow-y-auto no-scrollbar pb-8 space-y-10">
          <div className="space-y-4">
             <h4 className="font-mono text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Quick Access</h4>
             <div className="grid grid-cols-4 gap-4">
                {[
                  { id: 'CUSTOMERS', label: 'Customers', icon: 'group' },
                  { id: 'EXPENSES', label: 'Expenses', icon: 'payments' },
                  { id: 'REFUNDS', label: 'Returns', icon: 'keyboard_return' },
                  { id: 'DOCUMENTS', label: 'Receipts', icon: 'receipt_long' }
                ].map(item => (
                  <button key={item.id} onClick={() => onTabChange(item.id as any)} className="flex flex-col items-center gap-3 p-2 group">
                    <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all shadow-sm"> <MaterialIcon name={item.icon} /> </div>
                    <span className="font-mono text-[9px] font-bold text-on-surface-variant uppercase tracking-tight text-center">{item.label}</span>
                  </button>
                ))}
             </div>
          </div>

          <div className="space-y-4">
             <h4 className="font-mono text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Management</h4>
             <div className="grid grid-cols-4 gap-4">
                {[
                  { id: 'SUPPLIERS', label: 'Suppliers', icon: 'local_shipping' },
                  { id: 'PURCHASES', label: 'Purchases', icon: 'shopping_bag' },
                  { id: 'REPORTS', label: 'Reports', icon: 'analytics' },
                  { id: 'ADMIN_PANEL', label: 'Settings', icon: 'settings' }
                ].map(item => (
                  <button key={item.id} onClick={() => onTabChange(item.id as any)} className="flex flex-col items-center gap-3 p-2 group">
                    <div className="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-white transition-all shadow-sm"> <MaterialIcon name={item.icon} /> </div>
                    <span className="font-mono text-[9px] font-bold text-on-surface-variant uppercase tracking-tight text-center">{item.label}</span>
                  </button>
                ))}
             </div>
          </div>
        </div>

        <div className="pt-8 border-t border-outline-variant flex gap-4 shrink-0">
           <button onClick={onLogout} className="flex-1 py-4 rounded-xl bg-error-container text-error font-bold text-[10px] uppercase tracking-widest hover:bg-error hover:text-white transition-all shadow-sm">Sign Out</button>
        </div>
      </div>
    </div>
  );
}
