import { getApiKey } from '../runtimeConfig';
import { useStore } from '../store';
import {
  getDeviceId,
  getPendingOutbox,
  markOutboxAcked,
  markOutboxAttempt,
  upsertSyncState,
} from './localdb';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attemptCount: number) {
  const base = Math.min(30_000, 500 * Math.pow(2, Math.min(6, attemptCount)));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

export async function sendHeartbeat(args?: { cashierName?: string }): Promise<void> {
  if (typeof window === 'undefined') return;
  if (!navigator.onLine) return;

  const businessId = useStore.getState().activeBusinessId;
  const branchId = useStore.getState().activeBranchId;
  if (!businessId || !branchId) return;

  const apiKey = await getApiKey();
  const res = await fetch('/api/sync/heartbeat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      'X-Business-ID': businessId,
      'X-Branch-ID': branchId,
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({
      deviceId: getDeviceId(),
      cashierName: args?.cashierName,
      lastSyncAt: Date.now(),
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`heartbeat failed (${res.status}): ${t.slice(0, 120)}`);
  }
}

/**
 * Flush offline outbox in-order. Idempotency is enforced server-side using the idempotencyKey.
 * We deliberately only support `transactions` writes offline for now.
 */
export async function flushOutboxNow(): Promise<{ flushed: number }> {
  if (typeof window === 'undefined') return { flushed: 0 };
  if (!navigator.onLine) return { flushed: 0 };

  const businessId = useStore.getState().activeBusinessId;
  const branchId = useStore.getState().activeBranchId;
  const cashierName = useStore.getState().currentUser?.name;
  if (!businessId || !branchId) return { flushed: 0 };

  const pending = await getPendingOutbox({ businessId, branchId, limit: 25 });
  if (pending.length === 0) return { flushed: 0 };

  const apiKey = await getApiKey();

  let flushed = 0;
  for (const item of pending) {
    // sequential is intentional to preserve causal order for money/stock
    try {
      await markOutboxAttempt(item.id);
      const res = await fetch('/api/sync/flush', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Business-ID': businessId,
          'X-Branch-ID': branchId,
        },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          deviceId: getDeviceId(),
          cashierName,
          mutations: [
            {
              table: item.table,
              op: item.op,
              idempotencyKey: item.idempotencyKey,
              payload: item.payload,
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        await markOutboxAttempt(item.id, { error: `HTTP ${res.status}: ${text.slice(0, 150)}` });
        await sleep(backoffMs(item.attemptCount));
        continue;
      }

      const j: any = await res.json().catch(() => ({}));
      if (!j?.success) {
        await markOutboxAttempt(item.id, { error: j?.error || 'Unknown sync error' });
        await sleep(backoffMs(item.attemptCount));
        continue;
      }

      await markOutboxAcked(item.id);
      flushed += 1;
    } catch (e: any) {
      await markOutboxAttempt(item.id, { error: e?.message || String(e) });
      await sleep(backoffMs(item.attemptCount));
    }
  }

  if (flushed > 0) {
    const deviceId = getDeviceId();
    await upsertSyncState({
      businessId,
      branchId,
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

  return { flushed };
}

