import type { BusinessSettings, User } from '../db';

export const DEFAULT_CASH_DRAWER_LIMIT = 5000;
export const DEFAULT_CASH_FLOAT_TARGET = 1000;

function settingFlag(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  return fallback;
}

function settingNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function canUseOwnerMode(user: User | null | undefined): boolean {
  return user?.role === 'ADMIN' || user?.role === 'MANAGER';
}

export function isOwnerModeEnabled(settings: BusinessSettings | null | undefined): boolean {
  return settingFlag(settings?.ownerModeEnabled, false);
}

export function shouldAutoApproveOwnerAction(
  settings: BusinessSettings | null | undefined,
  user: User | null | undefined
): boolean {
  return canUseOwnerMode(user) && isOwnerModeEnabled(settings) && settingFlag(settings?.autoApproveOwnerActions, true);
}

export function isOwnerCashSweepEnabled(settings: BusinessSettings | null | undefined): boolean {
  return isOwnerModeEnabled(settings) && settingFlag(settings?.cashSweepEnabled, true);
}

export function getCashDrawerLimit(settings: BusinessSettings | null | undefined): number {
  return settingNumber(settings?.cashDrawerLimit, DEFAULT_CASH_DRAWER_LIMIT);
}

export function getCashFloatTarget(settings: BusinessSettings | null | undefined): number {
  return settingNumber(settings?.cashFloatTarget, DEFAULT_CASH_FLOAT_TARGET);
}
