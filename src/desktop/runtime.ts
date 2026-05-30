import { getMobileApiBaseUrl, isNativeMobileRuntime } from '../mobile/runtime';

export function getDesktopBridge() {
  if (typeof window === 'undefined') return undefined;
  return window.mtaaniDesktop;
}

export function isDesktopRuntime(): boolean {
  return !!getDesktopBridge()?.isDesktop;
}

export function getDesktopApiBaseUrl(): string {
  return getDesktopBridge()?.apiBaseUrl || '';
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const desktopBridge = getDesktopBridge();
  const base = (
    desktopBridge
      ? desktopBridge.apiBaseUrl
      : isNativeMobileRuntime()
        ? getMobileApiBaseUrl()
        : import.meta.env.VITE_API_BASE_URL || ''
  ).replace(/\/+$/, '');
  if (!base) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
