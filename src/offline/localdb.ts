import Dexie, { type Table } from 'dexie';

export type OfflineCacheTable =
  | 'products'
  | 'categories'
  | 'customers'
  | 'customerPayments'
  | 'serviceItems'
  | 'suppliers'
  | 'settings'
  | 'salesTills'
  | 'users'
  | 'financialAccounts'
  | 'expenseAccounts'
  | 'productIngredients';

export type OfflineOutboxOp = 'UPSERT';

export interface CachedRows {
  id: string; // `${table}|${businessId}|${shopId ?? ''}`
  table: OfflineCacheTable;
  businessId: string;
  shopId?: string;
  rows: any[];
  updatedAt: number;
}

export interface OutboxItem {
  id: string; // uuid
  businessId: string;
  shopId: string;
  table: 'transactions';
  op: OfflineOutboxOp;
  idempotencyKey: string; // uuid; for transactions we use tx.id
  payload: any; // record to apply
  createdAt: number; // client clock
  attemptCount: number;
  lastAttemptAt?: number;
  ackedAt?: number;
  error?: string;
}

export interface OutboxStats {
  pending: number;
  failed: number;
  oldestCreatedAt?: number;
  lastError?: string;
  lastErrorAt?: number;
}

export interface SyncStateRow {
  id: string; // `${businessId}|${shopId}|${deviceId}`
  businessId: string;
  shopId: string;
  deviceId: string;
  cashierName?: string;
  lastSuccessfulSyncAt?: number;
  updatedAt: number;
}

class OfflineDexie extends Dexie {
  cachedRows!: Table<CachedRows, string>;
  outbox!: Table<OutboxItem, string>;
  syncState!: Table<SyncStateRow, string>;

  constructor() {
    super('mtaani_pos_offline_v2');
    this.version(1).stores({
      cachedRows: 'id, table, businessId, shopId, updatedAt',
      outbox: 'id, businessId, shopId, table, createdAt, ackedAt, idempotencyKey',
      syncState: 'id, businessId, shopId, deviceId, updatedAt',
    });
  }
}

export const offlineDb = new OfflineDexie();

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'server';
  const key = 'mtaani:deviceId';
  let v = '';
  try {
    v = window.localStorage.getItem(key) || '';
  } catch {
    v = '';
  }
  if (!v) {
    v = crypto.randomUUID();
    try {
      window.localStorage.setItem(key, v);
    } catch {
      // ignore
    }
  }
  return v;
}

function cacheKey(table: OfflineCacheTable, businessId: string, shopId?: string) {
  return `${table}|${businessId}|${shopId ?? ''}`;
}

export async function cacheTableRows(args: {
  table: OfflineCacheTable;
  businessId: string;
  shopId?: string;
  rows: any[];
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = args.updatedAt ?? Date.now();
  await offlineDb.cachedRows.put({
    id: cacheKey(args.table, args.businessId, args.shopId),
    table: args.table,
    businessId: args.businessId,
    shopId: args.shopId,
    rows: args.rows ?? [],
    updatedAt,
  });
}

export async function readCachedTableRows(args: {
  table: OfflineCacheTable;
  businessId: string;
  shopId?: string;
}): Promise<any[]> {
  const row = await offlineDb.cachedRows.get(cacheKey(args.table, args.businessId, args.shopId));
  return row?.rows ?? [];
}

export async function enqueueOutbox(item: Omit<OutboxItem, 'id' | 'createdAt' | 'attemptCount'> & { id?: string; createdAt?: number }): Promise<string> {
  const id = item.id ?? crypto.randomUUID();
  await offlineDb.outbox.put({
    id,
    businessId: item.businessId,
    shopId: item.shopId,
    table: item.table,
    op: item.op,
    idempotencyKey: item.idempotencyKey,
    payload: item.payload,
    createdAt: item.createdAt ?? Date.now(),
    attemptCount: 0,
  });
  return id;
}

export async function markOutboxAttempt(id: string, args: { error?: string } = {}): Promise<void> {
  await offlineDb.outbox.update(id, {
    attemptCount: (Dexie as any).increment(1),
    lastAttemptAt: Date.now(),
    error: args.error,
  });
}

export async function markOutboxError(id: string, error: string): Promise<void> {
  await offlineDb.outbox.update(id, {
    lastAttemptAt: Date.now(),
    error,
  });
}

export async function markOutboxAcked(id: string): Promise<void> {
  await offlineDb.outbox.update(id, { ackedAt: Date.now(), error: undefined });
}

export async function markOutboxBatchAcked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = Date.now();
  await offlineDb.transaction('rw', offlineDb.outbox, async () => {
    await Promise.all(ids.map(id => offlineDb.outbox.update(id, { ackedAt: now, error: undefined })));
  });
}

function retryDelayMs(item: OutboxItem): number {
  if (!item.lastAttemptAt || item.attemptCount <= 0) return 0;
  return Math.min(60_000, 1_000 * Math.pow(2, Math.min(6, Math.max(0, item.attemptCount - 1))));
}

function isDueForRetry(item: OutboxItem, now: number): boolean {
  if (item.ackedAt) return false;
  if (!item.lastAttemptAt) return true;
  return now - item.lastAttemptAt >= retryDelayMs(item);
}

export async function getPendingOutbox(args: { businessId: string; shopId: string; limit?: number; dueOnly?: boolean }): Promise<OutboxItem[]> {
  const limit = args.limit ?? 50;
  const now = Date.now();
  return offlineDb.outbox
    .where('businessId')
    .equals(args.businessId)
    .filter((x) => x.shopId === args.shopId && !x.ackedAt && (!args.dueOnly || isDueForRetry(x, now)))
    .sortBy('createdAt')
    .then((arr) => arr.slice(0, limit));
}

export async function getOutboxStats(args: { businessId: string; shopId: string }): Promise<OutboxStats> {
  const rows = await offlineDb.outbox
    .where('businessId')
    .equals(args.businessId)
    .filter((x) => x.shopId === args.shopId && !x.ackedAt)
    .sortBy('createdAt');
  const failedRows = rows.filter(row => !!row.error);
  const latestFailed = failedRows
    .slice()
    .sort((a, b) => Number(b.lastAttemptAt || 0) - Number(a.lastAttemptAt || 0))[0];
  return {
    pending: rows.length,
    failed: failedRows.length,
    oldestCreatedAt: rows[0]?.createdAt,
    lastError: latestFailed?.error,
    lastErrorAt: latestFailed?.lastAttemptAt,
  };
}

export async function upsertSyncState(args: Omit<SyncStateRow, 'id' | 'updatedAt'> & { lastSuccessfulSyncAt?: number }): Promise<void> {
  const id = `${args.businessId}|${args.shopId}|${args.deviceId}`;
  await offlineDb.syncState.put({
    id,
    businessId: args.businessId,
    shopId: args.shopId,
    deviceId: args.deviceId,
    cashierName: args.cashierName,
    lastSuccessfulSyncAt: args.lastSuccessfulSyncAt,
    updatedAt: Date.now(),
  });
}

export async function readSyncState(args: { businessId: string; shopId: string; deviceId: string }): Promise<SyncStateRow | undefined> {
  return offlineDb.syncState.get(`${args.businessId}|${args.shopId}|${args.deviceId}`);
}
