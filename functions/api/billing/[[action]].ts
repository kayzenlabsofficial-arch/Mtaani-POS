interface Env {
  DB: D1Database;
  API_SECRET?: string;
  BILLING_MPESA_CONSUMER_KEY?: string;
  BILLING_MPESA_CONSUMER_SECRET?: string;
  BILLING_MPESA_SHORTCODE?: string;
  BILLING_MPESA_PASSKEY?: string;
  BILLING_MPESA_ENV?: string;
  BILLING_MPESA_CALLBACK_SECRET?: string;
}

type BillingAccount = {
  businessId: string;
  monthlyBaseFee: number;
  pricePerBranch: number;
  discountType: 'FIXED' | 'PERCENT';
  discountValue: number;
  dueDay: number;
  bannerEnabled: number;
  bannerMessage: string;
  allowPartial: number;
  minPaymentAmount: number;
  status: string;
  updated_at?: number;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolInt(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function dueDateMs(period: string, dueDay: number) {
  const [year, month] = period.split('-').map(Number);
  const d = new Date(year, (month || 1) - 1, clamp(Math.floor(dueDay || 1), 1, 28), 23, 59, 59, 999);
  return d.getTime();
}

function invoiceIdFor(businessId: string, period: string) {
  return `bill_${businessId}_${period}`;
}

function paymentStatus(resultCode: unknown) {
  const code = Number(resultCode);
  if (code === 0) return 'PAID';
  if (code === 999) return 'PENDING';
  return 'FAILED';
}

function formatPhone(phone: string): string {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = `254${cleaned.substring(1)}`;
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = `254${cleaned}`;
  return cleaned;
}

async function ensureBillingSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingAccounts (
      businessId TEXT PRIMARY KEY,
      monthlyBaseFee REAL DEFAULT 3000,
      pricePerBranch REAL DEFAULT 500,
      discountType TEXT DEFAULT 'FIXED',
      discountValue REAL DEFAULT 0,
      dueDay INTEGER DEFAULT 5,
      bannerEnabled INTEGER DEFAULT 0,
      bannerMessage TEXT,
      allowPartial INTEGER DEFAULT 1,
      minPaymentAmount REAL DEFAULT 500,
      status TEXT DEFAULT 'ACTIVE',
      updated_at INTEGER
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingInvoices (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      period TEXT NOT NULL,
      branchCount INTEGER DEFAULT 0,
      monthlyBaseFee REAL DEFAULT 0,
      pricePerBranch REAL DEFAULT 0,
      subtotal REAL DEFAULT 0,
      discountType TEXT DEFAULT 'FIXED',
      discountValue REAL DEFAULT 0,
      discountAmount REAL DEFAULT 0,
      totalDue REAL DEFAULT 0,
      amountPaid REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      dueDate INTEGER,
      status TEXT DEFAULT 'PENDING',
      notes TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS billingPayments (
      id TEXT PRIMARY KEY,
      invoiceId TEXT NOT NULL,
      businessId TEXT NOT NULL,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT DEFAULT 'PAID',
      receiptNumber TEXT,
      phoneNumber TEXT,
      checkoutRequestId TEXT,
      merchantRequestId TEXT,
      resultCode INTEGER,
      resultDesc TEXT,
      recordedBy TEXT,
      notes TEXT,
      timestamp INTEGER,
      updated_at INTEGER
    )
  `).run();

  for (const sql of [
    'CREATE INDEX IF NOT EXISTS idx_billingInvoices_business ON billingInvoices(businessId, period)',
    'CREATE INDEX IF NOT EXISTS idx_billingPayments_invoice ON billingPayments(invoiceId, status)',
    'CREATE INDEX IF NOT EXISTS idx_billingPayments_checkout ON billingPayments(checkoutRequestId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function first<T = any>(db: D1Database, sql: string, ...bindings: unknown[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...bindings).first();
  return row as T | null;
}

async function getAccount(db: D1Database, businessId: string): Promise<BillingAccount> {
  const row = await first<BillingAccount>(db, 'SELECT * FROM billingAccounts WHERE businessId = ?', businessId);
  if (row) return row;
  const account: BillingAccount = {
    businessId,
    monthlyBaseFee: 3000,
    pricePerBranch: 500,
    discountType: 'FIXED',
    discountValue: 0,
    dueDay: 5,
    bannerEnabled: 0,
    bannerMessage: 'Your Mtaani POS software subscription is due. Pay by M-Pesa to keep your account current.',
    allowPartial: 1,
    minPaymentAmount: 500,
    status: 'ACTIVE',
    updated_at: Date.now(),
  };
  await db.prepare(`
    INSERT OR REPLACE INTO billingAccounts
    (businessId, monthlyBaseFee, pricePerBranch, discountType, discountValue, dueDay, bannerEnabled, bannerMessage, allowPartial, minPaymentAmount, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    account.businessId,
    account.monthlyBaseFee,
    account.pricePerBranch,
    account.discountType,
    account.discountValue,
    account.dueDay,
    account.bannerEnabled,
    account.bannerMessage,
    account.allowPartial,
    account.minPaymentAmount,
    account.status,
    account.updated_at,
  ).run();
  return account;
}

async function branchCount(db: D1Database, businessId: string) {
  const row = await first<any>(db, 'SELECT COUNT(*) AS count FROM branches WHERE businessId = ? AND COALESCE(isActive, 1) != 0', businessId);
  return asNumber(row?.count, 0);
}

async function recomputeInvoice(db: D1Database, invoiceId: string) {
  const invoice = await first<any>(db, 'SELECT * FROM billingInvoices WHERE id = ?', invoiceId);
  if (!invoice) return null;
  const paidRow = await first<any>(db, "SELECT COALESCE(SUM(amount), 0) AS paid FROM billingPayments WHERE invoiceId = ? AND status = 'PAID'", invoiceId);
  const amountPaid = Math.max(0, asNumber(paidRow?.paid, 0));
  const totalDue = Math.max(0, asNumber(invoice.totalDue, 0));
  const balance = Math.max(0, totalDue - amountPaid);
  const status = balance <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'PENDING';
  await db.prepare('UPDATE billingInvoices SET amountPaid = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(amountPaid, balance, status, Date.now(), invoiceId)
    .run();
  return { ...invoice, amountPaid, balance, status };
}

async function ensureInvoice(db: D1Database, businessId: string, period = currentPeriod()) {
  const account = await getAccount(db, businessId);
  const branches = await branchCount(db, businessId);
  const monthlyBaseFee = Math.max(0, asNumber(account.monthlyBaseFee, 0));
  const pricePerBranch = Math.max(0, asNumber(account.pricePerBranch, 0));
  const subtotal = monthlyBaseFee + branches * pricePerBranch;
  const discountType = account.discountType === 'PERCENT' ? 'PERCENT' : 'FIXED';
  const rawDiscount = Math.max(0, asNumber(account.discountValue, 0));
  const discountAmount = discountType === 'PERCENT' ? subtotal * clamp(rawDiscount, 0, 100) / 100 : Math.min(subtotal, rawDiscount);
  const totalDue = Math.max(0, subtotal - discountAmount);
  const id = invoiceIdFor(businessId, period);
  const existing = await first<any>(db, 'SELECT amountPaid, created_at FROM billingInvoices WHERE id = ?', id);
  const amountPaid = Math.max(0, asNumber(existing?.amountPaid, 0));
  const balance = Math.max(0, totalDue - amountPaid);
  const status = balance <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'PENDING';
  const now = Date.now();

  await db.prepare(`
    INSERT OR REPLACE INTO billingInvoices
    (id, businessId, period, branchCount, monthlyBaseFee, pricePerBranch, subtotal, discountType, discountValue, discountAmount, totalDue, amountPaid, balance, dueDate, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    businessId,
    period,
    branches,
    monthlyBaseFee,
    pricePerBranch,
    subtotal,
    discountType,
    rawDiscount,
    discountAmount,
    totalDue,
    amountPaid,
    balance,
    dueDateMs(period, account.dueDay),
    status,
    existing?.created_at || now,
    now,
  ).run();

  return { id, businessId, period, branchCount: branches, monthlyBaseFee, pricePerBranch, subtotal, discountType, discountValue: rawDiscount, discountAmount, totalDue, amountPaid, balance, dueDate: dueDateMs(period, account.dueDay), status };
}

async function billingSummary(db: D1Database) {
  const { results } = await db.prepare('SELECT id, name, code, isActive FROM businesses ORDER BY name').all<any>();
  const rows = [];
  for (const business of results || []) {
    const account = await getAccount(db, business.id);
    const invoice = await ensureInvoice(db, business.id);
    rows.push({
      business,
      branchCount: invoice.branchCount,
      account,
      invoice,
    });
  }
  return rows;
}

function mpesaConfig(env: Env) {
  const consumerKey = env.BILLING_MPESA_CONSUMER_KEY;
  const consumerSecret = env.BILLING_MPESA_CONSUMER_SECRET;
  const shortcode = env.BILLING_MPESA_SHORTCODE;
  const passkey = env.BILLING_MPESA_PASSKEY;
  const callbackSecret = env.BILLING_MPESA_CALLBACK_SECRET;
  const isProd = env.BILLING_MPESA_ENV === 'production';
  if (!consumerKey || !consumerSecret || !shortcode || !passkey || !callbackSecret) return null;
  return {
    consumerKey,
    consumerSecret,
    shortcode,
    passkey,
    callbackSecret,
    baseUrl: isProd ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke',
    envName: isProd ? 'production' : 'sandbox',
  };
}

async function triggerBillingStk(request: Request, env: Env, body: any) {
  const businessId = String(body?.businessId || '').trim();
  const phone = formatPhone(String(body?.phone || ''));
  if (!businessId || !phone) return json({ error: 'Business and phone are required.' }, 400);
  const account = await getAccount(env.DB, businessId);
  const invoice = await ensureInvoice(env.DB, businessId, String(body?.period || currentPeriod()));
  const balance = Math.max(0, asNumber(invoice.balance, 0));
  if (balance <= 0) return json({ error: 'This bill is already fully paid.' }, 400);

  let amount = Math.ceil(asNumber(body?.amount, balance));
  if (!account.allowPartial) amount = Math.ceil(balance);
  if (amount <= 0) return json({ error: 'Enter a valid amount.' }, 400);
  if (amount > balance) amount = Math.ceil(balance);
  if (account.allowPartial && amount < Math.min(balance, Math.max(1, asNumber(account.minPaymentAmount, 1)))) {
    return json({ error: `Minimum partial payment is Ksh ${Math.round(asNumber(account.minPaymentAmount, 1)).toLocaleString()}.` }, 400);
  }

  const config = mpesaConfig(env);
  if (!config) return json({ error: 'Billing M-Pesa is not configured. Add BILLING_MPESA_* Pages secrets first.' }, 500);

  const authString = btoa(`${config.consumerKey}:${config.consumerSecret}`);
  const tokenRes = await fetch(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${authString}` },
  });
  if (!tokenRes.ok) throw new Error(`Failed to generate billing M-Pesa token: ${await tokenRes.text()}`);
  const { access_token } = await tokenRes.json() as any;

  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const password = btoa(`${config.shortcode}${config.passkey}${timestamp}`);
  const urlObj = new URL(request.url);
  const callbackUrl = `${urlObj.protocol}//${urlObj.host}/api/billing/callback/${config.callbackSecret}`;

  const stkRes = await fetch(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: config.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: config.shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: `MTAANI-${businessId.slice(0, 8).toUpperCase()}`,
      TransactionDesc: `Mtaani POS software bill ${invoice.period}`,
    }),
  });

  const stkData = await stkRes.json() as any;
  if (!stkRes.ok || stkData.errorCode) throw new Error(`Billing STK Push failed: ${JSON.stringify(stkData)}`);

  const paymentId = `billpay_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare(`
    INSERT INTO billingPayments
    (id, invoiceId, businessId, amount, method, status, phoneNumber, checkoutRequestId, merchantRequestId, resultCode, resultDesc, recordedBy, timestamp, updated_at)
    VALUES (?, ?, ?, ?, 'MPESA', 'PENDING', ?, ?, ?, 999, 'PENDING', 'STK_PROMPT', ?, ?)
  `).bind(paymentId, invoice.id, businessId, amount, phone, stkData.CheckoutRequestID, stkData.MerchantRequestID, Date.now(), Date.now()).run();

  return json({
    success: true,
    paymentId,
    invoiceId: invoice.id,
    checkoutRequestId: stkData.CheckoutRequestID,
    message: stkData.CustomerMessage || 'Software payment prompt sent.',
  });
}

async function handleCallback(action: string[], request: Request, env: Env) {
  const receivedSecret = action[1];
  const expectedSecret = env.BILLING_MPESA_CALLBACK_SECRET;
  if (!expectedSecret || receivedSecret !== expectedSecret) return json({ ResultCode: 1, ResultDesc: 'Unauthorized' }, 401);
  const data = await request.json().catch(() => null) as any;
  const callbackData = data?.Body?.stkCallback;
  if (!callbackData) return json({ ResultCode: 0, ResultDesc: 'Ignored' });

  const checkoutRequestId = callbackData.CheckoutRequestID;
  const resultCode = Number(callbackData.ResultCode);
  const resultDesc = callbackData.ResultDesc || '';
  let receiptNumber = '';
  let paidAmount = 0;
  let phoneNumber = '';

  if (resultCode === 0 && callbackData.CallbackMetadata?.Item) {
    for (const item of callbackData.CallbackMetadata.Item) {
      if (item.Name === 'Amount') paidAmount = asNumber(item.Value, 0);
      if (item.Name === 'MpesaReceiptNumber') receiptNumber = item.Value;
      if (item.Name === 'PhoneNumber') phoneNumber = String(item.Value || '');
    }
  }

  const existing = await first<any>(env.DB, 'SELECT * FROM billingPayments WHERE checkoutRequestId = ? LIMIT 1', checkoutRequestId);
  if (existing && existing.status !== 'PENDING') return json({ ResultCode: 0, ResultDesc: 'Duplicate ignored' });
  if (existing) {
    await env.DB.prepare(`
      UPDATE billingPayments
      SET status = ?, resultCode = ?, resultDesc = ?, receiptNumber = ?, amount = ?, phoneNumber = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      paymentStatus(resultCode),
      resultCode,
      resultDesc,
      receiptNumber || existing.receiptNumber || '',
      paidAmount || existing.amount,
      phoneNumber || existing.phoneNumber || '',
      Date.now(),
      existing.id,
    ).run();
    await recomputeInvoice(env.DB, existing.invoiceId);
  }

  return json({ ResultCode: 0, ResultDesc: 'Success' });
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const action = ((params.action as string[]) || []).map(part => String(part || ''));
    if (action[0] === 'callback') {
      await ensureBillingSchema(env.DB);
      return handleCallback(action, request, env);
    }

    if (!env.API_SECRET) return json({ error: 'Server misconfigured' }, 500);
    if (request.headers.get('X-API-Key') !== env.API_SECRET) return json({ error: 'Unauthorized' }, 401);
    await ensureBillingSchema(env.DB);

    const url = new URL(request.url);
    const route = action[0] || 'current';

    if (request.method === 'GET' && route === 'summary') {
      return json({ rows: await billingSummary(env.DB) });
    }

    if (request.method === 'GET' && route === 'current') {
      const businessId = String(url.searchParams.get('businessId') || request.headers.get('X-Business-ID') || '').trim();
      if (!businessId) return json({ error: 'Business is required.' }, 400);
      const account = await getAccount(env.DB, businessId);
      const invoice = await ensureInvoice(env.DB, businessId, String(url.searchParams.get('period') || currentPeriod()));
      return json({ account, invoice, showBanner: !!account.bannerEnabled });
    }

    if (request.method === 'POST' && route === 'account') {
      const body = await request.json().catch(() => null) as any;
      const businessId = String(body?.businessId || '').trim();
      if (!businessId) return json({ error: 'Business is required.' }, 400);
      const account: BillingAccount = {
        businessId,
        monthlyBaseFee: Math.max(0, asNumber(body?.monthlyBaseFee, 3000)),
        pricePerBranch: Math.max(0, asNumber(body?.pricePerBranch, 500)),
        discountType: body?.discountType === 'PERCENT' ? 'PERCENT' : 'FIXED',
        discountValue: Math.max(0, asNumber(body?.discountValue, 0)),
        dueDay: clamp(Math.floor(asNumber(body?.dueDay, 5)), 1, 28),
        bannerEnabled: boolInt(body?.bannerEnabled, 0),
        bannerMessage: String(body?.bannerMessage || 'Your Mtaani POS software subscription is due. Pay by M-Pesa to keep your account current.').slice(0, 500),
        allowPartial: boolInt(body?.allowPartial, 1),
        minPaymentAmount: Math.max(1, asNumber(body?.minPaymentAmount, 500)),
        status: String(body?.status || 'ACTIVE').slice(0, 30),
        updated_at: Date.now(),
      };
      await env.DB.prepare(`
        INSERT OR REPLACE INTO billingAccounts
        (businessId, monthlyBaseFee, pricePerBranch, discountType, discountValue, dueDay, bannerEnabled, bannerMessage, allowPartial, minPaymentAmount, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        account.businessId,
        account.monthlyBaseFee,
        account.pricePerBranch,
        account.discountType,
        account.discountValue,
        account.dueDay,
        account.bannerEnabled,
        account.bannerMessage,
        account.allowPartial,
        account.minPaymentAmount,
        account.status,
        account.updated_at,
      ).run();
      const invoice = await ensureInvoice(env.DB, businessId);
      return json({ success: true, account, invoice });
    }

    if (request.method === 'POST' && route === 'invoice') {
      const body = await request.json().catch(() => null) as any;
      const businessId = String(body?.businessId || '').trim();
      if (!businessId) return json({ error: 'Business is required.' }, 400);
      return json({ success: true, invoice: await ensureInvoice(env.DB, businessId, String(body?.period || currentPeriod())) });
    }

    if (request.method === 'POST' && route === 'payment') {
      const body = await request.json().catch(() => null) as any;
      const businessId = String(body?.businessId || '').trim();
      const amount = Math.max(0, asNumber(body?.amount, 0));
      if (!businessId || amount <= 0) return json({ error: 'Business and amount are required.' }, 400);
      const invoice = await ensureInvoice(env.DB, businessId, String(body?.period || currentPeriod()));
      const id = `billpay_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      await env.DB.prepare(`
        INSERT INTO billingPayments
        (id, invoiceId, businessId, amount, method, status, receiptNumber, recordedBy, notes, timestamp, updated_at)
        VALUES (?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, ?)
      `).bind(
        id,
        invoice.id,
        businessId,
        amount,
        String(body?.method || 'MANUAL').slice(0, 30),
        String(body?.receiptNumber || '').slice(0, 120),
        String(body?.recordedBy || 'System Admin').slice(0, 120),
        String(body?.notes || '').slice(0, 500),
        Date.now(),
        Date.now(),
      ).run();
      return json({ success: true, paymentId: id, invoice: await recomputeInvoice(env.DB, invoice.id) });
    }

    if (request.method === 'POST' && route === 'stkpush') {
      const body = await request.json().catch(() => null) as any;
      return triggerBillingStk(request, env, body);
    }

    if (request.method === 'GET' && route === 'status') {
      const id = action[1];
      if (!id) return json({ error: 'Payment id required.' }, 400);
      const payment = await first<any>(env.DB, 'SELECT * FROM billingPayments WHERE id = ? OR checkoutRequestId = ? LIMIT 1', id, id);
      if (!payment) return json({ found: false });
      const invoice = await recomputeInvoice(env.DB, payment.invoiceId);
      return json({ found: true, payment, invoice });
    }

    return json({ error: 'Not found' }, 404);
  } catch (err: any) {
    console.error('[Billing API]', err);
    return json({ error: err?.message || 'Billing request failed.' }, 500);
  }
};
