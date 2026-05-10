import React, { useState } from 'react';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: any) => void;
  onLogout: () => void;
  onSync: () => void;
  isSyncing: boolean;
  currentUser: any;
  onOpenProfile: () => void;
}

const navGroups = [
  { 
    id: 'ops', label: 'SALES OPS', items: [
      { id: 'REGISTER', label: 'Register', icon: 'point_of_sale', desc: 'New sale' },
      { id: 'DASHBOARD', label: 'Dashboard', icon: 'dashboard', desc: 'Overview' },
      { id: 'CUSTOMERS', label: 'Customers', icon: 'group', desc: 'CRM' },
    ]
  },
  { 
    id: 'inv', label: 'INVENTORY', items: [
      { id: 'INVENTORY', label: 'Products', icon: 'inventory_2', desc: 'Stock' },
      { id: 'SUPPLIERS', label: 'Suppliers', icon: 'local_shipping', desc: 'Vendors', adminOnly: true },
      { id: 'PURCHASES', label: 'Purchases', icon: 'shopping_bag', desc: 'Orders' },
    ]
  },
  { 
    id: 'fin', label: 'FINANCE', items: [
      { id: 'EXPENSES', label: 'Expenses', icon: 'payments', desc: 'Costs' },
      { id: 'REFUNDS', label: 'Refunds', icon: 'keyboard_return', desc: 'Returns' },
      { id: 'REPORTS', label: 'Reports', icon: 'analytics', desc: 'Analytics', adminOnly: true },
      { id: 'DOCUMENTS', label: 'Documents', icon: 'receipt_long', desc: 'Receipts' },
    ]
  },
  { 
    id: 'admin', label: 'SYSTEM', items: [
      { id: 'ADMIN_PANEL', label: 'Admin Panel', icon: 'settings', desc: 'Config', adminOnly: true },
    ]
  },
];

export default function Sidebar({ 
  activeTab, onTabChange, onLogout, onSync, isSyncing, currentUser, onOpenProfile
}: SidebarProps) {
  const isAdminOrManager = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  return (
    <aside className="hidden md:flex flex-col w-64 bg-slate-950 h-full flex-shrink-0 relative">
      
      {/* Brand */}
      <div className="px-6 py-6 border-b border-slate-800/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/30 flex-shrink-0">
            <MaterialIcon name="store" className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-white leading-none">Mtaani POS</h2>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">Enterprise Cloud POS</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto no-scrollbar py-4">
        {navGroups.map(group => {
          const visibleItems = group.items.filter(i => !(i as any).adminOnly || isAdminOrManager);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.id} className="mb-6 px-3">
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] px-3 mb-2">{group.label}</p>
              <div className="space-y-0.5">
                {visibleItems.map(item => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 group ${
                        isActive 
                          ? 'bg-primary shadow-lg shadow-primary/20 text-white' 
                          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                      }`}
                    >
                      <MaterialIcon 
                        name={item.icon} 
                        className={`text-lg flex-shrink-0 transition-colors ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] font-bold leading-none ${isActive ? 'text-white' : ''}`}>{item.label}</p>
                        <p className={`text-[9px] mt-0.5 ${isActive ? 'text-white/70' : 'text-slate-600'}`}>{item.desc}</p>
                      </div>
                      {isActive && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white/80 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800/60 p-4">
        <button onClick={onOpenProfile} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-slate-800/60 transition-all mb-3 group text-left">
          <div className="w-9 h-9 rounded-xl overflow-hidden border-2 border-slate-700 flex-shrink-0">
            <img 
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBanTVrDxgpc9k9_6zty19qXOLkfASYjRkPwQ_ImJ3zEw6tzpyfs7xlMCV1IitVdQ7l1jfwp4DlnS9ATDcQKEJWJ-uq0CWDgk5KkKbpEGNmzP4ld_l4eoeTKGNw70t2T7rIu_M2yTlJNVPd6UXlmcDvkMwlA4K3bf1CDnO8dRt5b1BYZ8b1jbVZ6N4yJQFXev6xV13LNa3awM1O2xkB3Hs7xcWlwHWy2RMXWZ-YWif-Jp2HhuiJRJxSswmn-zRE8ugFa13qjDYidMo"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-slate-200 truncate leading-none">{currentUser?.name}</p>
            <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">{currentUser?.role}</p>
          </div>
          <MaterialIcon name="chevron_right" className="text-slate-600 group-hover:text-slate-400 text-base" />
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={onSync}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-800 text-slate-500 hover:text-slate-200 hover:border-slate-600 transition-all text-[10px] font-bold uppercase tracking-widest ${isSyncing ? 'text-primary border-primary/30 bg-primary/5' : ''}`}
          >
            <MaterialIcon name="sync" className={`text-base ${isSyncing ? 'animate-spin' : ''}`} />
            Sync
          </button>
          <button 
            onClick={onLogout}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-900/50 hover:bg-rose-950/30 transition-all text-[10px] font-bold uppercase tracking-widest"
          >
            <MaterialIcon name="logout" className="text-base" />
            Exit
          </button>
        </div>
      </div>
    </aside>
  );
}
