import React, { useState } from 'react';
import { 
  Dashboard, PointOfSale, Inventory, Group, ReceiptLong, 
  Settings, Logout, Sync, ExpandMore, ChevronRight, 
  Payments, BarChart, History, LocalShipping, ShoppingBag
} from '@mui/icons-material';

// Material Symbol Helper
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
    ops: true,
    inv: true,
    fin: true
  });

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const navItems = [
    { 
      id: 'ops', label: 'SALES', items: [
        { id: 'REGISTER', label: 'Register', icon: 'point_of_sale' },
        { id: 'DASHBOARD', label: 'Dashboard', icon: 'dashboard' },
        { id: 'CUSTOMERS', label: 'Customers', icon: 'group' },
      ]
    },
    { 
      id: 'inv', label: 'STOCK', items: [
        { id: 'INVENTORY', label: 'Inventory', icon: 'inventory_2' },
        { id: 'SUPPLIERS', label: 'Suppliers', icon: 'local_shipping', hidden: !isAdminOrManager },
        { id: 'PURCHASES', label: 'Purchases', icon: 'shopping_bag' },
      ]
    },
    { 
      id: 'fin', label: 'RECORDS', items: [
        { id: 'EXPENSES', label: 'Expenses', icon: 'payments' },
        { id: 'REPORTS', label: 'Reports', icon: 'analytics', hidden: !isAdminOrManager },
        { id: 'DOCUMENTS', label: 'Receipts', icon: 'receipt_long' },
      ]
    }
  ];

  return (
    <aside className="hidden md:flex flex-col w-72 bg-white border-r border-outline-variant h-full shrink-0">
      {/* Brand Node */}
      <div className="p-8 flex items-center gap-4">
        <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-lg">
          <MaterialIcon name="store" className="text-white text-2xl" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-primary leading-tight">Mtaani POS</h2>
          <p className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest mt-0.5">Secure Cloud POS</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6 mt-4">
        <nav className="space-y-10">
          {navItems.map(group => (
            <div key={group.id} className="space-y-3">
              <h3 className="font-mono text-[10px] font-bold text-outline tracking-[0.2em] ml-2">{group.label}</h3>
              <div className="space-y-1">
                {group.items.filter(i => !i.hidden).map(item => (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-md transition-all group ${activeTab === item.id ? 'bg-primary-container text-white shadow-md' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-primary'}`}
                  >
                    <MaterialIcon name={item.icon} className={activeTab === item.id ? 'text-white' : 'text-primary opacity-70 group-hover:opacity-100'} />
                    <span className="text-sm font-medium tracking-tight">{item.label}</span>
                    {activeTab === item.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white shadow-sm" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* User Session Node */}
      <div className="p-6 border-t border-outline-variant bg-surface-container-lowest">
        <div className="flex items-center gap-4 mb-6">
           <div className="w-10 h-10 rounded-full border-2 border-primary/20 overflow-hidden bg-surface-container">
              <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBanTVrDxgpc9k9_6zty19qXOLkfASYjRkPwQ_ImJ3zEw6tzpyfs7xlMCV1IitVdQ7l1jfwp4DlnS9ATDcQKEJWJ-uq0CWDgk5KkKbpEGNmzP4ld_l4eoeTKGNw70t2T7rIu_M2yTlJNVPd6UXlmcDvkMwlA4K3bf1CDnO8dRt5b1BYZ8b1jbVZ6N4yJQFXev6xV13LNa3awM1O2xkB3Hs7xcWlwHWy2RMXWZ-YWif-Jp2HhuiJRJxSswmn-zRE8ugFa13qjDYidMo" className="w-full h-full object-cover" />
           </div>
           <div className="min-w-0">
              <p className="text-sm font-bold text-on-surface truncate">{currentUser?.name}</p>
              <p className="font-mono text-[9px] text-on-surface-variant uppercase">{currentUser?.role}</p>
           </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
           <button 
             onClick={onSync}
             className={`flex flex-col items-center justify-center py-3 rounded-md border border-outline-variant hover:bg-surface-container transition-all ${isSyncing ? 'animate-pulse bg-surface-container' : ''}`}
           >
              <MaterialIcon name="sync" className={`text-primary text-xl ${isSyncing ? 'animate-spin' : ''}`} />
              <span className="font-mono text-[9px] mt-1 text-on-surface-variant">SYNC</span>
           </button>
           <button 
             onClick={onLogout}
             className="flex flex-col items-center justify-center py-3 rounded-md border border-outline-variant hover:bg-error-container hover:text-error transition-all group"
           >
              <MaterialIcon name="logout" className="text-on-surface-variant group-hover:text-error text-xl" />
              <span className="font-mono text-[9px] mt-1 text-on-surface-variant group-hover:text-error">LOGOUT</span>
           </button>
        </div>
      </div>
    </aside>
  );
}
