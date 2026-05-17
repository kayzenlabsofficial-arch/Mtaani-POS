import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function ensureMpesaLedgerSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mpesaCallbacks (
      checkoutRequestId TEXT PRIMARY KEY,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      amount REAL,
      receiptNumber TEXT,
      phoneNumber TEXT,
      businessId TEXT,
      branchId TEXT,
      timestamp INTEGER,
      utilizedTransactionId TEXT,
      utilizedCustomerId TEXT,
      utilizedCustomerName TEXT,
      utilizedAt INTEGER
    )
  `).run();

  for (const sql of [
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT',
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT',
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT',
    'ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER',
    'ALTER TABLE transactions ADD COLUMN mpesaCustomer TEXT',
    'ALTER TABLE transactions ADD COLUMN mpesaCheckoutRequestId TEXT',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, branchId, receiptNumber)',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_timestamp ON mpesaCallbacks(businessId, branchId, timestamp)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const businessId = String(url.searchParams.get('businessId') || request.headers.get('X-Business-ID') || '').trim();
    const branchId = String(url.searchParams.get('branchId') || request.headers.get('X-Branch-ID') || '').trim();
    const from = Number(url.searchParams.get('from') || 0) || 0;
    const to = Number(url.searchParams.get('to') || 0) || 0;
    const search = String(url.searchParams.get('search') || '').trim().toUpperCase();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200) || 200));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0) || 0);

    if (!businessId || !branchId) return json({ error: 'Business and branch are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied' }, 403);

    await ensureMpesaLedgerSchema(env.DB);

    const clauses = ['m.businessId = ?', 'm.branchId = ?', 'COALESCE(m.resultCode, -1) = 0'];
    const bindings: unknown[] = [businessId, branchId];
    if (from) {
      clauses.push('m.timestamp >= ?');
      bindings.push(from);
    }
    if (to) {
      clauses.push('m.timestamp <= ?');
      bindings.push(to);
    }
    if (search) {
      clauses.push(`(
        UPPER(COALESCE(m.receiptNumber, '')) LIKE ?
        OR UPPER(COALESCE(m.checkoutRequestId, '')) LIKE ?
        OR UPPER(COALESCE(m.merchantRequestId, '')) LIKE ?
        OR UPPER(COALESCE(m.phoneNumber, '')) LIKE ?
        OR UPPER(COALESCE(m.resultDesc, '')) LIKE ?
        OR CAST(COALESCE(m.amount, 0) AS TEXT) LIKE ?
      )`);
      bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const where = clauses.join(' AND ');
    const count = await env.DB.prepare(`SELECT COUNT(*) AS count FROM mpesaCallbacks m WHERE ${where}`).bind(...bindings).first<any>();
    const { results } = await env.DB.prepare(`
      SELECT
        m.*,
        COALESCE(m.utilizedTransactionId, (
          SELECT t.id
          FROM transactions t
          WHERE t.businessId = m.businessId
            AND t.branchId = m.branchId
            AND (
              (
                COALESCE(m.receiptNumber, '') != ''
                AND (
                  UPPER(COALESCE(t.mpesaCode, '')) = UPPER(m.receiptNumber)
                  OR UPPER(COALESCE(t.mpesaReference, '')) = UPPER(m.receiptNumber)
                )
              )
              OR (
                COALESCE(m.checkoutRequestId, '') != ''
                AND UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = UPPER(m.checkoutRequestId)
              )
            )
          LIMIT 1
        )) AS linkedTransactionId,
        COALESCE(m.utilizedCustomerName, (
          SELECT t.customerName
          FROM transactions t
          WHERE t.businessId = m.businessId
            AND t.branchId = m.branchId
            AND (
              (
                COALESCE(m.receiptNumber, '') != ''
                AND (
                  UPPER(COALESCE(t.mpesaCode, '')) = UPPER(m.receiptNumber)
                  OR UPPER(COALESCE(t.mpesaReference, '')) = UPPER(m.receiptNumber)
                )
              )
              OR (
                COALESCE(m.checkoutRequestId, '') != ''
                AND UPPER(COALESCE(t.mpesaCheckoutRequestId, '')) = UPPER(m.checkoutRequestId)
              )
            )
          LIMIT 1
        )) AS linkedCustomerName
      FROM mpesaCallbacks m
      WHERE ${where}
      ORDER BY m.timestamp DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all<any>();

    return json({
      rows: (results || []).map((row: any) => {
        const linkedTransactionId = row.linkedTransactionId || null;
        return {
          checkoutRequestId: row.checkoutRequestId,
          merchantRequestId: row.merchantRequestId,
          receiptNumber: row.receiptNumber,
          amount: Number(row.amount || 0),
          phoneNumber: row.phoneNumber,
          resultCode: Number(row.resultCode),
          resultDesc: row.resultDesc,
          paymentStatus: 'PAID',
          utilizationStatus: linkedTransactionId ? 'UTILIZED' : 'UNUTILIZED',
          linkedTransactionId,
          linkedReceiptNumber: linkedTransactionId ? String(linkedTransactionId).split('-')[0].toUpperCase() : null,
          linkedCustomerName: row.linkedCustomerName || null,
          utilizedAt: row.utilizedAt || null,
          timestamp: row.timestamp,
        };
      }),
      total: Number(count?.count || 0),
      limit,
      offset,
    });
  } catch (err: any) {
    console.error('[M-Pesa Transactions Error]', err);
    return json({ error: err?.message || 'Could not load M-Pesa transactions.' }, 500);
  }
};
