import type { BusinessSettings, User } from '../db';

export type ActionKey =
  | 'sale.checkout'
  | 'sale.refund.request'
  | 'expense.create'
  | 'expense.delete'
  | 'report.view'
  | 'admin.manage';

export type ManagedRole = 'CASHIER' | 'MANAGER';
export type AccessMode = 'OPEN' | 'BLURRED' | 'LOCKED';

export type AccessFeatureId =
  | 'tab.dashboard'
  | 'tab.register'
  | 'tab.tills'
  | 'tab.customers'
  | 'tab.invoices'
  | 'tab.inventory'
  | 'tab.suppliers'
  | 'tab.supplierPayments'
  | 'tab.purchases'
  | 'tab.expenses'
  | 'tab.mainAccount'
  | 'tab.refunds'
  | 'tab.reports'
  | 'tab.documents'
  | 'tab.hr'
  | 'dashboard.dailySales'
  | 'dashboard.moneyBreakdown'
  | 'dashboard.salesTrend'
  | 'sale.checkout'
  | 'sale.refund.request'
  | 'expense.create'
  | 'expense.delete'
  | 'report.view';

export type AccessControlConfig = Partial<Record<ManagedRole, Partial<Record<AccessFeatureId, AccessMode>>>>;

export const ACCESS_CONTROL_GROUPS: Array<{
  id: string;
  title: string;
  description: string;
  features: Array<{ id: AccessFeatureId; label: string; description: string; allowBlur?: boolean }>;
}> = [
  {
    id: 'windows',
    title: 'Windows',
    description: 'Choose which pages each role can open.',
    features: [
      { id: 'tab.dashboard', label: 'Dashboard', description: 'Main shift screen and daily overview.' },
      { id: 'tab.register', label: 'Register', description: 'Sell products and take payment.' },
      { id: 'tab.tills', label: 'Tills', description: 'Till setup and till sessions.' },
      { id: 'tab.customers', label: 'Customers', description: 'Customer list and balances.' },
      { id: 'tab.invoices', label: 'Invoices', description: 'Customer sales invoices.' },
      { id: 'tab.inventory', label: 'Inventory', description: 'Products, stock and categories.' },
      { id: 'tab.suppliers', label: 'Suppliers', description: 'Supplier list and supplier ledger.' },
      { id: 'tab.supplierPayments', label: 'Supplier payments', description: 'Payments made to suppliers.' },
      { id: 'tab.purchases', label: 'Purchases', description: 'LPOs and stock receiving.' },
      { id: 'tab.expenses', label: 'Expenses', description: 'Expense workspace.' },
      { id: 'tab.mainAccount', label: 'Main account', description: 'Account balance and money movement log.' },
      { id: 'tab.refunds', label: 'Refunds', description: 'Refund and return workspace.' },
      { id: 'tab.reports', label: 'Reports', description: 'Sales and finance reports.' },
      { id: 'tab.documents', label: 'Documents', description: 'Receipts, records and approvals.' },
      { id: 'tab.hr', label: 'HR', description: 'Workers, attendance and payroll records.' },
    ],
  },
  {
    id: 'dashboard',
    title: 'Dashboard Values',
    description: 'Use blur when staff may see the card but not the amount.',
    features: [
      { id: 'dashboard.dailySales', label: 'Daily sales', description: 'Daily sales total card.', allowBlur: true },
      { id: 'dashboard.moneyBreakdown', label: 'Money breakdown', description: 'Till cash, M-Pesa and credit breakdown.', allowBlur: true },
      { id: 'dashboard.salesTrend', label: 'Sales trend graph', description: 'Sales movement chart.', allowBlur: true },
    ],
  },
  {
    id: 'actions',
    title: 'Actions',
    description: 'Control sensitive buttons and workflows.',
    features: [
      { id: 'sale.checkout', label: 'Complete sale', description: 'Finalize register transactions.' },
      { id: 'sale.refund.request', label: 'Request refund', description: 'Start a refund or return request.' },
      { id: 'expense.create', label: 'Create expense', description: 'Record expenses from till or Main account.' },
      { id: 'expense.delete', label: 'Delete expense', description: 'Remove expense records.' },
      { id: 'report.view', label: 'View reports', description: 'Open and read report data.' },
    ],
  },
];

export const TAB_FEATURES: Record<string, AccessFeatureId> = {
  DASHBOARD: 'tab.dashboard',
  REGISTER: 'tab.register',
  TILLS: 'tab.tills',
  CUSTOMERS: 'tab.customers',
  INVOICES: 'tab.invoices',
  INVENTORY: 'tab.inventory',
  SUPPLIERS: 'tab.suppliers',
  SUPPLIER_PAYMENTS: 'tab.supplierPayments',
  PURCHASES: 'tab.purchases',
  EXPENSES: 'tab.expenses',
  MAIN_ACCOUNT: 'tab.mainAccount',
  REFUNDS: 'tab.refunds',
  REPORTS: 'tab.reports',
  DOCUMENTS: 'tab.documents',
  HR: 'tab.hr',
};

const ACTION_FEATURES: Record<ActionKey, AccessFeatureId | null> = {
  'sale.checkout': 'sale.checkout',
  'sale.refund.request': 'sale.refund.request',
  'expense.create': 'expense.create',
  'expense.delete': 'expense.delete',
  'report.view': 'report.view',
  'admin.manage': null,
};

const CASHIER_DEFAULTS: Record<AccessFeatureId, AccessMode> = {
  'tab.dashboard': 'OPEN',
  'tab.register': 'OPEN',
  'tab.tills': 'OPEN',
  'tab.customers': 'OPEN',
  'tab.invoices': 'OPEN',
  'tab.inventory': 'OPEN',
  'tab.suppliers': 'LOCKED',
  'tab.supplierPayments': 'LOCKED',
  'tab.purchases': 'OPEN',
  'tab.expenses': 'OPEN',
  'tab.mainAccount': 'LOCKED',
  'tab.refunds': 'OPEN',
  'tab.reports': 'LOCKED',
  'tab.documents': 'OPEN',
  'tab.hr': 'LOCKED',
  'dashboard.dailySales': 'BLURRED',
  'dashboard.moneyBreakdown': 'BLURRED',
  'dashboard.salesTrend': 'BLURRED',
  'sale.checkout': 'OPEN',
  'sale.refund.request': 'OPEN',
  'expense.create': 'LOCKED',
  'expense.delete': 'LOCKED',
  'report.view': 'LOCKED',
};

const MANAGER_DEFAULTS: Record<AccessFeatureId, AccessMode> = {
  'tab.dashboard': 'OPEN',
  'tab.register': 'OPEN',
  'tab.tills': 'OPEN',
  'tab.customers': 'OPEN',
  'tab.invoices': 'OPEN',
  'tab.inventory': 'OPEN',
  'tab.suppliers': 'OPEN',
  'tab.supplierPayments': 'OPEN',
  'tab.purchases': 'OPEN',
  'tab.expenses': 'OPEN',
  'tab.mainAccount': 'OPEN',
  'tab.refunds': 'OPEN',
  'tab.reports': 'OPEN',
  'tab.documents': 'OPEN',
  'tab.hr': 'OPEN',
  'dashboard.dailySales': 'OPEN',
  'dashboard.moneyBreakdown': 'OPEN',
  'dashboard.salesTrend': 'OPEN',
  'sale.checkout': 'OPEN',
  'sale.refund.request': 'OPEN',
  'expense.create': 'OPEN',
  'expense.delete': 'LOCKED',
  'report.view': 'OPEN',
};

const DEFAULT_ACCESS: Record<ManagedRole, Record<AccessFeatureId, AccessMode>> = {
  CASHIER: CASHIER_DEFAULTS,
  MANAGER: MANAGER_DEFAULTS,
};

function parseAccessControl(settings?: BusinessSettings | null): AccessControlConfig {
  const raw = settings?.accessControl;
  if (!raw) return {};
  if (typeof raw === 'object') return raw as AccessControlConfig;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as AccessControlConfig : {};
  } catch {
    return {};
  }
}

export function getDefaultAccessControl(): Record<ManagedRole, Record<AccessFeatureId, AccessMode>> {
  return {
    CASHIER: { ...DEFAULT_ACCESS.CASHIER },
    MANAGER: { ...DEFAULT_ACCESS.MANAGER },
  };
}

export function normalizeAccessControl(settings?: BusinessSettings | null): Record<ManagedRole, Record<AccessFeatureId, AccessMode>> {
  const saved = parseAccessControl(settings);
  const normalized = getDefaultAccessControl();

  (['CASHIER', 'MANAGER'] as ManagedRole[]).forEach(role => {
    Object.keys(normalized[role]).forEach(featureId => {
      const savedMode = saved?.[role]?.[featureId as AccessFeatureId];
      if (savedMode === 'OPEN' || savedMode === 'BLURRED' || savedMode === 'LOCKED') {
        normalized[role][featureId as AccessFeatureId] = savedMode;
      }
    });
  });

  return normalized;
}

export function getFeatureAccessMode(
  user: User | null | undefined,
  settings: BusinessSettings | null | undefined,
  feature: AccessFeatureId,
): AccessMode {
  if (!user) return 'LOCKED';
  if (user.role === 'ROOT' || user.role === 'ADMIN') return 'OPEN';
  if (user.role !== 'CASHIER' && user.role !== 'MANAGER') return 'LOCKED';
  return normalizeAccessControl(settings)[user.role][feature] || 'LOCKED';
}

export function canAccessFeature(
  user: User | null | undefined,
  settings: BusinessSettings | null | undefined,
  feature: AccessFeatureId,
): boolean {
  return getFeatureAccessMode(user, settings, feature) !== 'LOCKED';
}

export function shouldBlurFeature(
  user: User | null | undefined,
  settings: BusinessSettings | null | undefined,
  feature: AccessFeatureId,
): boolean {
  return getFeatureAccessMode(user, settings, feature) === 'BLURRED';
}

export function canOpenTab(
  user: User | null | undefined,
  settings: BusinessSettings | null | undefined,
  tab: string,
): boolean {
  if (!user) return false;
  if (tab === 'SETTINGS' || tab === 'ADMIN_PANEL') return user.role === 'ADMIN' || user.role === 'ROOT';
  const feature = TAB_FEATURES[tab];
  return feature ? canAccessFeature(user, settings, feature) : true;
}

export function canPerform(
  user: User | null | undefined,
  action: ActionKey,
  settings?: BusinessSettings | null,
): boolean {
  if (!user) return false;
  if (user.role === 'ROOT') return true;
  if (action === 'admin.manage') return user.role === 'ADMIN';
  if (user.role === 'ADMIN') return true;
  const feature = ACTION_FEATURES[action];
  return feature ? canAccessFeature(user, settings, feature) : false;
}
