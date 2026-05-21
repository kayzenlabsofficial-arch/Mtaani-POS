import {
  buildBusinessSnapshot,
  buildPrompt,
  ensureAiSchema,
  getAiSettings,
  getUsage,
  maybeAnswerFromSnapshot,
  runAi,
  truncateText,
} from '../ai/ask';
import { verifyPassword, type Principal } from '../authUtils';
import { PolicyError } from '../salesSecurity';
import { ensureExpenseActionSchema, prepareExpenseApproval } from '../expenses/expenseOps';
import { ensureRefundSchema, prepareRefundApproval } from '../sales/refundOps';

interface Env {
  DB: D1Database;
  AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_GRAPH_API_VERSION?: string;
}

type IncomingMessage = {
  id: string;
  from: string;
  type: string;
  text: string;
  contactName?: string;
  phoneNumberId?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const ACTION_TTL_MS = 15 * 60 * 1000;

function responseText(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function responseJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function normaliseCode(value: unknown) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function normalisePhone(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function money(value: unknown) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  const hasCents = Math.abs(safe % 1) > 0.001;
  return `Ksh ${safe.toLocaleString('en-KE', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function todayBounds(now = Date.now()) {
  const start = Math.floor((now + NAIROBI_OFFSET_MS) / DAY_MS) * DAY_MS - NAIROBI_OFFSET_MS;
  return { start, end: start + DAY_MS };
}

function dateLabel(timestamp: number) {
  return new Date(timestamp + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

function firstWords(value: string, max = 80) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function parseMaybeJson(value: unknown): any {
  if (!value || typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function asArray(value: unknown): any[] {
  const parsed = parseMaybeJson(value);
  return Array.isArray(parsed) ? parsed : [];
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS whatsappContacts (
      phone TEXT PRIMARY KEY,
      displayName TEXT,
      businessId TEXT,
      branchId TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      createdAt INTEGER,
      updated_at INTEGER
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_whatsappContacts_business ON whatsappContacts(businessId, status)').run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS whatsappWebhookMessages (
      id TEXT PRIMARY KEY,
      phone TEXT,
      businessId TEXT,
      messageType TEXT,
      text TEXT,
      createdAt INTEGER
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_whatsappWebhookMessages_phone ON whatsappWebhookMessages(phone, createdAt)').run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS whatsappPendingActions (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      businessId TEXT NOT NULL,
      branchId TEXT,
      actionType TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      payload TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      completedAt INTEGER
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_whatsappPendingActions_lookup ON whatsappPendingActions(phone, businessId, status, expiresAt)').run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS whatsappOutboundMessages (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      businessId TEXT,
      inboundMessageId TEXT,
      status TEXT NOT NULL,
      error TEXT,
      createdAt INTEGER NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_whatsappOutboundMessages_phone ON whatsappOutboundMessages(phone, createdAt)').run();
}

async function hmacSha256Hex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifySignature(request: Request, env: Env, bodyText: string) {
  if (!env.WHATSAPP_APP_SECRET) return true;
  const signature = request.headers.get('X-Hub-Signature-256') || '';
  const expectedPrefix = 'sha256=';
  if (!signature.startsWith(expectedPrefix)) return false;
  const expected = await hmacSha256Hex(env.WHATSAPP_APP_SECRET, bodyText);
  return timingSafeEqual(signature.slice(expectedPrefix.length), expected);
}

function extractMessages(payload: any): IncomingMessage[] {
  const messages: IncomingMessage[] = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      const phoneNumberId = String(value?.metadata?.phone_number_id || '');
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      for (const message of value?.messages || []) {
        const from = normalisePhone(message?.from);
        if (!from) continue;
        const contact = contacts.find((item: any) => normalisePhone(item?.wa_id) === from);
        messages.push({
          id: String(message?.id || crypto.randomUUID()),
          from,
          type: String(message?.type || '').toLowerCase(),
          text: String(message?.text?.body || '').trim(),
          contactName: String(contact?.profile?.name || '').trim() || undefined,
          phoneNumberId,
        });
      }
    }
  }
  return messages;
}

async function sendWhatsAppText(env: Env, to: string, body: string, fallbackPhoneNumberId?: string): Promise<{ ok: boolean; error?: string }> {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID || fallbackPhoneNumberId;
  if (!accessToken || !phoneNumberId) {
    const error = 'WhatsApp is not configured. Missing token or phone number ID.';
    console.error(error);
    return { ok: false, error };
  }

  const version = env.WHATSAPP_GRAPH_API_VERSION || 'v25.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: body.slice(0, 4000),
      },
    }),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => '');
    const error = `WhatsApp send failed (${res.status}): ${details.slice(0, 500)}`;
    console.error(error);
    return { ok: false, error };
  }
  return { ok: true };
}

async function rememberOutbound(db: D1Database, args: {
  to: string;
  businessId?: string | null;
  inboundMessageId?: string | null;
  result: { ok: boolean; error?: string };
}) {
  await db.prepare(`
    INSERT INTO whatsappOutboundMessages (id, phone, businessId, inboundMessageId, status, error, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    args.to,
    args.businessId || null,
    args.inboundMessageId || null,
    args.result.ok ? 'SENT' : 'FAILED',
    args.result.error ? firstWords(args.result.error, 900) : null,
    Date.now(),
  ).run();
}

async function alreadyProcessed(db: D1Database, messageId: string) {
  const row = await db.prepare('SELECT id FROM whatsappWebhookMessages WHERE id = ? LIMIT 1')
    .bind(messageId)
    .first();
  return !!row;
}

async function rememberMessage(db: D1Database, message: IncomingMessage, businessId?: string | null) {
  await db.prepare(`
    INSERT OR IGNORE INTO whatsappWebhookMessages (id, phone, businessId, messageType, text, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    message.id,
    message.from,
    businessId || null,
    message.type,
    firstWords(message.text, 500),
    Date.now(),
  ).run();
}

async function linkedBusiness(db: D1Database, phone: string) {
  return db.prepare(`
    SELECT wc.phone, wc.businessId, wc.branchId, b.name AS businessName, b.code AS businessCode
    FROM whatsappContacts wc
    JOIN businesses b ON b.id = wc.businessId
    WHERE wc.phone = ?
      AND wc.status = 'ACTIVE'
      AND COALESCE(b.isActive, 1) != 0
    LIMIT 1
  `).bind(phone).first<any>();
}

async function linkBusiness(db: D1Database, message: IncomingMessage, code: string) {
  const businessCode = normaliseCode(code);
  if (!/^[A-Z0-9]{3,20}$/.test(businessCode)) {
    return 'Send your business code like this:\nlink ABC123';
  }

  const business = await db.prepare(`
    SELECT id, name, code
    FROM businesses
    WHERE UPPER(code) = ?
      AND COALESCE(isActive, 1) != 0
    LIMIT 1
  `).bind(businessCode).first<any>();

  if (!business) {
    return 'I could not find an active business with that code. Check the code and try again.';
  }

  const now = Date.now();
  await db.prepare(`
    INSERT OR REPLACE INTO whatsappContacts (phone, displayName, businessId, branchId, status, createdAt, updated_at)
    VALUES (?, ?, ?, NULL, 'ACTIVE', COALESCE((SELECT createdAt FROM whatsappContacts WHERE phone = ?), ?), ?)
  `).bind(
    message.from,
    message.contactName || null,
    business.id,
    message.from,
    now,
    now,
  ).run();

  return [
    `Linked to ${business.name}.`,
    '',
    'You can now ask Mtaani AI questions like:',
    'How are sales today?',
    'Which stock is not moving?',
    'Which customers owe us most?',
    '',
    'Quick commands:',
    'summary - today snapshot',
    'branches - active branches',
    'stock - low stock',
    'approvals - pending admin approvals',
    'audit orders - review LPO risks',
    'create LPO ... - draft a purchase order',
    'unlink - remove this WhatsApp link',
  ].join('\n');
}

async function unlinkBusiness(db: D1Database, phone: string) {
  await db.prepare(`
    UPDATE whatsappContacts
    SET status = 'DISABLED', updated_at = ?
    WHERE phone = ?
  `).bind(Date.now(), phone).run();
  return 'This WhatsApp number has been unlinked from Mtaani POS.';
}

function helpText(linked = false) {
  if (!linked) {
    return [
      'Mtaani POS on WhatsApp',
      '',
      'To connect this WhatsApp number, send:',
      'link YOURBUSINESSCODE',
      '',
      'Example:',
      'link ABC123',
    ].join('\n');
  }

  return [
    'Mtaani POS commands',
    '',
    'Ask any POS question, for example:',
    'Which products are slow?',
    'Which customers owe us most?',
    'How are sales today?',
    '',
    'Quick commands:',
    'summary - today snapshot',
    'branches - active branches',
    'stock - low stock',
    'approvals - pending admin approvals',
    'approve A1 1234 - approve with admin PIN',
    'reject A1 1234 - reject with admin PIN',
    'create LPO from Supplier: 10 Product',
    'audit orders - review LPO risks',
    'help - show commands',
    'unlink - remove this WhatsApp link',
  ].join('\n');
}

async function businessSummary(db: D1Database, businessId: string) {
  const { start, end } = todayBounds();
  const [business, settings, branchStats, sales, invoices, expenses, refunds, shifts, lowStock] = await Promise.all([
    db.prepare('SELECT id, name, code FROM businesses WHERE id = ? LIMIT 1').bind(businessId).first<any>(),
    db.prepare('SELECT storeName, location, tillNumber FROM settings WHERE businessId = ? ORDER BY updated_at DESC LIMIT 1').bind(businessId).first<any>(),
    db.prepare('SELECT COUNT(*) AS count FROM branches WHERE businessId = ? AND COALESCE(isActive, 1) != 0').bind(businessId).first<any>(),
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
      FROM transactions
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(status, '')) NOT IN ('VOIDED', 'QUOTE')
    `).bind(businessId, start, end).first<any>(),
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(balance), 0) AS balance
      FROM salesInvoices
      WHERE businessId = ?
        AND issueDate >= ?
        AND issueDate < ?
        AND UPPER(COALESCE(status, '')) != 'CANCELLED'
    `).bind(businessId, start, end).first<any>(),
    db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(status, 'APPROVED')) = 'APPROVED'
    `).bind(businessId, start, end).first<any>(),
    db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM refunds
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(status, 'APPROVED')) != 'REJECTED'
    `).bind(businessId, start, end).first<any>(),
    db.prepare("SELECT COUNT(*) AS count FROM shifts WHERE businessId = ? AND UPPER(COALESCE(status, '')) = 'OPEN'").bind(businessId).first<any>(),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE businessId = ?
        AND COALESCE(reorderPoint, 0) > 0
        AND COALESCE(stockQuantity, 0) <= COALESCE(reorderPoint, 0)
    `).bind(businessId).first<any>(),
  ]);

  const title = settings?.storeName || business?.name || 'Your business';
  const businessCode = business?.code ? ` (${business.code})` : '';
  const invoiceBalance = Number(invoices?.balance || 0);
  const lines = [
    `*${title}${businessCode}*`,
    `Today: ${dateLabel(start)}`,
    '',
    `POS sales: ${money(sales?.total)} from ${Number(sales?.count || 0)} receipts`,
    `Invoices: ${money(invoices?.total)} from ${Number(invoices?.count || 0)} invoices`,
    `Invoice balance: ${money(invoiceBalance)}`,
    `Approved expenses: ${money(expenses?.total)}`,
    `Refunds: ${money(refunds?.total)}`,
    '',
    `Active branches: ${Number(branchStats?.count || 0)}`,
    `Open shifts: ${Number(shifts?.count || 0)}`,
    `Low stock items: ${Number(lowStock?.count || 0)}`,
  ];

  if (settings?.location) lines.push('', `Location: ${settings.location}`);
  if (settings?.tillNumber) lines.push(`Till: ${settings.tillNumber}`);
  return lines.join('\n');
}

async function branchesSummary(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT name, location, phone, tillNumber
    FROM branches
    WHERE businessId = ?
      AND COALESCE(isActive, 1) != 0
    ORDER BY name
    LIMIT 12
  `).bind(businessId).all<any>();

  const branches = results || [];
  if (branches.length === 0) return 'No active branches found for this business.';
  return [
    '*Active branches*',
    '',
    ...branches.map((branch: any, index: number) => {
      const details = [
        branch.location ? String(branch.location) : '',
        branch.phone ? `Phone ${branch.phone}` : '',
        branch.tillNumber ? `Till ${branch.tillNumber}` : '',
      ].filter(Boolean).join(' | ');
      return `${index + 1}. ${branch.name}${details ? `\n   ${details}` : ''}`;
    }),
  ].join('\n');
}

async function stockSummary(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT name, stockQuantity, reorderPoint, unit
    FROM products
    WHERE businessId = ?
      AND COALESCE(reorderPoint, 0) > 0
      AND COALESCE(stockQuantity, 0) <= COALESCE(reorderPoint, 0)
    ORDER BY stockQuantity ASC, name ASC
    LIMIT 10
  `).bind(businessId).all<any>();

  const products = results || [];
  if (products.length === 0) return 'No low-stock products right now.';
  return [
    '*Low stock products*',
    '',
    ...products.map((product: any, index: number) => {
      const unit = product.unit ? ` ${product.unit}` : '';
      return `${index + 1}. ${product.name}: ${Number(product.stockQuantity || 0)}${unit} left (reorder at ${Number(product.reorderPoint || 0)}${unit})`;
    }),
  ].join('\n');
}

type ApprovalType = 'EXPENSE' | 'REFUND' | 'LPO' | 'STOCK' | 'CASH';

type ApprovalItem = {
  code: string;
  type: ApprovalType;
  id: string;
  businessId: string;
  branchId: string;
  title: string;
  details: string;
  amount?: number;
};

function shortId(id: string) {
  return String(id || '').split('-')[0].slice(0, 8).toUpperCase();
}

function principalForAdmin(admin: any, businessId: string, branchId?: string | null): Principal {
  return {
    userId: String(admin.id || 'whatsapp-admin'),
    userName: String(admin.name || 'WhatsApp Admin'),
    role: 'ADMIN',
    businessId,
    branchId: branchId || admin.branchId || undefined,
    exp: Date.now() + 60_000,
  };
}

async function verifyAdminPin(db: D1Database, businessId: string, phone: string, pin: string, branchId?: string | null) {
  const cleanPin = String(pin || '').trim();
  if (cleanPin.length < 4) throw new PolicyError('Admin PIN is required.', 401);

  await db.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
  const attemptId = `WHATSAPP_ADMIN_PIN:${businessId}:${phone}`;
  const attempt = await db.prepare('SELECT count, lockedUntil FROM loginAttempts WHERE id = ?').bind(attemptId).first<any>();
  if (attempt?.lockedUntil && Date.now() < Number(attempt.lockedUntil)) {
    const mins = Math.ceil((Number(attempt.lockedUntil) - Date.now()) / 60000);
    throw new PolicyError(`PIN check is locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 423);
  }

  const { results } = await db.prepare('SELECT id, name, role, password, pin, branchId FROM users WHERE businessId = ? AND role = ?')
    .bind(businessId, 'ADMIN')
    .all<any>();

  for (const admin of results || []) {
    const rawPin = typeof admin.pin === 'string' ? admin.pin : '';
    const pinOk = rawPin ? rawPin === cleanPin : false;
    const passwordOk = await verifyPassword(cleanPin, String(admin.password || ''));
    if (pinOk || passwordOk) {
      await db.prepare('DELETE FROM loginAttempts WHERE id = ?').bind(attemptId).run();
      return principalForAdmin(admin, businessId, branchId);
    }
  }

  const nextCount = Number(attempt?.count || 0) + 1;
  const lockedUntil = nextCount >= 5 ? Date.now() + 15 * 60 * 1000 : null;
  await db.prepare('INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)')
    .bind(attemptId, nextCount, lockedUntil, Date.now())
    .run();
  throw new PolicyError('Invalid admin PIN.', 401);
}

function auditLog(db: D1Database, args: {
  principal: Principal;
  businessId: string;
  branchId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  details: string;
}) {
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    args.principal.userId,
    args.principal.userName,
    args.action,
    args.entity,
    args.entityId,
    args.severity,
    args.details,
    args.businessId,
    args.branchId || null,
    now,
  );
}

async function ensureActionTables(db: D1Database) {
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

async function loadPendingApprovals(db: D1Database, businessId: string): Promise<ApprovalItem[]> {
  const items: Omit<ApprovalItem, 'code'>[] = [];
  const [expenses, refunds, pos, stock, cash] = await Promise.all([
    db.prepare(`
      SELECT e.id, e.amount, e.category, e.description, e.userName, e.branchId, b.name AS branchName
      FROM expenses e
      LEFT JOIN branches b ON b.id = e.branchId AND b.businessId = e.businessId
      WHERE e.businessId = ? AND UPPER(COALESCE(e.status, '')) = 'PENDING'
      ORDER BY e.timestamp DESC
      LIMIT 8
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
    db.prepare(`
      SELECT t.id, t.total, t.cashierName, t.customerName, t.branchId, b.name AS branchName
      FROM transactions t
      LEFT JOIN branches b ON b.id = t.branchId AND b.businessId = t.businessId
      WHERE t.businessId = ? AND UPPER(COALESCE(t.status, '')) = 'PENDING_REFUND'
      ORDER BY t.timestamp DESC
      LIMIT 8
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
    db.prepare(`
      SELECT po.id, po.poNumber, po.totalAmount, po.supplierId, po.items, po.branchId, s.name AS supplierName, s.company, b.name AS branchName
      FROM purchaseOrders po
      LEFT JOIN suppliers s ON s.id = po.supplierId AND s.businessId = po.businessId
      LEFT JOIN branches b ON b.id = po.branchId AND b.businessId = po.businessId
      WHERE po.businessId = ? AND UPPER(COALESCE(po.approvalStatus, '')) = 'PENDING'
      ORDER BY po.orderDate DESC
      LIMIT 8
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
    db.prepare(`
      SELECT sr.id, sr.productName, sr.productId, sr.oldQty, sr.newQty, sr.reason, sr.branchId, b.name AS branchName
      FROM stockAdjustmentRequests sr
      LEFT JOIN branches b ON b.id = sr.branchId AND b.businessId = sr.businessId
      WHERE sr.businessId = ? AND UPPER(COALESCE(sr.status, '')) = 'PENDING'
      ORDER BY sr.timestamp DESC
      LIMIT 8
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
    db.prepare(`
      SELECT cp.id, cp.amount, cp.userName, cp.branchId, b.name AS branchName
      FROM cashPicks cp
      LEFT JOIN branches b ON b.id = cp.branchId AND b.businessId = cp.businessId
      WHERE cp.businessId = ? AND UPPER(COALESCE(cp.status, '')) = 'PENDING'
      ORDER BY cp.timestamp DESC
      LIMIT 8
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
  ]);

  for (const row of expenses.results || []) {
    items.push({
      type: 'EXPENSE',
      id: row.id,
      businessId,
      branchId: row.branchId,
      title: `Expense ${money(row.amount)} - ${row.category || 'General'}`,
      details: `${row.branchName || 'Branch'}${row.userName ? ` | ${row.userName}` : ''}${row.description ? ` | ${firstWords(row.description, 60)}` : ''}`,
      amount: asNumber(row.amount),
    });
  }
  for (const row of refunds.results || []) {
    items.push({
      type: 'REFUND',
      id: row.id,
      businessId,
      branchId: row.branchId,
      title: `Refund ${money(row.total)} - receipt ${shortId(row.id)}`,
      details: `${row.branchName || 'Branch'}${row.cashierName ? ` | ${row.cashierName}` : ''}${row.customerName ? ` | ${row.customerName}` : ''}`,
      amount: asNumber(row.total),
    });
  }
  for (const row of pos.results || []) {
    const itemCount = asArray(row.items).length;
    items.push({
      type: 'LPO',
      id: row.id,
      businessId,
      branchId: row.branchId,
      title: `${row.poNumber || shortId(row.id)} ${money(row.totalAmount)}`,
      details: `${row.branchName || 'Branch'} | ${row.company || row.supplierName || 'Supplier'} | ${itemCount} item${itemCount === 1 ? '' : 's'}`,
      amount: asNumber(row.totalAmount),
    });
  }
  for (const row of stock.results || []) {
    items.push({
      type: 'STOCK',
      id: row.id,
      businessId,
      branchId: row.branchId,
      title: `Stock adjust ${row.productName || row.productId}`,
      details: `${row.branchName || 'Branch'} | ${asNumber(row.oldQty)} -> ${asNumber(row.newQty)} | ${firstWords(row.reason || '', 60)}`,
    });
  }
  for (const row of cash.results || []) {
    items.push({
      type: 'CASH',
      id: row.id,
      businessId,
      branchId: row.branchId,
      title: `Cash pick ${money(row.amount)}`,
      details: `${row.branchName || 'Branch'}${row.userName ? ` | ${row.userName}` : ''}`,
      amount: asNumber(row.amount),
    });
  }

  return items.slice(0, 20).map((item, index) => ({ ...item, code: `A${index + 1}` }));
}

async function approvalsSummary(db: D1Database, businessId: string) {
  const items = await loadPendingApprovals(db, businessId);
  if (items.length === 0) return 'No pending admin approvals right now.';
  return [
    '*Pending approvals*',
    '',
    ...items.map(item => `${item.code}. [${item.type}] ${item.title}\n   ${item.details}`),
    '',
    'Reply with:',
    'approve A1 1234',
    'reject A1 1234',
  ].join('\n');
}

async function ensurePickedCashAccount(db: D1Database, businessId: string, branchId: string) {
  const id = trimText(`picked_cash_${businessId}_${branchId}`, 160);
  const now = Date.now();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, branchId, accountNumber, updated_at)
    VALUES (?, 'Picked cash', 'CASH', 0, ?, ?, 'PICKED-CASH', ?)
  `).bind(id, businessId, branchId, now).run();
  return id;
}

async function applyApprovalAction(db: D1Database, item: ApprovalItem, principal: Principal, action: 'APPROVE' | 'REJECT', phone: string) {
  await ensureActionTables(db);
  const now = Date.now();
  const approvedBy = principal.userName || 'WhatsApp Admin';

  if (item.type === 'EXPENSE') {
    if (action === 'APPROVE') {
      await ensureExpenseActionSchema(db);
      const prepared = await prepareExpenseApproval(db, {
        businessId: item.businessId,
        branchId: item.branchId,
        principal,
        service: false,
        expenseId: item.id,
        approvedBy,
      });
      if (prepared.statements.length) await db.batch(prepared.statements);
      return `Approved expense ${item.code}: ${money(prepared.expense?.amount)}.`;
    }
    const expense = await db.prepare('SELECT id, amount, status FROM expenses WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1')
      .bind(item.id, item.businessId, item.branchId)
      .first<any>();
    if (!expense) throw new PolicyError('Expense was not found.', 404);
    if (String(expense.status || '').toUpperCase() !== 'PENDING') throw new PolicyError('This expense has already been processed.', 409);
    await db.batch([
      db.prepare("UPDATE expenses SET status = 'REJECTED', updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?").bind(now, item.id, item.businessId, item.branchId),
      auditLog(db, { principal, businessId: item.businessId, branchId: item.branchId, action: 'expense.reject.whatsapp', entity: 'expense', entityId: item.id, severity: 'WARN', details: `Rejected expense via WhatsApp (${phone}).` }),
    ]);
    return `Rejected expense ${item.code}.`;
  }

  if (item.type === 'REFUND') {
    if (action === 'APPROVE') {
      await ensureRefundSchema(db);
      const prepared = await prepareRefundApproval(db, {
        businessId: item.businessId,
        branchId: item.branchId,
        principal,
        service: false,
        transactionId: item.id,
        approvedBy,
        idempotencyKey: `whatsapp:${item.id}`,
      });
      if (prepared.statements.length) await db.batch(prepared.statements);
      return `Approved refund ${item.code}: ${money(prepared.refund?.amount || item.amount)}.`;
    }
    const tx = await db.prepare("SELECT id, status, total, items FROM transactions WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1")
      .bind(item.id, item.businessId, item.branchId)
      .first<any>();
    if (!tx) throw new PolicyError('Receipt was not found.', 404);
    if (String(tx.status || '').toUpperCase() !== 'PENDING_REFUND') throw new PolicyError('This refund has already been processed.', 409);
    const restoredStatus = asArray(tx.items).some(line => asNumber(line?.returnedQuantity) > 0) ? 'PARTIAL_REFUND' : 'PAID';
    await db.batch([
      db.prepare("UPDATE transactions SET status = ?, pendingRefundItems = NULL, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?")
        .bind(restoredStatus, now, item.id, item.businessId, item.branchId),
      auditLog(db, { principal, businessId: item.businessId, branchId: item.branchId, action: 'sale.refund.reject.whatsapp', entity: 'transaction', entityId: item.id, severity: 'WARN', details: `Rejected refund via WhatsApp (${phone}).` }),
    ]);
    return `Rejected refund ${item.code}.`;
  }

  if (item.type === 'LPO') {
    const po = await db.prepare('SELECT id, poNumber, approvalStatus, status FROM purchaseOrders WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1')
      .bind(item.id, item.businessId, item.branchId)
      .first<any>();
    if (!po) throw new PolicyError('LPO was not found.', 404);
    if (String(po.status || '').toUpperCase() === 'RECEIVED') throw new PolicyError('Received LPOs cannot be changed.', 409);
    if (String(po.approvalStatus || '').toUpperCase() !== 'PENDING') throw new PolicyError('This LPO has already been processed.', 409);
    const next = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    await db.batch([
      db.prepare(`
        UPDATE purchaseOrders
        SET approvalStatus = ?, approvedBy = CASE WHEN ? = 'APPROVED' THEN ? ELSE approvedBy END, updated_at = ?
        WHERE id = ? AND businessId = ? AND branchId = ?
      `).bind(next, next, approvedBy, now, item.id, item.businessId, item.branchId),
      auditLog(db, { principal, businessId: item.businessId, branchId: item.branchId, action: action === 'APPROVE' ? 'purchase.approve.whatsapp' : 'purchase.reject.whatsapp', entity: 'purchaseOrder', entityId: item.id, severity: action === 'APPROVE' ? 'INFO' : 'WARN', details: `${action === 'APPROVE' ? 'Approved' : 'Rejected'} ${po.poNumber || item.id} via WhatsApp (${phone}).` }),
    ]);
    return `${action === 'APPROVE' ? 'Approved' : 'Rejected'} LPO ${item.code}: ${po.poNumber || shortId(item.id)}.`;
  }

  if (item.type === 'STOCK') {
    const req = await db.prepare('SELECT * FROM stockAdjustmentRequests WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1')
      .bind(item.id, item.businessId, item.branchId)
      .first<any>();
    if (!req) throw new PolicyError('Stock adjustment was not found.', 404);
    if (String(req.status || '').toUpperCase() !== 'PENDING') throw new PolicyError('This stock adjustment has already been processed.', 409);
    if (action === 'REJECT') {
      await db.batch([
        db.prepare("UPDATE stockAdjustmentRequests SET status = 'REJECTED', approvedBy = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?")
          .bind(approvedBy, now, item.id, item.businessId, item.branchId),
        auditLog(db, { principal, businessId: item.businessId, branchId: item.branchId, action: 'stock.adjust.reject.whatsapp', entity: 'stockAdjustmentRequest', entityId: item.id, severity: 'WARN', details: `Rejected stock adjustment via WhatsApp (${phone}).` }),
      ]);
      return `Rejected stock adjustment ${item.code}.`;
    }
    const product = await db.prepare('SELECT id, name, stockQuantity FROM products WHERE id = ? AND businessId = ? LIMIT 1')
      .bind(req.productId, item.businessId)
      .first<any>();
    if (!product) throw new PolicyError('Product was not found.', 404);
    const delta = asNumber(req.newQty) - asNumber(req.oldQty);
    const adjustedQty = Math.max(0, asNumber(product.stockQuantity) + delta);
    await db.batch([
      db.prepare('UPDATE products SET stockQuantity = ?, updated_at = ? WHERE id = ? AND businessId = ?').bind(adjustedQty, now, req.productId, item.businessId),
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, 'ADJUST', ?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), req.productId, delta, now, `WhatsApp approved: ${trimText(req.reason, 90)}`, item.branchId, item.businessId, req.shiftId || null, now),
      db.prepare("UPDATE stockAdjustmentRequests SET status = 'APPROVED', approvedBy = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?").bind(approvedBy, now, item.id, item.businessId, item.branchId),
      auditLog(db, { principal, businessId: item.businessId, branchId: item.branchId, action: 'stock.adjust.approve.whatsapp', entity: 'stockAdjustmentRequest', entityId: item.id, severity: 'INFO', details: `Approved stock adjustment via WhatsApp (${phone}).` }),
    ]);
    return `Approved stock adjustment ${item.code}: ${product.name} is now ${adjustedQty}.`;
  }

  const pick = await db.prepare('SELECT id, amount, status, accountId FROM cashPicks WHERE id = ? AND businessId = ? AND branchId = ? LIMIT 1')
    .bind(item.id, item.businessId, item.branchId)
    .first<any>();
  if (!pick) throw new PolicyError('Cash pick was not found.', 404);
  if (action === 'REJECT') throw new PolicyError('Cash pick rejection is not supported from WhatsApp yet. Confirm it in the POS.', 400);
  if (String(pick.status || '').toUpperCase() === 'APPROVED' && pick.accountId) return `Cash pick ${item.code} was already approved.`;
  const accountId = await ensurePickedCashAccount(db, item.businessId, item.branchId);
  await db.batch([
    db.prepare("UPDATE cashPicks SET status = 'APPROVED', accountId = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?")
      .bind(accountId, now, item.id, item.businessId, item.branchId),
    db.prepare('UPDATE financialAccounts SET balance = COALESCE(balance, 0) + ?, updated_at = ? WHERE id = ? AND businessId = ?')
      .bind(asNumber(pick.amount), now, accountId, item.businessId),
    auditLog(db, { principal, businessId: item.businessId, branchId: item.branchId, action: 'cash.pick.approve.whatsapp', entity: 'cashPick', entityId: item.id, severity: 'INFO', details: `Approved cash pick via WhatsApp (${phone}).` }),
  ]);
  return `Approved cash pick ${item.code}: ${money(pick.amount)}.`;
}

function randomActionCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes).map(byte => byte.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
}

async function savePendingAction(db: D1Database, args: {
  phone: string;
  businessId: string;
  branchId?: string | null;
  actionType: string;
  payload: unknown;
}) {
  const now = Date.now();
  let id = randomActionCode();
  for (let i = 0; i < 4; i += 1) {
    const exists = await db.prepare('SELECT id FROM whatsappPendingActions WHERE id = ? AND status = ? LIMIT 1')
      .bind(id, 'PENDING')
      .first();
    if (!exists) break;
    id = randomActionCode();
  }
  await db.prepare(`
    INSERT INTO whatsappPendingActions (id, phone, businessId, branchId, actionType, status, payload, createdAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
  `).bind(
    id,
    args.phone,
    args.businessId,
    args.branchId || null,
    args.actionType,
    JSON.stringify(args.payload),
    now,
    now + ACTION_TTL_MS,
  ).run();
  return id;
}

async function loadPendingAction(db: D1Database, code: string, phone: string, businessId: string, actionType: string) {
  const row = await db.prepare(`
    SELECT *
    FROM whatsappPendingActions
    WHERE id = ?
      AND phone = ?
      AND businessId = ?
      AND actionType = ?
      AND status = 'PENDING'
      AND expiresAt > ?
    LIMIT 1
  `).bind(normaliseCode(code), phone, businessId, actionType, Date.now()).first<any>();
  if (!row) throw new PolicyError('That confirmation code is missing or expired. Draft the LPO again.', 404);
  return { ...row, payload: parseMaybeJson(row.payload) };
}

async function latestPendingAction(db: D1Database, phone: string, businessId: string, actionType: string) {
  const row = await db.prepare(`
    SELECT *
    FROM whatsappPendingActions
    WHERE phone = ?
      AND businessId = ?
      AND actionType = ?
      AND status = 'PENDING'
      AND expiresAt > ?
    ORDER BY createdAt DESC
    LIMIT 1
  `).bind(phone, businessId, actionType, Date.now()).first<any>();
  return row ? { ...row, payload: parseMaybeJson(row.payload) } : null;
}

function norm(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreMatch(query: string, candidates: string[]) {
  const q = norm(query);
  if (!q) return 0;
  let score = 0;
  for (const candidate of candidates) {
    const c = norm(candidate);
    if (!c) continue;
    if (c === q) score = Math.max(score, 100);
    else if (c.includes(q) || q.includes(c)) score = Math.max(score, 80);
    else {
      const qWords = q.split(' ').filter(Boolean);
      const cWords = c.split(' ').filter(Boolean);
      const overlap = qWords.filter(word => cWords.includes(word)).length;
      if (overlap) score = Math.max(score, 30 + overlap * 12);
    }
  }
  return score;
}

function bestMatch<T extends Record<string, any>>(query: string, rows: T[], labels: Array<keyof T>) {
  let best: { row: T; score: number } | null = null;
  for (const row of rows) {
    const score = scoreMatch(query, labels.map(label => String(row[label] || '')));
    if (!best || score > best.score) best = { row, score };
  }
  return best && best.score >= 45 ? best.row : null;
}

function supplierIds(value: unknown): string[] {
  const parsed = parseMaybeJson(value);
  const ids = Array.isArray(parsed) ? parsed : String(value || '').split(',');
  return ids.map(id => String(id || '').trim()).filter(Boolean);
}

function extractJsonObject(text: string) {
  const source = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw new PolicyError('I could not read the LPO details. Try: create LPO from Supplier: 10 Product, 5 Product.', 400);
  return JSON.parse(source.slice(start, end + 1));
}

async function parseLpoIntent(db: D1Database, env: Env, businessId: string, text: string) {
  const [suppliers, products, branches] = await Promise.all([
    db.prepare(`
      SELECT id, name, company, branchId
      FROM suppliers
      WHERE businessId = ?
      ORDER BY name
      LIMIT 80
    `).bind(businessId).all<any>(),
    db.prepare(`
      SELECT id, name, category, costPrice, sellingPrice, stockQuantity, reorderPoint, supplierIds, branchId, unit
      FROM products
      WHERE businessId = ?
      ORDER BY name
      LIMIT 160
    `).bind(businessId).all<any>(),
    db.prepare(`
      SELECT id, name, location
      FROM branches
      WHERE businessId = ? AND COALESCE(isActive, 1) != 0
      ORDER BY name
      LIMIT 30
    `).bind(businessId).all<any>(),
  ]);

  const prompt = [
    'Extract a purchase order draft from this WhatsApp message.',
    'Return JSON only with this exact shape:',
    '{"supplier":"supplier name","branch":"branch name if mentioned","items":[{"product":"product name","quantity":number}]}',
    'Use only names from the supplied lists. If a value is unclear, copy the user phrase.',
    '',
    `Suppliers: ${(suppliers.results || []).map((s: any) => `${s.company || s.name} (${s.name})`).join('; ')}`,
    `Branches: ${(branches.results || []).map((b: any) => `${b.name} (${b.location || ''})`).join('; ')}`,
    `Products: ${(products.results || []).map((p: any) => p.name).join('; ')}`,
    '',
    `Message: ${text}`,
  ].join('\n');

  const ai = await runAi(env, prompt);
  const parsed = extractJsonObject(ai);
  return {
    supplierText: trimText(parsed?.supplier, 160),
    branchText: trimText(parsed?.branch, 160),
    items: Array.isArray(parsed?.items) ? parsed.items : [],
    suppliers: suppliers.results || [],
    products: products.results || [],
    branches: branches.results || [],
  };
}

async function resolveLpoDraft(db: D1Database, env: Env, link: any, message: IncomingMessage) {
  const intent = await parseLpoIntent(db, env, link.businessId, message.text);
  if (!intent.supplierText) throw new PolicyError('Tell me the supplier for the LPO.', 400);
  if (!intent.items.length) throw new PolicyError('Tell me the products and quantities for the LPO.', 400);

  const supplier = bestMatch(intent.supplierText, intent.suppliers, ['name', 'company']);
  if (!supplier) throw new PolicyError(`I could not match supplier "${intent.supplierText}". Check the supplier name in POS.`, 400);

  let branch = link.branchId
    ? intent.branches.find((row: any) => row.id === link.branchId)
    : null;
  if (!branch && intent.branchText) branch = bestMatch(intent.branchText, intent.branches, ['name', 'location']);
  if (!branch && supplier.branchId) branch = intent.branches.find((row: any) => row.id === supplier.branchId);
  if (!branch && intent.branches.length === 1) branch = intent.branches[0];
  if (!branch && intent.branches.length > 1) {
    throw new PolicyError(`Which branch is this LPO for? Add the branch name. Active branches: ${intent.branches.map((row: any) => row.name).join(', ')}.`, 400);
  }
  if (!branch) throw new PolicyError('No active branch found for this business.', 400);
  if (supplier.branchId && supplier.branchId !== branch.id) throw new PolicyError('That supplier belongs to another branch.', 403);

  const items: any[] = [];
  for (const raw of intent.items.slice(0, 30)) {
    const productText = trimText(raw?.product || raw?.name, 160);
    const quantity = asNumber(raw?.quantity);
    if (!productText || quantity <= 0) continue;
    const product = bestMatch(productText, intent.products, ['name', 'category']);
    if (!product) throw new PolicyError(`I could not match product "${productText}". Check the product name in POS.`, 400);
    if (product.branchId && product.branchId !== branch.id) throw new PolicyError(`Product "${product.name}" belongs to another branch.`, 403);
    const linkedSuppliers = supplierIds(product.supplierIds);
    if (linkedSuppliers.length > 0 && !linkedSuppliers.includes(supplier.id)) {
      throw new PolicyError(`Product "${product.name}" is not linked to ${supplier.company || supplier.name}.`, 400);
    }
    const unitCost = roundMoney(asNumber(product.costPrice) > 0 ? asNumber(product.costPrice) : asNumber(product.sellingPrice));
    items.push({
      productId: product.id,
      name: product.name,
      expectedQuantity: quantity,
      receivedQuantity: 0,
      unitCost,
      unit: product.unit || '',
    });
  }
  if (!items.length) throw new PolicyError('I could not find any valid LPO line items.', 400);

  const totalAmount = roundMoney(items.reduce((sum, item) => sum + item.expectedQuantity * item.unitCost, 0));
  return {
    supplierId: supplier.id,
    supplierName: supplier.company || supplier.name,
    branchId: branch.id,
    branchName: branch.name,
    items,
    totalAmount,
  };
}

async function ensurePurchaseSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS purchaseOrders (
      id TEXT PRIMARY KEY,
      supplierId TEXT NOT NULL,
      items TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      status TEXT NOT NULL,
      approvalStatus TEXT NOT NULL,
      paymentStatus TEXT,
      paidAmount REAL,
      orderDate INTEGER NOT NULL,
      expectedDate INTEGER,
      receivedDate INTEGER,
      invoiceNumber TEXT,
      poNumber TEXT,
      preparedBy TEXT,
      approvedBy TEXT,
      receivedBy TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await ensureActionTables(db);
}

async function nextPoNumber(db: D1Database, businessId: string, branchId: string) {
  const { results } = await db.prepare(`
    SELECT poNumber
    FROM purchaseOrders
    WHERE businessId = ? AND branchId = ? AND poNumber LIKE 'PO-%'
    ORDER BY orderDate DESC
    LIMIT 500
  `).bind(businessId, branchId).all<any>();
  const max = ((results || []) as any[]).reduce((highest, row) => {
    const match = String(row.poNumber || '').match(/PO-(\d+)/i);
    const num = match ? Number(match[1]) : 0;
    return Number.isFinite(num) && num > highest ? num : highest;
  }, 0);
  return `PO-${String(max + 1).padStart(4, '0')}`;
}

async function createPurchaseOrderFromDraft(db: D1Database, businessId: string, draft: any, principal: Principal) {
  await ensurePurchaseSchema(db);
  const now = Date.now();
  const id = `po_${businessId}_${draft.branchId}_${crypto.randomUUID()}`;
  const poNumber = await nextPoNumber(db, businessId, draft.branchId);
  const totalAmount = roundMoney(asArray(draft.items).reduce((sum, item) => sum + asNumber(item.expectedQuantity) * asNumber(item.unitCost), 0));
  await db.batch([
    db.prepare(`
      INSERT INTO purchaseOrders (id, supplierId, items, totalAmount, status, approvalStatus, paymentStatus, paidAmount, orderDate, expectedDate, receivedDate, invoiceNumber, poNumber, preparedBy, approvedBy, receivedBy, branchId, businessId, updated_at)
      VALUES (?, ?, ?, ?, 'PENDING', 'PENDING', NULL, 0, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?)
    `).bind(
      id,
      draft.supplierId,
      JSON.stringify(draft.items),
      totalAmount,
      now,
      poNumber,
      principal.userName || 'WhatsApp Admin',
      draft.branchId,
      businessId,
      now,
    ),
    auditLog(db, { principal, businessId, branchId: draft.branchId, action: 'purchase.create.whatsapp', entity: 'purchaseOrder', entityId: id, severity: 'WARN', details: `Created ${poNumber} via WhatsApp. Pending approval.` }),
  ]);
  return { id, poNumber, totalAmount };
}

async function draftLpoFromWhatsApp(db: D1Database, env: Env, link: any, message: IncomingMessage) {
  const draft = await resolveLpoDraft(db, env, link, message);
  const code = await savePendingAction(db, {
    phone: message.from,
    businessId: link.businessId,
    branchId: draft.branchId,
    actionType: 'CREATE_LPO',
    payload: draft,
  });
  return [
    '*LPO draft ready*',
    `Supplier: ${draft.supplierName}`,
    `Branch: ${draft.branchName}`,
    '',
    ...draft.items.map((item: any, index: number) => `${index + 1}. ${item.name}: ${item.expectedQuantity}${item.unit ? ` ${item.unit}` : ''} x ${money(item.unitCost)} = ${money(item.expectedQuantity * item.unitCost)}`),
    '',
    `Total: ${money(draft.totalAmount)}`,
    '',
    `To create it, reply: confirm PO ${code} YOUR_ADMIN_PIN`,
    'It will be created as pending approval.',
  ].join('\n');
}

async function confirmLpo(db: D1Database, link: any, phone: string, code: string, pin: string) {
  const pending = await loadPendingAction(db, code, phone, link.businessId, 'CREATE_LPO');
  const principal = await verifyAdminPin(db, link.businessId, phone, pin, pending.branchId);
  const created = await createPurchaseOrderFromDraft(db, link.businessId, pending.payload, principal);
  await db.prepare("UPDATE whatsappPendingActions SET status = 'COMPLETED', completedAt = ? WHERE id = ?")
    .bind(Date.now(), pending.id)
    .run();
  return `Created LPO ${created.poNumber} for ${money(created.totalAmount)}. It is pending approval in POS.`;
}

async function confirmLatestLpo(db: D1Database, link: any, phone: string, pin: string) {
  const pending = await latestPendingAction(db, phone, link.businessId, 'CREATE_LPO');
  if (!pending) throw new PolicyError('I do not have an active LPO draft to confirm. Tell me the LPO you want to create first.', 404);
  const principal = await verifyAdminPin(db, link.businessId, phone, pin, pending.branchId);
  const created = await createPurchaseOrderFromDraft(db, link.businessId, pending.payload, principal);
  await db.prepare("UPDATE whatsappPendingActions SET status = 'COMPLETED', completedAt = ? WHERE id = ?")
    .bind(Date.now(), pending.id)
    .run();
  return `Created LPO ${created.poNumber} for ${money(created.totalAmount)}. It is pending approval in POS.`;
}

async function auditOrders(db: D1Database, env: Env, businessId: string) {
  const since = Date.now() - 30 * DAY_MS;
  const { results } = await db.prepare(`
    SELECT po.id, po.poNumber, po.totalAmount, po.approvalStatus, po.status, po.paymentStatus, po.paidAmount, po.orderDate, po.items,
           s.name AS supplierName, s.company, b.name AS branchName
    FROM purchaseOrders po
    LEFT JOIN suppliers s ON s.id = po.supplierId AND s.businessId = po.businessId
    LEFT JOIN branches b ON b.id = po.branchId AND b.businessId = po.businessId
    WHERE po.businessId = ?
      AND (po.orderDate >= ? OR po.approvalStatus = 'PENDING' OR COALESCE(po.paymentStatus, 'UNPAID') != 'PAID')
    ORDER BY po.orderDate DESC
    LIMIT 30
  `).bind(businessId, since).all<any>();

  const orders = (results || []).map((row: any) => ({
    poNumber: row.poNumber || shortId(row.id),
    supplier: row.company || row.supplierName || 'Supplier',
    branch: row.branchName || 'Branch',
    total: money(row.totalAmount),
    due: money(asNumber(row.totalAmount) - asNumber(row.paidAmount)),
    approvalStatus: row.approvalStatus,
    status: row.status,
    paymentStatus: row.paymentStatus || 'UNPAID',
    itemCount: asArray(row.items).length,
    ageDays: Math.floor((Date.now() - asNumber(row.orderDate, Date.now())) / DAY_MS),
  }));
  if (!orders.length) return 'No recent, pending, or unpaid LPOs found.';

  const fallback = [
    '*LPO audit*',
    `Orders checked: ${orders.length}`,
    `Pending approval: ${orders.filter(order => order.approvalStatus === 'PENDING').length}`,
    `Unpaid/partial: ${orders.filter(order => order.paymentStatus !== 'PAID').length}`,
    '',
    ...orders.slice(0, 6).map(order => `${order.poNumber}: ${order.supplier}, ${order.total}, ${order.approvalStatus}/${order.paymentStatus}, ${order.ageDays}d old`),
    '',
    'Action: approve or reject old pending LPOs first, then clear unpaid received orders.',
  ].join('\n');

  try {
    const answer = await runAi(env, [
      'Audit these Kenyan POS LPOs for risks. Keep the WhatsApp answer short.',
      'Flag old pending approvals, unpaid received orders, high totals, and unclear suppliers.',
      'End with one action recommendation.',
      JSON.stringify(orders),
    ].join('\n'));
    return truncateText(answer.trim(), 3500) || fallback;
  } catch {
    return fallback;
  }
}

function extractPin(text: string) {
  const explicit = text.match(/\b(?:pin|password|code)\s*(?:is|:|=)?\s*([A-Za-z0-9@#$%^&*!._-]{4,80})\b/i);
  if (explicit) return explicit[1].trim();
  const trailing = text.trim().match(/\b([A-Za-z0-9@#$%^&*!._-]{4,80})\s*$/);
  return trailing ? trailing[1].trim() : '';
}

function ordinalCode(text: string) {
  const lower = text.toLowerCase();
  const code = lower.match(/\b(a\d{1,2})\b/i);
  if (code) return code[1].toUpperCase();
  const ordinals: Array<[RegExp, string]> = [
    [/\b(first|1st|one)\b/i, 'A1'],
    [/\b(second|2nd|two)\b/i, 'A2'],
    [/\b(third|3rd|three)\b/i, 'A3'],
    [/\b(fourth|4th|four)\b/i, 'A4'],
    [/\b(fifth|5th|five)\b/i, 'A5'],
  ];
  return ordinals.find(([pattern]) => pattern.test(lower))?.[1] || '';
}

async function approvalItemFromText(db: D1Database, businessId: string, text: string) {
  const items = await loadPendingApprovals(db, businessId);
  const code = ordinalCode(text);
  if (code) return { item: items.find(row => row.code === code) || null, items };

  const lower = text.toLowerCase();
  const typeHint = lower.includes('expense')
    ? 'EXPENSE'
    : lower.includes('refund')
      ? 'REFUND'
      : lower.includes('stock')
        ? 'STOCK'
        : lower.includes('cash')
          ? 'CASH'
          : lower.includes('lpo') || lower.includes('po') || lower.includes('purchase')
            ? 'LPO'
            : '';
  const typed = typeHint ? items.filter(row => row.type === typeHint) : items;
  if (typed.length === 1) return { item: typed[0], items };
  return { item: null, items };
}

async function handleNaturalAction(db: D1Database, env: Env, link: any, message: IncomingMessage): Promise<string | null> {
  const body = message.text.trim();
  const lower = body.toLowerCase();
  const wantsApprove = /\b(approve|accept|authorize|allow|okay|ok|confirm)\b/i.test(body);
  const wantsReject = /\b(reject|decline|deny|cancel)\b/i.test(body);
  const mentionsApproval = /\b(approval|approvals|pending|request|requests)\b/i.test(body);
  const mentionsOrder = /\b(lpo|po|purchase order|purchase orders|orders?)\b/i.test(body);
  const wantsCreate = /\b(create|draft|make|raise|prepare|generate|order|buy|restock)\b/i.test(body);
  const wantsAudit = /\b(audit|review|check|inspect|risk|risks)\b/i.test(body);
  const wantsList = /\b(show|list|what|which|give|view|see)\b/i.test(body);

  const confirmsDraft = /\byes\b/i.test(body) || /\bdraft\b/i.test(body) || /\bconfirm\s+(?:po|lpo)\b/i.test(body);
  if (confirmsDraft && /\b(lpo|po|draft)\b/i.test(body)) {
    const pin = extractPin(body);
    if (!pin) return 'Send your admin PIN to confirm the LPO draft, for example: yes pin 1234';
    const code = normaliseCode(body.match(/\b(?:po|lpo|code)\s+([a-z0-9]{4,10})\b/i)?.[1] || '');
    if (code) {
      try { return await confirmLpo(db, link, message.from, code, pin); } catch {}
    }
    return confirmLatestLpo(db, link, message.from, pin);
  }

  if ((wantsApprove || wantsReject) && (mentionsApproval || ordinalCode(body) || /\b(expense|refund|stock|cash|lpo|po|purchase)\b/i.test(body))) {
    const pin = extractPin(body);
    if (!pin) return 'Please include your admin PIN/password to approve or reject from WhatsApp.';
    const { item, items } = await approvalItemFromText(db, link.businessId, body);
    if (!item) {
      if (items.length === 0) return 'No pending admin approvals right now.';
      return [
        'Which approval do you mean?',
        '',
        ...items.slice(0, 8).map(row => `${row.code}. [${row.type}] ${row.title}`),
        '',
        'Example: approve the first one pin 1234',
      ].join('\n');
    }
    const principal = await verifyAdminPin(db, link.businessId, message.from, pin, item.branchId);
    return applyApprovalAction(db, item, principal, wantsReject ? 'REJECT' : 'APPROVE', message.from);
  }

  if ((mentionsApproval && wantsList) || /^approvals?$/i.test(body) || lower.includes('pending approvals')) {
    return approvalsSummary(db, link.businessId);
  }

  if (mentionsOrder && wantsAudit) {
    return auditOrders(db, env, link.businessId);
  }

  if (mentionsOrder && wantsCreate) {
    return draftLpoFromWhatsApp(db, env, link, message);
  }

  if (/\b(my\s+)?business\s+code\s+(is\s+)?[a-z0-9-]+/i.test(body)) {
    const maybeCode = body.replace(/.*\bbusiness\s+code\s+(?:is\s+)?/i, '');
    return linkBusiness(db, message, maybeCode);
  }

  return null;
}

async function askBusinessAi(db: D1Database, env: Env, link: any, message: IncomingMessage) {
  try {
    await ensureAiSchema(db);

    const settings = await getAiSettings(db, link.businessId);
    if (!settings.enabled) {
      return 'Mtaani AI is disabled for this business. Ask an admin to enable it in POS settings.';
    }

    const userId = `whatsapp:${message.from}`;
    const userName = truncateText(message.contactName || message.from, 120);
    const branchId = link.branchId || null;
    const usage = await getUsage(db, link.businessId, userId, userName, branchId);
    if (usage.count >= settings.dailyLimit) {
      return `Daily business AI limit reached (${settings.dailyLimit}). Try again tomorrow or ask the Super Admin to raise the limit.`;
    }

    const question = truncateText(message.text, 900);
    const snapshot = await buildBusinessSnapshot(db, link.businessId, branchId);
    const prompt = `${buildPrompt(question, snapshot)}

WhatsApp reply rules:
- Keep the answer short enough for a phone screen.
- No tables.
- Use plain lines or short bullets.
- If the answer contains sensitive financial data, be concise and only use the linked business data.`;

    const answer = maybeAnswerFromSnapshot(question, snapshot) || await runAi(env, prompt);
    await usage.increment();
    return truncateText(answer.trim(), 3500) || 'I could not produce an answer from the available POS data.';
  } catch (err: any) {
    console.error('WhatsApp AI failed:', err?.message || err);
    return 'I could not reach Mtaani AI right now. Try summary, branches, or stock while I cool down.';
  }
}

async function handleTextMessage(db: D1Database, env: Env, message: IncomingMessage) {
  const body = message.text.trim();
  const lower = body.toLowerCase();

  if (/^(link|business|connect)\s+/i.test(body)) {
    const code = body.replace(/^(link|business|connect)\s+/i, '');
    return linkBusiness(db, message, code);
  }

  const link = await linkedBusiness(db, message.from);
  if (!link) {
    return helpText(false);
  }

  if (lower === 'unlink' || lower === 'logout' || lower === 'remove') {
    return unlinkBusiness(db, message.from);
  }
  if (lower === 'help' || lower === 'hi' || lower === 'hello' || lower === 'start') {
    return helpText(true);
  }
  const naturalAction = await handleNaturalAction(db, env, link, message);
  if (naturalAction) return naturalAction;
  const confirmPo = body.match(/^confirm\s+(?:po|lpo)\s+([a-z0-9]{4,10})\s+(.+)$/i);
  if (confirmPo) {
    return confirmLpo(db, link, message.from, confirmPo[1], confirmPo[2]);
  }
  const approvalAction = body.match(/^(approve|reject)\s+(A\d{1,2})\s+(.+)$/i);
  if (approvalAction) {
    const action = approvalAction[1].toUpperCase() as 'APPROVE' | 'REJECT';
    const code = approvalAction[2].toUpperCase();
    const pin = approvalAction[3];
    const item = (await loadPendingApprovals(db, link.businessId)).find(row => row.code === code);
    if (!item) return `I could not find pending approval ${code}. Send approvals to see the current list.`;
    const principal = await verifyAdminPin(db, link.businessId, message.from, pin, item.branchId);
    return applyApprovalAction(db, item, principal, action, message.from);
  }
  if (lower === 'approvals' || lower === 'approval' || lower === 'pending approvals' || lower === 'admin approvals') {
    return approvalsSummary(db, link.businessId);
  }
  if (/^(audit|review|check)\s+(orders|lpos|lpo|purchase orders)\b/i.test(body) || /^audit\s+orders$/i.test(body)) {
    return auditOrders(db, env, link.businessId);
  }
  if (/^(create|draft|make)\s+(an?\s+)?(lpo|po|purchase order)\b/i.test(body)) {
    return draftLpoFromWhatsApp(db, env, link, message);
  }
  if (lower === 'summary' || lower === 'today' || lower === 'sales') {
    return businessSummary(db, link.businessId);
  }
  if (lower === 'branches' || lower === 'branch') {
    return branchesSummary(db, link.businessId);
  }
  if (lower === 'stock' || lower === 'inventory') {
    return stockSummary(db, link.businessId);
  }
  if (lower === 'status') {
    return `Linked to ${link.businessName}. Ask any POS question, or send summary, branches, stock, help, or unlink.`;
  }

  return askBusinessAi(db, env, link, message);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') || '';

  if (!env.WHATSAPP_VERIFY_TOKEN) return responseText('WhatsApp verify token is not configured.', 500);
  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) return responseText(challenge);
  return responseText('Forbidden', 403);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return responseJson({ error: 'DB binding missing' }, 500);

    const bodyText = await request.text();
    if (!(await verifySignature(request, env, bodyText))) {
      return responseJson({ error: 'Invalid WhatsApp signature.' }, 401);
    }

    const payload = JSON.parse(bodyText || '{}');
    const messages = extractMessages(payload);
    if (messages.length === 0) return responseJson({ success: true, ignored: true });

    await ensureSchema(env.DB);
    for (const message of messages) {
      if (await alreadyProcessed(env.DB, message.id)) continue;

      const link = await linkedBusiness(env.DB, message.from);
      await rememberMessage(env.DB, message, link?.businessId);

      let reply: string;
      try {
        reply = message.type === 'text' && message.text
          ? await handleTextMessage(env.DB, env, message)
          : 'I can read text commands only for now. Send help to see what is available.';
      } catch (err: any) {
        console.error('WhatsApp message handling failed:', err?.message || err);
        reply = err instanceof PolicyError
          ? err.message
          : 'I could not complete that WhatsApp action. Please try again or use the POS.';
      }
      const sendResult = await sendWhatsAppText(env, message.from, reply, message.phoneNumberId);
      await rememberOutbound(env.DB, {
        to: message.from,
        businessId: link?.businessId,
        inboundMessageId: message.id,
        result: sendResult,
      });
    }

    return responseJson({ success: true });
  } catch (err: any) {
    console.error('WhatsApp webhook failed:', err?.message || err);
    return responseJson({ error: 'WhatsApp webhook failed.' }, 500);
  }
};
