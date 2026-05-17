import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
  AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 20;
const MAX_DAILY_LIMIT = 200;
const MODEL_FALLBACK = '@cf/meta/llama-3.1-8b-instruct';

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID, X-User-ID, X-User-Name',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      ...corsHeaders,
    },
  });
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('{') && !value.startsWith('[')) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normaliseRows<T extends Record<string, unknown>>(rows: T[] = []): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) out[key] = parseMaybeJson(value);
    return out as T;
  });
}

async function all<T extends Record<string, unknown>>(db: D1Database, sql: string, ...bindings: unknown[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...bindings).all();
  return normaliseRows((result.results || []) as T[]);
}

async function first<T extends Record<string, unknown>>(db: D1Database, sql: string, ...bindings: unknown[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...bindings).first();
  return row ? normaliseRows([row as T])[0] : null;
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ksh(value: unknown) {
  return `Ksh ${Math.round(asNumber(value)).toLocaleString('en-US')}`;
}

function nairobiDay(now = Date.now()) {
  return new Date(now + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function daysSince(timestamp: unknown, now = Date.now()) {
  const ts = asNumber(timestamp, 0);
  if (!ts) return null;
  return Math.max(0, Math.floor((now - ts) / DAY_MS));
}

function truncateText(text: unknown, max = 900) {
  return String(text || '').trim().slice(0, max);
}

async function ensureAiSchema(db: D1Database) {
  const migrations = [
    'ALTER TABLE settings ADD COLUMN aiAssistantEnabled INTEGER DEFAULT 1',
    'ALTER TABLE settings ADD COLUMN aiDailyRequestLimit INTEGER DEFAULT 20',
    `CREATE TABLE IF NOT EXISTS aiUsage (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      userId TEXT NOT NULL,
      userName TEXT,
      branchId TEXT,
      day TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      updated_at INTEGER
    )`,
    'CREATE INDEX IF NOT EXISTS idx_aiUsage_scope ON aiUsage(businessId, userId, day)',
  ];

  for (const sql of migrations) {
    try {
      await db.prepare(sql).run();
    } catch {
      // ALTER TABLE fails when the column already exists; that is expected.
    }
  }
}

async function getAiSettings(db: D1Database, businessId: string) {
  const settings = await first<any>(
    db,
    `SELECT aiAssistantEnabled, aiDailyRequestLimit
     FROM settings
     WHERE businessId = ?
     ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
     LIMIT 1`,
    businessId,
    `core_${businessId}`,
  );
  const enabled = asNumber(settings?.aiAssistantEnabled, 1) !== 0;
  const rawLimit = asNumber(settings?.aiDailyRequestLimit, DEFAULT_DAILY_LIMIT);
  const dailyLimit = Math.min(MAX_DAILY_LIMIT, Math.max(1, Math.floor(rawLimit || DEFAULT_DAILY_LIMIT)));
  return { enabled, dailyLimit };
}

async function getUsage(db: D1Database, businessId: string, userId: string, userName: string, branchId: string | null) {
  const day = nairobiDay();
  const id = `${businessId}|BUSINESS|${day}`;
  const row = await first<any>(db, 'SELECT count FROM aiUsage WHERE id = ?', id);
  return {
    id,
    day,
    count: asNumber(row?.count, 0),
    async increment() {
      const next = asNumber(row?.count, 0) + 1;
      await db.prepare(
        `INSERT OR REPLACE INTO aiUsage (id, businessId, userId, userName, branchId, day, count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, businessId, 'BUSINESS', `Last used by ${userName || userId}`, branchId, day, next, Date.now()).run();
      return next;
    },
  };
}

function productName(productsById: Map<string, any>, productId: string) {
  return productsById.get(productId)?.name || productId;
}

async function buildBusinessSnapshot(db: D1Database, businessId: string, branchId: string | null) {
  const now = Date.now();
  const since7 = now - 7 * DAY_MS;
  const since30 = now - 30 * DAY_MS;
  const since60 = now - 60 * DAY_MS;
  const since90 = now - 90 * DAY_MS;

  const [
    business,
    activeBranch,
    branches,
    products,
    stockRows,
    sales30,
    branchSales,
    expenseRows,
    customersOwing,
    suppliersOwing,
    purchaseOrderRows,
    pendingExpenses,
    pendingAdjustments,
    pendingPOs,
    pendingCashPicks,
    pendingRefunds,
    recentTransactions,
  ] = await Promise.all([
    first<any>(db, 'SELECT id, name, code FROM businesses WHERE id = ?', businessId),
    branchId ? first<any>(db, 'SELECT id, name, location FROM branches WHERE businessId = ? AND id = ?', businessId, branchId) : Promise.resolve(null),
    all<any>(db, 'SELECT id, name, location FROM branches WHERE businessId = ? ORDER BY name', businessId),
    all<any>(
      db,
      `SELECT id, name, category, sellingPrice, costPrice, stockQuantity, reorderPoint, taxCategory, isBundle
       FROM products WHERE businessId = ? ORDER BY name`,
      businessId,
    ),
    all<any>(
      db,
      `SELECT productId,
              MAX(timestamp) AS lastOut,
              SUM(CASE WHEN timestamp >= ? THEN quantity ELSE 0 END) AS sold30,
              SUM(CASE WHEN timestamp >= ? THEN quantity ELSE 0 END) AS sold60
       FROM stockMovements
       WHERE businessId = ? AND type = 'OUT'
       GROUP BY productId`,
      since30,
      since60,
      businessId,
    ),
    all<any>(
      db,
      `SELECT
          COUNT(*) AS count,
          SUM(total) AS totalSales,
          SUM(CASE WHEN timestamp >= ? THEN total ELSE 0 END) AS sales7,
          SUM(CASE WHEN paymentMethod = 'CASH' THEN total ELSE 0 END) AS cashSales,
          SUM(CASE WHEN paymentMethod = 'MPESA' THEN total ELSE 0 END) AS mpesaSales,
          SUM(CASE WHEN paymentMethod = 'CREDIT' OR status = 'UNPAID' THEN total ELSE 0 END) AS creditSales,
          SUM(tax) AS taxTotal
       FROM transactions
       WHERE businessId = ? AND timestamp >= ?`,
      since7,
      businessId,
      since30,
    ),
    all<any>(
      db,
      `SELECT b.name AS branchName, b.id AS branchId, COUNT(t.id) AS count, COALESCE(SUM(t.total), 0) AS sales
       FROM branches b
       LEFT JOIN transactions t ON t.businessId = b.businessId AND t.branchId = b.id AND t.timestamp >= ?
       WHERE b.businessId = ?
       GROUP BY b.id, b.name
       ORDER BY sales DESC`,
      since30,
      businessId,
    ),
    all<any>(
      db,
      `SELECT category, COUNT(*) AS count, SUM(amount) AS amount
       FROM expenses
       WHERE businessId = ? AND timestamp >= ? AND status != 'REJECTED'
       GROUP BY category
       ORDER BY amount DESC
       LIMIT 12`,
      businessId,
      since30,
    ),
    all<any>(
      db,
      `SELECT name, phone, balance, totalSpent
       FROM customers
       WHERE businessId = ? AND balance > 0
       ORDER BY balance DESC
       LIMIT 12`,
      businessId,
    ),
    all<any>(
      db,
      `SELECT name, company, balance
       FROM suppliers
       WHERE businessId = ? AND balance > 0
       ORDER BY balance DESC
       LIMIT 12`,
      businessId,
    ),
    all<any>(
      db,
      `SELECT id, poNumber, supplierId, totalAmount, paidAmount, paymentStatus, status, approvalStatus, orderDate
       FROM purchaseOrders
       WHERE businessId = ? AND status = 'RECEIVED' AND COALESCE(paymentStatus, 'UNPAID') != 'PAID'
       ORDER BY orderDate DESC
       LIMIT 12`,
      businessId,
    ),
    first<any>(db, "SELECT COUNT(*) AS count FROM expenses WHERE businessId = ? AND status = 'PENDING'", businessId),
    first<any>(db, "SELECT COUNT(*) AS count FROM stockAdjustmentRequests WHERE businessId = ? AND status = 'PENDING'", businessId),
    first<any>(db, "SELECT COUNT(*) AS count FROM purchaseOrders WHERE businessId = ? AND approvalStatus = 'PENDING'", businessId),
    first<any>(db, "SELECT COUNT(*) AS count FROM cashPicks WHERE businessId = ? AND status = 'PENDING'", businessId),
    first<any>(db, "SELECT COUNT(*) AS count FROM transactions WHERE businessId = ? AND status = 'PENDING_REFUND'", businessId),
    all<any>(
      db,
      `SELECT id, total, timestamp, status, paymentMethod, customerName, cashierName, branchId
       FROM transactions
       WHERE businessId = ? AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 20`,
      businessId,
      since90,
    ),
  ]);

  const productsById = new Map(products.map((product) => [product.id, product]));
  const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));
  const inventoryRows = products.map((product) => {
    const stock = asNumber(product.stockQuantity);
    const cost = asNumber(product.costPrice);
    const metrics = stockByProduct.get(product.id) || {};
    const sold30 = asNumber(metrics.sold30);
    const sold60 = asNumber(metrics.sold60);
    const lastOut = asNumber(metrics.lastOut);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      stock,
      reorderPoint: asNumber(product.reorderPoint),
      costPrice: cost,
      sellingPrice: asNumber(product.sellingPrice),
      stockValue: Math.round(stock * cost),
      sold30,
      sold60,
      lastSold: lastOut ? new Date(lastOut).toISOString().slice(0, 10) : null,
      daysSinceSale: daysSince(lastOut, now),
    };
  });

  const deadStock = inventoryRows
    .filter((item) => item.stock > 0 && item.category !== 'Services' && (item.sold60 <= 0 || !item.lastSold))
    .sort((a, b) => b.stockValue - a.stockValue)
    .slice(0, 8);

  const lowStock = inventoryRows
    .filter((item) => item.reorderPoint > 0 && item.stock <= item.reorderPoint)
    .sort((a, b) => (a.stock / Math.max(1, a.reorderPoint)) - (b.stock / Math.max(1, b.reorderPoint)))
    .slice(0, 15);

  const topSellers = inventoryRows
    .filter((item) => item.sold30 > 0)
    .sort((a, b) => b.sold30 - a.sold30)
    .slice(0, 15);

  const branchNameById = new Map(branches.map((branch) => [branch.id, branch.name]));
  const formatInventoryItem = (item: any) => ({
    name: item.name,
    category: item.category,
    stockOnHand: item.stock,
    reorderPoint: item.reorderPoint,
    stockValue: ksh(item.stockValue),
    sellingPrice: ksh(item.sellingPrice),
    soldLast30Days: item.sold30,
    soldLast60Days: item.sold60,
    lastSold: item.lastSold || 'No recorded sale or stock-out in POS',
    daysSinceSale: item.daysSinceSale ?? 'No recorded sale history',
    signal: item.sold60 <= 0 ? 'No stock-out movement in the last 60 days' : 'Slow movement',
  });

  return {
    generatedAt: new Date(now).toISOString(),
    period: {
      salesWindow: 'last 30 days',
      deadStockWindow: 'no stock movement OUT in the last 60 days',
      lowStockRule: 'stockQuantity <= reorderPoint',
    },
    business: {
      id: businessId,
      name: business?.name || 'Business',
      code: business?.code,
      activeBranch: activeBranch ? { id: activeBranch.id, name: activeBranch.name, location: activeBranch.location } : null,
      branchCount: branches.length,
      branches: branches.map((branch) => ({ id: branch.id, name: branch.name, location: branch.location })),
    },
    sales: {
      last30Days: {
        count: asNumber(sales30[0]?.count),
        totalSales: ksh(sales30[0]?.totalSales),
        last7DaysSales: ksh(sales30[0]?.sales7),
        cashSales: ksh(sales30[0]?.cashSales),
        mpesaSales: ksh(sales30[0]?.mpesaSales),
        creditSales: ksh(sales30[0]?.creditSales),
        taxTotal: ksh(sales30[0]?.taxTotal),
      },
      byBranch: branchSales.map((row) => ({
        branch: row.branchName,
        sales: ksh(row.sales),
        transactions: asNumber(row.count),
      })),
      recent: recentTransactions.slice(0, 10).map((tx) => ({
        date: new Date(asNumber(tx.timestamp)).toISOString().slice(0, 10),
        branch: branchNameById.get(tx.branchId) || tx.branchId,
        total: ksh(tx.total),
        status: tx.status,
        paymentMethod: tx.paymentMethod,
        customer: tx.customerName,
      })),
    },
    inventory: {
      productCount: products.length,
      totalStockValue: ksh(inventoryRows.reduce((sum, item) => sum + item.stockValue, 0)),
      deadStockValue: ksh(deadStock.reduce((sum, item) => sum + item.stockValue, 0)),
      deadStock: deadStock.map(formatInventoryItem),
      lowStock: lowStock.map(formatInventoryItem),
      topSellers: topSellers.map(formatInventoryItem),
    },
    receivables: {
      totalCustomersOwing: ksh(customersOwing.reduce((sum, row) => sum + asNumber(row.balance), 0)),
      customersOwing: customersOwing.map((row) => ({
        name: row.name,
        phone: row.phone,
        balance: ksh(row.balance),
        totalSpent: ksh(row.totalSpent),
      })),
    },
    payables: {
      totalSuppliersOwing: ksh(suppliersOwing.reduce((sum, row) => sum + asNumber(row.balance), 0)),
      suppliersOwing: suppliersOwing.map((row) => ({
        name: row.name,
        company: row.company,
        balance: ksh(row.balance),
      })),
      unpaidPurchaseOrders: purchaseOrderRows.map((row) => ({
        poNumber: row.poNumber || row.id,
        total: ksh(row.totalAmount),
        paid: ksh(row.paidAmount),
        due: ksh(asNumber(row.totalAmount) - asNumber(row.paidAmount)),
        paymentStatus: row.paymentStatus || 'UNPAID',
        status: row.status,
      })),
    },
    expenses: {
      last30DaysByCategory: expenseRows.map((row) => ({
        category: row.category,
        amount: ksh(row.amount),
        count: asNumber(row.count),
      })),
    },
    approvals: {
      pendingExpenses: asNumber(pendingExpenses?.count),
      pendingStockAdjustments: asNumber(pendingAdjustments?.count),
      pendingPurchaseOrders: asNumber(pendingPOs?.count),
      pendingCashPicks: asNumber(pendingCashPicks?.count),
      pendingRefunds: asNumber(pendingRefunds?.count),
    },
    lookupNotes: {
      productNameExample: productName(productsById, deadStock[0]?.id || topSellers[0]?.id || ''),
    },
  };
}

function buildPrompt(question: string, snapshot: unknown) {
  return [
    'You are the Mtaani POS AI analyst inside a Kenyan point-of-sale system.',
    'Answer only from the provided business data. Do not invent records, totals, or dates.',
    'Give practical advice the shop owner can act on. Be direct and concise. Use at most five bullets unless the user asks for a full list.',
    'Use Ksh for money. When warning about dead stock, name the product, stock on hand, stock value, and how long it has not moved when available.',
    'Do not mention JSON keys, null values, or implementation details. If sale history is missing, say "no recorded sales in POS".',
    'Do not recommend buying more of dead stock. Do not treat service items as physical stock buying advice.',
    'End with one clear action recommendation.',
    'If the question asks for something outside the provided data, say what data is missing and suggest a POS report to check.',
    '',
    `Business data JSON:\n${JSON.stringify(snapshot)}`,
    '',
    `User question: ${question}`,
    '',
    'Answer:',
  ].join('\n');
}

function maybeAnswerFromSnapshot(question: string, snapshot: any): string | null {
  const q = question.toLowerCase();
  const wantsDeadStock = (
    q.includes('dead stock') ||
    q.includes('not moved') ||
    q.includes('slow stock') ||
    q.includes('avoid buying') ||
    (q.includes('stock') && q.includes('dead'))
  );

  if (wantsDeadStock) {
    const items = (snapshot?.inventory?.deadStock || []).slice(0, 5);
    if (!items.length) {
      return 'I do not see any stocked physical products with no movement in the last 60 days. Keep buying based on the top sellers and reorder-point alerts.';
    }

    const lines = items.map((item: any, index: number) => (
      `${index + 1}. ${item.name}: ${item.stockOnHand} on hand, ${item.stockValue} tied up, ${item.signal.toLowerCase()}.`
    ));

    return [
      'Avoid buying more of these slow/dead stock items until they start moving:',
      ...lines,
      `Action: pause reorders for these items, discount or bundle them, and move buying money toward top sellers like ${(snapshot?.inventory?.topSellers || []).slice(0, 3).map((item: any) => item.name).join(', ') || 'your fastest-moving products'}.`,
    ].join('\n');
  }

  if (q.includes('customer') && (q.includes('owe') || q.includes('debt') || q.includes('balance') || q.includes('credit'))) {
    const customers = (snapshot?.receivables?.customersOwing || []).slice(0, 5);
    if (!customers.length) return 'No customer balances are currently outstanding in the provided POS data.';
    return [
      `Customer credit outstanding is ${snapshot.receivables.totalCustomersOwing}. Biggest balances:`,
      ...customers.map((customer: any, index: number) => `${index + 1}. ${customer.name}: ${customer.balance}${customer.phone ? ` (${customer.phone})` : ''}.`),
      'Action: collect or send M-Pesa prompts to the top balances first.',
    ].join('\n');
  }

  if (q.includes('supplier') && (q.includes('owe') || q.includes('debt') || q.includes('payable') || q.includes('balance'))) {
    const suppliers = (snapshot?.payables?.suppliersOwing || []).slice(0, 5);
    if (!suppliers.length) return 'No supplier balances are currently outstanding in the provided POS data.';
    return [
      `Supplier payables total ${snapshot.payables.totalSuppliersOwing}. Biggest balances:`,
      ...suppliers.map((supplier: any, index: number) => `${index + 1}. ${supplier.name}: ${supplier.balance}.`),
      'Action: clear the oldest/unpaid purchase orders first to keep supplier credit healthy.',
    ].join('\n');
  }

  if (q.includes('approval') || q.includes('pending')) {
    const approvals = snapshot?.approvals || {};
    return [
      'Pending work needing admin attention:',
      `- Expenses: ${approvals.pendingExpenses || 0}`,
      `- Stock adjustments: ${approvals.pendingStockAdjustments || 0}`,
      `- Purchase orders: ${approvals.pendingPurchaseOrders || 0}`,
      `- Cash picks: ${approvals.pendingCashPicks || 0}`,
      `- Refunds: ${approvals.pendingRefunds || 0}`,
      'Action: approve stock and cash items first because they affect drawer and inventory accuracy.',
    ].join('\n');
  }

  return null;
}

function extractAiText(result: any) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string') return result.response;
  if (typeof result.result?.response === 'string') return result.result.response;
  if (Array.isArray(result.choices) && result.choices[0]?.message?.content) return result.choices[0].message.content;
  return JSON.stringify(result);
}

async function runAi(env: Env, prompt: string) {
  const model = env.CLOUDFLARE_AI_MODEL || MODEL_FALLBACK;
  const input = {
    prompt,
    max_tokens: 450,
  };

  if (env.AI?.run) {
    return extractAiText(await env.AI.run(model, input));
  }

  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_AI_API_TOKEN) {
    throw new Error('AI is not configured. Add a Workers AI binding or set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_API_TOKEN.');
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  const payload: any = await res.json().catch(() => null);
  if (!res.ok || payload?.success === false) {
    const message = payload?.errors?.[0]?.message || payload?.error || `Cloudflare AI request failed (${res.status})`;
    throw new Error(message);
  }

  return extractAiText(payload);
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;

    const businessId = request.headers.get('X-Business-ID')?.trim();
    const branchId = request.headers.get('X-Branch-ID')?.trim() || null;
    const userId = truncateText(auth.principal.userId || 'anonymous', 120);
    const headerUserName = truncateText(auth.principal.userName || 'Unknown user', 120);
    if (!businessId) return json({ error: 'X-Business-ID header required' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || (branchId && !canAccessBranch(auth.principal, branchId))) return json({ error: 'Access denied' }, 403);
    if (auth.principal.role !== 'ADMIN' && auth.principal.role !== 'ROOT') return json({ error: 'AI assistant is only available to admin accounts.' }, 403);

    const body = await request.json().catch(() => null) as any;
    const question = truncateText(body?.question, 900);
    if (!question) return json({ error: 'Ask a question first.' }, 400);

    await ensureAiSchema(env.DB);
    const user = await first<any>(
      env.DB,
      'SELECT id, name, role FROM users WHERE businessId = ? AND id = ? LIMIT 1',
      businessId,
      userId,
    );
    if (!user || String(user.role || '').toUpperCase() !== 'ADMIN') {
      return json({ error: 'AI assistant is only available to admin accounts.' }, 403);
    }
    const userName = truncateText(user.name || headerUserName || 'Admin', 120);

    const settings = await getAiSettings(env.DB, businessId);
    if (!settings.enabled) return json({ error: 'AI assistant is disabled for this business.' }, 403);

    const usage = await getUsage(env.DB, businessId, userId, userName, branchId);
    if (usage.count >= settings.dailyLimit) {
      return json({
        error: `Daily business AI limit reached (${settings.dailyLimit}). Ask the Super Admin to raise the limit or try again tomorrow.`,
        usage: { used: usage.count, limit: settings.dailyLimit, remaining: 0, day: usage.day },
      }, 429);
    }

    const snapshot = await buildBusinessSnapshot(env.DB, businessId, branchId);
    const answer = maybeAnswerFromSnapshot(question, snapshot) || await runAi(env, buildPrompt(question, snapshot));
    const used = await usage.increment();

    return json({
      answer: answer.trim(),
      usage: {
        used,
        limit: settings.dailyLimit,
        remaining: Math.max(0, settings.dailyLimit - used),
        day: usage.day,
      },
    });
  } catch (err: any) {
    console.error('[AI Assistant]', err);
    return json({ error: err?.message || 'AI request failed.' }, 500);
  }
};
