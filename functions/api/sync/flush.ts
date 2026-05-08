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

  let applied = 0;
  let skipped = 0;

  for (const m of mutations) {
    if (m?.table !== 'transactions' || m?.op !== 'UPSERT') {
      return json({ error: 'Only transactions UPSERT supported' }, 400);
    }
    const idempotencyKey = String(m.idempotencyKey || '').trim();
    if (!idempotencyKey) return json({ error: 'idempotencyKey required' }, 400);

    // Idempotency check
    const idemId = `${businessId}|${branchId}|${idempotencyKey}`;
    const insertKey = await env.DB.prepare(
      `INSERT OR IGNORE INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(idemId, businessId, branchId, idempotencyKey, 'transactions:UPSERT', deviceId, cashierName, Date.now())
      .run();

    if ((insertKey as any)?.meta?.changes === 0) {
      skipped += 1;
      continue;
    }

    const payload = m.payload || {};
    payload.businessId = businessId;
    payload.branchId = branchId;

    // Keep schema strict by using D1 table columns
    const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('transactions')`).all();
    const validCols = new Set((pragma as any[]).map((r: any) => r.name));
    const cols = Object.keys(payload).filter((k) => validCols.has(k));
    if (cols.length === 0) return json({ error: 'No valid columns to insert' }, 400);

    const sql = `INSERT OR REPLACE INTO transactions (${cols.map((c) => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    await env.DB.prepare(sql).bind(...cols.map((c) => serializeValue(payload[c]))).run();
    applied += 1;
  }

  return json({ success: true, applied, skipped });
};

