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
import { isDesktopRuntime, resolveApiUrl } from './desktop/runtime';
import { isNativeMobileRuntime } from './mobile/runtime';
import { normalizedShopId } from './utils/inventoryIntegrity';
import { useStore } from './store';

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
const DATA_READ_FETCH_TIMEOUT_MS = 20000;
const DATA_WRITE_FETCH_TIMEOUT_MS = 45000;

const OFFLINE_CACHE_TABLES = new Set<OfflineCacheTable>([
  'products',
  'transactions',
  'refunds',
  'cashPicks',
  'shifts',
  'endOfDayReports',
  'stockMovements',
  'expenses',
  'categories',
  'customers',
  'customerPayments',
  'salesInvoices',
  'serviceItems',
  'suppliers',
  'supplierPayments',
  'creditNotes',
  'dailySummaries',
  'stockAdjustmentRequests',
  'purchaseOrders',
  'hrStaff',
  'hrStaffDocuments',
  'hrAttendance',
  'hrPayrollAdjustments',
  'settings',
  'salesTills',
  'users',
  'financialAccounts',
  'expenseAccounts',
  'productIngredients',
  'businesses',
]);

const CLIENT_GLOBAL_TABLES = new Set([
  'users',
  'settings',
  'salesTills',
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

const SHOP_SCOPED_TABLES = new Set([
  'products',
  'transactions',
  'refunds',
  'cashPicks',
  'shifts',
  'endOfDayReports',
  'stockMovements',
  'expenses',
  'customers',
  'customerPayments',
  'salesInvoices',
  'suppliers',
  'supplierPayments',
  'creditNotes',
  'dailySummaries',
  'stockAdjustmentRequests',
  'purchaseOrders',
  'hrStaff',
  'hrStaffDocuments',
  'hrAttendance',
  'hrPayrollAdjustments',
]);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function isLikelyOfflineError(e: any): boolean {
  if (typeof window !== 'undefined' && navigator && navigator.onLine === false) return true;
  const msg = String(e?.message || e || '');
  return (
    e?.name === 'AbortError' ||
    msg.includes('aborted') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('fetch') && msg.includes('failed')
  );
}

function sanitizeRowsForClient(table: string, rows: any[]): any[] {
  if (table !== 'settings') return rows;
  return rows.map(row => {
    const clean = { ...row };
    delete clean.mpesaConsumerKey;
    delete clean.mpesaConsumerSecret;
    delete clean.mpesaPasskey;
    delete clean.mpesaEnv;
    delete clean.mpesaType;
    delete clean.mpesaStoreNumber;
    delete clean.consumerKeyCipher;
    delete clean.consumerSecretCipher;
    delete clean.passkeyCipher;
    return clean;
  });
}

async function d1Fetch(table: string, method: string, body?: any): Promise<any> {
  const businessId = useStore.getState().activeBusinessId;
  const activeShopId = useStore.getState().activeShopId;
  const shopId = activeShopId ? normalizedShopId(activeShopId) : '';
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
  if (shopId) headers['X-Shop-ID'] = shopId;
  
  const url = resolveApiUrl(`${API}/${table}`);

  try {
    let res: Response | null = null;
    let networkError: any = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = method === 'GET' ? DATA_READ_FETCH_TIMEOUT_MS : DATA_WRITE_FETCH_TIMEOUT_MS;
      const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
      try {
        res = await fetch(url, {
          method,
          headers,
          credentials: 'same-origin',
      // CRITICAL: Bypass service worker & browser cache — always fetch fresh from D1
          cache: 'no-store',
          signal: controller.signal,
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
      } finally {
        globalThis.clearTimeout(timeout);
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
      // Only force-logout on genuine session expiry — not on missing-header 401s
      // (which can occur during startup before businessId is available)
      if (res.status === 401 && !isDesktopRuntime() && !isNativeMobileRuntime() && (text.includes('Sign in') || text.includes('Session expired') || text.includes('expired'))) {
        console.warn('[CloudDB] Session expired — logging out.');
        useStore.getState().logout();
      }
      throw new Error(msg);
    }
    
    const rawJson = await res.json();
    const json = Array.isArray(rawJson) ? sanitizeRowsForClient(table, rawJson) : rawJson;

    // Write-through cache for offline reads
    if (method === 'GET' && businessId && OFFLINE_CACHE_TABLES.has(table as OfflineCacheTable)) {
      try {
        const cacheTable = table as OfflineCacheTable;
        const cacheShopId = SHOP_SCOPED_TABLES.has(table) ? shopId || undefined : undefined;
        await cacheTableRows({
          table: cacheTable,
          businessId,
          shopId: cacheShopId,
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
        const cacheShopId = SHOP_SCOPED_TABLES.has(table) ? shopId || undefined : undefined;
        const rows = sanitizeRowsForClient(table, await readCachedTableRows({ table: cacheTable, businessId, shopId: cacheShopId }));
        await cacheTableRows({
          table: cacheTable,
          businessId,
          shopId: cacheShopId,
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
  const businessId = useStore.getState().activeBusinessId;
  const activeShopId = useStore.getState().activeShopId;
  const shopId = activeShopId ? normalizedShopId(activeShopId) : '';
  const apiKey = await getApiKey();
  const headers: Record<string, string> = { 
    'X-API-Key': apiKey
  };
  
  if (!businessId && table !== 'system/setup' && table !== 'businesses' && table !== 'loginAttempts') {
    throw new Error("Business ID missing. Please log in again.");
  }

  if (businessId) headers['X-Business-ID'] = businessId;
  if (shopId) headers['X-Shop-ID'] = shopId;

  const res = await fetch(resolveApiUrl(`${API}/${table}/${id}`), { 
    method: 'DELETE',
    headers,
    credentials: 'same-origin',
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`DELETE /api/data/${table}/${id} → ${res.status}`);
}

function isCashPaidTransaction(table: string, row: any): boolean {
  return table === 'transactions' && row?.status === 'PAID' && row?.paymentMethod === 'CASH';
}

async function persistOfflineCacheRow(table: string, row: any): Promise<void> {
  if (!OFFLINE_CACHE_TABLES.has(table as OfflineCacheTable)) return;
  const state = useStore.getState();
  const businessId = row.businessId || state.activeBusinessId;
  if (!businessId) return;
  const shopId = SHOP_SCOPED_TABLES.has(table) ? normalizedShopId(row.shopId || state.activeShopId) : undefined;
  const cachedRows = await readCachedTableRows({ table: table as OfflineCacheTable, businessId, shopId });
  const nextRows = cachedRows.slice();
  const existingIndex = nextRows.findIndex((existing: any) => existing?.id === row.id);
  if (existingIndex >= 0) {
    nextRows[existingIndex] = row;
  } else {
    nextRows.push(row);
  }
  await cacheTableRows({ table: table as OfflineCacheTable, businessId, shopId, rows: nextRows });
}

async function removeOfflineCacheRow(table: string, rowId: string, row?: any): Promise<void> {
  if (!OFFLINE_CACHE_TABLES.has(table as OfflineCacheTable)) return;
  const state = useStore.getState();
  const businessId = row?.businessId || state.activeBusinessId;
  if (!businessId) return;
  const shopId = SHOP_SCOPED_TABLES.has(table) ? normalizedShopId(row?.shopId || state.activeShopId) : undefined;
  const cachedRows = await readCachedTableRows({ table: table as OfflineCacheTable, businessId, shopId });
  const nextRows = cachedRows.filter((existing: any) => existing?.id !== rowId);
  await cacheTableRows({ table: table as OfflineCacheTable, businessId, shopId, rows: nextRows });
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
  private hydrateInFlight: Promise<void> | null = null;
  private hydrateScopeKey: string | null = null;

  constructor(public readonly name: string) {}

  private async currentScope(): Promise<{ key: string; canHydrate: boolean }> {
    if (this.name === 'businesses' || this.name === 'loginAttempts' || this.name.startsWith('system')) {
      return { key: `${this.name}:unscoped`, canHydrate: true };
    }

    const businessId = useStore.getState().activeBusinessId;

    if (!businessId) {
      return { key: `${this.name}:no-business`, canHydrate: false };
    }

    const activeShopId = useStore.getState().activeShopId;
    const shopId = activeShopId ? normalizedShopId(activeShopId) : '';
    if (SHOP_SCOPED_TABLES.has(this.name)) {
      return { key: `${this.name}:business:${businessId}:shop:${shopId || 'none'}`, canHydrate: !!shopId };
    }

    return { key: `${this.name}:business:${businessId}`, canHydrate: true };
  }

  private clearIfScopeChanged(scopeKey: string): boolean {
    if (this.loadedScopeKey === scopeKey) return false;
    this.cache.clear();
    this.loaded = false;
    this.loadedScopeKey = scopeKey;
    return true;
  }

  /**
   * Clears the local cache and marks table as not loaded.
   * Useful when switching business context to avoid UI showing stale cached rows.
   */
  reset(): void {
    this.cache.clear();
    this.loaded = false;
    this.loadedScopeKey = null;
    emitChange();
  }

  private replaceCache(rows: T[], scopeKey: string): void {
    this.cache.clear();
    rows.forEach(r => this.cache.set(r.id, r));
    this.loaded = true;
    this.loadedScopeKey = scopeKey;
    emitChange();
  }

  private async readOfflineRowsForScope(scope: { canHydrate: boolean }): Promise<T[] | null> {
    if (!scope.canHydrate || !OFFLINE_CACHE_TABLES.has(this.name as OfflineCacheTable)) return null;

    const state = useStore.getState();
    const businessId = state.activeBusinessId;
    if (!businessId) return null;

    const isShopScoped = SHOP_SCOPED_TABLES.has(this.name);
    const shopId = isShopScoped ? normalizedShopId(state.activeShopId || '') : undefined;
    if (isShopScoped && !shopId) return null;

    try {
      const rows = await readCachedTableRows({
        table: this.name as OfflineCacheTable,
        businessId,
        shopId,
      });
      return rows.length ? (rows as T[]) : null;
    } catch (e) {
      console.warn(`[CloudDB] Failed to read offline cache for "${this.name}":`, e);
      return null;
    }
  }

  // ── Hydration ─────────────────────────────────────────────────────────────

  async hydrate(): Promise<void> {
    const scope = await this.currentScope();
    if (this.hydrateInFlight && this.hydrateScopeKey === scope.key) {
      await this.hydrateInFlight;
      return;
    }

    const runHydrate = async () => {
      this.clearIfScopeChanged(scope.key);

      if (!scope.canHydrate) {
        this.cache.clear();
        this.loaded = true;
        this.loadedScopeKey = scope.key;
        emitChange();
        return;
      }

      try {
        const offlineRows = await this.readOfflineRowsForScope(scope);
        if (offlineRows) {
          this.replaceCache(offlineRows, scope.key);
        }

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
        this.replaceCache(rows, scope.key); // Trigger UI update
      } catch (e) {
        console.error(`[CloudDB] Failed to hydrate "${this.name}":`, e);
        // Keep offline cache data on failure.
        if (this.cache.size === 0 || this.loadedScopeKey !== scope.key) {
          this.loaded = false;
        }
      }
    };

    this.hydrateScopeKey = scope.key;
    this.hydrateInFlight = runHydrate().finally(() => {
      if (this.hydrateScopeKey === scope.key) {
        this.hydrateInFlight = null;
        this.hydrateScopeKey = null;
      }
    });
    await this.hydrateInFlight;
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
      equals: (v: any) => makeOp(field === 'shopId' ? r => normalizedShopId((r as any)[field]) === normalizedShopId(v) : r => (r[field] as any) === v),
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

    if ((isDesktopRuntime() || isNativeMobileRuntime()) && isCashPaidTransaction(this.name, stamped)) {
      try {
        const businessId = stamped.businessId || useStore.getState().activeBusinessId;
        const shopId = normalizedShopId(stamped.shopId || useStore.getState().activeShopId);
        if (!businessId || !shopId) throw new Error('Business and shop are required for desktop offline sale sync.');
        await enqueueOutbox({
          businessId,
          shopId,
          table: 'transactions',
          op: 'UPSERT',
          idempotencyKey: stamped.id,
          payload: stamped,
        });
        await persistOfflineCacheRow(this.name, stamped);
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          void import('./offline/offlineSync')
            .then(({ flushOutboxNow }) => flushOutboxNow({ maxBatches: 1 }))
            .catch(() => {});
        }
        return stamped.id;
      } catch (e) {
        this.cache.delete(stamped.id);
        emitChange();
        throw e;
      }
    }
    // Then persist to D1 — if it fails, remove from cache and rethrow
    try {
      await d1Fetch(this.name, 'POST', [stamped]);
      await persistOfflineCacheRow(this.name, stamped).catch(e => {
        console.warn('[CloudDB] Offline cache write failed after add:', e);
      });
    } catch (e) {
      const offline = isLikelyOfflineError(e);

      // ── Offline-safe writes (minimal scope) ───────────────────────────────
      // Only allow offline upserts for paid cash register sales.
      // Everything else must hard-fail to protect money/data integrity.
      if (
        offline &&
        this.name === 'transactions' &&
        stamped.status === 'PAID' &&
        stamped.paymentMethod === 'CASH'
      ) {
        try {
          // Queue for sync (idempotencyKey = transaction.id)
          const businessId = useStore.getState().activeBusinessId;
          if (businessId) {
            const activeShopId = normalizedShopId(stamped.shopId || useStore.getState().activeShopId);
            await enqueueOutbox({
              businessId,
              shopId: activeShopId,
              table: 'transactions',
              op: 'UPSERT',
              idempotencyKey: stamped.id,
              payload: stamped,
            });
            await persistOfflineCacheRow(this.name, stamped);
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
      await persistOfflineCacheRow(this.name, updated).catch(e => {
        console.warn('[CloudDB] Offline cache write failed after update:', e);
      });
    } catch (e) {
      // Rollback cache on failure
      this.cache.set(id, existing);
      emitChange();
      throw e;
    }
    return 1;
  }

  async delete(id: string): Promise<void> {
    const existing = this.cache.get(id);
    await d1Delete(this.name, id);
    this.cache.delete(id);
    await removeOfflineCacheRow(this.name, id, existing).catch(e => {
      console.warn('[CloudDB] Offline cache delete failed:', e);
    });
    emitChange();
  }

  async bulkAdd(items: (T | any)[]): Promise<void> {
    const stamped = items.map(i => this.stamp(i));
    // Optimistic update
    stamped.forEach((i: any) => this.cache.set(i.id, i));
    emitChange();
    try {
      await d1Fetch(this.name, 'POST', stamped);
      await Promise.all(stamped.map((row: any) => persistOfflineCacheRow(this.name, row).catch(e => {
        console.warn('[CloudDB] Offline cache write failed after bulkAdd:', e);
      })));
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

  async cacheLocal(item: T | any): Promise<void> {
    const scope = await this.currentScope();
    this.clearIfScopeChanged(scope.key);
    const stamped = this.stamp(item) as T;
    this.cache.set(stamped.id, stamped);
    this.loaded = true;
    this.loadedScopeKey = scope.key;
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

const LIVE_QUERY_CACHE_LIMIT = 500;
const liveQueryResultCache = new Map<string, unknown>();

function liveQueryDepsKey(deps: any[]) {
  try {
    return JSON.stringify(deps);
  } catch {
    return deps.map(dep => String(dep)).join('|');
  }
}

function liveQueryCacheKey(querier: () => unknown, deps: any[]) {
  return `${querier.toString()}::${liveQueryDepsKey(deps)}`;
}

function rememberLiveQueryResult<T>(key: string, value: T | undefined) {
  liveQueryResultCache.set(key, value);
  if (liveQueryResultCache.size > LIVE_QUERY_CACHE_LIMIT) {
    const oldestKey = liveQueryResultCache.keys().next().value;
    if (oldestKey) liveQueryResultCache.delete(oldestKey);
  }
}

export function useLiveQuery<T>(
  querier: () => T | Promise<T> | undefined,
  deps: any[] = [],
  defaultResult?: T,
  pollInterval: number = 15000 // Poll every 15s by default for a "live" feel
): T | undefined {
  const cacheKey = liveQueryCacheKey(querier, deps);
  const [result, setResult] = useState<T | undefined>(() => (
    liveQueryResultCache.has(cacheKey)
      ? liveQueryResultCache.get(cacheKey) as T | undefined
      : defaultResult
  ));

  useEffect(() => {
    let alive = true;
    setResult(
      liveQueryResultCache.has(cacheKey)
        ? liveQueryResultCache.get(cacheKey) as T | undefined
        : defaultResult
    );

    const run = async (forceHydrate = false) => {
      try {
        // If forceHydrate is true, we should probably trigger a reload on the tables involved
        // But for simplicity, we just re-run the querier.
        // The CloudTable ensure() will only hydrate if !loaded.
        // To truly sync from server, we'd need to know which tables were used.
        // Instead, we'll let the global sync or manual reload handle it.
        const val = await querier();
        rememberLiveQueryResult(cacheKey, val as T);
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
  }, [cacheKey, pollInterval]);

  return result;
}

// ── Background Sync ────────────────────────────────────────────────────────
// Periodically refreshes all tables from the server to catch remote updates.

let syncTimer: any = null;
let backgroundSyncRunning = false;
let lastRemoteReloadAt = 0;
let lastHeartbeatAt = 0;
let onlineSyncHandler: (() => void) | null = null;

export function startBackgroundSync(intervalMs = 10000) {
  if (syncTimer) return;
  const nativeOfflineMode = isDesktopRuntime() || isNativeMobileRuntime();
  const heartbeatIntervalMs = nativeOfflineMode ? 60_000 : 30_000;
  const remoteReloadIntervalMs = nativeOfflineMode ? 60 * 60_000 : 30_000;

  const run = async () => {
    if (backgroundSyncRunning) return;
    const state = useStore.getState();
    const businessId = state.activeBusinessId;
    if (!businessId || !state.currentUser) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    backgroundSyncRunning = true;
    try {
      const { flushOutboxNow, sendHeartbeat } = await import('./offline/offlineSync');
      const result = await flushOutboxNow();
      const now = Date.now();

      if (result.flushed > 0) lastHeartbeatAt = now;
      if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
        await sendHeartbeat({ cashierName: useStore.getState().currentUser?.name }).catch(() => {});
        lastHeartbeatAt = Date.now();
      }

      // Dispatch on window so db.ts wire-up can receive and reload tables.
      // Keep remote reloads bounded; outbox flushing runs more often than full table hydration.
      if (typeof window !== 'undefined' && (result.flushed > 0 || now - lastRemoteReloadAt >= remoteReloadIntervalMs)) {
        lastRemoteReloadAt = now;
        window.dispatchEvent(new Event('db:sync-request'));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[CloudDB] Background sync failed: ${message}`);
    } finally {
      backgroundSyncRunning = false;
    }
  };

  void run();
  if (typeof window !== 'undefined') {
    onlineSyncHandler = () => void run();
    window.addEventListener('online', onlineSyncHandler);
  }
  syncTimer = setInterval(() => void run(), intervalMs);
}

export function stopBackgroundSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  if (typeof window !== 'undefined' && onlineSyncHandler) {
    window.removeEventListener('online', onlineSyncHandler);
  }
  onlineSyncHandler = null;
  backgroundSyncRunning = false;
}
