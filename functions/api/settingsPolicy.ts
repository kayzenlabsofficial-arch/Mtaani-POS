export type SettingsRole = 'CASHIER' | 'MANAGER';
export type AccessMode = 'OPEN' | 'BLURRED' | 'LOCKED';
export type ActionKey = 'sale.checkout' | 'sale.refund.request' | 'expense.create' | 'expense.delete';

const ACTION_FEATURES: Record<ActionKey, string> = {
  'sale.checkout': 'sale.checkout',
  'sale.refund.request': 'sale.refund.request',
  'expense.create': 'expense.create',
  'expense.delete': 'expense.delete',
};

const ACTION_DEFAULTS: Record<SettingsRole, Record<ActionKey, AccessMode>> = {
  CASHIER: {
    'sale.checkout': 'OPEN',
    'sale.refund.request': 'OPEN',
    'expense.create': 'LOCKED',
    'expense.delete': 'LOCKED',
  },
  MANAGER: {
    'sale.checkout': 'OPEN',
    'sale.refund.request': 'OPEN',
    'expense.create': 'OPEN',
    'expense.delete': 'LOCKED',
  },
};

const FEATURE_DEFAULTS: Record<SettingsRole, Record<AccessFeatureId, AccessMode>> = {
  CASHIER: {
    'tab.dashboard': 'OPEN',
    'tab.register': 'OPEN',
    'tab.tills': 'OPEN',
    'tab.customers': 'OPEN',
    'tab.invoices': 'OPEN',
    'tab.inventory': 'OPEN',
    'tab.suppliers': 'LOCKED',
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
  },
  MANAGER: {
    'tab.dashboard': 'OPEN',
    'tab.register': 'OPEN',
    'tab.tills': 'OPEN',
    'tab.customers': 'OPEN',
    'tab.invoices': 'OPEN',
    'tab.inventory': 'OPEN',
    'tab.suppliers': 'OPEN',
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
  },
};

export const ACCESS_ROLES: SettingsRole[] = ['CASHIER', 'MANAGER'];

export const ACCESS_FEATURES = [
  'tab.dashboard',
  'tab.register',
  'tab.tills',
  'tab.customers',
  'tab.invoices',
  'tab.inventory',
  'tab.suppliers',
  'tab.purchases',
  'tab.expenses',
  'tab.mainAccount',
  'tab.refunds',
  'tab.reports',
  'tab.documents',
  'tab.hr',
  'dashboard.dailySales',
  'dashboard.moneyBreakdown',
  'dashboard.salesTrend',
  'sale.checkout',
  'sale.refund.request',
  'expense.create',
  'expense.delete',
  'report.view',
] as const;

export type AccessFeatureId = typeof ACCESS_FEATURES[number];
export type AccessControlConfig = Partial<Record<SettingsRole, Partial<Record<AccessFeatureId, AccessMode>>>>;

const FEATURE_SET = new Set<string>(ACCESS_FEATURES);
const MODE_SET = new Set<string>(['OPEN', 'BLURRED', 'LOCKED']);

function parseAccessControl(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}

export function normalizeAccessControlConfig(value: unknown): AccessControlConfig {
  const raw = parseAccessControl(value);
  const normalized: AccessControlConfig = {};
  for (const role of ACCESS_ROLES) {
    const roleConfig = raw[role];
    if (!roleConfig || typeof roleConfig !== 'object') continue;
    const clean: Partial<Record<AccessFeatureId, AccessMode>> = {};
    for (const [feature, mode] of Object.entries(roleConfig)) {
      const cleanMode = String(mode || '').toUpperCase();
      if (FEATURE_SET.has(feature) && MODE_SET.has(cleanMode)) {
        clean[feature as AccessFeatureId] = cleanMode as AccessMode;
      }
    }
    if (Object.keys(clean).length > 0) normalized[role] = clean;
  }
  return normalized;
}

export function normalizedAccessControlText(value: unknown): string {
  const normalized = normalizeAccessControlConfig(value);
  return Object.keys(normalized).length ? JSON.stringify(normalized) : '';
}

export function actionModeForRole(roleValue: unknown, accessControl: unknown, action: ActionKey): AccessMode {
  const role = String(roleValue || '').toUpperCase() as SettingsRole;
  if (role !== 'CASHIER' && role !== 'MANAGER') return 'OPEN';
  const normalized = normalizeAccessControlConfig(accessControl);
  const feature = ACTION_FEATURES[action];
  const configured = normalized[role]?.[feature as AccessFeatureId];
  return configured || ACTION_DEFAULTS[role][action];
}

export function featureModeForRole(roleValue: unknown, accessControl: unknown, feature: AccessFeatureId): AccessMode {
  const role = String(roleValue || '').toUpperCase() as SettingsRole;
  if (role !== 'CASHIER' && role !== 'MANAGER') return 'OPEN';
  const normalized = normalizeAccessControlConfig(accessControl);
  return normalized[role]?.[feature] || FEATURE_DEFAULTS[role][feature] || 'LOCKED';
}

export async function canPerformServerAction(
  db: D1Database,
  businessId: string,
  principal: any,
  service: boolean,
  action: ActionKey,
): Promise<boolean> {
  if (service) return true;
  const role = String(principal?.role || '').toUpperCase();
  if (role === 'ROOT' || role === 'ADMIN') return true;
  if (role !== 'CASHIER' && role !== 'MANAGER') return false;
  const settings = await db.prepare(`
    SELECT accessControl
    FROM settings
    WHERE businessId = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  `).bind(businessId, `core_${businessId}`).first<any>().catch(() => null);
  return actionModeForRole(role, settings?.accessControl, action) !== 'LOCKED';
}

export async function canReadServerFeature(
  db: D1Database,
  businessId: string,
  principal: any,
  service: boolean,
  feature: AccessFeatureId,
): Promise<boolean> {
  if (service) return true;
  const role = String(principal?.role || '').toUpperCase();
  if (role === 'ROOT' || role === 'ADMIN') return true;
  if (role !== 'CASHIER' && role !== 'MANAGER') return false;
  const settings = await db.prepare(`
    SELECT accessControl
    FROM settings
    WHERE businessId = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, updated_at DESC
    LIMIT 1
  `).bind(businessId, `core_${businessId}`).first<any>().catch(() => null);
  return featureModeForRole(role, settings?.accessControl, feature) !== 'LOCKED';
}
