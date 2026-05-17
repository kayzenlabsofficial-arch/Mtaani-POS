import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !APPROVER_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to approve purchase orders.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const purchaseOrderId = String(body?.purchaseOrderId || body?.id || '').trim();
    const action = String(body?.action || '').trim().toUpperCase();
    if (!businessId || !branchId || !purchaseOrderId) return json({ error: 'Business, branch and purchase order are required.' }, 400);
    if (action !== 'APPROVE' && action !== 'REJECT') return json({ error: 'Approval action is required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const po = await env.DB.prepare(`
      SELECT id, poNumber, approvalStatus, status
      FROM purchaseOrders
      WHERE id = ? AND businessId = ? AND branchId = ?
      LIMIT 1
    `).bind(purchaseOrderId, businessId, branchId).first<any>();
    if (!po) throw new PolicyError('Purchase order was not found.', 404);
    if (po.status === 'RECEIVED') throw new PolicyError('Received purchase orders cannot be changed.', 409);
    if (po.approvalStatus !== 'PENDING' && po.approvalStatus !== (action === 'APPROVE' ? 'APPROVED' : 'REJECTED')) {
      throw new PolicyError('This purchase order has already been processed.', 409);
    }

    const now = Date.now();
    const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const approvedBy = trimText(body?.approvedBy || auth.principal.userName || 'Administrator', 120) || 'Administrator';
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE purchaseOrders
        SET approvalStatus = ?,
            approvedBy = CASE WHEN ? = 'APPROVED' THEN ? ELSE approvedBy END,
            updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ?
      `).bind(nextStatus, nextStatus, approvedBy, now, purchaseOrderId, businessId, branchId),
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        action === 'APPROVE' ? 'purchase.approve' : 'purchase.reject',
        'purchaseOrder',
        purchaseOrderId,
        action === 'APPROVE' ? 'INFO' : 'WARN',
        `${action === 'APPROVE' ? 'Approved' : 'Rejected'} ${po.poNumber || purchaseOrderId}.`,
        businessId,
        branchId,
        now,
      ),
    ]);

    return json({ success: true, purchaseOrderId, approvalStatus: nextStatus });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update purchase approval.' }, status);
  }
};

