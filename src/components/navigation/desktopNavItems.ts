import type React from 'react';
import {
  BarChart3,
  CircleDollarSign,
  FileText,
  Landmark,
  LayoutDashboard,
  Package,
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

export type DesktopNavItem = {
  id: string;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
  managerAllowed?: boolean;
};

export const desktopNavItems: DesktopNavItem[] = [
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

export const activeDesktopNavId = (activeTab: string) => {
  if (activeTab === 'SUPPLIER_PAYMENTS') return 'SUPPLIERS';
  return activeTab;
};

export const desktopNavLabel = (activeTab: string) => {
  const navId = activeDesktopNavId(activeTab);
  return desktopNavItems.find(item => item.id === navId)?.label || activeTab.replace(/_/g, ' ').toLowerCase();
};
