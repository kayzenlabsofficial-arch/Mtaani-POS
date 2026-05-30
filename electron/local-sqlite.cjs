const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  throw new Error('This Electron build must include node:sqlite to run the desktop offline database.');
}

function now() {
  return Date.now();
}

function cacheKey(table, businessId, shopId) {
  return `${table}|${businessId}|${shopId || ''}`;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function nullableNumber(value) {
  if (value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function retryDelayMs(item) {
  if (!item.lastAttemptAt || item.attemptCount <= 0) return 0;
  return Math.min(60_000, 1_000 * Math.pow(2, Math.min(6, Math.max(0, item.attemptCount - 1))));
}

function isDueForRetry(item, timestamp) {
  if (item.ackedAt) return false;
  if (!item.lastAttemptAt) return true;
  return timestamp - item.lastAttemptAt >= retryDelayMs(item);
}

function rowToOutboxItem(row) {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    shopId: String(row.shop_id),
    table: String(row.table_name),
    op: String(row.op),
    idempotencyKey: String(row.idempotency_key),
    payload: parseJson(row.payload_json, {}),
    createdAt: Number(row.created_at || 0),
    attemptCount: Number(row.attempt_count || 0),
    lastAttemptAt: nullableNumber(row.last_attempt_at),
    ackedAt: nullableNumber(row.acked_at),
    error: row.error === null || row.error === undefined ? undefined : String(row.error),
  };
}

function rowToSyncState(row) {
  if (!row) return undefined;
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    shopId: String(row.shop_id),
    deviceId: String(row.device_id),
    cashierName: row.cashier_name === null || row.cashier_name === undefined ? undefined : String(row.cashier_name),
    lastSuccessfulSyncAt: nullableNumber(row.last_successful_sync_at),
    updatedAt: Number(row.updated_at || 0),
  };
}

function createLocalSqliteStore(app) {
  const configuredPath = process.env.MTAANI_POS_DB_PATH;
  const dbPath = configuredPath || path.join(app.getPath('userData'), 'mtaani-pos-desktop.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
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

  function transaction(fn) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      database.exec('COMMIT');
      return result;
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    path: dbPath,

    close() {
      database.close();
    },

    cacheTableRows(args) {
      const updatedAt = args.updatedAt || now();
      const id = cacheKey(args.table, args.businessId, args.shopId);
      database.prepare(`
        INSERT OR REPLACE INTO cached_rows (id, table_name, business_id, shop_id, rows_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, args.table, args.businessId, args.shopId || null, JSON.stringify(args.rows || []), updatedAt);
    },

    readCachedTableRows(args) {
      const id = cacheKey(args.table, args.businessId, args.shopId);
      const row = database.prepare('SELECT rows_json FROM cached_rows WHERE id = ?').get(id);
      return parseJson(row && row.rows_json, []);
    },

    enqueueOutbox(item) {
      const id = item.id || randomUUID();
      const createdAt = item.createdAt || now();
      database.prepare(`
        INSERT OR REPLACE INTO outbox (
          id, business_id, shop_id, table_name, op, idempotency_key,
          payload_json, created_at, attempt_count, last_attempt_at, acked_at, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
      `).run(
        id,
        item.businessId,
        item.shopId,
        item.table,
        item.op,
        item.idempotencyKey,
        JSON.stringify(item.payload || {}),
        createdAt,
        0,
      );
      return id;
    },

    markOutboxAttempt(args) {
      database.prepare(`
        UPDATE outbox
        SET attempt_count = attempt_count + 1,
            last_attempt_at = ?,
            error = ?
        WHERE id = ?
      `).run(now(), args.error || null, args.id);
    },

    markOutboxError(args) {
      database.prepare('UPDATE outbox SET last_attempt_at = ?, error = ? WHERE id = ?').run(now(), args.error, args.id);
    },

    markOutboxAcked(args) {
      database.prepare('UPDATE outbox SET acked_at = ?, error = NULL WHERE id = ?').run(now(), args.id);
    },

    markOutboxBatchAcked(args) {
      const ids = Array.isArray(args.ids) ? args.ids : [];
      if (ids.length === 0) return;
      const stampedAt = now();
      const stmt = database.prepare('UPDATE outbox SET acked_at = ?, error = NULL WHERE id = ?');
      transaction(() => {
        ids.forEach((id) => stmt.run(stampedAt, id));
      });
    },

    getPendingOutbox(args) {
      const limit = Math.max(1, Math.min(500, Math.floor(args.limit || 50)));
      const queryLimit = args.dueOnly ? Math.min(500, Math.max(limit * 4, limit)) : limit;
      const rows = database.prepare(`
        SELECT *
        FROM outbox
        WHERE business_id = ? AND shop_id = ? AND acked_at IS NULL
        ORDER BY created_at ASC
        LIMIT ?
      `).all(args.businessId, args.shopId, queryLimit);
      const timestamp = now();
      const items = rows.map(rowToOutboxItem);
      return (args.dueOnly ? items.filter(item => isDueForRetry(item, timestamp)) : items).slice(0, limit);
    },

    getOutboxStats(args) {
      const rows = database.prepare(`
        SELECT *
        FROM outbox
        WHERE business_id = ? AND shop_id = ? AND acked_at IS NULL
        ORDER BY created_at ASC
      `).all(args.businessId, args.shopId).map(rowToOutboxItem);
      const failedRows = rows.filter(row => !!row.error);
      const latestFailed = failedRows
        .slice()
        .sort((a, b) => Number(b.lastAttemptAt || 0) - Number(a.lastAttemptAt || 0))[0];
      return {
        pending: rows.length,
        failed: failedRows.length,
        oldestCreatedAt: rows[0] && rows[0].createdAt,
        lastError: latestFailed && latestFailed.error,
        lastErrorAt: latestFailed && latestFailed.lastAttemptAt,
      };
    },

    upsertSyncState(args) {
      const id = `${args.businessId}|${args.shopId}|${args.deviceId}`;
      database.prepare(`
        INSERT OR REPLACE INTO sync_state (
          id, business_id, shop_id, device_id, cashier_name, last_successful_sync_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        args.businessId,
        args.shopId,
        args.deviceId,
        args.cashierName || null,
        args.lastSuccessfulSyncAt || null,
        now(),
      );
    },

    readSyncState(args) {
      const id = `${args.businessId}|${args.shopId}|${args.deviceId}`;
      const row = database.prepare('SELECT * FROM sync_state WHERE id = ?').get(id);
      return rowToSyncState(row);
    },

    getStatus() {
      const pending = database.prepare('SELECT COUNT(*) AS n FROM outbox WHERE acked_at IS NULL').get();
      const failed = database.prepare('SELECT COUNT(*) AS n FROM outbox WHERE acked_at IS NULL AND error IS NOT NULL').get();
      return {
        path: dbPath,
        pending: Number((pending && pending.n) || 0),
        failed: Number((failed && failed.n) || 0),
      };
    },
  };
}

module.exports = { createLocalSqliteStore };
