import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { isNativeMobileRuntime, getMobilePlatform } from './runtime';
import type { OfflineCacheTable, OutboxItem, OutboxStats, SyncStateRow } from '../offline/localdb';

const DATABASE_NAME = 'mtaani_pos_mobile';

let sqlite: SQLiteConnection | null = null;
let connection: SQLiteDBConnection | null = null;
let initPromise: Promise<SQLiteDBConnection> | null = null;

function now() {
  return Date.now();
}

function cacheKey(table: string, businessId: string, shopId?: string) {
  return `${table}|${businessId}|${shopId ?? ''}`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nullableNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function rowToOutboxItem(row: any): OutboxItem {
  return {
    id: String(row.id || ''),
    businessId: String(row.business_id || ''),
    shopId: String(row.shop_id || ''),
    table: row.table_name,
    op: row.op,
    idempotencyKey: String(row.idempotency_key || ''),
    payload: parseJson(row.payload_json, {}),
    createdAt: Number(row.created_at || 0),
    attemptCount: Number(row.attempt_count || 0),
    lastAttemptAt: nullableNumber(row.last_attempt_at),
    ackedAt: nullableNumber(row.acked_at),
    error: row.error || undefined,
  };
}

function rowToSyncState(row: any): SyncStateRow | undefined {
  if (!row) return undefined;
  return {
    id: String(row.id || ''),
    businessId: String(row.business_id || ''),
    shopId: String(row.shop_id || ''),
    deviceId: String(row.device_id || ''),
    cashierName: row.cashier_name || undefined,
    lastSuccessfulSyncAt: nullableNumber(row.last_successful_sync_at),
    updatedAt: Number(row.updated_at || 0),
  };
}

function retryDelayMs(item: OutboxItem): number {
  if (!item.lastAttemptAt || item.attemptCount <= 0) return 0;
  return Math.min(60_000, 1_000 * Math.pow(2, Math.min(6, Math.max(0, item.attemptCount - 1))));
}

function isDueForRetry(item: OutboxItem, timestamp: number): boolean {
  if (item.ackedAt) return false;
  if (!item.lastAttemptAt) return true;
  return timestamp - item.lastAttemptAt >= retryDelayMs(item);
}

async function ensureConnection(): Promise<SQLiteDBConnection> {
  if (!isNativeMobileRuntime()) {
    throw new Error('Native mobile SQLite is only available in the Capacitor Android/iOS app.');
  }
  if (connection) return connection;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    sqlite = sqlite || new SQLiteConnection(CapacitorSQLite);
    const existing = await sqlite.isConnection(DATABASE_NAME, false).catch(() => ({ result: false }));
    const db = existing.result
      ? await sqlite.retrieveConnection(DATABASE_NAME, false)
      : await sqlite.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false);

    await db.open();
    await db.execute(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS cached_rows (
        id TEXT PRIMARY KEY,
        table_name TEXT NOT NULL,
        business_id TEXT NOT NULL,
        shop_id TEXT,
        rows_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_rows_scope ON cached_rows(table_name, business_id, shop_id);

      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        op TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at INTEGER,
        acked_at INTEGER,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(business_id, shop_id, acked_at, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_outbox_idempotency ON outbox(business_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        shop_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        cashier_name TEXT,
        last_successful_sync_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_state_scope ON sync_state(business_id, shop_id, device_id);
    `);

    connection = db;
    return db;
  })().finally(() => {
    initPromise = null;
  });

  return initPromise;
}

export function getMobileNativeLocalDb() {
  if (!isNativeMobileRuntime()) return undefined;

  return {
    async cacheTableRows(args: {
      table: OfflineCacheTable;
      businessId: string;
      shopId?: string;
      rows: any[];
      updatedAt?: number;
    }): Promise<void> {
      const db = await ensureConnection();
      const updatedAt = args.updatedAt ?? now();
      await db.run(
        `INSERT OR REPLACE INTO cached_rows (id, table_name, business_id, shop_id, rows_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          cacheKey(args.table, args.businessId, args.shopId),
          args.table,
          args.businessId,
          args.shopId || null,
          JSON.stringify(args.rows || []),
          updatedAt,
        ],
      );
    },

    async readCachedTableRows(args: { table: OfflineCacheTable; businessId: string; shopId?: string }): Promise<any[]> {
      const db = await ensureConnection();
      const result = await db.query('SELECT rows_json FROM cached_rows WHERE id = ?', [
        cacheKey(args.table, args.businessId, args.shopId),
      ]);
      return parseJson(result.values?.[0]?.rows_json, []);
    },

    async enqueueOutbox(item: Omit<OutboxItem, 'attemptCount'>): Promise<string> {
      const db = await ensureConnection();
      const id = item.id || crypto.randomUUID();
      const createdAt = item.createdAt || now();
      await db.run(
        `INSERT OR REPLACE INTO outbox (
          id, business_id, shop_id, table_name, op, idempotency_key,
          payload_json, created_at, attempt_count, last_attempt_at, acked_at, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL)`,
        [
          id,
          item.businessId,
          item.shopId,
          item.table,
          item.op,
          item.idempotencyKey,
          JSON.stringify(item.payload || {}),
          createdAt,
        ],
      );
      return id;
    },

    async markOutboxAttempt(args: { id: string; error?: string }): Promise<void> {
      const db = await ensureConnection();
      await db.run(
        `UPDATE outbox
         SET attempt_count = attempt_count + 1,
             last_attempt_at = ?,
             error = ?
         WHERE id = ?`,
        [now(), args.error || null, args.id],
      );
    },

    async markOutboxError(args: { id: string; error: string }): Promise<void> {
      const db = await ensureConnection();
      await db.run('UPDATE outbox SET last_attempt_at = ?, error = ? WHERE id = ?', [now(), args.error, args.id]);
    },

    async markOutboxAcked(args: { id: string }): Promise<void> {
      const db = await ensureConnection();
      await db.run('UPDATE outbox SET acked_at = ?, error = NULL WHERE id = ?', [now(), args.id]);
    },

    async markOutboxBatchAcked(args: { ids: string[] }): Promise<void> {
      if (!args.ids.length) return;
      const db = await ensureConnection();
      const stampedAt = now();
      await db.executeSet(
        args.ids.map(id => ({
          statement: 'UPDATE outbox SET acked_at = ?, error = NULL WHERE id = ?',
          values: [stampedAt, id],
        })),
      );
    },

    async getPendingOutbox(args: { businessId: string; shopId: string; limit?: number; dueOnly?: boolean }): Promise<OutboxItem[]> {
      const db = await ensureConnection();
      const limit = Math.max(1, Math.min(500, Math.floor(args.limit || 50)));
      const queryLimit = args.dueOnly ? Math.min(500, Math.max(limit * 4, limit)) : limit;
      const result = await db.query(
        `SELECT *
         FROM outbox
         WHERE business_id = ? AND shop_id = ? AND acked_at IS NULL
         ORDER BY created_at ASC
         LIMIT ?`,
        [args.businessId, args.shopId, queryLimit],
      );
      const timestamp = now();
      const rows = (result.values || []).map(rowToOutboxItem);
      return (args.dueOnly ? rows.filter(item => isDueForRetry(item, timestamp)) : rows).slice(0, limit);
    },

    async getOutboxStats(args: { businessId: string; shopId: string }): Promise<OutboxStats> {
      const db = await ensureConnection();
      const result = await db.query(
        `SELECT *
         FROM outbox
         WHERE business_id = ? AND shop_id = ? AND acked_at IS NULL
         ORDER BY created_at ASC`,
        [args.businessId, args.shopId],
      );
      const rows = (result.values || []).map(rowToOutboxItem);
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
    },

    async upsertSyncState(args: Omit<SyncStateRow, 'id' | 'updatedAt'>): Promise<void> {
      const db = await ensureConnection();
      const id = `${args.businessId}|${args.shopId}|${args.deviceId}`;
      await db.run(
        `INSERT OR REPLACE INTO sync_state (
          id, business_id, shop_id, device_id, cashier_name, last_successful_sync_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          args.businessId,
          args.shopId,
          args.deviceId,
          args.cashierName || null,
          args.lastSuccessfulSyncAt || null,
          now(),
        ],
      );
    },

    async readSyncState(args: { businessId: string; shopId: string; deviceId: string }): Promise<SyncStateRow | undefined> {
      const db = await ensureConnection();
      const id = `${args.businessId}|${args.shopId}|${args.deviceId}`;
      const result = await db.query('SELECT * FROM sync_state WHERE id = ?', [id]);
      return rowToSyncState(result.values?.[0]);
    },

    async getStatus(): Promise<{ path: string; pending: number; failed: number; platform: string }> {
      const db = await ensureConnection();
      const pending = await db.query('SELECT COUNT(*) AS n FROM outbox WHERE acked_at IS NULL');
      const failed = await db.query('SELECT COUNT(*) AS n FROM outbox WHERE acked_at IS NULL AND error IS NOT NULL');
      return {
        path: DATABASE_NAME,
        pending: Number(pending.values?.[0]?.n || 0),
        failed: Number(failed.values?.[0]?.n || 0),
        platform: getMobilePlatform(),
      };
    },
  };
}
