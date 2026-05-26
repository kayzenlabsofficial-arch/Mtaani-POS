import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { normalizedAccessControlText } from '../settingsPolicy';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ADMIN_ROLES = new Set(['ROOT', 'ADMIN']);
const MAX_TILLS = 12;
const DEFAULT_CASH_DRAWER_LIMIT = 5000;
const MAX_MONEY_SETTING = 50_000_000;
const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function text(value: unknown, fallback = '', max = 500) {
  const normalized = String(value ?? fallback).trim();
  return normalized.slice(0, max);
}

function numberValue(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function moneySetting(value: unknown, fallback: number) {
  const n = numberValue(value, fallback);
  return Math.min(MAX_MONEY_SETTING, Math.max(0, Math.round(n * 100) / 100));
}

function flag(value: unknown, fallback: number) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return fallback;
}

function parseJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function businessKey(businessId: string) {
  return String(businessId || 'business').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 42) || 'business';
}

function cleanTillName(value: unknown, fallback: string) {
  return text(value, fallback, 60) || fallback;
}

export type NormalizedSalesTill = { id: string; name: string; isActive: boolean };

export function normalizeSalesTills(value: unknown, businessId: string, fallback: unknown = ''): NormalizedSalesTill[] {
  const rawRows = parseJsonArray(value);
  const rows = rawRows.length ? rawRows : parseJsonArray(fallback);
  const key = businessKey(businessId);
  const seen = new Set<string>();
  const normalized: NormalizedSalesTill[] = [];

  for (const row of rows) {
    const isActive = row?.isActive === undefined ? true : row.isActive !== false && row.isActive !== 0 && row.isActive !== '0';
    if (!isActive) continue;

    const position = normalized.length + 1;
    const fallbackId = `${key}-till-${position}`.slice(0, 80);
    const rawId = text(row?.id, '', 80);
    const needsScopedId = !rawId || /^till-\d+$/i.test(rawId);
    let id = (needsScopedId ? fallbackId : rawId).slice(0, 80) || fallbackId;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${id.slice(0, 76)}-${suffix}`.slice(0, 80);
      suffix += 1;
    }
    seen.add(id);
    normalized.push({
      id,
      name: cleanTillName(row?.name, `Till ${position}`),
      isActive: true,
    });
    if (normalized.length >= MAX_TILLS) break;
  }

  return normalized.length ? normalized : [{ id: `${key}-till-1`.slice(0, 80), name: 'Till 1', isActive: true }];
}

function serializeSalesTills(tills: NormalizedSalesTill[]) {
  return JSON.stringify(tills.map(till => ({ id: till.id, name: till.name, isActive: true })));
}

export function normalizeBusinessSettingsInput(settingsValue: any, fallbackValue: any, businessId: string, now = Date.now()) {
  const settings = settingsValue && typeof settingsValue === 'object' ? settingsValue : {};
  const fallback = fallbackValue && typeof fallbackValue === 'object' ? fallbackValue : {};
  const normalizedTills = normalizeSalesTills(settings.salesTills, businessId, fallback.salesTills || '');
  return {
    saved: {
      id: `core_${businessId}`,
      storeName: text(settings.storeName, fallback.storeName || 'Smart Shop', 160) || 'Smart Shop',
      location: text(settings.location, fallback.location || 'Nairobi, Kenya', 160),
      tillNumber: text(settings.tillNumber, fallback.tillNumber || '', 80),
      kraPin: text(settings.kraPin, fallback.kraPin || '', 80),
      receiptFooter: text(settings.receiptFooter, fallback.receiptFooter || 'Thank you for shopping!', 500),
      ownerModeEnabled: flag(settings.ownerModeEnabled, numberValue(fallback.ownerModeEnabled, 0)),
      autoApproveOwnerActions: flag(settings.autoApproveOwnerActions, numberValue(fallback.autoApproveOwnerActions, 1)),
      cashSweepEnabled: flag(settings.cashSweepEnabled, numberValue(fallback.cashSweepEnabled, 1)),
      cashDrawerLimit: moneySetting(settings.cashDrawerLimit, numberValue(fallback.cashDrawerLimit, DEFAULT_CASH_DRAWER_LIMIT)),
      salesTills: serializeSalesTills(normalizedTills),
      defaultOpeningFloat: moneySetting(settings.defaultOpeningFloat, numberValue(fallback.defaultOpeningFloat, 0)),
      accessControl: normalizedAccessControlText(settings.accessControl ?? fallback.accessControl ?? ''),
      businessId,
      updated_at: now,
    },
    tills: normalizedTills,
  };
}

function auditStatement(db: D1Database, principal: any, businessId: string, action: string, entity: string, entityId: string, details: string, now: number, severity = 'INFO') {
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    principal.userId || null,
    principal.userName || null,
    action,
    entity,
    entityId,
    severity,
    details,
    businessId,
    now,
  );
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      storeName TEXT NOT NULL,
      location TEXT,
      tillNumber TEXT,
      kraPin TEXT,
      receiptFooter TEXT,
      ownerModeEnabled INTEGER DEFAULT 0,
      autoApproveOwnerActions INTEGER DEFAULT 1,
      cashSweepEnabled INTEGER DEFAULT 1,
      cashDrawerLimit REAL DEFAULT 5000,
      salesTills TEXT,
      defaultOpeningFloat REAL DEFAULT 0,
      accessControl TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS salesTills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      isActive INTEGER DEFAULT 1,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
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
      updated_at INTEGER
    )
  `).run();
  const columns: Array<[string, string]> = [
    ['location', 'TEXT'],
    ['ownerModeEnabled', 'INTEGER DEFAULT 0'],
    ['autoApproveOwnerActions', 'INTEGER DEFAULT 1'],
    ['cashSweepEnabled', 'INTEGER DEFAULT 1'],
    ['cashDrawerLimit', 'REAL DEFAULT 5000'],
    ['salesTills', 'TEXT'],
    ['defaultOpeningFloat', 'REAL DEFAULT 0'],
    ['accessControl', 'TEXT'],
    ['businessId', 'TEXT'],
    ['updated_at', 'INTEGER'],
  ];
  for (const [name, type] of columns) {
    try {
      await db.prepare(`ALTER TABLE settings ADD COLUMN ${name} ${type}`).run();
    } catch (err) {
      // Column already exists in older deployments.
    }
  }
  for (const sql of [
    'ALTER TABLE salesTills ADD COLUMN isActive INTEGER DEFAULT 1',
    'ALTER TABLE salesTills ADD COLUMN businessId TEXT',
    'ALTER TABLE salesTills ADD COLUMN updated_at INTEGER',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ADMIN_ROLES.has(auth.principal.role)) return json({ error: 'Admin access required.' }, 403);

    const body = await request.json().catch(() => null) as any;
    const settings = body?.settings || body || {};
    const businessId = String(request.headers.get('X-Business-ID') || settings.businessId || auth.principal.businessId || '').trim();
    if (!businessId || !canAccessBusiness(auth.principal, businessId)) return json({ error: 'Access denied.' }, 403);

    await ensureSchema(env.DB);
    const settingsId = `core_${businessId}`;
    const existing = await env.DB.prepare(`SELECT * FROM settings WHERE businessId = ? AND id = ? LIMIT 1`)
      .bind(businessId, settingsId)
      .first<any>();
    const fallback = existing || {};
    const now = Date.now();
    const { saved, tills } = normalizeBusinessSettingsInput(settings, fallback, businessId, now);

    const existingTillRows = await env.DB.prepare(`SELECT * FROM salesTills WHERE businessId = ?`).bind(businessId).all<any>();
    const activeTillIds = new Set(tills.map(till => till.id));
    const tillStatements = [
      ...tills.map(till => env.DB.prepare(`
        INSERT OR REPLACE INTO salesTills (id, name, isActive, businessId, updated_at)
        VALUES (?, ?, 1, ?, ?)
      `).bind(till.id, till.name, businessId, now)),
      ...((existingTillRows.results || []) as any[])
        .filter(row => String(row.id || '').trim() && !activeTillIds.has(String(row.id || '')))
        .map(row => env.DB.prepare(`
          INSERT OR REPLACE INTO salesTills (id, name, isActive, businessId, updated_at)
          VALUES (?, ?, 0, ?, ?)
        `).bind(text(row.id, '', 160), text(row.name, 'Till', 60), businessId, now)),
    ];

    await env.DB.batch([
      env.DB.prepare(`
      INSERT OR REPLACE INTO settings (
        id, storeName, location, tillNumber, kraPin, receiptFooter,
        ownerModeEnabled, autoApproveOwnerActions, cashSweepEnabled, cashDrawerLimit,
        salesTills, defaultOpeningFloat,
        accessControl, businessId, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      saved.id,
      saved.storeName,
      saved.location,
      saved.tillNumber,
      saved.kraPin,
      saved.receiptFooter,
      saved.ownerModeEnabled,
      saved.autoApproveOwnerActions,
      saved.cashSweepEnabled,
      saved.cashDrawerLimit,
      saved.salesTills,
      saved.defaultOpeningFloat,
      saved.accessControl,
      businessId,
      now,
      ),
      ...tillStatements,
      auditStatement(env.DB, auth.principal, businessId, 'settings.business.save', 'settings', saved.id, 'Saved business receipt and profile settings.', now),
      auditStatement(env.DB, auth.principal, businessId, 'settings.tills.save', 'salesTills', businessId, `Saved ${tills.length} active till${tills.length === 1 ? '' : 's'}.`, now),
      auditStatement(env.DB, auth.principal, businessId, 'settings.ownerMode.save', 'settings', saved.id, `Owner mode ${saved.ownerModeEnabled ? 'enabled' : 'disabled'}, cash sweep ${saved.cashSweepEnabled ? 'enabled' : 'disabled'}.`, now),
      auditStatement(env.DB, auth.principal, businessId, 'settings.accessControl.save', 'settings', saved.id, saved.accessControl ? 'Saved access-control policy.' : 'Cleared access-control overrides.', now, 'WARN'),
    ]);

    return json({ success: true, settings: saved, salesTills: tills });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not save business settings.' }, 500);
  }
};
