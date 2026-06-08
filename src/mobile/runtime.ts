import { Capacitor } from '@capacitor/core';

const DEFAULT_API_BASE_URL = 'https://smartpos.pages.dev';

export function isNativeMobileRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === 'android' || platform === 'ios');
}

export function getMobilePlatform(): string {
  return Capacitor.getPlatform();
}

export function getMobileApiBaseUrl(): string {
  return (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
}
