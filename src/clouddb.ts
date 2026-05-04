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

// ── Global change event bus ────────────────────────────────────────────────
// Any CloudTable mutation fires this so useLiveQuery hooks re-run.

const dbEventBus = typeof window !== 'undefined' ? new EventTarget() : null;

function emitChange() {
  dbEventBus?.dispatchEvent(new Event('db:change'));
}

// ── Low-level fetch helpers ────────────────────────────────────────────────

import { useStore } from './store';

const API = '/api/data';
const API_KEY = (import.meta.env.VITE_API_SECRET as string) || 'mtaani-pos-auth-token-2026';

async function d1Fetch(table: string, method: string, body?: any): Promise<any> {
  const businessId = useStore.getState().activeBusinessId;
  const branchId = useStore.getState().activeBranchId;
  const headers: Record<string, string> = { 
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY
  };
  
  if (businessId) {
    headers['X-Business-ID'] = businessId;
  }
  if (branchId) {
    headers['X-Branch-ID'] = branchId;
  }

  try {
    const res = await fetch(`${API}/${table}`, {
      method,
      headers,
      // CRITICAL: Bypass service worker & browser cache — always fetch fresh from D1
      cache: 'no-store',
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      let msg = `${method} /api/data/${table} → ${res.status}`;
      try { 
        const j: any = await res.json(); 
        if (j.error) msg += `: ${j.error}`;
        if (j.message) msg += ` (${j.message})`;
      } catch {
        const text = await res.text();
        if (text) msg += `: ${text.slice(0, 100)}`;
      }
      throw new Error(msg);
    }
    
    return res.json();
  } catch (e: any) {
    console.error(`[CloudDB] Fetch error (${method} ${table}):`, e.message);
    throw e;
  }
}

async function d1Delete(table: string, id: string): Promise<void> {
  const res = await fetch(`${API}/${table}/${id}`, { 
    method: 'DELETE',
    headers: { 'X-API-Key': API_KEY }
  });
  if (!res.ok) throw new Error(`DELETE /api/data/${table}/${id} → ${res.status}`);
}

/** Global DB setup trigger */
export async function setupRemoteDB(): Promise<void> {
  console.log('[CloudDB] Initializing remote database schema...');
  try {
    await d1Fetch('system/setup', 'POST', {});
    console.log('[CloudDB] Remote database schema initialized successfully.');
  } catch (e) {
    console.error('[CloudDB] Remote setup failed:', e);
    throw e;
  }
}

// ── CloudTable ─────────────────────────────────────────────────────────────

export class CloudTable<T extends { id: string }> {
  private cache = new Map<string, T>();
  private loaded = false;

  constructor(public readonly name: string) {}

  // ── Hydration ─────────────────────────────────────────────────────────────

  async hydrate(): Promise<void> {
    try {
      const rows: T[] = await d1Fetch(this.name, 'GET');
      this.cache.clear();
      rows.forEach(r => this.cache.set(r.id, r));
      this.loaded = true;
    } catch (e) {
      console.error(`[CloudDB] Failed to hydrate "${this.name}":`, e);
    }
  }

  /** Force refetch from cloud */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.hydrate();
  }

  private async ensure(): Promise<void> {
    if (!this.loaded) await this.hydrate();
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
    const makeOp = (predicate: (r: T) => boolean, _rev = false) => {
      const op = {
        toArray: async (): Promise<T[]> => {
          await self.ensure();
          let arr = Array.from(self.cache.values()).filter(predicate);
          if (_rev) arr = arr.reverse();
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
        and: (fn: (r: T) => boolean) => makeOp(r => predicate(r) && fn(r), _rev),
        filter: (fn: (r: T) => boolean) => makeOp(r => predicate(r) && fn(r), _rev),
        reverse: () => makeOp(predicate, true),
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
      this.cache.delete(stamped.id);
      emitChange();
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
      stamped.forEach((i: any) => this.cache.delete(i.id));
      emitChange();
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
  defaultResult?: T
): T | undefined {
  const [result, setResult] = useState<T | undefined>(defaultResult);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const val = await querier();
        if (alive) setResult(val as T);
      } catch (e) {
        console.warn('[useLiveQuery]', e);
      }
    };

    run();

    // Re-run on any DB mutation
    const handler = () => { if (alive) run(); };
    dbEventBus?.addEventListener('db:change', handler);

    return () => {
      alive = false;
      dbEventBus?.removeEventListener('db:change', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return result;
}
