import { db, type BusinessSettings } from '../db';

export function settingsIdForBusiness(businessId?: string | null) {
  return businessId ? `core_${businessId}` : 'core';
}

export async function getBusinessSettings(businessId?: string | null): Promise<BusinessSettings | undefined> {
  if (!businessId) return undefined;
  const scoped = await db.settings.get(settingsIdForBusiness(businessId));
  if (scoped) return scoped;

  const businessRows = await db.settings
    .where('businessId')
    .equals(businessId)
    .toArray();
  if (businessRows.length > 0) {
    return businessRows
      .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
  }

  const legacy = await db.settings.get('core');
  return legacy?.businessId === businessId ? legacy : undefined;
}
