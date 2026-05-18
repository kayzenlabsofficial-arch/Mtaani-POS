import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ADMIN_ROLES = new Set(['ROOT', 'ADMIN']);

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

function boolValue(value: unknown, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value ? 1 : 0;
  return String(value).toLowerCase() === 'true' || value === '1' ? 1 : 0;
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
    if (!auth.service && !ADMIN_ROLES.has(auth.principal.role)) return json({ error: 'Admin access required.' }, 403);

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'SAVE').trim().toUpperCase();
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || auth.principal.businessId || '').trim();
    const branchId = trimText(body?.branchId || body?.branch?.id || request.headers.get('X-Branch-ID'), 160);
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'SAVE') {
      const branch = body?.branch || body || {};
      const name = trimText(branch.name, 120);
      const location = trimText(branch.location, 160);
      if (!name || !location) return json({ error: 'Branch name and location are required.' }, 400);
      const id = trimText(branch.id || body?.branchId, 160) || `branch_${crypto.randomUUID().split('-')[0]}`;
      const existing = await env.DB.prepare(`SELECT id FROM branches WHERE id = ? AND businessId = ? LIMIT 1`)
        .bind(id, businessId)
        .first<any>();
      const savedBranch = {
        id,
        name,
        location,
        phone: trimText(branch.phone, 40) || null,
        tillNumber: trimText(branch.tillNumber, 80) || null,
        kraPin: trimText(branch.kraPin, 40) || null,
        isActive: existing ? boolValue(branch.isActive, true) : 1,
        businessId,
        updated_at: now,
      };
      await env.DB.batch([
        env.DB.prepare(`
          INSERT OR REPLACE INTO branches (id, name, location, phone, tillNumber, kraPin, isActive, businessId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(savedBranch.id, savedBranch.name, savedBranch.location, savedBranch.phone, savedBranch.tillNumber, savedBranch.kraPin, savedBranch.isActive, businessId, now),
        env.DB.prepare(`
          INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), now, auth.principal.userId || null, auth.principal.userName || null, existing ? 'branch.update' : 'branch.create', 'branch', id, 'INFO', `${existing ? 'Updated' : 'Created'} branch ${name}.`, businessId, id, now),
      ]);
      return json({ success: true, branch: savedBranch });
    }

    if (!branchId) return json({ error: 'Branch is required.' }, 400);
    if (!canAccessBranch(auth.principal, branchId)) return json({ error: 'Access denied.' }, 403);
    const branch = await env.DB.prepare(`SELECT * FROM branches WHERE id = ? AND businessId = ? LIMIT 1`)
      .bind(branchId, businessId)
      .first<any>();
    if (!branch) throw new PolicyError('Branch was not found.', 404);

    if (action === 'SET_ACTIVE') {
      const isActive = boolValue(body?.isActive, true);
      if (!isActive) {
        const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM branches WHERE businessId = ? AND isActive = 1`)
          .bind(businessId)
          .first<any>();
        if (Number(row?.count || 0) <= 1) throw new PolicyError('At least one branch must remain active.', 409);
      }
      await env.DB.prepare(`UPDATE branches SET isActive = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(isActive, now, branchId, businessId)
        .run();
      return json({ success: true, branchId, isActive });
    }

    if (action === 'DELETE') {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM branches WHERE businessId = ?`)
        .bind(businessId)
        .first<any>();
      if (Number(row?.count || 0) <= 1) throw new PolicyError('Cannot delete the only remaining branch.', 409);
      const linked = await env.DB.prepare(`
        SELECT
          (SELECT COUNT(*) FROM transactions WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM products WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM expenses WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM purchaseOrders WHERE businessId = ? AND branchId = ?) +
          (SELECT COUNT(*) FROM salesInvoices WHERE businessId = ? AND branchId = ?) AS count
      `).bind(businessId, branchId, businessId, branchId, businessId, branchId, businessId, branchId, businessId, branchId).first<any>();
      if (Number(linked?.count || 0) > 0) throw new PolicyError('Branches with records cannot be deleted. Deactivate it instead.', 409);
      await env.DB.prepare(`DELETE FROM branches WHERE id = ? AND businessId = ?`).bind(branchId, businessId).run();
      return json({ success: true, branchId });
    }

    return json({ error: 'Unsupported branch action.' }, 400);
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not update branch.' }, status);
  }
};

