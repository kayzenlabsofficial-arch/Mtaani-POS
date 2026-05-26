import { authorizeRequest, hashPassword } from '../authUtils';
import {
  ensureBillingSchema,
  getBillingBusiness,
  getRecentBillingPayments,
  markBillingPaid,
  normalizeBillingStatus,
  publicBillingStatus,
  setBusinessBillingState,
  text,
} from '../billing/_utils';
import { normalizeBusinessSettingsInput } from '../settings/business';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  BUSINESS_BOOTSTRAP_PASSWORD?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function requireBootstrapPassword(env: Env) {
  const password = String(env.BUSINESS_BOOTSTRAP_PASSWORD || '').trim();
  if (password.length < 4) {
    throw new Error('BUSINESS_BOOTSTRAP_PASSWORD must be set in Cloudflare secrets and be at least 4 characters.');
  }
  return password;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      isActive INTEGER DEFAULT 1,
      billingStatus TEXT NOT NULL DEFAULT 'OK',
      billingAmountDue REAL DEFAULT 0,
      billingDueAt INTEGER,
      billingMessage TEXT,
      billingLastPaidAt INTEGER,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      businessId TEXT,
      mustChangePassword INTEGER DEFAULT 0,
      isBootstrapAdmin INTEGER DEFAULT 0,
      updated_at INTEGER
    )
  `).run();
  await ensureBillingSchema(db);
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)`).run();

  const userColumns = [
    'pin TEXT',
    'updated_at INTEGER',
    'mustChangePassword INTEGER DEFAULT 0',
    'isBootstrapAdmin INTEGER DEFAULT 0',
  ];
  for (const column of userColumns) {
    try { await db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run(); } catch {}
  }
  for (const column of [
    ['settings', 'salesTills TEXT'],
    ['settings', 'defaultOpeningFloat REAL DEFAULT 0'],
    ['settings', 'accessControl TEXT'],
    ['salesTills', 'isActive INTEGER DEFAULT 1'],
    ['salesTills', 'businessId TEXT'],
    ['salesTills', 'updated_at INTEGER'],
  ] as const) {
    try { await db.prepare(`ALTER TABLE ${column[0]} ADD COLUMN ${column[1]}`).run(); } catch {}
  }
}

async function requireRoot(request: Request, env: Env) {
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth;
  if (!auth.service && auth.principal.role !== 'ROOT') {
    return { ok: false as const, response: json({ error: 'Root access required.' }, 403) };
  }
  return auth;
}

async function getBusinessDetails(db: D1Database, businessId: string) {
  const business = await getBillingBusiness(db, businessId);
  if (!business) return null;
  const users = await db.prepare(`
    SELECT id, name, role, businessId, mustChangePassword, isBootstrapAdmin, updated_at
    FROM users
    WHERE businessId = ?
    ORDER BY role, name
  `).bind(businessId).all<any>();
  const payments = await getRecentBillingPayments(db, businessId, 12);
  const lockouts = await db.prepare(`
    SELECT *
    FROM loginAttempts
    WHERE id LIKE ?
    ORDER BY updated_at DESC
  `).bind(`LOGIN:${String(business.code || '').toUpperCase()}:%`).all<any>();
  return {
    business,
    billing: publicBillingStatus(business),
    users: users.results || [],
    billingPayments: payments,
    loginAttempts: lockouts.results || [],
  };
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await requireRoot(request, env);
    if (!auth.ok) return auth.response;
    await ensureSchema(env.DB);

    const url = new URL(request.url);
    const businessId = String(url.searchParams.get('businessId') || '').trim();
    if (!businessId) return json({ error: 'Business is required.' }, 400);

    const details = await getBusinessDetails(env.DB, businessId);
    if (!details) return json({ error: 'Business was not found.' }, 404);
    return json({ success: true, ...details });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not load business.' }, 500);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await requireRoot(request, env);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as any;
    const action = String(body?.action || 'CREATE').trim().toUpperCase();
    await ensureSchema(env.DB);
    const now = Date.now();

    if (action === 'CREATE') {
      const name = text(body?.name, '', 160);
      const code = text(body?.code, '', 20).toUpperCase();
      if (!name || !/^[A-Z0-9]{3,20}$/.test(code)) {
        return json({ error: 'Valid business name and code are required.' }, 400);
      }

      const exists = await env.DB.prepare(`SELECT id FROM businesses WHERE code = ? LIMIT 1`).bind(code).first<any>();
      if (exists) return json({ error: 'Business code is already in use.' }, 409);

      const businessId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const bootstrapPassword = requireBootstrapPassword(env);
      const { saved: initialSettings, tills: initialTills } = normalizeBusinessSettingsInput({
        storeName: name,
        location: 'Nairobi, Kenya',
        tillNumber: '',
        kraPin: '',
        receiptFooter: 'Thank you for shopping!',
        ownerModeEnabled: 0,
        autoApproveOwnerActions: 1,
        cashSweepEnabled: 1,
        cashDrawerLimit: 5000,
        salesTills: [{ id: 'till-1', name: 'Till 1', isActive: true }],
        defaultOpeningFloat: 0,
        accessControl: '',
      }, {}, businessId, now);
      const initialTill = initialTills[0];

      await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO businesses (
            id, name, code, isActive, billingStatus, billingAmountDue, billingDueAt, billingMessage, billingLastPaidAt, updated_at
          )
          VALUES (?, ?, ?, 1, 'OK', 0, NULL, '', NULL, ?)
        `).bind(businessId, name, code, now),
        env.DB.prepare(`
          INSERT INTO users (id, name, password, role, businessId, mustChangePassword, isBootstrapAdmin, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(userId, 'admin', await hashPassword(bootstrapPassword), 'ADMIN', businessId, 1, 1, now),
        env.DB.prepare(`
          INSERT INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(`picked_cash_${businessId}`, 'Main account', 'CASH', 0, businessId, 'PICKED-CASH', now),
        env.DB.prepare(`
          INSERT INTO settings (
            id, storeName, location, tillNumber, kraPin, receiptFooter,
            ownerModeEnabled, autoApproveOwnerActions, cashSweepEnabled, cashDrawerLimit,
            salesTills, defaultOpeningFloat, accessControl, businessId, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          initialSettings.id,
          initialSettings.storeName,
          initialSettings.location,
          initialSettings.tillNumber,
          initialSettings.kraPin,
          initialSettings.receiptFooter,
          initialSettings.ownerModeEnabled,
          initialSettings.autoApproveOwnerActions,
          initialSettings.cashSweepEnabled,
          initialSettings.cashDrawerLimit,
          initialSettings.salesTills,
          initialSettings.defaultOpeningFloat,
          initialSettings.accessControl,
          businessId,
          now,
        ),
        env.DB.prepare(`
          INSERT INTO salesTills (id, name, isActive, businessId, updated_at)
          VALUES (?, ?, 1, ?, ?)
        `).bind(initialTill.id, initialTill.name, businessId, now),
      ]);

      return json({ success: true, businessId });
    }

    const businessId = text(body?.businessId, '', 160);
    if (!businessId) return json({ error: 'Business is required.' }, 400);
    const business = await getBillingBusiness(env.DB, businessId);
    if (!business) return json({ error: 'Business was not found.' }, 404);

    if (action === 'UPDATE_BILLING') {
      const status = normalizeBillingStatus(body?.billingStatus);
      const amountDue = Number(body?.amountDue ?? body?.billingAmountDue ?? business.billingAmountDue ?? 0);
      const dueAt = body?.dueAt || body?.billingDueAt ? Number(body?.dueAt || body?.billingDueAt) : null;
      const message = text(body?.message ?? body?.billingMessage, '', 500);
      await setBusinessBillingState(env.DB, businessId, status, amountDue, dueAt, message);
      const details = await getBusinessDetails(env.DB, businessId);
      return json({ success: true, ...details });
    }

    if (action === 'MARK_PAID') {
      const paymentId = crypto.randomUUID();
      const amount = Math.max(0, Number(body?.amount || business.billingAmountDue || 0));
      await env.DB.prepare(`
        INSERT INTO billingPayments (
          id, businessId, phone, amount, reference, checkoutRequestId, merchantRequestId,
          receiptNumber, resultCode, resultDesc, status, createdAt, updated_at
        )
        VALUES (?, ?, '', ?, 'MANUAL', NULL, NULL, ?, 0, 'Marked paid by super admin', 'PAID', ?, ?)
      `).bind(paymentId, businessId, amount, text(body?.receiptNumber, 'MANUAL', 80), now, now).run();
      await markBillingPaid(env.DB, businessId, paymentId);
      const details = await getBusinessDetails(env.DB, businessId);
      return json({ success: true, ...details });
    }

    if (action === 'CLEAR_LOGIN_LOCKOUTS') {
      await env.DB.prepare(`DELETE FROM loginAttempts WHERE id LIKE ?`)
        .bind(`LOGIN:${String(business.code || '').toUpperCase()}:%`)
        .run();
      const details = await getBusinessDetails(env.DB, businessId);
      return json({ success: true, ...details });
    }

    return json({ error: 'Unsupported business action.' }, 400);
  } catch (err: any) {
    return json({ error: err?.message || 'Could not update business.' }, 500);
  }
};
