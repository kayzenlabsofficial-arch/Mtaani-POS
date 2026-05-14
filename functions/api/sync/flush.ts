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
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID, X-Branch-ID',
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expectedKey = env.API_SECRET;
  const apiKey = request.headers.get('X-API-Key');
  if (!expectedKey || apiKey !== expectedKey) return json({ error: 'Unauthorized' }, 401);
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const businessId = request.headers.get('X-Business-ID') || '';
  const branchId = request.headers.get('X-Branch-ID') || '';
  if (!businessId || !branchId) return json({ error: 'X-Business-ID and X-Branch-ID required' }, 400);

  const body = (await request.json().catch(() => null)) as any;
  const deviceId = body?.deviceId ? String(body.deviceId).slice(0, 120) : null;
  const cashierName = body?.cashierName ? String(body.cashierName).slice(0, 120) : null;
  const mutations: Mutation[] = Array.isArray(body?.mutations) ? body.mutations : [];
  
  if (mutations.length === 0) return json({ success: true, applied: 0, skipped: 0 });

  // 1. Batch Idempotency Check
  // We use INSERT OR IGNORE to atomically check if this key was already processed.
  const idempotencyStmts = mutations.map(m => {
    const idempotencyKey = String(m.idempotencyKey || '').trim();
    const idemId = `${businessId}|${branchId}|${idempotencyKey}`;
    return env.DB.prepare(
      `INSERT OR IGNORE INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(idemId, businessId, branchId, idempotencyKey, 'transactions:UPSERT', deviceId, cashierName, Date.now());
  });

  const idemResults = await env.DB.batch(idempotencyStmts);
  const validMutations = mutations.filter((m, idx) => (idemResults[idx] as any).meta.changes > 0);
  const skippedCount = mutations.length - validMutations.length;

  if (validMutations.length === 0) {
    return json({ success: true, applied: 0, skipped: skippedCount });
  }

  // 2. Collect Product IDs for Stock Deduction
  const productIds = new Set<string>();
  validMutations.forEach(m => {
    const items = m.payload?.items || [];
    items.forEach((it: any) => {
      const productId = it.productId || it.id;
      if (productId) productIds.add(productId);
    });
  });

  const productsMap = new Map();
  if (productIds.size > 0) {
    const ids = Array.from(productIds);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, name, isBundle, components, stockQuantity FROM products WHERE businessId = ? AND id IN (${placeholders})`
    ).bind(businessId, ...ids).all();
    results.forEach((p: any) => productsMap.set(p.id, deserializeRow(p)));
  }

  const bundleIds = Array.from(productsMap.values())
    .filter((p: any) => p.isBundle === 1 || p.isBundle === true || p.isBundle === '1')
    .map((p: any) => p.id);
  const ingredientsMap = new Map<string, any[]>();
  if (bundleIds.length > 0) {
    const placeholders = bundleIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT productId, ingredientProductId, quantity FROM productIngredients WHERE businessId = ? AND productId IN (${placeholders})`
    ).bind(businessId, ...bundleIds).all();
    results.forEach((row: any) => {
      const arr = ingredientsMap.get(row.productId) || [];
      arr.push(deserializeRow(row));
      ingredientsMap.set(row.productId, arr);
    });
  }

  // 3. Build Final Batch (Transactions + Stock Updates + Movements)
  const finalBatch: D1PreparedStatement[] = [];
  
  // Cache transaction table columns for schema safety
  const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('transactions')`).all();
  const validTxCols = new Set((pragma as any[]).map((r: any) => r.name));

  for (const m of validMutations) {
    if (m.table !== 'transactions' || m.op !== 'UPSERT') continue;

    const payload = m.payload || {};
    payload.businessId = businessId;
    payload.branchId = branchId;

    // A. Transaction Upsert
    const cols = Object.keys(payload).filter((k) => validTxCols.has(k));
    if (cols.length > 0) {
      const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      finalBatch.push(env.DB.prepare(sql).bind(...cols.map((c) => serializeValue(payload[c]))));
    }

    // B. Stock Logic (Skip if not PAID)
    if (payload.status !== 'PAID') continue;

    const items = payload.items || [];
    const txRef = payload.id?.split('-')[0].toUpperCase() || 'SYNC';
    const txTime = payload.timestamp || Date.now();

    for (const item of items) {
      const itemProductId = item.productId || item.id;
      const p = productsMap.get(itemProductId);
      if (!p) continue;

      const saleQty = Number(item.cartQuantity || item.quantity) || 0;
      if (saleQty <= 0) continue;

      if (p.isBundle) {
        // Deduct from components
        const components = ingredientsMap.get(p.id)?.map((row: any) => ({
          productId: row.ingredientProductId,
          quantity: row.quantity,
        })) || (Array.isArray(p.components) ? p.components : []);
        for (const comp of components) {
          const deductQty = (Number(comp.quantity) || 0) * saleQty;
          if (deductQty <= 0) continue;

          // Update stock
          finalBatch.push(
            env.DB.prepare(`UPDATE products SET stockQuantity = MAX(0, stockQuantity - ?) WHERE id = ? AND businessId = ?`)
              .bind(deductQty, comp.productId, businessId)
          );
          // Record movement
          finalBatch.push(
            env.DB.prepare(
              `INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(crypto.randomUUID(), comp.productId, 'OUT', -deductQty, txTime, `Bundle Sale (Sync) #${txRef} (${p.name})`, branchId, businessId, payload.shiftId)
          );
        }
      } else {
        // Regular product deduction
        finalBatch.push(
          env.DB.prepare(`UPDATE products SET stockQuantity = MAX(0, stockQuantity - ?) WHERE id = ? AND businessId = ?`)
            .bind(saleQty, itemProductId, businessId)
        );
        // Record movement
        finalBatch.push(
          env.DB.prepare(
            `INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), itemProductId, 'OUT', -saleQty, txTime, `Sale (Sync) #${txRef}`, branchId, businessId, payload.shiftId)
        );
      }
    }
  }

  // Execute final batch in chunks (to stay within D1 limits if many items are synced)
  if (finalBatch.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < finalBatch.length; i += CHUNK_SIZE) {
      await env.DB.batch(finalBatch.slice(i, i + CHUNK_SIZE));
    }
  }

  return json({ success: true, applied: validMutations.length, skipped: skippedCount });
};


