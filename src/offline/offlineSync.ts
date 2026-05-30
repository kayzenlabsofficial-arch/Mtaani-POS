import { getApiKey } from '../runtimeConfig';
import { resolveApiUrl } from '../desktop/runtime';
import { useStore } from '../store';
import { normalizedShopId } from '../utils/inventoryIntegrity';
import {
  getDeviceId,
  getOutboxStats,
  getPendingOutbox,
  markOutboxAttempt,
  markOutboxBatchAcked,
  markOutboxError,
  upsertSyncState,
  type OutboxItem,
} from './localdb';

const DEFAULT_FLUSH_BATCH_SIZE = 25;
const MAX_FLUSH_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCHES = 2;

export type FlushOutboxResult = {
  flushed: number;
  attempted: number;
  failed: number;
  pending: number;
  remaining: number;
  errors: string[];
};

type BatchSuccess = { ok: true; applied: number; skipped: number };
type BatchFailure = { ok: false; status?: number; retryable: boolean; error: string };
type BatchResult = BatchSuccess | BatchFailure;

function getSyncScope() {
  const state = useStore.getState();
  return {
    businessId: state.activeBusinessId,
    shopId: normalizedShopId(state.activeShopId),
    cashierName: state.currentUser?.name,
  };
}

function shortError(value: unknown): string {
  return String(value || 'Sync failed.').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function batchFailed(result: BatchResult): result is BatchFailure {
  return result.ok === false;
}

export async function sendHeartbeat(args?: { cashierName?: string }): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!navigator.onLine) return;

  const { businessId, shopId, cashierName: stateCashierName } = getSyncScope();
  if (!businessId) return;
  const stats = await getOutboxStats({ businessId, shopId }).catch(() => null);

  const apiKey = await getApiKey();
  const res = await fetch(resolveApiUrl('/api/sync/heartbeat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Business-ID': businessId,
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({
      deviceId: getDeviceId(),
      shopId,
      cashierName: args?.cashierName ?? stateCashierName,
      lastSyncAt: Date.now(),
      pendingOutboxCount: stats?.pending ?? 0,
      failedOutboxCount: stats?.failed ?? 0,
      oldestPendingAt: stats?.oldestCreatedAt ?? null,
      lastErrorAt: stats?.lastErrorAt ?? null,
      lastSyncError: stats?.lastError ?? null,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`heartbeat failed (${res.status}): ${t.slice(0, 120)}`);
  }
}

async function postMutationBatch(args: {
  apiKey: string;
  businessId: string;
  deviceId: string;
  cashierName?: string;
  items: OutboxItem[];
}): Promise<BatchResult> {
  await Promise.all(args.items.map(item => markOutboxAttempt(item.id)));

  try {
    const res = await fetch(resolveApiUrl('/api/sync/flush'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': args.apiKey,
        'X-Business-ID': args.businessId,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({
        deviceId: args.deviceId,
        cashierName: args.cashierName,
        mutations: args.items.map(item => ({
          table: item.table,
          op: item.op,
          idempotencyKey: item.idempotencyKey,
          payload: item.payload,
        })),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
        error: `HTTP ${res.status}: ${text.slice(0, 150)}`,
      };
    }

    const body: any = await res.json().catch(() => ({}));
    if (!body?.success) {
      return {
        ok: false,
        status: 200,
        retryable: false,
        error: body?.error || 'Unknown sync error',
      };
    }

    return {
      ok: true,
      applied: Number(body.applied || 0),
      skipped: Number(body.skipped || 0),
    };
  } catch (err: any) {
    return {
      ok: false,
      retryable: true,
      error: err?.message || String(err),
    };
  }
}

/**
 * Flush offline outbox in-order. Idempotency is enforced server-side using the idempotencyKey.
 * Failed rows use a retry cooldown so one bad offline sale does not block newer sales.
 */
export async function flushOutboxNow(args: { batchSize?: number; maxBatches?: number } = {}): Promise<FlushOutboxResult> {
  const empty: FlushOutboxResult = { flushed: 0, attempted: 0, failed: 0, pending: 0, remaining: 0, errors: [] };
  if (typeof window === 'undefined') return empty;
  if (!navigator.onLine) return empty;

  const { businessId, shopId, cashierName } = getSyncScope();
  if (!businessId) return empty;

  const batchSize = Math.max(1, Math.min(MAX_FLUSH_BATCH_SIZE, Math.floor(args.batchSize || DEFAULT_FLUSH_BATCH_SIZE)));
  const maxBatches = Math.max(1, Math.floor(args.maxBatches || DEFAULT_MAX_BATCHES));
  const pending = await getPendingOutbox({ businessId, shopId, limit: batchSize * maxBatches, dueOnly: true });
  if (pending.length === 0) {
    const stats = await getOutboxStats({ businessId, shopId }).catch(() => null);
    return {
      ...empty,
      pending: stats?.pending ?? 0,
      remaining: stats?.pending ?? 0,
      failed: stats?.failed ?? 0,
      errors: stats?.lastError ? [stats.lastError] : [],
    };
  }

  const apiKey = await getApiKey();
  const deviceId = getDeviceId();

  let flushed = 0;
  let attempted = 0;
  let failed = 0;
  const errors = new Set<string>();

  for (const chunk of chunkItems(pending, batchSize)) {
    const batch = await postMutationBatch({ apiKey, businessId, deviceId, cashierName, items: chunk });
    attempted += chunk.length;

    if (!batchFailed(batch)) {
      await markOutboxBatchAcked(chunk.map(item => item.id));
      flushed += chunk.length;
      continue;
    }

    const batchError = shortError(batch.error);
    errors.add(batchError);

    if (batch.retryable || chunk.length === 1) {
      await Promise.all(chunk.map(item => markOutboxError(item.id, batchError)));
      failed += chunk.length;
      if (batch.retryable) break;
      continue;
    }

    // A permanent batch rejection can be caused by one bad row. Retry each item
    // alone so valid rows still sync and only the bad rows remain pending.
    for (const item of chunk) {
      const single = await postMutationBatch({ apiKey, businessId, deviceId, cashierName, items: [item] });
      attempted += 1;
      if (!batchFailed(single)) {
        await markOutboxBatchAcked([item.id]);
        flushed += 1;
      } else {
        const itemError = shortError(single.error);
        errors.add(itemError);
        await markOutboxError(item.id, itemError);
        failed += 1;
      }
    }
  }

  if (flushed > 0) {
    const deviceId = getDeviceId();
    await upsertSyncState({
      businessId,
      shopId,
      deviceId,
      cashierName,
      lastSuccessfulSyncAt: Date.now(),
    });
    // best-effort heartbeat for admin visibility
    try {
      await sendHeartbeat({ cashierName });
    } catch {
      // ignore
    }
  }

  const stats = await getOutboxStats({ businessId, shopId }).catch(() => null);
  if (stats?.lastError) errors.add(stats.lastError);

  return {
    flushed,
    attempted,
    failed,
    pending: stats?.pending ?? 0,
    remaining: stats?.pending ?? 0,
    errors: Array.from(errors).slice(0, 3),
  };
}
