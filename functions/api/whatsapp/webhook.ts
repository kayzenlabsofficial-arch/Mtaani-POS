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
import { hashPassword, verifyPassword, type Principal } from '../authUtils';
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
const CHAT_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const CHAT_CONTEXT_MAX_TURNS = 10;

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

function daysAgo(timestamp: unknown, now = Date.now()) {
  const ts = asNumber(timestamp, 0);
  return ts ? Math.max(0, Math.floor((now - ts) / DAY_MS)) : 0;
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
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS whatsappConversationTurns (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      businessId TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_whatsappConversationTurns_lookup ON whatsappConversationTurns(phone, businessId, createdAt)').run();
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

function sanitizeForMemory(text: string) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  if (isStandaloneAdminSecret(source)) return '';
  if (isAiLimitMemory(source)) return '';
  const redacted = source
    .replace(/\b(pin|password|code)\s*(?:is|:|=)?\s*([A-Za-z0-9@#$%^&*!._-]{3,120})\b/gi, '$1 [redacted]')
    .replace(/\b(EAA[A-Za-z0-9_-]{20,})\b/g, '[redacted-token]');
  return trimText(redacted, 700);
}

function isAiLimitMemory(text: string) {
  return /\b(ai|data|daily|business|request)?\s*limit\b.{0,120}\b(reached|exhausted|used up|hit)\b/i.test(text)
    || /\b(reached|exhausted|used up|hit)\b.{0,120}\b(ai|data|daily|business|request)?\s*limit\b/i.test(text)
    || /\bdata limit has been reached\b/i.test(text)
    || /\bask the super admin to raise\b/i.test(text)
    || /\btry again tomorrow\b/i.test(text);
}

async function rememberConversationTurn(db: D1Database, args: {
  phone: string;
  businessId?: string | null;
  userText: string;
  assistantText: string;
}) {
  if (!args.businessId) return;
  const now = Date.now();
  const userText = sanitizeForMemory(args.userText);
  const assistantText = sanitizeForMemory(args.assistantText);
  const statements = [];
  if (userText) {
    statements.push(db.prepare(`
      INSERT INTO whatsappConversationTurns (id, phone, businessId, role, text, createdAt)
      VALUES (?, ?, ?, 'user', ?, ?)
    `).bind(crypto.randomUUID(), args.phone, args.businessId, userText, now));
  }
  if (assistantText) {
    statements.push(db.prepare(`
      INSERT INTO whatsappConversationTurns (id, phone, businessId, role, text, createdAt)
      VALUES (?, ?, ?, 'assistant', ?, ?)
    `).bind(crypto.randomUUID(), args.phone, args.businessId, assistantText, now + 1));
  }
  statements.push(
    db.prepare('DELETE FROM whatsappConversationTurns WHERE phone = ? AND businessId = ? AND createdAt < ?')
      .bind(args.phone, args.businessId, now - CHAT_CONTEXT_TTL_MS),
  );
  statements.push(
    db.prepare(`
      DELETE FROM whatsappConversationTurns
      WHERE phone = ?
        AND businessId = ?
        AND id NOT IN (
          SELECT id
          FROM whatsappConversationTurns
          WHERE phone = ? AND businessId = ?
          ORDER BY createdAt DESC
          LIMIT ?
        )
    `).bind(args.phone, args.businessId, args.phone, args.businessId, CHAT_CONTEXT_MAX_TURNS),
  );
  if (statements.length) await db.batch(statements);
}

async function loadConversationContext(db: D1Database, phone: string, businessId: string, limit = 8) {
  const { results } = await db.prepare(`
    SELECT role, text
    FROM whatsappConversationTurns
    WHERE phone = ?
      AND businessId = ?
      AND createdAt >= ?
    ORDER BY createdAt DESC
    LIMIT ?
  `).bind(phone, businessId, Date.now() - CHAT_CONTEXT_TTL_MS, limit).all<any>();
  const rows = (results || []).slice().reverse();
  const safeRows = rows.filter(row => !isAiLimitMemory(String(row.text || '')));
  if (!safeRows.length) return '';
  return safeRows
    .map(row => `${row.role === 'assistant' ? 'Mtaani POS' : 'User'}: ${trimText(row.text, 320)}`)
    .join('\n');
}

async function latestProductLookupQuery(db: D1Database, phone: string, businessId: string) {
  const { results } = await db.prepare(`
    SELECT text
    FROM whatsappConversationTurns
    WHERE phone = ?
      AND businessId = ?
      AND role = 'assistant'
      AND text LIKE '%Stock:%'
      AND text LIKE '%Branch in POS:%'
    ORDER BY createdAt DESC
    LIMIT 8
  `).bind(phone, businessId).all<any>();
  for (const row of results || []) {
    const text = String(row.text || '');
    const title = text.match(/^\*([^*]+)\*/)?.[1]?.trim();
    if (title) return title.replace(/\s+-\s+/g, '\n');
  }
  return '';
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
    '*Mtaani POS AI operator*',
    '',
    'I can read your business data, draft work, and execute admin actions after PIN confirmation.',
    '',
    '*Ask me to check*',
    '- sales today, yesterday, 7d, 30d',
    '- branch performance',
    '- stock status, low stock, lowest stock per branch',
    '- dead stock and top moving products',
    '- suppliers, balances, customers owing',
    '- expenses, cash status, open shifts',
    '- pending approvals and LPO audits',
    '',
    '*Ask me to prepare*',
    '- draft LPOs',
    '- update an LPO draft quantity',
    '- draft low-stock LPOs by supplier/branch',
    '- draft a cashier/manager/admin user',
    '',
    '*Admin actions*',
    '- approve A1 password 1234',
    '- reject A1 password 1234',
    '- confirm PO CODE password 1234',
    '- confirm user CODE password 1234',
  ].join('\n');
}

function wantsCapabilityHelp(text: string) {
  return /\b(what can you do|what do you do|capabilities|commands|tools|help me|how can you help|show help)\b/i.test(text)
    || (/^(hi|hello|hey|start)\b/i.test(text.trim()) && /\b(can|do|help|tools|commands)\b/i.test(text));
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

async function suppliersSummary(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT s.name, s.company, s.phone, s.branchId, b.name AS branchName
    FROM suppliers s
    LEFT JOIN branches b ON b.id = s.branchId AND b.businessId = s.businessId
    WHERE s.businessId = ?
    ORDER BY COALESCE(b.name, 'Unassigned') ASC, COALESCE(s.company, s.name) ASC
    LIMIT 40
  `).bind(businessId).all<any>();

  const suppliers = results || [];
  if (suppliers.length === 0) return 'No suppliers are registered yet.';

  const byBranch = new Map<string, string[]>();
  for (const supplier of suppliers) {
    const branch = supplier.branchName || 'Unassigned branch';
    const name = supplier.company && supplier.company !== supplier.name
      ? `${supplier.name} (${supplier.company})`
      : supplier.name || supplier.company || 'Supplier';
    const list = byBranch.get(branch) || [];
    list.push(name);
    byBranch.set(branch, list);
  }

  const lines = ['*Registered suppliers*', ''];
  for (const [branch, names] of byBranch) {
    lines.push(`${branch}:`);
    for (const name of names.slice(0, 8)) lines.push(`- ${name}`);
    if (names.length > 8) lines.push(`- +${names.length - 8} more`);
    lines.push('');
  }
  lines.push('Use the supplier and branch together when creating an LPO.');
  return lines.join('\n').trim();
}

async function stockSummary(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT p.name, p.stockQuantity, p.reorderPoint, p.unit, COALESCE(b.name, 'Unassigned/global') AS branchName
    FROM products p
    LEFT JOIN branches b ON b.id = p.branchId AND b.businessId = p.businessId
    WHERE p.businessId = ?
      AND COALESCE(reorderPoint, 0) > 0
      AND COALESCE(stockQuantity, 0) <= COALESCE(reorderPoint, 0)
    ORDER BY stockQuantity ASC, COALESCE(b.name, 'Unassigned/global') ASC, name ASC
    LIMIT 10
  `).bind(businessId).all<any>();

  const products = results || [];
  if (products.length === 0) return 'No low-stock products right now.';
  return [
    '*Low stock products*',
    '',
    ...products.map((product: any, index: number) => {
      const unit = product.unit ? ` ${product.unit}` : '';
      return `${index + 1}. ${product.name}: ${Number(product.stockQuantity || 0)}${unit} left (reorder at ${Number(product.reorderPoint || 0)}${unit}) | ${product.branchName}`;
    }),
  ].join('\n');
}

type ToolBranch = {
  id: string;
  name: string;
  location?: string | null;
};

type ToolProduct = {
  id: string;
  name: string;
  category?: string | null;
  barcode?: string | null;
  sellingPrice?: number | null;
  costPrice?: number | null;
  stockQuantity?: number | null;
  reorderPoint?: number | null;
  supplierIds?: string | null;
  branchId?: string | null;
  branchName?: string | null;
  unit?: string | null;
  updated_at?: number | null;
};

function wantsAiUsageQuestion(text: string) {
  return /\b(ai|assistant|bot)\b/i.test(text)
    && /\b(usage|limit|allowance|quota|remaining|used|increased|raised)\b/i.test(text);
}

function wantsProductStatusQuestion(text: string) {
  return /\b(status|stock|inventory|available|availability|left|quantity|qty|price|cost|reorder|check again|check)\b/i.test(text);
}

function wantsStockIntelligence(text: string) {
  const lower = text.toLowerCase();
  const stockWords = /\b(stock|inventory|products?|items?|reorder|branch|branches|them|those)\b/i.test(lower);
  const insightWords = /\b(low|lowest|least|minimum|min|almost out|out of stock|running out|reorder|short|arrange|group|per branch|by branch|branch wise)\b/i.test(lower);
  return stockWords && insightWords;
}

function wantsGroupedStock(text: string) {
  return /\b(arrange|group|split|show|list)\b/i.test(text)
    && /\b(per branch|by branch|branch wise|branches|branch)\b/i.test(text)
    && /\b(stock|products?|items?|them|those|low)\b/i.test(text);
}

function wantsLowestStock(text: string) {
  return /\b(lowest|least|minimum|min|smallest)\b/i.test(text)
    && /\b(stock|inventory|quantity|qty|products?|items?)\b/i.test(text);
}

function wantsOutOfStock(text: string) {
  return /\b(out of stock|zero stock|stock out|stocked out)\b/i.test(text);
}

function isShortFollowUp(text: string) {
  return /^(check|check again|again|recheck|what about it|what about that|and now|now|that one|those ones)\??$/i.test(text.trim())
    || (/^(why|so|then)\b/i.test(text.trim()) && /\b(that|it|those)\b/i.test(text));
}

function bestTextMatch<T extends Record<string, any>>(query: string, rows: T[], labels: Array<keyof T>, minScore = 45) {
  let best: { row: T; score: number } | null = null;
  for (const row of rows) {
    const score = scoreMatch(query, labels.map(label => String(row[label] || '')));
    if (!best || score > best.score) best = { row, score };
  }
  return best && best.score >= minScore ? best.row : null;
}

function stockSignal(stock: number, reorderPoint: number) {
  if (stock <= 0) return 'Out of stock';
  if (reorderPoint > 0 && stock <= reorderPoint) return 'Low stock';
  return 'In stock';
}

function unitSuffix(unit?: string | null) {
  return unit ? ` ${unit}` : '';
}

function formatMaybeMoney(label: string, value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? `${label}: ${money(amount)}` : '';
}

function branchGroupName(row: any) {
  return String(row?.branchName || 'Unassigned/global');
}

function formatStockLine(product: any, includeBranch = false) {
  const unit = unitSuffix(product.unit);
  const reorder = asNumber(product.reorderPoint) > 0
    ? ` (reorder at ${asNumber(product.reorderPoint)}${unit})`
    : '';
  return `${product.name}: ${asNumber(product.stockQuantity)}${unit} left${reorder}${includeBranch ? ` | ${branchGroupName(product)}` : ''}`;
}

async function loadToolSuppliers(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT s.id, s.name, s.company, s.phone, s.branchId, b.name AS branchName
    FROM suppliers s
    LEFT JOIN branches b ON b.id = s.branchId AND b.businessId = s.businessId
    WHERE s.businessId = ?
    ORDER BY COALESCE(b.name, 'Unassigned') ASC, COALESCE(s.company, s.name) ASC
    LIMIT 160
  `).bind(businessId).all<any>();
  return results || [];
}

async function supplierRecommendationTool(db: D1Database, link: any, message: IncomingMessage) {
  const text = message.text.trim();
  if (!/\b(restock|reorder|order|buy|purchase|get|use|supplier|from)\b/i.test(text)
    || !/\b(who|which supplier|supplier|from|use)\b/i.test(text)) return null;

  const [branch, products, suppliers] = await Promise.all([
    resolveBranchFromTool(db, link, text),
    loadToolProducts(db, link.businessId),
    loadToolSuppliers(db, link.businessId),
  ]);
  const branchProducts = branch
    ? products.filter(product => !product.branchId || product.branchId === branch.id)
    : products;
  const product = bestTextMatch(text, branchProducts.length ? branchProducts : products, ['name', 'category', 'barcode'], 42);
  if (!product) return null;

  const ids = supplierIds(product.supplierIds);
  const linked = suppliers.filter((supplier: any) => ids.includes(String(supplier.id)));
  const branchLinked = linked.filter((supplier: any) => !branch?.id || !supplier.branchId || supplier.branchId === branch.id);
  const sameBranchSuppliers = suppliers.filter((supplier: any) => !branch?.id || !supplier.branchId || supplier.branchId === branch.id);
  const title = `*Supplier check - ${product.name}${branch ? ` / ${branch.name}` : ''}*`;

  if (branchLinked.length) {
    return [
      title,
      `Use: ${branchLinked.map(supplierName).join(', ')}.`,
      product.branchName ? `Product branch: ${product.branchName}` : 'Product branch: Unassigned/global',
      `Stock: ${asNumber(product.stockQuantity)}${unitSuffix(product.unit)}`,
      asNumber(product.reorderPoint) > 0 ? `Reorder point: ${asNumber(product.reorderPoint)}${unitSuffix(product.unit)}` : '',
    ].filter(Boolean).join('\n');
  }

  if (linked.length) {
    return [
      title,
      `${product.name} is linked to supplier(s) outside the requested branch: ${linked.map((supplier: any) => `${supplierName(supplier)}${supplier.branchName ? ` (${supplier.branchName})` : ''}`).join(', ')}.`,
      branch ? `${branch.name} suppliers: ${sameBranchSuppliers.slice(0, 8).map(supplierName).join(', ') || 'none assigned'}.` : '',
      'Do not create the LPO until the product-supplier branch is clear.',
    ].filter(Boolean).join('\n');
  }

  return [
    title,
    `${product.name} has no supplier linked in POS.`,
    branch
      ? `${branch.name} suppliers: ${sameBranchSuppliers.slice(0, 8).map(supplierName).join(', ') || 'none assigned'}.`
      : `Registered suppliers: ${suppliers.slice(0, 8).map(supplierName).join(', ') || 'none'}.`,
    'Pick a supplier in your message, or link the product to a supplier in POS.',
  ].join('\n');
}

async function attentionSummaryTool(db: D1Database, link: any) {
  const { start, end } = todayBounds();
  const since7 = Date.now() - 7 * DAY_MS;
  const [approvals, lowStock, zeroSales, expenses7, openShifts] = await Promise.all([
    loadPendingApprovals(db, link.businessId),
    db.prepare(`
      SELECT p.name, p.stockQuantity, p.reorderPoint, p.unit, COALESCE(b.name, 'Unassigned/global') AS branchName
      FROM products p
      LEFT JOIN branches b ON b.id = p.branchId AND b.businessId = p.businessId
      WHERE p.businessId = ?
        AND COALESCE(p.reorderPoint, 0) > 0
        AND COALESCE(p.stockQuantity, 0) <= COALESCE(p.reorderPoint, 0)
      ORDER BY COALESCE(p.stockQuantity, 0) ASC, p.name ASC
      LIMIT 6
    `).bind(link.businessId).all<any>(),
    db.prepare(`
      SELECT b.name, COALESCE(SUM(t.total), 0) AS sales
      FROM branches b
      LEFT JOIN transactions t ON t.businessId = b.businessId
        AND t.branchId = b.id
        AND t.timestamp >= ?
        AND t.timestamp < ?
        AND UPPER(COALESCE(t.status, '')) NOT IN ('VOIDED', 'QUOTE')
      WHERE b.businessId = ? AND COALESCE(b.isActive, 1) != 0
      GROUP BY b.id, b.name
      HAVING sales <= 0
      ORDER BY b.name
      LIMIT 6
    `).bind(start, end, link.businessId).all<any>(),
    db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE businessId = ?
        AND timestamp >= ?
        AND UPPER(COALESCE(status, 'APPROVED')) != 'REJECTED'
      GROUP BY category
      ORDER BY total DESC
      LIMIT 3
    `).bind(link.businessId, since7).all<any>(),
    db.prepare("SELECT COUNT(*) AS count FROM shifts WHERE businessId = ? AND UPPER(COALESCE(status, '')) = 'OPEN'")
      .bind(link.businessId).first<any>(),
  ]);

  const byType = new Map<string, number>();
  for (const item of approvals) byType.set(item.type, (byType.get(item.type) || 0) + 1);
  const approvalBits = Array.from(byType.entries()).map(([type, count]) => `${type.toLowerCase()} ${count}`).join(', ');
  const lines = ['*Needs attention*', ''];
  lines.push(`Pending approvals: ${approvals.length}${approvalBits ? ` (${approvalBits})` : ''}`);
  lines.push(`Open shifts: ${asNumber(openShifts?.count)}`);
  const low = lowStock.results || [];
  lines.push(`Low stock: ${low.length}${low.length ? ` - ${low.slice(0, 3).map((row: any) => `${row.name} (${row.branchName})`).join(', ')}` : ''}`);
  const zero = zeroSales.results || [];
  if (zero.length) lines.push(`No sales today: ${zero.map((row: any) => row.name).join(', ')}`);
  const expenses = expenses7.results || [];
  if (expenses.length) lines.push(`Top 7d expenses: ${expenses.map((row: any) => `${row.category || 'General'} ${money(row.total)}`).join(', ')}`);
  lines.push('', 'Action: clear approvals first, then handle low-stock items by branch.');
  return lines.join('\n');
}

async function latestAssistantText(db: D1Database, phone: string, businessId: string) {
  const row = await db.prepare(`
    SELECT text
    FROM whatsappConversationTurns
    WHERE phone = ? AND businessId = ? AND role = 'assistant'
    ORDER BY createdAt DESC
    LIMIT 1
  `).bind(phone, businessId).first<any>();
  return String(row?.text || '');
}

async function stockIntelligenceTool(db: D1Database, link: any, message: IncomingMessage) {
  const body = message.text.trim();
  const previous = await latestAssistantText(db, message.from, link.businessId);
  const isFollowUpGrouping = wantsGroupedStock(body) && /\blow stock products\b/i.test(previous);
  if (!wantsStockIntelligence(body) && !isFollowUpGrouping) return null;

  const groupByBranch = wantsGroupedStock(body) || isFollowUpGrouping;
  const lowest = wantsLowestStock(body);
  const outOnly = wantsOutOfStock(body);
  const branch = await resolveBranchFromTool(db, link, body);
  const strictBranchId = branch?.id || null;

  const baseSql = `
    SELECT p.id, p.name, p.stockQuantity, p.reorderPoint, p.unit, p.branchId,
           COALESCE(b.name, 'Unassigned/global') AS branchName
    FROM products p
    LEFT JOIN branches b ON b.id = p.branchId AND b.businessId = p.businessId
    WHERE p.businessId = ?
      AND (? IS NULL OR p.branchId = ?)
  `;

  if (lowest) {
    const wantsMany = /\b(products|items|list|show|top|all)\b/i.test(body)
      && !/\b(which|what)\s+(?:is|'s|one)\b/i.test(body);
    const { results } = await db.prepare(`${baseSql}
      ORDER BY COALESCE(p.stockQuantity, 0) ASC, p.name ASC
      LIMIT ?
    `).bind(link.businessId, strictBranchId, strictBranchId, wantsMany ? 8 : 1).all<any>();
    const rows = results || [];
    if (!rows.length) return `No products found${branch ? ` in ${branch.name}` : ''}.`;
    return [
      `*Lowest stock${branch ? ` - ${branch.name}` : ''}*`,
      '',
      ...rows.map((product: any, index: number) => `${index + 1}. ${formatStockLine(product, !branch)}`),
    ].join('\n');
  }

  const condition = outOnly
    ? 'AND COALESCE(p.stockQuantity, 0) <= 0'
    : 'AND COALESCE(p.reorderPoint, 0) > 0 AND COALESCE(p.stockQuantity, 0) <= COALESCE(p.reorderPoint, 0)';
  const { results } = await db.prepare(`${baseSql}
    ${condition}
    ORDER BY COALESCE(b.name, 'Unassigned/global') ASC, COALESCE(p.stockQuantity, 0) ASC, p.name ASC
    LIMIT 80
  `).bind(link.businessId, strictBranchId, strictBranchId).all<any>();
  const rows = results || [];
  if (!rows.length) return `${outOnly ? 'No out-of-stock products' : 'No low-stock products'}${branch ? ` in ${branch.name}` : ''}.`;

  if (groupByBranch || !branch) {
    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      const name = branchGroupName(row);
      const list = grouped.get(name) || [];
      list.push(row);
      grouped.set(name, list);
    }
    const lines = [`*${outOnly ? 'Out-of-stock products' : 'Low stock by branch'}*`, ''];
    for (const [branchName, products] of grouped) {
      lines.push(`${branchName}:`);
      for (const product of products.slice(0, 10)) lines.push(`- ${formatStockLine(product)}`);
      if (products.length > 10) lines.push(`- +${products.length - 10} more`);
      lines.push('');
    }
    return lines.join('\n').trim();
  }

  return [
    `*${outOnly ? 'Out of stock' : 'Low stock'} - ${branch.name}*`,
    '',
    ...rows.slice(0, 20).map((product: any, index: number) => `${index + 1}. ${formatStockLine(product)}`),
  ].join('\n');
}

async function aiUsageSummary(db: D1Database, link: any, message: IncomingMessage) {
  await ensureAiSchema(db);
  const settings = await getAiSettings(db, link.businessId);
  const usage = await getUsage(db, link.businessId, `whatsapp:${message.from}`, message.contactName || message.from, link.branchId || null);
  const remaining = Math.max(0, settings.dailyLimit - usage.count);
  return [
    '*AI usage today*',
    `Used: ${usage.count}`,
    `Limit: ${settings.dailyLimit}`,
    `Remaining: ${remaining}`,
    `Status: ${settings.enabled ? (remaining > 0 ? 'Ready' : 'Limit reached') : 'Disabled'}`,
  ].join('\n');
}

async function loadToolBranches(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT id, name, location
    FROM branches
    WHERE businessId = ? AND COALESCE(isActive, 1) != 0
    ORDER BY name
    LIMIT 80
  `).bind(businessId).all<ToolBranch>();
  return results || [];
}

async function loadToolProducts(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT p.id, p.name, p.category, p.barcode, p.sellingPrice, p.costPrice, p.stockQuantity,
           p.reorderPoint, p.supplierIds, p.branchId, p.unit, p.updated_at, b.name AS branchName
    FROM products p
    LEFT JOIN branches b ON b.id = p.branchId AND b.businessId = p.businessId
    WHERE p.businessId = ?
    ORDER BY p.name
    LIMIT 600
  `).bind(businessId).all<ToolProduct>();
  return results || [];
}

async function productMovementSummary(db: D1Database, businessId: string, productId: string, branchId?: string | null) {
  const since7 = Date.now() - 7 * DAY_MS;
  const since30 = Date.now() - 30 * DAY_MS;
  return db.prepare(`
    SELECT
      MAX(timestamp) AS lastOut,
      COALESCE(SUM(CASE WHEN timestamp >= ? THEN quantity ELSE 0 END), 0) AS sold7,
      COALESCE(SUM(CASE WHEN timestamp >= ? THEN quantity ELSE 0 END), 0) AS sold30
    FROM stockMovements
    WHERE businessId = ?
      AND productId = ?
      AND UPPER(COALESCE(type, '')) = 'OUT'
      AND (? IS NULL OR branchId = ? OR branchId IS NULL)
  `).bind(since7, since30, businessId, productId, branchId || null, branchId || null).first<any>();
}

async function supplierNamesForProduct(db: D1Database, businessId: string, product: ToolProduct) {
  const ids = supplierIds(product.supplierIds).slice(0, 8);
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const { results } = await db.prepare(`
    SELECT name, company
    FROM suppliers
    WHERE businessId = ?
      AND id IN (${placeholders})
    ORDER BY COALESCE(company, name)
  `).bind(businessId, ...ids).all<any>();
  return (results || []).map(row => supplierName(row));
}

async function productStatusTool(db: D1Database, link: any, message: IncomingMessage) {
  const body = message.text.trim();
  if (!wantsProductStatusQuestion(body) && !isShortFollowUp(body)) return null;

  let context = '';
  if (isShortFollowUp(body)) {
    context = await latestProductLookupQuery(db, message.from, link.businessId)
      || await loadConversationContext(db, message.from, link.businessId, 6);
  }
  const queryText = `${body}\n${context}`.trim();

  const [branches, products] = await Promise.all([
    loadToolBranches(db, link.businessId),
    loadToolProducts(db, link.businessId),
  ]);
  if (!products.length) return null;

  const linkedBranch = link.branchId ? branches.find(branch => branch.id === link.branchId) : null;
  const branch = linkedBranch || bestTextMatch(queryText, branches, ['name', 'location'], 32);
  const branchProducts = branch
    ? products.filter(product => !product.branchId || product.branchId === branch.id)
    : products;
  const product = bestTextMatch(queryText, branchProducts.length ? branchProducts : products, ['name', 'category', 'barcode'], 45);
  if (!product) return null;

  const stock = asNumber(product.stockQuantity);
  const reorderPoint = asNumber(product.reorderPoint);
  const signal = stockSignal(stock, reorderPoint);
  const movement = await productMovementSummary(db, link.businessId, product.id, branch?.id || product.branchId || null);
  const suppliers = await supplierNamesForProduct(db, link.businessId, product);
  const productBranch = product.branchName || (product.branchId ? product.branchId : 'Unassigned/global');
  const requestedBranch = branch?.name || null;
  const unit = unitSuffix(product.unit);
  const lastOut = asNumber(movement?.lastOut);
  const branchNote = requestedBranch && product.branchId && product.branchId !== branch?.id
    ? `Note: this product is assigned to ${productBranch}, not ${requestedBranch}.`
    : requestedBranch && !product.branchId
      ? `Note: ${product.name} is not assigned to a specific branch; stock is recorded as global/unassigned.`
      : '';

  const lines = [
    `*${product.name}${requestedBranch ? ` - ${requestedBranch}` : ''}*`,
    `Status: ${signal}`,
    `Stock: ${stock}${unit}`,
    reorderPoint > 0 ? `Reorder point: ${reorderPoint}${unit}` : 'Reorder point: not set',
    formatMaybeMoney('Selling price', product.sellingPrice),
    formatMaybeMoney('Cost price', product.costPrice),
    `Branch in POS: ${productBranch}`,
    suppliers.length ? `Suppliers: ${suppliers.join(', ')}` : 'Suppliers: none linked',
    `Sold last 7 days: ${asNumber(movement?.sold7)}${unit}`,
    `Sold last 30 days: ${asNumber(movement?.sold30)}${unit}`,
    lastOut ? `Last stock-out/sale movement: ${dateLabel(lastOut)}` : 'Last stock-out/sale movement: none recorded',
    branchNote,
  ].filter(Boolean);

  return lines.join('\n');
}

async function businessToolAnswer(db: D1Database, link: any, message: IncomingMessage) {
  const body = message.text.trim();
  if (wantsAiUsageQuestion(body)) return aiUsageSummary(db, link, message);
  const supplierRecommendation = await supplierRecommendationTool(db, link, message);
  if (supplierRecommendation) return supplierRecommendation;
  const stockInsight = await stockIntelligenceTool(db, link, message);
  if (stockInsight) return stockInsight;
  const productStatus = await productStatusTool(db, link, message);
  if (productStatus) return productStatus;
  return null;
}

type AgentToolName =
  | 'business_summary'
  | 'sales_summary'
  | 'branch_performance'
  | 'product_status'
  | 'low_stock'
  | 'dead_stock'
  | 'top_products'
  | 'suppliers_list'
  | 'supplier_balances'
  | 'customers_owing'
  | 'expenses_summary'
  | 'cash_status'
  | 'open_shifts'
  | 'pending_approvals'
  | 'audit_orders'
  | 'lpo_status'
  | 'draft_lpo'
  | 'draft_low_stock_lpo'
  | 'update_lpo_draft'
  | 'ai_usage'
  | 'branches'
  | 'staff_list'
  | 'supplier_recommendation'
  | 'attention_summary'
  | 'draft_create_user';

type AgentToolCall = {
  name: AgentToolName;
  args?: Record<string, unknown>;
};

const AGENT_TOOLS: Array<{ name: AgentToolName; access: 'read' | 'draft' | 'protected'; description: string }> = [
  { name: 'business_summary', access: 'read', description: 'Today snapshot: sales, invoices, expenses, refunds, open shifts, low stock.' },
  { name: 'sales_summary', access: 'read', description: 'Sales totals by date range, branch, and payment method.' },
  { name: 'branch_performance', access: 'read', description: 'Compare branches by recent sales.' },
  { name: 'product_status', access: 'read', description: 'Stock, price, supplier, reorder point, and sales movement for a named product.' },
  { name: 'low_stock', access: 'read', description: 'List products at or below reorder point.' },
  { name: 'dead_stock', access: 'read', description: 'Find products with stock but little or no recent movement.' },
  { name: 'top_products', access: 'read', description: 'Top selling products by stock movement.' },
  { name: 'suppliers_list', access: 'read', description: 'Registered suppliers grouped by branch.' },
  { name: 'supplier_balances', access: 'read', description: 'Suppliers with outstanding balances.' },
  { name: 'customers_owing', access: 'read', description: 'Customers with outstanding balances.' },
  { name: 'expenses_summary', access: 'read', description: 'Expense totals by category for a range.' },
  { name: 'cash_status', access: 'read', description: 'Cash sales, cash picks, and cash account picture.' },
  { name: 'open_shifts', access: 'read', description: 'Open cashier shifts by branch.' },
  { name: 'pending_approvals', access: 'read', description: 'Pending expenses, refunds, stock adjustments, LPOs, and cash picks. Supports branch/type filters.' },
  { name: 'audit_orders', access: 'read', description: 'Review LPO risks and admin actions needed.' },
  { name: 'lpo_status', access: 'read', description: 'Check whether the latest WhatsApp LPO draft or LPO was created.' },
  { name: 'draft_lpo', access: 'draft', description: 'Draft an LPO from natural language; requires later admin PIN confirmation.' },
  { name: 'draft_low_stock_lpo', access: 'draft', description: 'Draft LPOs for low-stock items; requires later admin PIN confirmation.' },
  { name: 'update_lpo_draft', access: 'draft', description: 'Change quantity on an active pending LPO draft.' },
  { name: 'ai_usage', access: 'read', description: 'Show AI daily usage and remaining allowance.' },
  { name: 'branches', access: 'read', description: 'List active branches.' },
  { name: 'staff_list', access: 'read', description: 'List POS users/staff by role and branch.' },
  { name: 'supplier_recommendation', access: 'read', description: 'Recommend or validate the supplier to use for restocking a product in a branch.' },
  { name: 'attention_summary', access: 'read', description: 'Summarize what needs owner/admin attention across approvals, low stock, branches, shifts, and cash.' },
  { name: 'draft_create_user', access: 'protected', description: 'Draft creation of a POS user. Actual creation requires admin PIN/password.' },
];

function agentCatalogText() {
  return AGENT_TOOLS
    .map(tool => `- ${tool.name} [${tool.access}]: ${tool.description}`)
    .join('\n');
}

function shouldTryAgentTools(text: string) {
  return /\b(summary|sales?|revenue|payment|mpesa|cash|stock|inventory|product|price|supplier|customer|owe|debt|expense|shift|approval|approve|reject|lpo|po|purchase|order|audit|branch|performance|dead|slow|top|usage|limit|user|staff|employee|cashier|manager|admin|create|add|draft|make|update|change|show|list|which|what|check)\b/i.test(text);
}

function safeJsonFromAi(text: string): any | null {
  try {
    return extractJsonObject(text);
  } catch {
    try { return JSON.parse(text); } catch { return null; }
  }
}

function normalizeToolName(value: unknown): AgentToolName | '' {
  const name = String(value || '').trim() as AgentToolName;
  return AGENT_TOOLS.some(tool => tool.name === name) ? name : '';
}

type PromptIntentName =
  | 'system.help'
  | 'system.status'
  | 'system.unlink'
  | 'auth.link'
  | 'auth.secret_reply'
  | 'approval.execute'
  | 'approval.list'
  | 'lpo.confirm'
  | 'lpo.update_draft'
  | 'lpo.create'
  | 'lpo.audit'
  | 'inventory.low_stock'
  | 'inventory.product_status'
  | 'inventory.dead_stock'
  | 'inventory.top_products'
  | 'sales.summary'
  | 'branches.performance'
  | 'branches.list'
  | 'suppliers.list'
  | 'suppliers.balances'
  | 'customers.owing'
  | 'expenses.summary'
  | 'cash.status'
  | 'shifts.open'
  | 'staff.list'
  | 'staff.create'
  | 'ai.usage'
  | 'business.summary'
  | 'unknown';

type PromptIntent = {
  name: PromptIntentName;
  confidence: number;
  risk: 'read' | 'draft' | 'protected' | 'auth' | 'system' | 'unknown';
  slots: Record<string, string>;
  toolCalls: AgentToolCall[];
  legacyFirst?: boolean;
  reason: string;
};

function textHas(text: string, pattern: RegExp) {
  return pattern.test(text);
}

function extractRangeSlot(text: string) {
  const lower = text.toLowerCase();
  if (/\byesterday\b/.test(lower)) return 'yesterday';
  const match = lower.match(/\b(7|14|30|60|90)\s*(?:d|day|days)\b/);
  if (match) return `${match[1]}d`;
  if (/\b(today|now)\b/.test(lower)) return 'today';
  if (/\bweek\b/.test(lower)) return '7d';
  if (/\bmonth\b/.test(lower)) return '30d';
  return '';
}

function makeIntent(
  name: PromptIntentName,
  confidence: number,
  risk: PromptIntent['risk'],
  reason: string,
  toolCalls: AgentToolCall[] = [],
  slots: Record<string, string> = {},
  legacyFirst = false,
): PromptIntent {
  return { name, confidence, risk, slots, toolCalls, reason, legacyFirst };
}

function analyzePromptFast(text: string): PromptIntent {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const has = (pattern: RegExp) => textHas(lower, pattern);
  const slots: Record<string, string> = {};
  const range = extractRangeSlot(raw);
  if (range) slots.range = range;

  if (/^(link|business|connect)\s+/i.test(raw)) {
    return makeIntent('auth.link', 0.99, 'auth', 'explicit link command', [], slots, true);
  }
  if (/^(unlink|logout|remove)$/i.test(raw)) {
    return makeIntent('system.unlink', 0.99, 'system', 'explicit unlink command', [], slots);
  }
  if (wantsCapabilityHelp(raw) || /^(help|hi|hello|start)$/i.test(raw)) {
    return makeIntent('system.help', 0.98, 'system', 'capability/help request', [], slots);
  }
  if (/^status$/i.test(raw)) {
    return makeIntent('system.status', 0.95, 'system', 'link status request', [], slots);
  }
  if (isStandaloneAdminSecret(raw)) {
    return makeIntent('auth.secret_reply', 0.95, 'protected', 'standalone admin secret for pending action', [], slots, true);
  }
  if (has(/\bconfirm\s+(?:po|lpo)\b/)) {
    return makeIntent('lpo.confirm', 0.96, 'protected', 'confirm pending LPO', [], slots, true);
  }
  if (has(/\bconfirm\s+(?:user|staff|employee)\b/)) {
    return makeIntent('staff.create', 0.96, 'protected', 'confirm pending user creation', [], slots, true);
  }
  if (has(/\b(approve|reject|accept|authorize|decline|deny)\b/) && (ordinalCode(raw) || has(/\b(expense|refund|stock|cash|lpo|po|purchase|approval)\b/))) {
    return makeIntent('approval.execute', 0.95, 'protected', 'approval action request', [], slots, true);
  }
  if (has(/\b(create|add|make|register)\b/) && has(/\b(user|staff|employee|cashier|manager|admin)\b/)) {
    return makeIntent('staff.create', 0.93, 'protected', 'draft staff/user creation', [{ name: 'draft_create_user', args: { query: raw } }], slots);
  }
  if (has(/\b(update|change|edit|make|set)\b/) && has(/\b(lpo|po|draft|order)\b/)) {
    return makeIntent('lpo.update_draft', 0.88, 'draft', 'update active LPO draft', [{ name: 'update_lpo_draft', args: { query: raw } }], slots);
  }
  if (/\d/.test(raw) && has(/\b(make|set|change|update|edit|increase|reduce|quantity|qty)\b/)) {
    return makeIntent('lpo.update_draft', 0.72, 'draft', 'quantity-like follow-up that may target active LPO draft', [{ name: 'update_lpo_draft', args: { query: raw } }], slots);
  }
  if (has(/\b(create|draft|raise|prepare|generate|order|buy|restock)\b/) && has(/\b(lpo|po|purchase order|order)\b/)) {
    const tool: AgentToolName = has(/\b(low stock|almost out|out of stock|reorder|stock)\b/) ? 'draft_low_stock_lpo' : 'draft_lpo';
    return makeIntent('lpo.create', 0.91, 'draft', 'draft purchase order request', [{ name: tool, args: { query: raw } }], slots);
  }
  if (has(/\b(approval|approvals|pending request|pending requests)\b/)) {
    return makeIntent('approval.list', 0.9, 'read', 'pending approvals list', [{ name: 'pending_approvals', args: { query: raw } }], slots);
  }
  if (has(/\b(attention|need my attention|needs attention|weird|strange|problem|problems|issue|issues|what should i do|what should we do|what next|boss briefing|briefing)\b/)) {
    return makeIntent('business.summary', 0.86, 'read', 'owner attention summary request', [{ name: 'attention_summary', args: { query: raw } }], slots);
  }
  if (has(/\b(audit|review|risk|inspect)\b/) && has(/\b(lpo|po|purchase|orders?)\b/)) {
    return makeIntent('lpo.audit', 0.9, 'read', 'LPO audit request', [{ name: 'audit_orders', args: { query: raw } }], slots);
  }
  if (has(/\b(did|was|is|status)\b/) && has(/\b(lpo|po|purchase order)\b/)) {
    return makeIntent('lpo.confirm', 0.78, 'read', 'LPO status request', [{ name: 'lpo_status', args: { query: raw } }], slots);
  }
  if (has(/\b(branch performance|performance by branch|best branch|worst branch|branches performing|branch.*sleeping|sleeping.*branch|quiet branch|dead branch)\b/)) {
    return makeIntent('branches.performance', 0.91, 'read', 'branch performance request', [{ name: 'branch_performance', args: { query: raw, range } }], slots);
  }
  if (has(/\b(open shifts?|active shifts?|who is clocked|cashiers? working|who is working|working right now|staff working|employees working)\b/)) {
    return makeIntent('shifts.open', 0.88, 'read', 'open shifts request', [{ name: 'open_shifts', args: { query: raw } }], slots);
  }
  if (has(/\b(cash status|cash drawer|cash picks?|cash account|cash at hand)\b/)) {
    return makeIntent('cash.status', 0.88, 'read', 'cash status request', [{ name: 'cash_status', args: { query: raw, range } }], slots);
  }
  if (has(/\b(expenses?|spend|spending)\b/)) {
    return makeIntent('expenses.summary', 0.82, 'read', 'expenses summary request', [{ name: 'expenses_summary', args: { query: raw, range } }], slots);
  }
  if (has(/\b(customers?|clients?)\b/) && has(/\b(owe|owing|debt|balance|unpaid|money stuck|stuck|receivable|receivables)\b/)) {
    return makeIntent('customers.owing', 0.88, 'read', 'customer balances request', [{ name: 'customers_owing', args: { query: raw } }], slots);
  }
  if (has(/\b(restock|reorder|buy|purchase|get)\b/) && has(/\b(who|supplier|use|from)\b/)) {
    return makeIntent('suppliers.list', 0.86, 'read', 'supplier recommendation request', [{ name: 'supplier_recommendation', args: { query: raw } }], slots);
  }
  if (has(/\bsuppliers?\b/) && has(/\b(balance|owe|owing|debt|unpaid)\b/)) {
    return makeIntent('suppliers.balances', 0.88, 'read', 'supplier balance request', [{ name: 'supplier_balances', args: { query: raw } }], slots);
  }
  if (has(/\bsuppliers?\b/)) {
    return makeIntent('suppliers.list', 0.84, 'read', 'supplier list request', [{ name: 'suppliers_list', args: { query: raw } }], slots);
  }
  if (has(/\b(staff|users?|employees?|cashiers?|managers?|admins?)\b/) && has(/\b(list|show|who|which|all)\b/)) {
    return makeIntent('staff.list', 0.86, 'read', 'staff list request', [{ name: 'staff_list', args: { query: raw } }], slots);
  }
  if (has(/\b(dead stock|slow stock|not moving|slow moving)\b/)) {
    return makeIntent('inventory.dead_stock', 0.9, 'read', 'dead stock request', [{ name: 'dead_stock', args: { query: raw, range } }], slots);
  }
  if (has(/\b(top products?|best sellers?|fast moving|moving most|sold most|most sold|highest selling)\b/)) {
    return makeIntent('inventory.top_products', 0.9, 'read', 'top products request', [{ name: 'top_products', args: { query: raw, range } }], slots);
  }
  if (/^(stock|inventory)$/i.test(raw)) {
    return makeIntent('inventory.low_stock', 0.86, 'read', 'stock summary command', [{ name: 'low_stock', args: { query: 'low stock by branch' } }], slots);
  }
  if (wantsStockIntelligence(raw)) {
    return makeIntent('inventory.low_stock', 0.9, 'read', 'stock intelligence request', [{ name: 'low_stock', args: { query: raw } }], slots);
  }
  if (wantsProductStatusQuestion(raw) || has(/\b(product|item)\b/)) {
    return makeIntent('inventory.product_status', 0.68, 'read', 'product status style request', [{ name: 'product_status', args: { query: raw } }], slots);
  }
  if (has(/\b(branches|branch list|locations)\b/)) {
    return makeIntent('branches.list', 0.86, 'read', 'branch list request', [{ name: 'branches', args: { query: raw } }], slots);
  }
  if (has(/\b(ai usage|ai limit|assistant usage|bot usage|remaining requests)\b/)) {
    return makeIntent('ai.usage', 0.95, 'read', 'AI usage request', [{ name: 'ai_usage', args: { query: raw } }], slots);
  }
  if (has(/\b(sales?|revenue|turnover|payments?|mpesa)\b/)) {
    return makeIntent('sales.summary', 0.82, 'read', 'sales summary request', [{ name: 'sales_summary', args: { query: raw, range } }], slots);
  }
  if (has(/\b(summary|dashboard|snapshot|today)\b/)) {
    return makeIntent('business.summary', 0.78, 'read', 'business summary request', [{ name: 'business_summary', args: { query: raw } }], slots);
  }
  return makeIntent('unknown', 0.15, 'unknown', 'no fast intent matched', [], slots);
}

function hasExplicitScope(text: string) {
  return /\b(all branches|every branch|whole business|entire business|overall|total|company-wide|business-wide|everywhere)\b/i.test(text);
}

function hasExplicitTimeRange(text: string) {
  return !!extractRangeSlot(text)
    || /\b(today|yesterday|this week|last week|this month|last month|now|current|daily|weekly|monthly|since|between)\b/i.test(text);
}

function vagueQuestionPrefix(text: string) {
  return /^(tell me|show me|give me|check|what about|how about|status|report)\b/i.test(text.trim());
}

async function clarificationForIntent(db: D1Database, link: any, message: IncomingMessage, intent: PromptIntent) {
  const text = message.text.trim();
  if (intent.legacyFirst || intent.risk === 'system' || intent.risk === 'auth') return null;
  if (intent.confidence < 0.55) {
    return [
      'I am not fully sure what you want me to check.',
      'Please mention the area: sales, stock, approvals, suppliers, customers, cash, staff, or LPOs.',
    ].join('\n');
  }

  if (intent.name === 'sales.summary') {
    const branch = await resolveBranchFromTool(db, link, text);
    if (!hasExplicitTimeRange(text) && !branch && !hasExplicitScope(text)) {
      return [
        'Which sales should I check?',
        'Example: sales today all branches',
        'Example: sales this week CBD Express',
      ].join('\n');
    }
  }

  if (intent.name === 'expenses.summary' || intent.name === 'cash.status') {
    const branch = await resolveBranchFromTool(db, link, text);
    if (vagueQuestionPrefix(text) && !hasExplicitTimeRange(text) && !branch && !hasExplicitScope(text)) {
      return [
        `Which ${intent.name === 'cash.status' ? 'cash' : 'expense'} view do you want?`,
        'Mention a branch or time range, for example: this week CBD Express.',
      ].join('\n');
    }
  }

  if (intent.name === 'inventory.product_status') {
    const products = await loadToolProducts(db, link.businessId);
    const product = bestTextMatch(text, products, ['name', 'category', 'barcode'], 45);
    if (!product) {
      return [
        'Which product should I check?',
        'Include the product name and branch if needed.',
        'Example: status of Milk 1L in CBD Express.',
      ].join('\n');
    }
  }

  if (intent.name === 'inventory.low_stock' && /^(stock|inventory)$/i.test(text)) {
    return [
      'What stock view do you want?',
      '1. low stock by branch',
      '2. lowest stock in a branch',
      '3. status of a specific product',
    ].join('\n');
  }

  if (intent.toolCalls.some(call => call.name === 'supplier_recommendation')) {
    const [branch, products] = await Promise.all([
      resolveBranchFromTool(db, link, text),
      loadToolProducts(db, link.businessId),
    ]);
    const product = bestTextMatch(text, products, ['name', 'category', 'barcode'], 42);
    if (!product || !branch) {
      return [
        'Which product and branch should I match to a supplier?',
        'Example: which supplier should I use for Cooking Oil 1L in CBD Express?',
      ].join('\n');
    }
  }

  if (intent.name === 'lpo.create') {
    const hasSupplierHint = /\b(from|supplier|using|use)\b/i.test(text);
    const hasQuantityHint = /\b\d+(?:\.\d+)?\s*(?:pcs?|pieces?|units?|pkt|packets?|ctn|cartons?|box|boxes|pack|packs|set|sets)?\b/i.test(text);
    if (!hasSupplierHint && !/\blow stock|almost out|out of stock|reorder\b/i.test(text)) {
      return [
        'Which supplier should I use for the LPO?',
        'Example: create LPO for 20 Milk 1L from OMBURI MLA CHAKE in CBD Express.',
      ].join('\n');
    }
    if (!hasQuantityHint && !/\blow stock|almost out|out of stock|reorder\b/i.test(text)) {
      return [
        'How many units should I put on the LPO?',
        'Example: order 20 Milk 1L from OMBURI MLA CHAKE.',
      ].join('\n');
    }
  }

  return null;
}

function deterministicAgentToolCalls(text: string): AgentToolCall[] {
  const analyzed = analyzePromptFast(text);
  if (!analyzed.legacyFirst && analyzed.toolCalls.length) return analyzed.toolCalls;

  const calls: AgentToolCall[] = [];
  const lower = text.toLowerCase();
  const has = (pattern: RegExp) => pattern.test(lower);

  if (has(/\b(create|add|make|register)\b/) && has(/\b(user|staff|employee|cashier|manager|admin)\b/)) {
    return [{ name: 'draft_create_user', args: { query: text } }];
  }
  if (has(/\b(update|change|edit|make|set)\b/) && has(/\b(lpo|po|draft|order)\b/)) {
    return [{ name: 'update_lpo_draft', args: { query: text } }];
  }
  if (has(/\b(create|draft|raise|prepare|generate|order|buy|restock)\b/) && has(/\b(lpo|po|purchase order|order)\b/)) {
    return [{ name: has(/\b(low stock|almost out|out of stock|reorder|stock)\b/) ? 'draft_low_stock_lpo' : 'draft_lpo', args: { query: text } }];
  }
  if (has(/\b(approve|reject|approval|approvals|pending request|pending requests)\b/)) {
    return [{ name: 'pending_approvals', args: { query: text } }];
  }
  if (has(/\b(audit|review|risk|inspect)\b/) && has(/\b(lpo|po|purchase|orders?)\b/)) {
    return [{ name: 'audit_orders', args: { query: text } }];
  }
  if (has(/\b(did|was|is|status)\b/) && has(/\b(lpo|po|purchase order)\b/)) {
    return [{ name: 'lpo_status', args: { query: text } }];
  }
  if (has(/\b(branch performance|performance by branch|best branch|worst branch|branches performing)\b/)) {
    return [{ name: 'branch_performance', args: { query: text } }];
  }
  if (has(/\b(open shifts?|active shifts?|who is clocked|cashiers? working)\b/)) {
    return [{ name: 'open_shifts', args: { query: text } }];
  }
  if (has(/\b(cash status|cash drawer|cash picks?|cash account|cash at hand)\b/)) {
    return [{ name: 'cash_status', args: { query: text } }];
  }
  if (has(/\b(expenses?|spend|spending)\b/)) {
    return [{ name: 'expenses_summary', args: { query: text } }];
  }
  if (has(/\b(customers?|clients?)\b/) && has(/\b(owe|owing|debt|balance|unpaid)\b/)) {
    return [{ name: 'customers_owing', args: { query: text } }];
  }
  if (has(/\bsuppliers?\b/) && has(/\b(balance|owe|owing|debt|unpaid)\b/)) {
    return [{ name: 'supplier_balances', args: { query: text } }];
  }
  if (has(/\bsuppliers?\b/)) {
    return [{ name: 'suppliers_list', args: { query: text } }];
  }
  if (has(/\b(staff|users?|employees?|cashiers?|managers?|admins?)\b/) && has(/\b(list|show|who|which|all)\b/)) {
    return [{ name: 'staff_list', args: { query: text } }];
  }
  if (has(/\b(dead stock|slow stock|not moving|slow moving)\b/)) {
    return [{ name: 'dead_stock', args: { query: text } }];
  }
  if (has(/\b(top products?|best sellers?|fast moving|moving most)\b/)) {
    return [{ name: 'top_products', args: { query: text } }];
  }
  if (has(/\b(low stock|lowest stock|out of stock|almost out|reorder|inventory)\b/)) {
    return [{ name: 'low_stock', args: { query: text } }];
  }
  if (has(/\b(branches|branch list|locations)\b/)) {
    return [{ name: 'branches', args: { query: text } }];
  }
  if (has(/\b(ai usage|ai limit|assistant usage|bot usage|remaining requests)\b/)) {
    return [{ name: 'ai_usage', args: { query: text } }];
  }
  if (has(/\b(sales?|revenue|turnover|payments?|mpesa)\b/)) {
    calls.push({ name: 'sales_summary', args: { query: text } });
  }
  if (has(/\b(summary|dashboard|snapshot|today)\b/) && !calls.length) {
    calls.push({ name: 'business_summary', args: { query: text } });
  }
  return calls.slice(0, 3);
}

async function planAgentToolCalls(db: D1Database, env: Env, link: any, message: IncomingMessage): Promise<AgentToolCall[]> {
  if (!env.AI && !env.CLOUDFLARE_ACCOUNT_ID) return [];
  const context = await loadConversationContext(db, message.from, link.businessId, 8);
  const prompt = [
    'You are the tool planner for Mtaani POS WhatsApp.',
    'Choose the POS tool calls that should answer or perform the user request.',
    'Return JSON only with this shape: {"tool_calls":[{"name":"tool_name","args":{}}]}',
    'Use at most 3 tools. If no tool fits, return {"tool_calls":[]}.',
    'Do not answer the user. Do not invent data. Tools will query the POS database.',
    'Write tools only draft or request confirmation; protected tools require admin PIN later.',
    '',
    'Available tools:',
    agentCatalogText(),
    '',
    'Useful args:',
    '- query: product, supplier, customer, or free text to match.',
    '- range: today, yesterday, 7d, 30d, 60d, 90d.',
    '- branch: branch name.',
    '- type: EXPENSE, REFUND, LPO, STOCK, CASH.',
    '- name, role, password, pin, branch for draft_create_user.',
    '',
    `Recent context:\n${context || 'None'}`,
    '',
    `User message: ${message.text}`,
  ].join('\n');

  try {
    const planned = safeJsonFromAi(await runAi(env, prompt));
    const rawCalls = Array.isArray(planned?.tool_calls) ? planned.tool_calls : [];
    return rawCalls
      .slice(0, 3)
      .map((call: any) => ({ name: normalizeToolName(call?.name), args: call?.args && typeof call.args === 'object' ? call.args : {} }))
      .filter((call: AgentToolCall) => !!call.name);
  } catch (err) {
    console.error('WhatsApp agent planner failed:', err);
    return [];
  }
}

function rangeDays(range: unknown, text = '') {
  const source = `${String(range || '')} ${text}`.toLowerCase();
  if (/\byesterday\b/.test(source)) return { label: 'yesterday', days: 1, offsetDays: 1 };
  const match = source.match(/\b(7|14|30|60|90)\s*(?:d|day|days)\b/);
  if (match) return { label: `last ${match[1]} days`, days: Number(match[1]), offsetDays: 0 };
  if (/\b(month|30)\b/.test(source)) return { label: 'last 30 days', days: 30, offsetDays: 0 };
  if (/\bweek|7\b/.test(source)) return { label: 'last 7 days', days: 7, offsetDays: 0 };
  return { label: 'today', days: 1, offsetDays: 0 };
}

function rangeBoundsFromTool(range: unknown, text = '') {
  const parsed = rangeDays(range, text);
  if (parsed.offsetDays === 1) {
    const today = todayBounds();
    return { label: parsed.label, start: today.start - DAY_MS, end: today.start };
  }
  if (parsed.days === 1) {
    const today = todayBounds();
    return { label: parsed.label, start: today.start, end: today.end };
  }
  return { label: parsed.label, start: Date.now() - parsed.days * DAY_MS, end: Date.now() + 1 };
}

async function resolveBranchFromTool(db: D1Database, link: any, text: string, branchArg?: unknown) {
  const branches = await loadToolBranches(db, link.businessId);
  if (link.branchId) return branches.find(branch => branch.id === link.branchId) || null;
  const explicitArg = trimText(branchArg, 120);
  if (explicitArg) return bestTextMatch(explicitArg, branches, ['name', 'location'], 35);
  const normalizedText = norm(text);
  const direct = branches.find(branch => {
    const branchName = norm(branch.name);
    const location = norm(branch.location || '');
    return (branchName && normalizedText.includes(branchName))
      || (location && normalizedText.includes(location));
  });
  if (direct) return direct;
  const phrase = text.match(/\b(?:in|at|for|from)\s+([a-z0-9\s&.'-]{2,80}?)(?:\s+(?:branch|store|outlet|shop|today|yesterday|last|this|only|with|where|which|what)|$)/i)?.[1];
  return phrase ? bestTextMatch(phrase, branches, ['name', 'location'], 35) : null;
}

async function salesSummaryTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const range = rangeBoundsFromTool(args.range, text);
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const [totals, payments] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(tax), 0) AS taxTotal
      FROM transactions
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(status, '')) NOT IN ('VOIDED', 'QUOTE')
        AND (? IS NULL OR branchId = ?)
    `).bind(link.businessId, range.start, range.end, branch?.id || null, branch?.id || null).first<any>(),
    db.prepare(`
      SELECT COALESCE(paymentMethod, 'UNKNOWN') AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
      FROM transactions
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(status, '')) NOT IN ('VOIDED', 'QUOTE')
        AND (? IS NULL OR branchId = ?)
      GROUP BY COALESCE(paymentMethod, 'UNKNOWN')
      ORDER BY total DESC
      LIMIT 8
    `).bind(link.businessId, range.start, range.end, branch?.id || null, branch?.id || null).all<any>(),
  ]);

  return [
    `*Sales ${range.label}${branch ? ` - ${branch.name}` : ''}*`,
    `Total: ${money(totals?.total)} from ${asNumber(totals?.count)} receipts`,
    `Tax: ${money(totals?.taxTotal)}`,
    '',
    ...((payments.results || []) as any[]).map(row => `${String(row.method || 'UNKNOWN').toUpperCase()}: ${money(row.total)} (${asNumber(row.count)})`),
  ].join('\n').trim();
}

async function branchPerformanceTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const range = rangeBoundsFromTool(args.range || '30d', text);
  const { results } = await db.prepare(`
    SELECT b.name, COUNT(t.id) AS count, COALESCE(SUM(t.total), 0) AS sales
    FROM branches b
    LEFT JOIN transactions t ON t.businessId = b.businessId
      AND t.branchId = b.id
      AND t.timestamp >= ?
      AND t.timestamp < ?
      AND UPPER(COALESCE(t.status, '')) NOT IN ('VOIDED', 'QUOTE')
    WHERE b.businessId = ? AND COALESCE(b.isActive, 1) != 0
    GROUP BY b.id, b.name
    ORDER BY sales DESC, b.name ASC
    LIMIT 12
  `).bind(range.start, range.end, link.businessId).all<any>();
  const rows = results || [];
  if (!rows.length) return 'No active branch sales found.';
  return [
    `*Branch performance - ${range.label}*`,
    '',
    ...rows.map((row: any, index: number) => `${index + 1}. ${row.name}: ${money(row.sales)} (${asNumber(row.count)} receipts)`),
  ].join('\n');
}

async function deadStockTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const range = rangeDays(args.range || '60d', text);
  const since = Date.now() - range.days * DAY_MS;
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const { results } = await db.prepare(`
    SELECT p.id, p.name, p.stockQuantity, p.unit, b.name AS branchName,
           COALESCE(SUM(CASE WHEN sm.timestamp >= ? THEN sm.quantity ELSE 0 END), 0) AS sold,
           MAX(sm.timestamp) AS lastSold
    FROM products p
    LEFT JOIN branches b ON b.id = p.branchId AND b.businessId = p.businessId
    LEFT JOIN stockMovements sm ON sm.productId = p.id AND sm.businessId = p.businessId AND UPPER(COALESCE(sm.type, '')) = 'OUT'
    WHERE p.businessId = ?
      AND COALESCE(p.stockQuantity, 0) > 0
      AND (? IS NULL OR p.branchId = ? OR p.branchId IS NULL)
    GROUP BY p.id
    HAVING sold <= 3
    ORDER BY sold ASC, p.stockQuantity DESC, p.name ASC
    LIMIT 12
  `).bind(since, link.businessId, branch?.id || null, branch?.id || null).all<any>();
  const rows = results || [];
  if (!rows.length) return `No dead-stock candidates found for ${range.label}.`;
  return [
    `*Dead/slow stock - ${range.label}${branch ? ` - ${branch.name}` : ''}*`,
    '',
    ...rows.map((row: any) => {
      const last = asNumber(row.lastSold);
      return `- ${row.name}: ${asNumber(row.stockQuantity)}${unitSuffix(row.unit)}, sold ${asNumber(row.sold)}${unitSuffix(row.unit)}${last ? `, last sold ${daysAgo(last)}d ago` : ', no sale movement recorded'}`;
    }),
  ].join('\n');
}

async function topProductsTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const range = rangeBoundsFromTool(args.range || '30d', text);
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const { results } = await db.prepare(`
    SELECT p.name, p.unit, COALESCE(SUM(sm.quantity), 0) AS qty
    FROM stockMovements sm
    JOIN products p ON p.id = sm.productId AND p.businessId = sm.businessId
    WHERE sm.businessId = ?
      AND sm.timestamp >= ?
      AND sm.timestamp < ?
      AND UPPER(COALESCE(sm.type, '')) = 'OUT'
      AND (? IS NULL OR sm.branchId = ? OR sm.branchId IS NULL)
    GROUP BY p.id, p.name, p.unit
    ORDER BY qty DESC
    LIMIT 10
  `).bind(link.businessId, range.start, range.end, branch?.id || null, branch?.id || null).all<any>();
  const rows = results || [];
  if (!rows.length) return `No product movement found for ${range.label}.`;
  return [
    `*Top products - ${range.label}${branch ? ` - ${branch.name}` : ''}*`,
    '',
    ...rows.map((row: any, index: number) => `${index + 1}. ${row.name}: ${asNumber(row.qty)}${unitSuffix(row.unit)}`),
  ].join('\n');
}

async function supplierBalancesTool(db: D1Database, businessId: string) {
  const { results } = await db.prepare(`
    SELECT s.name, s.company, s.balance, b.name AS branchName
    FROM suppliers s
    LEFT JOIN branches b ON b.id = s.branchId AND b.businessId = s.businessId
    WHERE s.businessId = ? AND COALESCE(s.balance, 0) > 0
    ORDER BY s.balance DESC
    LIMIT 12
  `).bind(businessId).all<any>();
  const rows = results || [];
  if (!rows.length) return 'No supplier balances are outstanding.';
  return [
    '*Supplier balances*',
    '',
    ...rows.map((row: any) => `- ${supplierName(row)}: ${money(row.balance)}${row.branchName ? ` | ${row.branchName}` : ''}`),
  ].join('\n');
}

async function customersOwingTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const { results } = await db.prepare(`
    SELECT c.name, c.phone, c.balance, c.totalSpent, b.name AS branchName
    FROM customers c
    LEFT JOIN branches b ON b.id = c.branchId AND b.businessId = c.businessId
    WHERE c.businessId = ?
      AND COALESCE(c.balance, 0) > 0
      AND (? IS NULL OR c.branchId = ? OR c.branchId IS NULL)
    ORDER BY c.balance DESC
    LIMIT 12
  `).bind(link.businessId, branch?.id || null, branch?.id || null).all<any>();
  const rows = results || [];
  if (!rows.length) return `No customers owing${branch ? ` in ${branch.name}` : ''}.`;
  return [
    `*Customers owing${branch ? ` - ${branch.name}` : ''}*`,
    '',
    ...rows.map((row: any) => `- ${row.name}: ${money(row.balance)}${row.phone ? ` | ${row.phone}` : ''}`),
  ].join('\n');
}

async function expensesSummaryTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const range = rangeBoundsFromTool(args.range || '30d', text);
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const { results } = await db.prepare(`
    SELECT category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE businessId = ?
      AND timestamp >= ?
      AND timestamp < ?
      AND UPPER(COALESCE(status, 'APPROVED')) != 'REJECTED'
      AND (? IS NULL OR branchId = ?)
    GROUP BY category
    ORDER BY total DESC
    LIMIT 12
  `).bind(link.businessId, range.start, range.end, branch?.id || null, branch?.id || null).all<any>();
  const rows = results || [];
  if (!rows.length) return `No expenses found for ${range.label}.`;
  const total = rows.reduce((sum: number, row: any) => sum + asNumber(row.total), 0);
  return [
    `*Expenses - ${range.label}${branch ? ` - ${branch.name}` : ''}*`,
    `Total: ${money(total)}`,
    '',
    ...rows.map((row: any) => `- ${row.category || 'General'}: ${money(row.total)} (${asNumber(row.count)})`),
  ].join('\n');
}

async function cashStatusTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const range = rangeBoundsFromTool(args.range || 'today', text);
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const [cashSales, picks, accounts] = await Promise.all([
    db.prepare(`
      SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
      FROM transactions
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(paymentMethod, '')) = 'CASH'
        AND UPPER(COALESCE(status, '')) NOT IN ('VOIDED', 'QUOTE')
        AND (? IS NULL OR branchId = ?)
    `).bind(link.businessId, range.start, range.end, branch?.id || null, branch?.id || null).first<any>(),
    db.prepare(`
      SELECT status, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
      FROM cashPicks
      WHERE businessId = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND (? IS NULL OR branchId = ?)
      GROUP BY status
    `).bind(link.businessId, range.start, range.end, branch?.id || null, branch?.id || null).all<any>(),
    db.prepare(`
      SELECT name, balance
      FROM financialAccounts
      WHERE businessId = ?
        AND UPPER(COALESCE(type, '')) = 'CASH'
        AND (? IS NULL OR branchId = ? OR branchId IS NULL)
      ORDER BY balance DESC
      LIMIT 6
    `).bind(link.businessId, branch?.id || null, branch?.id || null).all<any>().catch(() => ({ results: [] })),
  ]);
  return [
    `*Cash status - ${range.label}${branch ? ` - ${branch.name}` : ''}*`,
    `Cash sales: ${money(cashSales?.total)} (${asNumber(cashSales?.count)} receipts)`,
    '',
    '*Cash picks*',
    ...((picks.results || []) as any[]).map(row => `- ${row.status || 'UNKNOWN'}: ${money(row.total)} (${asNumber(row.count)})`),
    (picks.results || []).length ? '' : '- None recorded',
    '',
    '*Cash accounts*',
    ...((accounts.results || []) as any[]).map(row => `- ${row.name}: ${money(row.balance)}`),
    (accounts.results || []).length ? '' : '- None found',
  ].join('\n').trim();
}

async function openShiftsTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const { results } = await db.prepare(`
    SELECT s.id, s.cashierName, s.startTime, b.name AS branchName
    FROM shifts s
    LEFT JOIN branches b ON b.id = s.branchId AND b.businessId = s.businessId
    WHERE s.businessId = ?
      AND UPPER(COALESCE(s.status, '')) = 'OPEN'
      AND (? IS NULL OR s.branchId = ?)
    ORDER BY s.startTime ASC
    LIMIT 12
  `).bind(link.businessId, branch?.id || null, branch?.id || null).all<any>();
  const rows = results || [];
  if (!rows.length) return `No open shifts${branch ? ` in ${branch.name}` : ''}.`;
  return [
    `*Open shifts${branch ? ` - ${branch.name}` : ''}*`,
    '',
    ...rows.map((row: any) => `- ${row.cashierName || 'Cashier'} | ${row.branchName || 'Branch'} | opened ${dateLabel(asNumber(row.startTime))}`),
  ].join('\n');
}

async function staffListTool(db: D1Database, link: any, text: string, args: Record<string, unknown> = {}) {
  const branch = await resolveBranchFromTool(db, link, text, args.branch);
  const role = String(args.role || text.match(/\b(admin|manager|cashier)\b/i)?.[1] || '').toUpperCase();
  const { results } = await db.prepare(`
    SELECT u.name, u.role, b.name AS branchName
    FROM users u
    LEFT JOIN branches b ON b.id = u.branchId AND b.businessId = u.businessId
    WHERE u.businessId = ?
      AND (? = '' OR UPPER(u.role) = ?)
      AND (? IS NULL OR u.branchId = ? OR u.role = 'ADMIN')
    ORDER BY u.role, u.name
    LIMIT 30
  `).bind(link.businessId, role, role, branch?.id || null, branch?.id || null).all<any>();
  const rows = results || [];
  if (!rows.length) return 'No matching staff users found.';
  return [
    `*Staff users${role ? ` - ${role}` : ''}${branch ? ` - ${branch.name}` : ''}*`,
    '',
    ...rows.map((row: any) => `- ${row.name} | ${row.role}${row.branchName ? ` | ${row.branchName}` : ''}`),
  ].join('\n');
}

function normalizeStaffRole(value: unknown, text = '') {
  const role = String(value || text.match(/\b(admin|manager|cashier)\b/i)?.[1] || 'CASHIER').toUpperCase();
  return ['ADMIN', 'MANAGER', 'CASHIER'].includes(role) ? role : '';
}

function extractStaffName(args: Record<string, unknown>, text: string) {
  const provided = trimText(args.name, 120);
  if (provided) return provided;
  const match = text.match(/\b(?:called|named|name\s+is|user|staff|employee|cashier|manager|admin)\s+([A-Za-z][A-Za-z0-9 .'-]{1,80}?)(?:\s+(?:as|for|in|at|with|password|pin|role|branch)\b|$)/i);
  return trimText(match?.[1]?.replace(/\s+(?:for|in|at|with)\s+.*$/i, '') || '', 120);
}

function extractNewUserPassword(args: Record<string, unknown>, text: string) {
  const fromArgs = String(args.password || '');
  if (fromArgs.length >= 4) return fromArgs.slice(0, 80);
  const match = text.match(/\b(?:login\s+password|new\s+password|password)\s*(?:is|:|=)?\s*([A-Za-z0-9@#$%^&*!._-]{4,80})\b/i);
  return match ? match[1] : '';
}

function temporaryPassword() {
  return `MT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function ensureUserToolSchema(db: D1Database) {
  try { await db.prepare('ALTER TABLE users ADD COLUMN pin TEXT').run(); } catch {}
  await ensureActionTables(db);
}

async function draftCreateUserTool(db: D1Database, link: any, message: IncomingMessage, args: Record<string, unknown> = {}) {
  await ensureUserToolSchema(db);
  const name = extractStaffName(args, message.text);
  const role = normalizeStaffRole(args.role, message.text);
  if (!name) return 'Who should I create? Example: create cashier Jane for CBD Express.';
  if (!role) return 'Which role should this user have? Allowed roles: ADMIN, MANAGER, CASHIER.';

  const branch = await resolveBranchFromTool(db, link, message.text, args.branch);
  if (role !== 'ADMIN' && !branch) {
    const branches = await loadToolBranches(db, link.businessId);
    return [
      `Which branch is ${name} assigned to?`,
      '',
      `Active branches: ${branches.map(row => row.name).join(', ') || 'none'}.`,
      `Example: create ${role.toLowerCase()} ${name} for CBD Express.`,
    ].join('\n');
  }

  const duplicate = await db.prepare(`
    SELECT id
    FROM users
    WHERE businessId = ? AND lower(trim(name)) = lower(trim(?))
    LIMIT 1
  `).bind(link.businessId, name).first<any>();
  if (duplicate) return `A staff user named ${name} already exists.`;

  const password = extractNewUserPassword(args, message.text);
  const payload: any = {
    name,
    role,
    branchId: role === 'ADMIN' ? (branch?.id || null) : branch?.id,
    branchName: branch?.name || null,
    passwordProvided: !!password,
    passwordHash: password ? await hashPassword(password) : null,
  };
  const code = await savePendingAction(db, {
    phone: message.from,
    businessId: link.businessId,
    branchId: payload.branchId,
    actionType: 'CREATE_USER',
    payload,
  });

  return [
    '*User draft ready*',
    `Name: ${payload.name}`,
    `Role: ${payload.role}`,
    `Branch: ${payload.branchName || 'All branches/admin'}`,
    `Password: ${payload.passwordProvided ? 'provided' : 'temporary password will be generated after confirmation'}`,
    '',
    `To create this user, reply: confirm user ${code} YOUR_ADMIN_PIN`,
  ].join('\n');
}

async function createUserFromDraft(db: D1Database, businessId: string, draft: any, principal: Principal) {
  await ensureUserToolSchema(db);
  const now = Date.now();
  const id = `user_${businessId}_${crypto.randomUUID()}`;
  const tempPassword = draft.passwordHash ? '' : temporaryPassword();
  const passwordHash = draft.passwordHash || await hashPassword(tempPassword);
  await db.batch([
    db.prepare(`INSERT INTO users (id, name, password, role, businessId, branchId, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, draft.name, passwordHash, draft.role, businessId, draft.branchId || null, now),
    auditLog(db, {
      principal,
      businessId,
      branchId: draft.branchId || null,
      action: 'admin.user.create.whatsapp',
      entity: 'user',
      entityId: id,
      severity: 'WARN',
      details: `Created ${draft.role} account for ${draft.name} via WhatsApp.`,
    }),
  ]);
  return { id, tempPassword };
}

async function confirmUserDraft(db: D1Database, link: any, phone: string, code: string, pin: string) {
  const pending = await loadPendingAction(db, code, phone, link.businessId, 'CREATE_USER');
  const principal = await verifyAdminPin(db, link.businessId, phone, pin, pending.branchId);
  const created = await createUserFromDraft(db, link.businessId, pending.payload, principal);
  await db.prepare("UPDATE whatsappPendingActions SET status = 'COMPLETED', completedAt = ? WHERE id = ?")
    .bind(Date.now(), pending.id)
    .run();
  return [
    `Created ${pending.payload.role} user ${pending.payload.name}.`,
    created.tempPassword ? `Temporary password: ${created.tempPassword}` : 'Password: the provided password was used.',
    'Ask them to change the password after first login.',
  ].join('\n');
}

async function confirmLatestUserDraft(db: D1Database, link: any, phone: string, pin: string) {
  const pending = await latestPendingAction(db, phone, link.businessId, 'CREATE_USER');
  if (!pending) return null;
  const principal = await verifyAdminPin(db, link.businessId, phone, pin, pending.branchId);
  const created = await createUserFromDraft(db, link.businessId, pending.payload, principal);
  await db.prepare("UPDATE whatsappPendingActions SET status = 'COMPLETED', completedAt = ? WHERE id = ?")
    .bind(Date.now(), pending.id)
    .run();
  return [
    `Created ${pending.payload.role} user ${pending.payload.name}.`,
    created.tempPassword ? `Temporary password: ${created.tempPassword}` : 'Password: the provided password was used.',
    'Ask them to change the password after first login.',
  ].join('\n');
}

async function executeAgentTool(db: D1Database, env: Env, link: any, message: IncomingMessage, call: AgentToolCall) {
  const args = call.args || {};
  const queryText = trimText(args.query || args.instruction || message.text, 900);
  const toolMessage = { ...message, text: queryText || message.text };

  switch (call.name) {
    case 'business_summary':
      return businessSummary(db, link.businessId);
    case 'sales_summary':
      return salesSummaryTool(db, link, message.text, args);
    case 'branch_performance':
      return branchPerformanceTool(db, link, message.text, args);
    case 'product_status':
      return await productStatusTool(db, link, toolMessage) || `I could not match that product. Try the product name and branch together.`;
    case 'low_stock':
      return await stockIntelligenceTool(db, link, toolMessage) || stockSummary(db, link.businessId);
    case 'dead_stock':
      return deadStockTool(db, link, message.text, args);
    case 'top_products':
      return topProductsTool(db, link, message.text, args);
    case 'suppliers_list':
      return suppliersSummary(db, link.businessId);
    case 'supplier_balances':
      return supplierBalancesTool(db, link.businessId);
    case 'customers_owing':
      return customersOwingTool(db, link, message.text, args);
    case 'expenses_summary':
      return expensesSummaryTool(db, link, message.text, args);
    case 'cash_status':
      return cashStatusTool(db, link, message.text, args);
    case 'open_shifts':
      return openShiftsTool(db, link, message.text, args);
    case 'pending_approvals':
      return approvalsSummary(db, link.businessId, [args.type, args.branch, message.text].filter(Boolean).join(' '));
    case 'audit_orders':
      return auditOrders(db, env, link.businessId);
    case 'lpo_status':
      return latestLpoStatus(db, link, message.from);
    case 'draft_lpo':
      return draftLpoFromWhatsApp(db, env, link, toolMessage);
    case 'draft_low_stock_lpo':
      return draftLowStockLpos(db, link, toolMessage);
    case 'update_lpo_draft':
      return await updateLatestLpoDraftFromText(db, link, message.from, toolMessage.text)
        || 'I do not have an active LPO draft to update.';
    case 'ai_usage':
      return aiUsageSummary(db, link, message);
    case 'branches':
      return branchesSummary(db, link.businessId);
    case 'staff_list':
      return staffListTool(db, link, message.text, args);
    case 'supplier_recommendation':
      return await supplierRecommendationTool(db, link, toolMessage)
        || 'I could not match the product and branch for supplier recommendation. Try: which supplier should I use for Cooking Oil 1L in CBD Express?';
    case 'attention_summary':
      return attentionSummaryTool(db, link);
    case 'draft_create_user':
      return draftCreateUserTool(db, link, message, args);
    default:
      return null;
  }
}

async function agenticToolAnswer(db: D1Database, env: Env, link: any, message: IncomingMessage) {
  if (!shouldTryAgentTools(message.text)) return null;
  const deterministicCalls = deterministicAgentToolCalls(message.text);
  const calls = deterministicCalls.length ? deterministicCalls : await planAgentToolCalls(db, env, link, message);
  if (!calls.length) return null;
  const outputs: string[] = [];
  for (const call of calls) {
    try {
      const output = await executeAgentTool(db, env, link, message, call);
      if (output) outputs.push(output);
      if (call.name.startsWith('draft_') || call.name === 'update_lpo_draft') break;
    } catch (err: any) {
      if (err instanceof PolicyError) outputs.push(err.message);
      else {
        console.error(`WhatsApp tool ${call.name} failed:`, err?.message || err);
        outputs.push(`I could not complete ${call.name.replace(/_/g, ' ')}. Please try again or use the POS.`);
      }
      break;
    }
  }
  return outputs.length ? truncateText(outputs.join('\n\n'), 3500) : null;
}

async function executeFastIntent(
  db: D1Database,
  env: Env,
  link: any,
  message: IncomingMessage,
  intent: PromptIntent,
) {
  if (intent.legacyFirst) return null;
  if (intent.name === 'system.help') return helpText(true);
  if (intent.name === 'system.status') {
    return `Linked to ${link.businessName}. Intent engine is active. Ask a POS question, request an action, or send help.`;
  }
  if (intent.name === 'system.unlink') return unlinkBusiness(db, message.from);
  const clarification = await clarificationForIntent(db, link, message, intent);
  if (clarification) return clarification;
  if (!intent.toolCalls.length || intent.confidence < 0.68) return null;

  const outputs: string[] = [];
  for (const call of intent.toolCalls.slice(0, 3)) {
    try {
      const output = await executeAgentTool(db, env, link, message, call);
      if (output) outputs.push(output);
      if (call.name.startsWith('draft_') || call.name === 'update_lpo_draft') break;
    } catch (err: any) {
      if (err instanceof PolicyError) outputs.push(err.message);
      else {
        console.error(`Fast intent ${intent.name} via ${call.name} failed:`, err?.message || err);
        outputs.push(`I understood this as ${intent.name}, but could not complete the tool action. Try again or use the POS.`);
      }
      break;
    }
  }
  return outputs.length ? truncateText(outputs.join('\n\n'), 3500) : null;
}

type ApprovalType = 'EXPENSE' | 'REFUND' | 'LPO' | 'STOCK' | 'CASH';

type ApprovalItem = {
  code: string;
  type: ApprovalType;
  id: string;
  businessId: string;
  branchId: string;
  branchName?: string;
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
  if (cleanPin.length < 3) throw new PolicyError('Admin PIN/password is required.', 401);

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
      branchName: row.branchName || 'Branch',
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
      branchName: row.branchName || 'Branch',
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
      branchName: row.branchName || 'Branch',
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
      branchName: row.branchName || 'Branch',
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
      branchName: row.branchName || 'Branch',
      title: `Cash pick ${money(row.amount)}`,
      details: `${row.branchName || 'Branch'}${row.userName ? ` | ${row.userName}` : ''}`,
      amount: asNumber(row.amount),
    });
  }

  return items.slice(0, 20).map((item, index) => ({ ...item, code: `A${index + 1}` }));
}

type ApprovalFilters = {
  type?: ApprovalType;
  branchId?: string;
  branchName?: string;
};

function approvalTypeFromText(text: string): ApprovalType | '' {
  const lower = text.toLowerCase();
  if (/\bexpenses?\b/i.test(lower)) return 'EXPENSE';
  if (/\brefunds?\b/i.test(lower)) return 'REFUND';
  if (/\bstock\b|\binventory\b/i.test(lower)) return 'STOCK';
  if (/\bcash\b|\bpicks?\b/i.test(lower)) return 'CASH';
  if (/\blpos?\b|\bpos?\b|\bpurchase\b/i.test(lower)) return 'LPO';
  return '';
}

function uniqueApprovalBranches(items: ApprovalItem[]) {
  const byId = new Map<string, { id: string; name: string }>();
  for (const item of items) {
    if (!item.branchId) continue;
    byId.set(item.branchId, { id: item.branchId, name: item.branchName || 'Branch' });
  }
  return Array.from(byId.values());
}

function branchFilterFromText(items: ApprovalItem[], text: string) {
  const branches = uniqueApprovalBranches(items);
  if (!branches.length) return null;
  const normalizedText = norm(text);
  const direct = branches.find(branch => {
    const branchName = norm(branch.name);
    return branchName && normalizedText.includes(branchName);
  });
  if (direct) return direct;

  const phrase = text.match(/\b(?:from|for|at|in)\s+([a-z0-9\s&.'-]{2,80}?)(?:\s+(?:only|branch|approvals?|expenses?|refunds?|stock|cash|lpos?|pos?|purchase)|$)/i)?.[1];
  if (!phrase) return null;
  return bestMatch(phrase, branches, ['name']);
}

function approvalFiltersFromText(items: ApprovalItem[], text: string): ApprovalFilters {
  const type = approvalTypeFromText(text) || undefined;
  const branch = branchFilterFromText(items, text);
  return {
    type,
    branchId: branch?.id,
    branchName: branch?.name,
  };
}

function applyApprovalFilters(items: ApprovalItem[], filters?: ApprovalFilters) {
  return items.filter(item => {
    if (filters?.type && item.type !== filters.type) return false;
    if (filters?.branchId && item.branchId !== filters.branchId) return false;
    return true;
  });
}

function approvalFilterLabel(filters?: ApprovalFilters) {
  const parts: string[] = [];
  if (filters?.type) parts.push(filters.type.toLowerCase());
  parts.push('approvals');
  if (filters?.branchName) parts.push(`for ${filters.branchName}`);
  return parts.join(' ');
}

async function approvalsSummary(db: D1Database, businessId: string, filterSource?: string | ApprovalFilters) {
  const allItems = await loadPendingApprovals(db, businessId);
  if (allItems.length === 0) return 'No pending admin approvals right now.';
  const filters = typeof filterSource === 'string'
    ? approvalFiltersFromText(allItems, filterSource)
    : filterSource;
  const items = applyApprovalFilters(allItems, filters);
  if (items.length === 0) return `No pending ${approvalFilterLabel(filters)} right now.`;
  const title = filters?.type || filters?.branchId
    ? `*Pending ${approvalFilterLabel(filters)}*`
    : '*Pending approvals*';
  return [
    title,
    '',
    ...items.map(item => `${item.code}. [${item.type}] ${item.title}\n   ${item.details}`),
    '',
    'Reply with:',
    'approve A1 password 1234',
    'reject A1 password 1234',
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

async function updatePendingActionPayload(db: D1Database, id: string, payload: unknown) {
  await db.prepare('UPDATE whatsappPendingActions SET payload = ?, expiresAt = ? WHERE id = ? AND status = ?')
    .bind(JSON.stringify(payload), Date.now() + ACTION_TTL_MS, id, 'PENDING')
    .run();
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

async function parseLpoIntent(db: D1Database, env: Env, businessId: string, text: string, context = '') {
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
    context ? `Recent WhatsApp context:\n${context}` : '',
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
  const context = await loadConversationContext(db, message.from, link.businessId);
  const intent = await parseLpoIntent(db, env, link.businessId, message.text, context);
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
    const branchProducts = intent.products.filter((row: any) => !row.branchId || row.branchId === branch.id);
    const product = bestMatch(productText, branchProducts.length ? branchProducts : intent.products, ['name', 'category']);
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

function supplierName(row: any) {
  return String(row?.company || row?.name || 'Supplier');
}

function addGroupedValue(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key) || [];
  list.push(value);
  map.set(key, list);
}

function skippedLowStockSummary(skipped: Map<string, string[]>) {
  const lines: string[] = [];
  for (const [branch, names] of Array.from(skipped.entries()).slice(0, 5)) {
    lines.push(`${branch}: ${names.slice(0, 5).join(', ')}${names.length > 5 ? `, +${names.length - 5} more` : ''}`);
  }
  return lines;
}

async function draftLowStockLpos(db: D1Database, link: any, message: IncomingMessage) {
  const [suppliers, branches] = await Promise.all([
    db.prepare(`
      SELECT id, name, company, branchId
      FROM suppliers
      WHERE businessId = ?
      ORDER BY name ASC
      LIMIT 120
    `).bind(link.businessId).all<any>(),
    db.prepare(`
      SELECT id, name, location
      FROM branches
      WHERE businessId = ? AND COALESCE(isActive, 1) != 0
      ORDER BY name ASC
      LIMIT 40
    `).bind(link.businessId).all<any>(),
  ]);

  const supplierRows = suppliers.results || [];
  const branchRows = branches.results || [];
  const selectedSupplier = bestMatch(message.text, supplierRows, ['name', 'company']);
  const linkedBranch = link.branchId ? branchRows.find((row: any) => row.id === link.branchId) : null;
  const selectedBranch = linkedBranch || bestMatch(message.text, branchRows, ['name', 'location']);
  const supplierBranch = selectedSupplier?.branchId
    ? branchRows.find((row: any) => row.id === selectedSupplier.branchId)
    : null;
  if (selectedSupplier && selectedBranch && selectedSupplier.branchId && selectedSupplier.branchId !== selectedBranch.id) {
    const branchSuppliers = supplierRows
      .filter((supplier: any) => supplier.branchId === selectedBranch.id)
      .map(supplierName)
      .slice(0, 8);
    return [
      '\u26A0\uFE0F I did not create the LPO.',
      `${supplierName(selectedSupplier)} is assigned to ${supplierBranch?.name || 'another branch'}, not ${selectedBranch.name}.`,
      '',
      branchSuppliers.length
        ? `${selectedBranch.name} suppliers: ${branchSuppliers.join(', ')}.`
        : `${selectedBranch.name} does not have suppliers assigned yet.`,
      '',
      `Reply with a ${selectedBranch.name} supplier, or move ${supplierName(selectedSupplier)} to that branch in POS.`,
    ].join('\n');
  }

  const inferredBranch = selectedBranch || supplierBranch || null;
  const branchId = inferredBranch?.id || link.branchId || null;
  const products = await db.prepare(`
    SELECT p.id, p.name, p.category, p.costPrice, p.sellingPrice, p.stockQuantity, p.reorderPoint,
           p.supplierIds, p.branchId, p.unit, b.name AS branchName
    FROM products p
    LEFT JOIN branches b ON b.id = p.branchId AND b.businessId = p.businessId
    WHERE p.businessId = ?
      AND (? IS NULL OR p.branchId = ?)
      AND COALESCE(p.reorderPoint, 0) > 0
      AND COALESCE(p.stockQuantity, 0) <= COALESCE(p.reorderPoint, 0)
    ORDER BY p.stockQuantity ASC, p.name ASC
    LIMIT 40
  `).bind(link.businessId, branchId, branchId).all<any>();

  const lowStock = products.results || [];
  if (!lowStock.length) return 'No low-stock products need an LPO right now.';

  const suppliersById = new Map<string, any>();
  for (const supplier of supplierRows) suppliersById.set(String(supplier.id), supplier);

  const groups = new Map<string, any>();
  const skipped = new Map<string, string[]>();
  for (const product of lowStock) {
    const productBranchId = String(product.branchId || branchId || '');
    const productBranchName = String(product.branchName || 'Branch');
    const linked = supplierIds(product.supplierIds)
      .map(id => suppliersById.get(id))
      .filter((supplier: any) => supplier && (!supplier.branchId || !productBranchId || supplier.branchId === productBranchId));

    const sameBranchSuppliers = supplierRows.filter((supplier: any) => !supplier.branchId || !productBranchId || supplier.branchId === productBranchId);
    const linkedSupplierIds = supplierIds(product.supplierIds);
    if (selectedSupplier && linkedSupplierIds.length > 0 && !linkedSupplierIds.includes(selectedSupplier.id)) {
      addGroupedValue(skipped, productBranchName, `${product.name} (linked to another supplier)`);
      continue;
    }
    const supplier = selectedSupplier || linked[0] || (sameBranchSuppliers.length === 1 ? sameBranchSuppliers[0] : null);
    if (!supplier || (supplier.branchId && productBranchId && supplier.branchId !== productBranchId)) {
      addGroupedValue(skipped, productBranchName, product.name);
      continue;
    }

    const resolvedBranchId = productBranchId || supplier.branchId;
    if (!resolvedBranchId) {
      addGroupedValue(skipped, productBranchName, product.name);
      continue;
    }

    const reorderPoint = Math.ceil(asNumber(product.reorderPoint));
    const stock = asNumber(product.stockQuantity);
    const quantity = Math.max(1, Math.ceil(reorderPoint - stock));
    const unitCost = roundMoney(asNumber(product.costPrice) > 0 ? asNumber(product.costPrice) : asNumber(product.sellingPrice));
    const key = `${resolvedBranchId}:${supplier.id}`;
    const group = groups.get(key) || {
      supplierId: supplier.id,
      supplierName: supplierName(supplier),
      branchId: resolvedBranchId,
      branchName: productBranchName,
      items: [],
    };
    group.items.push({
      productId: product.id,
      name: product.name,
      expectedQuantity: quantity,
      receivedQuantity: 0,
      unitCost,
      unit: product.unit || '',
    });
    groups.set(key, group);
  }

  if (groups.size === 0) {
    const skippedLines = skippedLowStockSummary(skipped);
    return [
      '\u26A0\uFE0F I found low-stock items, but I could not safely draft an LPO because the products do not have a clear supplier.',
      '',
      ...skippedLines.map(line => `- ${line}`),
      '',
      'Link suppliers to those products in POS, or tell me the supplier and branch in one message.',
    ].join('\n');
  }

  const replies = ['\u2705 *Low-stock LPO drafts*', ''];
  for (const draft of Array.from(groups.values()).slice(0, 5)) {
    draft.totalAmount = roundMoney(draft.items.reduce((sum: number, item: any) => sum + item.expectedQuantity * item.unitCost, 0));
    const code = await savePendingAction(db, {
      phone: message.from,
      businessId: link.businessId,
      branchId: draft.branchId,
      actionType: 'CREATE_LPO',
      payload: draft,
    });
    replies.push(
      `${code}: ${draft.supplierName} | ${draft.branchName} | ${draft.items.length} item${draft.items.length === 1 ? '' : 's'} | ${money(draft.totalAmount)}`,
      ...draft.items.slice(0, 4).map((item: any) => `- ${item.name}: ${item.expectedQuantity}${item.unit ? ` ${item.unit}` : ''}`),
      `Create it: confirm PO ${code} password YOUR_ADMIN_PASSWORD`,
      '',
    );
  }

  if (groups.size > 5) replies.push(`I prepared the first 5 drafts. ${groups.size - 5} more supplier groups are still waiting.`);
  const skippedLines = skippedLowStockSummary(skipped);
  if (skippedLines.length) {
    replies.push('Needs supplier choice:', ...skippedLines.map(line => `- ${line}`));
  }
  return replies.join('\n').trim();
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

function recalcDraftTotal(draft: any) {
  draft.totalAmount = roundMoney(asArray(draft.items).reduce((sum, item) => {
    return sum + asNumber(item.expectedQuantity) * asNumber(item.unitCost);
  }, 0));
  return draft;
}

function lpoDraftSummary(draft: any, code: string, title = '*LPO draft ready*') {
  recalcDraftTotal(draft);
  return [
    title,
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

async function draftLpoFromWhatsApp(db: D1Database, env: Env, link: any, message: IncomingMessage) {
  const draft = await resolveLpoDraft(db, env, link, message);
  const code = await savePendingAction(db, {
    phone: message.from,
    businessId: link.businessId,
    branchId: draft.branchId,
    actionType: 'CREATE_LPO',
    payload: draft,
  });
  return lpoDraftSummary(draft, code);
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

function extractQuantityUpdate(text: string) {
  const direct = text.match(/\b(?:make|set|change|update|edit|increase|reduce)\b[\s\S]{0,80}?\b(?:to\s*)?(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|units?|pkt|packets?|ctn|cartons?)?\b/i)
    || text.match(/\b(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|units?|pkt|packets?|ctn|cartons?)\b/i);
  const quantity = direct ? asNumber(direct[1]) : 0;
  return quantity > 0 ? quantity : 0;
}

function cleanedLpoItemQuery(text: string) {
  return norm(text
    .replace(/\b(?:make|set|change|update|edit|increase|reduce|the|it|this|that|item|line|quantity|qty|to|pcs?|pieces?|units?|pkt|packets?|ctn|cartons?)\b/gi, ' ')
    .replace(/\d+(?:\.\d+)?/g, ' '));
}

async function updateLatestLpoDraftFromText(db: D1Database, link: any, phone: string, text: string) {
  const quantity = extractQuantityUpdate(text);
  if (!quantity) return null;
  const pending = await latestPendingAction(db, phone, link.businessId, 'CREATE_LPO');
  if (!pending) return null;
  const draft = pending.payload || {};
  const items = asArray(draft.items);
  if (!items.length) return null;

  const query = cleanedLpoItemQuery(text);
  let index = -1;
  if (!query || /\b(it|this|that|item|line)\b/i.test(text)) {
    if (items.length === 1) index = 0;
  }
  if (index < 0) {
    const match = bestMatch(query || text, items, ['name']);
    index = match ? items.findIndex((item: any) => item.productId === match.productId || item.name === match.name) : -1;
  }
  if (index < 0) {
    return [
      'Which LPO item should I change?',
      '',
      ...items.map((item: any, i: number) => `${i + 1}. ${item.name}: ${item.expectedQuantity}${item.unit ? ` ${item.unit}` : ''}`),
      '',
      'Example: make milk 20pc',
    ].join('\n');
  }

  items[index] = {
    ...items[index],
    expectedQuantity: quantity,
  };
  draft.items = items;
  recalcDraftTotal(draft);
  await updatePendingActionPayload(db, pending.id, draft);
  return lpoDraftSummary(draft, pending.id, '*LPO draft updated*');
}

async function latestLpoStatus(db: D1Database, link: any, phone: string) {
  const pending = await latestPendingAction(db, phone, link.businessId, 'CREATE_LPO');
  if (pending) {
    return `Not yet. I have an LPO draft waiting for admin confirmation. Reply: confirm PO ${pending.id} password YOUR_ADMIN_PASSWORD`;
  }
  try {
    const recent = await db.prepare(`
      SELECT po.poNumber, po.totalAmount, po.approvalStatus, po.orderDate, s.name AS supplierName, s.company
      FROM auditLogs al
      JOIN purchaseOrders po ON po.id = al.entityId AND po.businessId = al.businessId
      LEFT JOIN suppliers s ON s.id = po.supplierId AND s.businessId = po.businessId
      WHERE al.businessId = ?
        AND al.action = 'purchase.create.whatsapp'
      ORDER BY al.ts DESC
      LIMIT 1
    `).bind(link.businessId).first<any>();
    if (recent) {
      return `Latest WhatsApp LPO: ${recent.poNumber || 'PO'} for ${money(recent.totalAmount)} from ${recent.company || recent.supplierName || 'supplier'}. Approval: ${recent.approvalStatus || 'PENDING'}.`;
    }
  } catch {}
  return 'Not yet. I only create an LPO after you confirm the draft with your admin PIN/password.';
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
  const explicit = text.match(/\b(?:pin|password|code)\s*(?:is|:|=)?\s*([A-Za-z0-9@#$%^&*!._-]{3,80})\b/i);
  if (explicit) return explicit[1].trim();
  const trailing = text.trim().match(/\b([A-Za-z0-9@#$%^&*!._-]{3,80})\s*$/);
  return trailing ? trailing[1].trim() : '';
}

function isStandaloneAdminSecret(text: string) {
  const value = text.trim();
  return /^(?=.*\d)[A-Za-z0-9@#$%^&*!._-]{3,80}$/.test(value);
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

  const filters = approvalFiltersFromText(items, text);
  const filtered = applyApprovalFilters(items, filters);
  if (filtered.length === 1) return { item: filtered[0], items: filtered };
  return { item: null, items: filtered.length ? filtered : items };
}

async function savePendingApprovalAction(
  db: D1Database,
  phone: string,
  item: ApprovalItem,
  action: 'APPROVE' | 'REJECT',
) {
  return savePendingAction(db, {
    phone,
    businessId: item.businessId,
    branchId: item.branchId,
    actionType: 'APPROVAL_ACTION',
    payload: {
      action,
      approvalId: item.id,
      approvalType: item.type,
      code: item.code,
      title: item.title,
    },
  });
}

async function confirmLatestApprovalAction(db: D1Database, link: any, phone: string, pin: string) {
  const pending = await latestPendingAction(db, phone, link.businessId, 'APPROVAL_ACTION');
  if (!pending) return null;
  const payload = pending.payload || {};
  const items = await loadPendingApprovals(db, link.businessId);
  const item = items.find(row => row.id === payload.approvalId && row.type === payload.approvalType);
  if (!item) throw new PolicyError('That approval is no longer pending. Send approvals to see the current list.', 409);
  const principal = await verifyAdminPin(db, link.businessId, phone, pin, item.branchId);
  const result = await applyApprovalAction(db, item, principal, payload.action === 'REJECT' ? 'REJECT' : 'APPROVE', phone);
  await db.prepare("UPDATE whatsappPendingActions SET status = 'COMPLETED', completedAt = ? WHERE id = ?")
    .bind(Date.now(), pending.id)
    .run();
  return result;
}

async function handleNaturalAction(db: D1Database, env: Env, link: any, message: IncomingMessage): Promise<string | null> {
  const body = message.text.trim();
  const lower = body.toLowerCase();
  const wantsApprove = /\b(approve|accept|authorize|allow|okay|ok|confirm)\b/i.test(body);
  const wantsReject = /\b(reject|decline|deny|cancel)\b/i.test(body);
  const mentionsApproval = /\b(approval|approvals|pending|request|requests)\b/i.test(body);
  const mentionsOrder = /\b(lpo|po|purchase order|purchase orders|orders?)\b/i.test(body);
  const mentionsSupplier = /\bsuppliers?\b/i.test(body);
  const wantsCreate = /\b(create|draft|make|raise|prepare|generate|order|buy|restock)\b/i.test(body);
  const wantsAudit = /\b(audit|review|check|inspect|risk|risks)\b/i.test(body);
  const wantsList = /\b(show|list|what|which|give|view|see|any|all|want|need)\b/i.test(body);

  if (isStandaloneAdminSecret(body)) {
    const approvalResult = await confirmLatestApprovalAction(db, link, message.from, body);
    if (approvalResult) return approvalResult;
    const pendingLpo = await latestPendingAction(db, message.from, link.businessId, 'CREATE_LPO');
    if (pendingLpo) return confirmLatestLpo(db, link, message.from, body);
    const userResult = await confirmLatestUserDraft(db, link, message.from, body);
    if (userResult) return userResult;
  }

  const looksLikeDraftQuantityEdit = /\d/.test(body)
    && !/\b(confirm|approve|reject|password|pin|passcode)\b/i.test(body)
    && (
      /\b(make|set|change|update|edit|increase|reduce|quantity|qty)\b/i.test(body)
      || /\b\d+(?:\.\d+)?\s*(?:pcs?|pieces?|units?|pkt|packets?|ctn|cartons?)\b/i.test(body)
    );
  if (looksLikeDraftQuantityEdit) {
    const updatedDraft = await updateLatestLpoDraftFromText(db, link, message.from, body);
    if (updatedDraft) return updatedDraft;
  }

  const confirmsDraft = /\byes\b/i.test(body) || /\bdraft\b/i.test(body) || /\bconfirm\s+(?:po|lpo)\b/i.test(body);
  if (confirmsDraft && /\b(lpo|po|draft)\b/i.test(body)) {
    const pin = extractPin(body);
    if (!pin) return 'Send your admin PIN/password to confirm the LPO draft. You can reply with just the PIN/password.';
    const code = normaliseCode(body.match(/\b(?:po|lpo|code)\s+([a-z0-9]{4,10})\b/i)?.[1] || '');
    if (code) {
      try { return await confirmLpo(db, link, message.from, code, pin); } catch {}
    }
    return confirmLatestLpo(db, link, message.from, pin);
  }

  if (/\bconfirm\s+(?:user|staff|employee)\b/i.test(body)) {
    const pin = extractPin(body);
    if (!pin) return 'Send your admin PIN/password to create the drafted user.';
    const code = normaliseCode(body.match(/\b(?:user|staff|employee|code)\s+([a-z0-9]{4,10})\b/i)?.[1] || '');
    if (code) return confirmUserDraft(db, link, message.from, code, pin);
    const userResult = await confirmLatestUserDraft(db, link, message.from, pin);
    if (userResult) return userResult;
  }

  if ((wantsApprove || wantsReject) && (mentionsApproval || ordinalCode(body) || /\b(expense|refund|stock|cash|lpo|po|purchase)\b/i.test(body))) {
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
    const pin = extractPin(body);
    if (!pin) {
      await savePendingApprovalAction(db, message.from, item, wantsReject ? 'REJECT' : 'APPROVE');
      return `Send your admin PIN/password to ${wantsReject ? 'reject' : 'approve'} ${item.code}: ${item.title}. You can reply with just the PIN/password.`;
    }
    const principal = await verifyAdminPin(db, link.businessId, message.from, pin, item.branchId);
    return applyApprovalAction(db, item, principal, wantsReject ? 'REJECT' : 'APPROVE', message.from);
  }

  const wantsApprovalList = mentionsApproval && (wantsList || /\b(from|for|at|in|only|branch|expenses?|refunds?|stock|cash|lpos?|pos?|purchase)\b/i.test(body));
  if (wantsApprovalList || /^approvals?$/i.test(body) || lower.includes('pending approvals')) {
    return approvalsSummary(db, link.businessId, body);
  }

  if (mentionsSupplier && wantsList && !mentionsOrder) {
    return suppliersSummary(db, link.businessId);
  }

  if (mentionsOrder && wantsAudit) {
    return auditOrders(db, env, link.businessId);
  }

  if (mentionsOrder && /\b(did|have|has|was)\b.*\b(create|created|make|made|raise|raised)\b/i.test(body)) {
    return latestLpoStatus(db, link, message.from);
  }

  if (mentionsOrder && wantsCreate) {
    if (/\b(stock|restock|reorder|almost out|out of stock|low stock)\b/i.test(body)) {
      return draftLowStockLpos(db, link, message);
    }
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
    const context = await loadConversationContext(db, message.from, link.businessId);
    const remaining = Math.max(0, settings.dailyLimit - usage.count);
    const allowanceBlock = wantsAiUsageQuestion(question)
      ? [
        'Current AI allowance:',
        `- Used before this request: ${usage.count}`,
        `- Limit today: ${settings.dailyLimit}`,
        `- Remaining before this request: ${remaining}`,
        '',
      ].join('\n')
      : '';
    const prompt = `${buildPrompt(question, snapshot)}

${allowanceBlock}
Recent WhatsApp context:
${context || 'No recent context.'}

WhatsApp reply rules:
- Keep the answer short enough for a phone screen.
- No tables.
- Use the recent context to answer follow-up words like "that", "those", "today", or "it".
- If the user asks why something failed, explain the last relevant system reply instead of switching topics.
- Do not claim the AI limit is reached unless Current AI allowance shows remaining is 0.
- Ignore old conversation lines about a previous limit being reached; the admin may have raised the limit since then.
- Do not mention AI allowance, limit, usage, or remaining requests unless the user explicitly asks about AI usage or limits.
- Use plain lines or short bullets.
- A small amount of emoji is okay when it improves clarity.
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

  const promptIntent = analyzePromptFast(body);
  const fastIntentAnswer = await executeFastIntent(db, env, link, message, promptIntent);
  if (fastIntentAnswer) return fastIntentAnswer;

  if (lower === 'unlink' || lower === 'logout' || lower === 'remove') return unlinkBusiness(db, message.from);
  if (wantsCapabilityHelp(body) || lower === 'help' || lower === 'hi' || lower === 'hello' || lower === 'start') return helpText(true);

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
  if (lower === 'suppliers' || lower === 'supplier') {
    return suppliersSummary(db, link.businessId);
  }
  if (lower === 'stock' || lower === 'inventory') {
    return stockSummary(db, link.businessId);
  }
  if (lower === 'status') {
    return `Linked to ${link.businessName}. Ask any POS question, or send summary, branches, stock, help, or unlink.`;
  }

  const toolAnswer = await businessToolAnswer(db, link, message);
  if (toolAnswer) return toolAnswer;

  const agentToolAnswer = await agenticToolAnswer(db, env, link, message);
  if (agentToolAnswer) return agentToolAnswer;

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
      await rememberConversationTurn(env.DB, {
        phone: message.from,
        businessId: link?.businessId,
        userText: message.text,
        assistantText: reply,
      });
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
