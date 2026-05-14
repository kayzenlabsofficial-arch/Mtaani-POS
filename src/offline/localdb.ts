import Dexie, { type Table } from 'dexie';

export type OfflineCacheTable =
  | 'products'
  | 'categories'
  | 'customers'
  | 'suppliers'
  | 'settings'
  | 'branches'
  | 'users'
  | 'financialAccounts'
  | 'expenseAccounts'
  | 'productIngredients';

export type OfflineOutboxOp = 'UPSERT';

export interface CachedRows {
  id: string; // `${table}|${businessId}|${branchId ?? ''}`
  table: OfflineCacheTable;
  businessId: string;
  branchId?: string;
  rows: any[];
  updatedAt: number;
}

export interface OutboxItem {
  id: string; // uuid
  businessId: string;
  branchId: string;
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

export interface SyncStateRow {
  id: string; // `${businessId}|${branchId}|${deviceId}`
  businessId: string;
  branchId: string;
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
    super('mtaani_pos_offline_v1');
    this.version(1).stores({
      cachedRows: 'id, table, businessId, branchId, updatedAt',
      outbox: 'id, businessId, branchId, table, createdAt, ackedAt, idempotencyKey',
      syncState: 'id, businessId, branchId, deviceId, updatedAt',
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

function cacheKey(table: OfflineCacheTable, businessId: string, branchId?: string) {
  return `${table}|${businessId}|${branchId ?? ''}`;
}

export async function cacheTableRows(args: {
  table: OfflineCacheTable;
  businessId: string;
  branchId?: string;
  rows: any[];
  updatedAt?: number;
}): Promise<void> {
  const updatedAt = args.updatedAt ?? Date.now();
  await offlineDb.cachedRows.put({
    id: cacheKey(args.table, args.businessId, args.branchId),
    table: args.table,
    businessId: args.businessId,
    branchId: args.branchId,
    rows: args.rows ?? [],
    updatedAt,
  });
}

export async function readCachedTableRows(args: {
  table: OfflineCacheTable;
  businessId: string;
  branchId?: string;
}): Promise<any[]> {
  const row = await offlineDb.cachedRows.get(cacheKey(args.table, args.businessId, args.branchId));
  return row?.rows ?? [];
}

export async function enqueueOutbox(item: Omit<OutboxItem, 'id' | 'createdAt' | 'attemptCount'> & { id?: string; createdAt?: number }): Promise<string> {
  const id = item.id ?? crypto.randomUUID();
  await offlineDb.outbox.put({
    id,
    businessId: item.businessId,
    branchId: item.branchId,
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

export async function markOutboxAcked(id: string): Promise<void> {
  await offlineDb.outbox.update(id, { ackedAt: Date.now(), error: undefined });
}

export async function getPendingOutbox(args: { businessId: string; branchId: string; limit?: number }): Promise<OutboxItem[]> {
  const limit = args.limit ?? 50;
  return offlineDb.outbox
    .where(['businessId', 'branchId'])
    .equals([args.businessId, args.branchId])
    .filter((x) => !x.ackedAt)
    .sortBy('createdAt')
    .then((arr) => arr.slice(0, limit));
}

export async function upsertSyncState(args: Omit<SyncStateRow, 'id' | 'updatedAt'> & { lastSuccessfulSyncAt?: number }): Promise<void> {
  const id = `${args.businessId}|${args.branchId}|${args.deviceId}`;
  await offlineDb.syncState.put({
    id,
    businessId: args.businessId,
    branchId: args.branchId,
    deviceId: args.deviceId,
    cashierName: args.cashierName,
    lastSuccessfulSyncAt: args.lastSuccessfulSyncAt,
    updatedAt: Date.now(),
  });
}

export async function readSyncState(args: { businessId: string; branchId: string; deviceId: string }): Promise<SyncStateRow | undefined> {
  return offlineDb.syncState.get(`${args.businessId}|${args.branchId}|${args.deviceId}`);
}

