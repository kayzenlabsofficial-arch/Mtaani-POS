import { isNativeMobileRuntime } from './runtime';

export async function disableNativeServiceWorkers(): Promise<void> {
  if (!isNativeMobileRuntime() || typeof window === 'undefined') return;

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
    }
  } catch (err) {
    console.warn('[Mobile] Could not unregister service workers', err);
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
  } catch (err) {
    console.warn('[Mobile] Could not clear web caches', err);
  }
}
