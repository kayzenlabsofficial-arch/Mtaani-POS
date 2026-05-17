import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { hardenTransactionBatch, PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

type Mutation = {
  table: 'transactions';
  op: 'UPSERT';
  idempotencyKey: string;
  payload: any;
};

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders, 'Cache-Control': 'no-store' },
  });
}

function serializeValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function deserializeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function ensureSyncSchema(db: D1Database) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      createdAt INTEGER NOT NULL
    )`
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey)').run();

  await db.prepare('CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER)').run();

  const migrations = [
    'ALTER TABLE transactions ADD COLUMN branchId TEXT',
    'ALTER TABLE transactions ADD COLUMN businessId TEXT',
    'ALTER TABLE transactions ADD COLUMN shiftId TEXT',
    'ALTER TABLE transactions ADD COLUMN approvedBy TEXT',
    'ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT',
    'ALTER TABLE transactions ADD COLUMN changeGiven REAL',
    'ALTER TABLE transactions ADD COLUMN mpesaReference TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCode TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT',
    'ALTER TABLE transactions ADD COLUMN cashierId TEXT',
    'ALTER TABLE transactions ADD COLUMN customerId TEXT',
    'ALTER TABLE transactions ADD COLUMN customerName TEXT',
    'ALTER TABLE transactions ADD COLUMN discount REAL',
    'ALTER TABLE transactions ADD COLUMN discountType TEXT',
    'ALTER TABLE transactions ADD COLUMN splitPayments TEXT',
    'ALTER TABLE transactions ADD COLUMN splitData TEXT',
    'ALTER TABLE transactions ADD COLUMN isSynced INTEGER',
    'ALTER TABLE products ADD COLUMN businessId TEXT',
    'ALTER TABLE products ADD COLUMN branchId TEXT',
    'ALTER TABLE products ADD COLUMN unit TEXT',
    'ALTER TABLE products ADD COLUMN costPrice REAL',
    "ALTER TABLE products ADD COLUMN taxCategory TEXT DEFAULT 'A'",
    'ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN components TEXT',
    'ALTER TABLE products ADD COLUMN updated_at INTEGER',
    'ALTER TABLE customers ADD COLUMN totalSpent REAL',
    'ALTER TABLE customers ADD COLUMN balance REAL',
    'ALTER TABLE customers ADD COLUMN businessId TEXT',
    'ALTER TABLE customers ADD COLUMN updated_at INTEGER',
    'ALTER TABLE productIngredients ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN reference TEXT',
    'ALTER TABLE stockMovements ADD COLUMN branchId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shiftId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER',
  ];
  for (const sql of migrations) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);
  await ensureSyncSchema(env.DB);

  const businessId = request.headers.get('X-Business-ID') || '';
  const branchId = request.headers.get('X-Branch-ID') || '';
  if (!businessId || !branchId) return json({ error: 'X-Business-ID and X-Branch-ID required' }, 400);
  if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied' }, 403);

  const body = (await request.json().catch(() => null)) as any;
  const deviceId = body?.deviceId ? String(body.deviceId).slice(0, 120) : null;
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const mutations: Mutation[] = Array.isArray(body?.mutations) ? body.mutations : [];
  
  if (mutations.length === 0) return json({ success: true, applied: 0, skipped: 0 });
  if (mutations.length > 25) return json({ error: 'Too many offline sales in one sync request.' }, 413);
  if (mutations.some(m => m.table !== 'transactions' || m.op !== 'UPSERT' || !String(m.idempotencyKey || '').trim())) {
    return json({ error: 'Offline sync only accepts valid sale records.' }, 400);
  }

  // Check idempotency before preparing the sale, then write the idempotency row in
  // the same final batch as the transaction and stock effects. If the sale batch
  // fails, the key is not burned and the device can retry safely.
  const idemIds = mutations.map(m => `${businessId}|${branchId}|${String(m.idempotencyKey || '').trim()}`);
  const placeholders = idemIds.map(() => '?').join(',');
  const existingIdem = placeholders
    ? await env.DB.prepare(`SELECT id FROM idempotencyKeys WHERE id IN (${placeholders})`).bind(...idemIds).all()
    : { results: [] };
  const existingIdemIds = new Set(((existingIdem.results || []) as any[]).map(row => String(row.id)));
  const validMutations = mutations.filter((m) => {
    const idempotencyKey = String(m.idempotencyKey || '').trim();
    return !existingIdemIds.has(`${businessId}|${branchId}|${idempotencyKey}`);
  });
  const skippedCount = mutations.length - validMutations.length;

  if (validMutations.length === 0) {
    return json({ success: true, applied: 0, skipped: skippedCount });
  }

  // 2. Build Final Batch. The Worker recalculates totals and stock from server data.
  const finalBatch: D1PreparedStatement[] = [];
  
  // Cache transaction table columns for schema safety
  const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('transactions')`).all();
  const validTxCols = new Set((pragma as any[]).map((r: any) => r.name));

  const transactionMutations = validMutations.filter(m => m.table === 'transactions' && m.op === 'UPSERT');
  const payloads = transactionMutations.map(m => m.payload || {});
  let sideEffects: D1PreparedStatement[] = [];
  try {
    sideEffects = await hardenTransactionBatch({
      db: env.DB,
      businessId,
      branchId,
      principal: auth.principal,
      service: auth.service,
      sourceLabel: 'Sale (Sync)',
    }, payloads);
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 400;
    return json({ error: err?.message || 'Offline sale was rejected.' }, status);
  }

  for (const payload of payloads) {
    payload.businessId = businessId;
    payload.branchId = branchId;

    const cols = Object.keys(payload).filter((k) => validTxCols.has(k));
    if (cols.length > 0) {
      const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      finalBatch.push(env.DB.prepare(sql).bind(...cols.map((c) => serializeValue(payload[c]))));
    }
  }
  finalBatch.push(...sideEffects);
  for (const m of validMutations) {
    const idempotencyKey = String(m.idempotencyKey || '').trim();
    const idemId = `${businessId}|${branchId}|${idempotencyKey}`;
    finalBatch.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(idemId, businessId, branchId, idempotencyKey, 'transactions:UPSERT', deviceId, cashierName, Date.now())
    );
  }

  // Execute final batch in chunks (to stay within D1 limits if many items are synced)
  try {
    if (finalBatch.length > 0) {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < finalBatch.length; i += CHUNK_SIZE) {
        await env.DB.batch(finalBatch.slice(i, i + CHUNK_SIZE));
      }
    }
  } catch (err: any) {
    console.error('[Sync Flush Error]', err?.message || err);
    return json({ error: err?.message || 'Offline sync failed.' }, 500);
  }

  return json({ success: true, applied: validMutations.length, skipped: skippedCount });
};


