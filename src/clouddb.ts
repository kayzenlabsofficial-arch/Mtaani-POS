/**
 * CloudDB — Online-first data layer backed by Cloudflare D1.
 *
 * Architecture:
 * - Each table has an in-memory Map cache, hydrated from D1 on startup.
 * - All reads come from the cache (fast, synchronous lookups).
 * - All writes go to D1 first, then update the cache.
 * - A global event bus triggers React re-renders after any write.
 */

import { useState, useEffect } from 'react';
import { getApiKey } from './runtimeConfig';
import { cacheTableRows, readCachedTableRows, type OfflineCacheTable } from './offline/localdb';
import { enqueueOutbox } from './offline/localdb';

// ── Global change event bus ────────────────────────────────────────────────
// Any CloudTable mutation fires this so useLiveQuery hooks re-run.

const dbEventBus = typeof window !== 'undefined' ? new EventTarget() : null;

function emitChange() {
  dbEventBus?.dispatchEvent(new Event('db:change'));
}

// ── Low-level fetch helpers ────────────────────────────────────────────────
// NOTE: useStore is imported lazily inside each function to break the
// circular dependency: clouddb → store → db → clouddb.

const API = '/api/data';

const OFFLINE_CACHE_TABLES = new Set<OfflineCacheTable>([
  'products',
  'categories',
  'customers',
  'customerPayments',
  'serviceItems',
  'suppliers',
  'settings',
  'branches',
  'users',
  'financialAccounts',
  'expenseAccounts',
  'productIngredients',
]);

const CLIENT_GLOBAL_TABLES = new Set([
  'users',
  'branches',
  'settings',
  'expenseAccounts',
  'financialAccounts',
  'customers',
  'serviceItems',
  'suppliers',
  'products',
  'productIngredients',
  'categories',
  'businesses',
  'loginAttempts',
]);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isLikelyOfflineError(e: any): boolean {
  if (typeof window !== 'undefined' && navigator && navigator.onLine === false) return true;
  const msg = String(e?.message || e || '');
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('fetch') && msg.includes('failed')
  );
}

function sanitizeRowsForClient(table: string, rows: any[]): any[] {
  if (table !== 'branches') return rows;
  return rows.map(row => {
    const clean = { ...row };
    clean.mpesaConsumerKeySet = !!row.mpesaConsumerKeySet || !!row.mpesaConsumerKey;
    clean.mpesaConsumerSecretSet = !!row.mpesaConsumerSecretSet || !!row.mpesaConsumerSecret;
    clean.mpesaPasskeySet = !!row.mpesaPasskeySet || !!row.mpesaPasskey;
    clean.mpesaConfigured = !!row.mpesaConfigured || !!(row.mpesaConsumerKey && row.mpesaConsumerSecret && row.mpesaPasskey);
    delete clean.mpesaConsumerKey;
    delete clean.mpesaConsumerSecret;
    delete clean.mpesaPasskey;
    return clean;
  });
}

async function d1Fetch(table: string, method: string, body?: any): Promise<any> {
  // Lazy import to avoid circular dependency with store.ts
  const { useStore } = await import('./store');
  const businessId = useStore.getState().activeBusinessId;
  const branchId = useStore.getState().activeBranchId;
  const apiKey = await getApiKey();
  const headers: Record<string, string> = { 
    'Content-Type': 'application/json',
    'X-API-Key': apiKey
  };
  
  if (businessId) {
    headers['X-Business-ID'] = businessId;
  } else if (table !== 'businesses' && table !== 'loginAttempts' && !table.startsWith('system')) {
    throw new Error('Business ID missing for ' + method + ' ' + table);
  }
  
  if (branchId) {
    headers['X-Branch-ID'] = branchId;
  }

  const url = `${API}/${table}`;

  try {
    let res: Response | null = null;
    let networkError: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        res = await fetch(url, {
          method,
          headers,
          credentials: 'same-origin',
      // CRITICAL: Bypass service worker & browser cache — always fetch fresh from D1
          cache: 'no-store',
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        break;
      } catch (err) {
        networkError = err;
        if (attempt < 2 && isLikelyOfflineError(err)) {
          await wait(300 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
    if (!res) throw networkError || new Error('Request failed.');

    if (!res.ok) {
      let msg = `${method} /api/data/${table} → ${res.status}`;
      const text = await res.text().catch(() => '');
      try {
        const j: any = text ? JSON.parse(text) : {};
        if (j.error) msg += `: ${j.error}`;
        if (j.message) msg += ` (${j.message})`;
      } catch {
        if (text) msg += `: ${text.slice(0, 100)}`;
      }
      throw new Error(msg);
    }
    
    const rawJson = await res.json();
    const json = Array.isArray(rawJson) ? sanitizeRowsForClient(table, rawJson) : rawJson;

    // Write-through cache for offline reads
    if (method === 'GET' && businessId && OFFLINE_CACHE_TABLES.has(table as OfflineCacheTable)) {
      try {
        const cacheTable = table as OfflineCacheTable;
        const scopedBranchId = headers['X-Branch-ID'] ? (branchId ?? undefined) : undefined;
        await cacheTableRows({
          table: cacheTable,
          businessId,
          branchId: scopedBranchId,
          rows: Array.isArray(json) ? json : [],
          updatedAt: Date.now(),
        });
      } catch (e) {
        console.warn('[CloudDB] Offline cache write failed:', e);
      }
    }

    return json;
  } catch (e: any) {
    console.error(`[CloudDB] Fetch error (${method} ${table}):`, e.message);

    // Offline fallback for reads
    if (method === 'GET' && businessId && OFFLINE_CACHE_TABLES.has(table as OfflineCacheTable) && isLikelyOfflineError(e)) {
      try {
        const cacheTable = table as OfflineCacheTable;
        const scopedBranchId = headers['X-Branch-ID'] ? (branchId ?? undefined) : undefined;
        const rows = sanitizeRowsForClient(table, await readCachedTableRows({ table: cacheTable, businessId, branchId: scopedBranchId }));
        await cacheTableRows({
          table: cacheTable,
          businessId,
          branchId: scopedBranchId,
          rows,
          updatedAt: Date.now(),
        }).catch(() => {});
        console.warn(`[CloudDB] Using offline cache for GET ${table} (${rows.length} rows).`);
        return rows;
      } catch (e2) {
        console.warn('[CloudDB] Offline cache read failed:', e2);
      }
    }

    throw e;
  }
}

async function d1Delete(table: string, id: string): Promise<void> {
  // Lazy import to avoid circular dependency with store.ts
  const { useStore } = await import('./store');
  const businessId = useStore.getState().activeBusinessId;
  const branchId = useStore.getState().activeBranchId;
  const apiKey = await getApiKey();
  const headers: Record<string, string> = { 
    'X-API-Key': apiKey
  };
  
  if (!businessId && table !== 'system/setup' && table !== 'businesses' && table !== 'loginAttempts') {
    throw new Error("Business ID missing. Please log in again.");
  }

  if (businessId) headers['X-Business-ID'] = businessId;
  if (branchId) headers['X-Branch-ID'] = branchId;

  const res = await fetch(`${API}/${table}/${id}`, { 
    method: 'DELETE',
    headers,
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`DELETE /api/data/${table}/${id} → ${res.status}`);
}

/** Global DB setup trigger */
export async function setupRemoteDB(): Promise<void> {
  console.log('[CloudDB] Initializing remote database schema...');
  try {
    await d1Fetch('system/setup', 'POST', {});
    console.log('[CloudDB] Remote database schema initialized successfully.');
  } catch (e: any) {
    console.warn('[CloudDB] Remote setup failed or already done.', e.message);
    // Do not throw; failing to run setup should not crash the app if it's already setup
  }
}

// ── CloudTable ─────────────────────────────────────────────────────────────

export class CloudTable<T extends { id: string }> {
  private cache = new Map<string, T>();
  private loaded = false;
  private loadedScopeKey: string | null = null;

  constructor(public readonly name: string) {}

  private async currentScope(): Promise<{ key: string; canHydrate: boolean }> {
    if (this.name === 'businesses' || this.name === 'loginAttempts' || this.name.startsWith('system')) {
      return { key: `${this.name}:unscoped`, canHydrate: true };
    }

    const { useStore } = await import('./store');
    const businessId = useStore.getState().activeBusinessId;
    const branchId = useStore.getState().activeBranchId;

    if (!businessId) {
      return { key: `${this.name}:no-business`, canHydrate: false };
    }

    if (CLIENT_GLOBAL_TABLES.has(this.name)) {
      return { key: `${this.name}:business:${businessId}`, canHydrate: true };
    }

    if (!branchId) {
      return { key: `${this.name}:business:${businessId}:no-branch`, canHydrate: false };
    }

    return { key: `${this.name}:business:${businessId}:branch:${branchId}`, canHydrate: true };
  }

  private clearIfScopeChanged(scopeKey: string): boolean {
    if (this.loadedScopeKey === scopeKey) return false;
    this.cache.clear();
    this.loaded = false;
    this.loadedScopeKey = scopeKey;
    emitChange();
    return true;
  }

  /**
   * Clears the local cache and marks table as not loaded.
   * Useful when switching tenant context (business/branch) to avoid UI showing stale cached rows.
   */
  reset(): void {
    this.cache.clear();
    this.loaded = false;
    this.loadedScopeKey = null;
    emitChange();
  }

  // ── Hydration ─────────────────────────────────────────────────────────────

  async hydrate(): Promise<void> {
    const scope = await this.currentScope();
    this.clearIfScopeChanged(scope.key);

    if (!scope.canHydrate) {
      this.cache.clear();
      this.loaded = true;
      this.loadedScopeKey = scope.key;
      emitChange();
      return;
    }

    try {
      const rows: T[] = await d1Fetch(this.name, 'GET');
      const latestScope = await this.currentScope();
      if (latestScope.key !== scope.key) {
        this.cache.clear();
        this.loaded = false;
        this.loadedScopeKey = latestScope.key;
        emitChange();
        return;
      }

      // Only clear and update if we successfully got data
      this.cache.clear();
      rows.forEach(r => this.cache.set(r.id, r));
      this.loaded = true;
      this.loadedScopeKey = scope.key;
      emitChange(); // Trigger UI update
    } catch (e) {
      console.error(`[CloudDB] Failed to hydrate "${this.name}":`, e);
      // Keep old cache data on failure
      this.loaded = false; 
    }
  }

  private async ensure(): Promise<void> {
    const scope = await this.currentScope();
    if (!this.loaded || this.loadedScopeKey !== scope.key) await this.hydrate();
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  async toArray(): Promise<T[]> {
    await this.ensure();
    return Array.from(this.cache.values());
  }

  async get(id: string): Promise<T | undefined> {
    await this.ensure();
    return this.cache.get(id);
  }

  async bulkGet(ids: string[]): Promise<(T | undefined)[]> {
    await this.ensure();
    return ids.map(id => this.cache.get(id));
  }

  async count(): Promise<number> {
    await this.ensure();
    return this.cache.size;
  }

  // Lazy where() — all terminal methods call ensure() internally
  where(field: keyof T) {
    const self = this;
    const makeOp = (predicate: (r: T) => boolean, _rev = false, _limit?: number) => {
      const op = {
        toArray: async (): Promise<T[]> => {
          await self.ensure();
          let arr = Array.from(self.cache.values()).filter(predicate);
          if (_rev) arr = arr.reverse();
          if (_limit !== undefined) arr = arr.slice(0, _limit);
          return arr;
        },
        count: async (): Promise<number> => {
          await self.ensure();
          return Array.from(self.cache.values()).filter(predicate).length;
        },
        first: async (): Promise<T | undefined> => {
          await self.ensure();
          const all = Array.from(self.cache.values()).filter(predicate);
          return _rev ? all[all.length - 1] : all[0];
        },
        last: async (): Promise<T | undefined> => {
          await self.ensure();
          const all = Array.from(self.cache.values()).filter(predicate);
          return _rev ? all[0] : all[all.length - 1];
        },
        delete: async (): Promise<number> => {
          await self.ensure();
          const toDelete = Array.from(self.cache.values()).filter(predicate);
          for (const r of toDelete) await self.delete(r.id);
          return toDelete.length;
        },
        // ── KEY FIX: and() is the secondary filter ──────────────────────────
        and: (fn: (r: T) => boolean) => makeOp(r => predicate(r) && fn(r), _rev, _limit),
        filter: (fn: (r: T) => boolean) => makeOp(r => predicate(r) && fn(r), _rev, _limit),
        reverse: () => makeOp(predicate, true, _limit),
        limit: (n: number) => makeOp(predicate, _rev, n),
        sortBy: async (key: keyof T): Promise<T[]> => {
          await self.ensure();
          let arr = Array.from(self.cache.values())
            .filter(predicate)
            .sort((a, b) => (a[key] > b[key] ? 1 : -1));
          if (_rev) arr = arr.reverse();
          return arr;
        },
      };
      return op;
    };

    return {
      equals: (v: any) => makeOp(r => (r[field] as any) === v),
      between: (low: any, high: any, includeLow = true, includeHigh = false) => makeOp(r => {
        const value = r[field] as any;
        const aboveLow = includeLow ? value >= low : value > low;
        const belowHigh = includeHigh ? value <= high : value < high;
        return aboveLow && belowHigh;
      }),
      above: (v: any) => makeOp(r => (r[field] as any) > v),
      aboveOrEqual: (v: any) => makeOp(r => (r[field] as any) >= v),
      below: (v: any) => makeOp(r => (r[field] as any) < v),
      belowOrEqual: (v: any) => makeOp(r => (r[field] as any) <= v),
      anyOf: (vals: any[]) => {
        const s = new Set(vals);
        return makeOp(r => s.has(r[field] as any));
      },
    };
  }

  // Lazy orderBy() chain
  orderBy(field: keyof T) {
    const self = this;
    let _rev = false;
    let _limit: number | undefined;

    const chain = {
      reverse()  { _rev = true; return chain; },
      limit(n: number) { _limit = n; return chain; },
      async toArray(): Promise<T[]> {
        await self.ensure();
        let arr = Array.from(self.cache.values()).sort((a, b) =>
          (a[field] as any) < (b[field] as any) ? -1 : 1
        );
        if (_rev) arr = arr.reverse();
        if (_limit !== undefined) arr = arr.slice(0, _limit);
        return arr;
      },
      async count(): Promise<number> {
        await self.ensure();
        return self.cache.size;
      },
      async first(): Promise<T | undefined> {
        return (await chain.toArray())[0];
      },
    };
    return chain;
  }

  // Arbitrary filter (like Dexie's .filter())
  filter(fn: (r: T) => boolean) {
    const self = this;
    return {
      toArray: async (): Promise<T[]> => {
        await self.ensure();
        return Array.from(self.cache.values()).filter(fn);
      },
      count: async (): Promise<number> => {
        await self.ensure();
        return Array.from(self.cache.values()).filter(fn).length;
      },
    };
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  private stamp(item: any): any {
    return { ...item, updated_at: item.updated_at ?? Date.now() };
  }

  async add(item: T | any): Promise<string> {
    const stamped = this.stamp(item);
    // Optimistically update cache first so UI is immediate
    this.cache.set(stamped.id, stamped);
    emitChange();
    // Then persist to D1 — if it fails, remove from cache and rethrow
    try {
      await d1Fetch(this.name, 'POST', [stamped]);
    } catch (e) {
      const offline = isLikelyOfflineError(e);

      // ── Offline-safe writes (minimal scope) ───────────────────────────────
      // Only allow offline upserts for CASH/QUOTE transactions.
      // Everything else must hard-fail to protect money/data integrity.
      if (
        offline &&
        this.name === 'transactions' &&
        (stamped.status === 'PAID' || stamped.status === 'QUOTE') &&
        (stamped.paymentMethod === 'CASH' || stamped.status === 'QUOTE')
      ) {
        try {
          // Queue for sync (idempotencyKey = transaction.id)
          const { useStore } = await import('./store');
          const businessId = useStore.getState().activeBusinessId;
          const branchId = useStore.getState().activeBranchId;
          if (businessId && branchId) {
            await enqueueOutbox({
              businessId,
              branchId,
              table: 'transactions',
              op: 'UPSERT',
              idempotencyKey: stamped.id,
              payload: stamped,
            });
          }
        } catch (qe) {
          console.warn('[CloudDB] Failed to enqueue offline transaction:', qe);
        }
        // Keep cache entry and resolve successfully so the sale is recorded locally.
        return stamped.id;
      }

      this.cache.delete(stamped.id);
      emitChange();

      if (offline) {
        throw new Error('Offline: this action requires internet connection.');
      }
      throw e;
    }
    return stamped.id;
  }

  async put(item: T | any): Promise<string> {
    return this.add(item);
  }

  async update(id: string, changes: Partial<T> | any): Promise<number> {
    await this.ensure();
    let existing = this.cache.get(id);
    
    // ── KEY FIX: If cache misses, try to pull from server before giving up ──
    if (!existing) {
      console.warn(`[CloudDB] update() cache miss for ${this.name}/${id}. Attempting server fetch...`);
      try {
        const rows: T[] = await d1Fetch(this.name, 'GET');
        rows.forEach(r => this.cache.set(r.id, r));
        existing = this.cache.get(id);
      } catch (e) {
        console.error(`[CloudDB] Server fetch during update failed for ${this.name}/${id}:`, e);
      }
    }

    if (!existing) {
      console.error(`[CloudDB] update() FAILED: record ${this.name}/${id} not found in cache or server.`);
      return 0;
    }
    
    const updated = this.stamp({ ...existing, ...changes }) as T;
    // Optimistically update cache
    this.cache.set(id, updated);
    emitChange();
    // Persist to D1
    try {
      await d1Fetch(this.name, 'POST', [updated]);
    } catch (e) {
      // Rollback cache on failure
      this.cache.set(id, existing);
      emitChange();
      throw e;
    }
    return 1;
  }

  async delete(id: string): Promise<void> {
    await d1Delete(this.name, id);
    this.cache.delete(id);
    emitChange();
  }

  async bulkAdd(items: (T | any)[]): Promise<void> {
    const stamped = items.map(i => this.stamp(i));
    // Optimistic update
    stamped.forEach((i: any) => this.cache.set(i.id, i));
    emitChange();
    try {
      await d1Fetch(this.name, 'POST', stamped);
    } catch (e) {
      const offline = isLikelyOfflineError(e);
      stamped.forEach((i: any) => this.cache.delete(i.id));
      emitChange();
      if (offline) throw new Error('Offline: this action requires internet connection.');
      throw e;
    }
  }

  async bulkPut(items: (T | any)[]): Promise<void> {
    return this.bulkAdd(items);
  }

  async bulkDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await d1Delete(this.name, id);
      this.cache.delete(id);
    }
    emitChange();
  }

  // Force reload from D1 (use after external changes)
  async reload(): Promise<void> {
    this.loaded = false;
    await this.hydrate();
    emitChange();
  }

  // Expose cache for debugging
  get _cache() { return this.cache; }
}


// ── useLiveQuery ───────────────────────────────────────────────────────────
// Drop-in replacement for dexie-react-hooks useLiveQuery.
// Re-runs when deps change OR when any CloudTable mutates.

export function useLiveQuery<T>(
  querier: () => T | Promise<T> | undefined,
  deps: any[] = [],
  defaultResult?: T,
  pollInterval: number = 15000 // Poll every 15s by default for a "live" feel
): T | undefined {
  const [result, setResult] = useState<T | undefined>(defaultResult);

  useEffect(() => {
    let alive = true;

    const run = async (forceHydrate = false) => {
      try {
        // If forceHydrate is true, we should probably trigger a reload on the tables involved
        // But for simplicity, we just re-run the querier.
        // The CloudTable ensure() will only hydrate if !loaded.
        // To truly sync from server, we'd need to know which tables were used.
        // Instead, we'll let the global sync or manual reload handle it.
        const val = await querier();
        if (alive) setResult(val as T);
      } catch (e) {
        console.warn('[useLiveQuery]', e);
      }
    };

    run();

    // Re-run on any local DB mutation
    const handler = () => { if (alive) run(); };
    dbEventBus?.addEventListener('db:change', handler);

    // Polling for remote changes (since we don't have WebSockets)
    const poller = setInterval(() => {
      // We don't want to force hydrate every 15s for EVERY query (too expensive).
      // But for queries that might have remote updates (like transactions), we need it.
      // For now, just re-running the querier helps if the cache was updated elsewhere.
      if (alive) run();
    }, pollInterval);

    return () => {
      alive = false;
      dbEventBus?.removeEventListener('db:change', handler);
      clearInterval(poller);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return result;
}

// ── Background Sync ────────────────────────────────────────────────────────
// Periodically refreshes all tables from the server to catch remote updates.

let syncTimer: any = null;

export function startBackgroundSync(intervalMs = 30000) {
  if (syncTimer) return;
  
  syncTimer = setInterval(async () => {
    // Lazy import to check if we are logged in
    const { useStore } = await import('./store');
    const businessId = useStore.getState().activeBusinessId;
    if (!businessId) return;

    console.log('[CloudDB] Background sync starting...');
    try {
       if (typeof navigator === 'undefined' || navigator.onLine) {
         const { flushOutboxNow } = await import('./offline/offlineSync');
         await flushOutboxNow();
       }
       // We only need to reload tables that have been loaded/used already
       // Tables are exported from db.ts, but clouddb doesn't know about 'db'
       // Instead, we'll let db.ts call a refresh method.
       dbEventBus?.dispatchEvent(new Event('db:sync-request'));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[CloudDB] Background sync failed: ${message}`);
    }
  }, intervalMs);
}

export function stopBackgroundSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}
