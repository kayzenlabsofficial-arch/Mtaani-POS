import { authorizeRequest, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ADMIN_ROLES = new Set(['ROOT', 'ADMIN']);
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

function flag(value: unknown, fallback: number) {
  if (value === undefined || value === null) return fallback;
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  return fallback;
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
    ['mpesaConsumerKey', 'TEXT'],
    ['mpesaConsumerSecret', 'TEXT'],
    ['mpesaPasskey', 'TEXT'],
    ['mpesaEnv', "TEXT DEFAULT 'sandbox'"],
    ['mpesaType', "TEXT DEFAULT 'paybill'"],
    ['mpesaStoreNumber', 'TEXT'],
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
    const existing = await env.DB.prepare(`SELECT * FROM settings WHERE businessId = ? AND id = ? LIMIT 1`)
      .bind(businessId, text(settings.id, `core_${businessId}`, 160))
      .first<any>();
    const fallback = existing || {};
    const now = Date.now();
    const id = text(settings.id, fallback.id || `core_${businessId}`, 160);
    const saved = {
      id,
      storeName: text(settings.storeName, fallback.storeName || 'Mtaani Shop', 160) || 'Mtaani Shop',
      location: text(settings.location, fallback.location || 'Nairobi, Kenya', 160),
      tillNumber: text(settings.tillNumber, fallback.tillNumber || '', 80),
      kraPin: text(settings.kraPin, fallback.kraPin || '', 80),
      receiptFooter: text(settings.receiptFooter, fallback.receiptFooter || 'Thank you for shopping!', 500),
      ownerModeEnabled: flag(settings.ownerModeEnabled, numberValue(fallback.ownerModeEnabled, 0)),
      autoApproveOwnerActions: flag(settings.autoApproveOwnerActions, numberValue(fallback.autoApproveOwnerActions, 1)),
      cashSweepEnabled: flag(settings.cashSweepEnabled, numberValue(fallback.cashSweepEnabled, 1)),
      cashDrawerLimit: Math.max(0, numberValue(settings.cashDrawerLimit, numberValue(fallback.cashDrawerLimit, 5000))),
      salesTills: text(settings.salesTills, fallback.salesTills || '', 4000),
      defaultOpeningFloat: Math.max(0, numberValue(settings.defaultOpeningFloat, numberValue(fallback.defaultOpeningFloat, 0))),
      mpesaConsumerKey: fallback.mpesaConsumerKey || null,
      mpesaConsumerSecret: fallback.mpesaConsumerSecret || null,
      mpesaPasskey: fallback.mpesaPasskey || null,
      mpesaEnv: fallback.mpesaEnv || 'sandbox',
      mpesaType: fallback.mpesaType || 'paybill',
      mpesaStoreNumber: fallback.mpesaStoreNumber || null,
      businessId,
      updated_at: now,
    };

    await env.DB.prepare(`
      INSERT OR REPLACE INTO settings (
        id, storeName, location, tillNumber, kraPin, receiptFooter,
        ownerModeEnabled, autoApproveOwnerActions, cashSweepEnabled, cashDrawerLimit,
        salesTills, defaultOpeningFloat,
        mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey, mpesaEnv, mpesaType, mpesaStoreNumber,
        businessId, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      saved.mpesaConsumerKey,
      saved.mpesaConsumerSecret,
      saved.mpesaPasskey,
      saved.mpesaEnv,
      saved.mpesaType,
      saved.mpesaStoreNumber,
      businessId,
      now,
    ).run();

    return json({ success: true, settings: saved });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not save business settings.' }, 500);
  }
};
