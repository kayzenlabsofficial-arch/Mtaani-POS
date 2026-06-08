/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface SmartDesktopLocalDb {
  cacheTableRows(args: { table: string; businessId: string; shopId?: string; rows: any[]; updatedAt?: number }): Promise<void>;
  readCachedTableRows(args: { table: string; businessId: string; shopId?: string }): Promise<any[]>;
  enqueueOutbox(args: any): Promise<string>;
  markOutboxAttempt(args: { id: string; error?: string }): Promise<void>;
  markOutboxError(args: { id: string; error: string }): Promise<void>;
  markOutboxAcked(args: { id: string }): Promise<void>;
  markOutboxBatchAcked(args: { ids: string[] }): Promise<void>;
  getPendingOutbox(args: { businessId: string; shopId: string; limit?: number; dueOnly?: boolean }): Promise<any[]>;
  getOutboxStats(args: { businessId: string; shopId: string }): Promise<any>;
  upsertSyncState(args: any): Promise<void>;
  readSyncState(args: { businessId: string; shopId: string; deviceId: string }): Promise<any | undefined>;
  getStatus(): Promise<{ path: string; pending: number; failed: number }>;
}

interface SmartDesktopBridge {
  isDesktop: true;
  apiBaseUrl: string;
  platform: string;
  getInfo(): Promise<{ apiBaseUrl: string; sqlitePath: string; platform: string }>;
  localDb: SmartDesktopLocalDb;
}

interface Window {
  smartDesktop?: SmartDesktopBridge;
}

declare module 'virtual:pwa-register/react' {
  export function useRegisterSW(): {
    offlineReady: [boolean, (value: boolean) => void];
    needRefresh: [boolean, (value: boolean) => void];
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  };
}
