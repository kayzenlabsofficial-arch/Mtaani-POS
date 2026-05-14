interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ALLOWED_TABLES = new Set([
  'users', 'products', 'transactions', 'cashPicks', 'shifts',
  'endOfDayReports', 'stockMovements', 'expenses', 'customers',
  'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries',
  'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories',
  'branches', 'businesses', 'system', 'expenseAccounts', 'financialAccounts', 'productIngredients', 'loginAttempts'
]);

// Global tables: shared across branches, isolated by businessId
const GLOBAL_TABLES = new Set(['users', 'branches', 'settings', 'expenseAccounts', 'financialAccounts', 'customers', 'suppliers', 'products', 'productIngredients', 'categories']);
// Truly unscoped tables: not filtered by businessId/branchId
const UNSCOPED_TABLES = new Set(['businesses', 'loginAttempts']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID'
};

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders };
}

function secureJsonHeaders() {
  return {
    'Content-Type': 'application/json',
    ...corsHeaders,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, isActive INTEGER DEFAULT 1, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, businessId TEXT, branchId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, sellingPrice REAL NOT NULL, costPrice REAL, taxCategory TEXT NOT NULL, stockQuantity REAL NOT NULL, unit TEXT, barcode TEXT NOT NULL, imageUrl TEXT, reorderPoint REAL, isBundle INTEGER DEFAULT 0, components TEXT, businessId TEXT, branchId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total REAL NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, discountAmount REAL, discountReason TEXT, items TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, paymentMethod TEXT, amountTendered REAL, cashierName TEXT, approvedBy TEXT, pendingRefundItems TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS cashPicks (id TEXT PRIMARY KEY, amount REAL NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, userName TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, startTime INTEGER NOT NULL, endTime INTEGER, openingFloat REAL, cashierName TEXT NOT NULL, status TEXT NOT NULL, branchId TEXT, lastSyncAt INTEGER, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS endOfDayReports (id TEXT PRIMARY KEY, shiftId TEXT, timestamp INTEGER NOT NULL, openingFloat REAL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, cashSales REAL NOT NULL, mpesaSales REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalRefunds REAL, expectedCash REAL NOT NULL, reportedCash REAL NOT NULL, difference REAL NOT NULL, cashierName TEXT NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT, timestamp INTEGER NOT NULL, userName TEXT, status TEXT NOT NULL, source TEXT, accountId TEXT, preparedBy TEXT, approvedBy TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, totalSpent REAL, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS supplierPayments (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, purchaseOrderId TEXT, purchaseOrderIds TEXT, creditNoteIds TEXT, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, timestamp INTEGER NOT NULL, reference TEXT, source TEXT, accountId TEXT, shiftId TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS creditNotes (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, amount REAL NOT NULL, reference TEXT NOT NULL, timestamp INTEGER NOT NULL, reason TEXT, status TEXT DEFAULT 'PENDING', allocatedTo TEXT, branchId TEXT, businessId TEXT, shiftId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS dailySummaries (id TEXT PRIMARY KEY, date INTEGER NOT NULL, shiftIds TEXT NOT NULL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalVariance REAL NOT NULL, timestamp INTEGER NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT, oldQty REAL, newQty REAL, requestedQuantity REAL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, preparedBy TEXT, approvedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS purchaseOrders (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, items TEXT NOT NULL, totalAmount REAL NOT NULL, status TEXT NOT NULL, approvalStatus TEXT NOT NULL, paymentStatus TEXT, paidAmount REAL, orderDate INTEGER NOT NULL, expectedDate INTEGER, receivedDate INTEGER, invoiceNumber TEXT, poNumber TEXT, preparedBy TEXT, approvedBy TEXT, receivedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, storeName TEXT NOT NULL, location TEXT, tillNumber TEXT, kraPin TEXT, receiptFooter TEXT, ownerModeEnabled INTEGER DEFAULT 0, autoApproveOwnerActions INTEGER DEFAULT 1, cashSweepEnabled INTEGER DEFAULT 1, cashDrawerLimit REAL DEFAULT 5000, cashFloatTarget REAL DEFAULT 1000, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, iconName TEXT NOT NULL, color TEXT NOT NULL, businessId TEXT, branchId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, phone TEXT, tillNumber TEXT, kraPin TEXT, isActive INTEGER NOT NULL DEFAULT 1, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS expenseAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, businessId TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS financialAccounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, businessId TEXT, branchId TEXT, accountNumber TEXT, updated_at INTEGER);
 CREATE TABLE IF NOT EXISTS mpesaCallbacks (checkoutRequestId TEXT PRIMARY KEY, merchantRequestId TEXT, resultCode INTEGER, resultDesc TEXT, amount REAL, receiptNumber TEXT, phoneNumber TEXT, businessId TEXT, branchId TEXT, timestamp INTEGER);
CREATE TABLE IF NOT EXISTS deviceSyncStatus (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, deviceId TEXT NOT NULL, cashierName TEXT, lastSyncAt INTEGER, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt);
CREATE TABLE IF NOT EXISTS idempotencyKeys (id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, idempotencyKey TEXT NOT NULL, operation TEXT NOT NULL, deviceId TEXT, cashierName TEXT, createdAt INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER);
`;

function serializeValue(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function deserializeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  try {
    const parts = (params.table as string[]) ?? [];
    const table = parts[0];
    const recordId = parts[1];

    // Allow CORS preflight
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // ── Auth: ALL endpoints require a valid API key ───────────────────────────
    const apiKey = request.headers.get('X-API-Key');
    const expectedKey = env.API_SECRET;
    if (!expectedKey) {
      console.error('[Security] API_SECRET env var is not set. Refusing to serve requests.');
      return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers: secureJsonHeaders() });
    }
    if (apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: secureJsonHeaders() });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: secureJsonHeaders() });
    }

    // ── Request size limit (1MB) ─────────────────────────────────────────────
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength) > 1_048_576) {
      return new Response(JSON.stringify({ error: 'Request too large' }), { status: 413, headers: secureJsonHeaders() });
    }

    const businessId = request.headers.get('X-Business-ID');
    const branchId = request.headers.get('X-Branch-ID');

    // ── System / Schema Setup ────────────────────────────────────────────────
    if (table === 'system') {
      if (recordId === 'ping') {
        return new Response(JSON.stringify({ success: true, message: 'pong' }), { headers: jsonHeaders() });
      }
      if (recordId === 'status') {
        return new Response(JSON.stringify({ success: true, hasDB: !!env.DB, hasSecret: !!env.API_SECRET }), { headers: jsonHeaders() });
      }
      if (recordId === 'setup') {
        const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
        for (const s of statements) {
          try { await env.DB.prepare(s).run(); } catch (e) {}
        }
        // Migrations: add new columns if they don't exist
        const migrationCols: [string, string][] = [
          ['products',   'unit TEXT'],
          ['products',   'branchId TEXT'],
          ['products',   'costPrice REAL'],
          ['products',   'reorderPoint REAL'],
          ['products',   'isBundle INTEGER DEFAULT 0'],
          ['products',   'components TEXT'],
          ['transactions', 'shiftId TEXT'],
          ['transactions', 'approvedBy TEXT'],
          ['transactions', 'pendingRefundItems TEXT'],
          ['categories', 'branchId TEXT'],
          ['shifts',     'lastSyncAt INTEGER'],
          ['shifts',     'openingFloat REAL'],
          ['businesses', 'isActive INTEGER DEFAULT 1'],
          ['stockAdjustmentRequests', 'preparedBy TEXT'],
          ['stockAdjustmentRequests', 'approvedBy TEXT'],
          ['users',      'branchId TEXT'],
          ['cashPicks',  'shiftId TEXT'],
          ['expenses',   'source TEXT'],
          ['expenses',   'accountId TEXT'],
          ['expenses',   'preparedBy TEXT'],
          ['expenses',   'approvedBy TEXT'],
          ['expenses',   'shiftId TEXT'],
          ['supplierPayments', 'source TEXT'],
          ['supplierPayments', 'accountId TEXT'],
          ['supplierPayments', 'shiftId TEXT'],
          ['supplierPayments', 'creditNoteIds TEXT'],
          ['supplierPayments', 'reference TEXT'],
          ['creditNotes', "status TEXT DEFAULT 'PENDING'"],
          ['creditNotes', 'allocatedTo TEXT'],
          ['creditNotes', 'shiftId TEXT'],
          ['purchaseOrders', 'poNumber TEXT'],
          ['purchaseOrders', 'preparedBy TEXT'],
          ['purchaseOrders', 'approvedBy TEXT'],
          ['purchaseOrders', 'receivedBy TEXT'],
          ['endOfDayReports', 'totalRefunds REAL'],
          ['financialAccounts', 'accountNumber TEXT'],
          ['settings', 'location TEXT'],
          ['settings', 'ownerModeEnabled INTEGER DEFAULT 0'],
          ['settings', 'autoApproveOwnerActions INTEGER DEFAULT 1'],
          ['settings', 'cashSweepEnabled INTEGER DEFAULT 1'],
          ['settings', 'cashDrawerLimit REAL DEFAULT 5000'],
          ['settings', 'cashFloatTarget REAL DEFAULT 1000'],
        ];
        const allTables = ['users', 'products', 'productIngredients', 'transactions', 'cashPicks', 'shifts', 'endOfDayReports', 'stockMovements', 'expenses', 'customers', 'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries', 'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories', 'branches', 'financialAccounts'];
        for (const t of allTables) {
          try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN businessId TEXT`).run(); } catch (e) {}
        }
        for (const [t, col] of migrationCols) {
          try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN ${col}`).run(); } catch (e) {}
        }
        return new Response(JSON.stringify({ success: true, message: 'Database initialized.' }), { headers: jsonHeaders() });
      }
    }

    // ── Table Allow-list check ───────────────────────────────────────────────
    if (!table || !ALLOWED_TABLES.has(table)) {
      return new Response(JSON.stringify({ error: 'Table not allowed' }), { status: 400, headers: jsonHeaders() });
    }

    if (table === 'loginAttempts') {
      // Defensive migration for environments where /system/setup has not run yet.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
    }

    if (table === 'productIngredients') {
      // Defensive migration for deployed databases that predate bundle ingredients.
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER)').run();
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId)').run();
    }

    // ── GET ──────────────────────────────────────────────────────────────────
    if (request.method === 'GET') {
      if (table === 'businesses') {
        // Only allow listing businesses if the API key is the master secret
        // In a real production system, this would be restricted to a super-admin token
        const { results } = await env.DB.prepare(`SELECT id, name, code, isActive FROM businesses`).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }
      if (table === 'loginAttempts') {
        const { results } = await env.DB.prepare(`SELECT * FROM loginAttempts`).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }

      if (!businessId) {
        return new Response(JSON.stringify({ error: 'X-Business-ID header required' }), { status: 400, headers: jsonHeaders() });
      }

      // Branch-scoped tables MUST be requested with an explicit branchId.
      // Otherwise a caller could read all branch data for a business in one request.
      if (!GLOBAL_TABLES.has(table) && !branchId) {
        return new Response(JSON.stringify({ error: 'X-Branch-ID header required for this table' }), { status: 400, headers: jsonHeaders() });
      }

      if (GLOBAL_TABLES.has(table)) {
        const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ?`).bind(businessId).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      } else {
        // Branch-specific table (and branchId is provided)
        const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ? AND branchId = ?`).bind(businessId, branchId).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }
    }

    // ── POST (upsert) ────────────────────────────────────────────────────────
    if (request.method === 'POST') {
      const body = await request.json() as any;
      const items = Array.isArray(body) ? body : [body];
      if (items.length === 0) return new Response(JSON.stringify({ success: true, count: 0 }), { headers: jsonHeaders() });

      // Normalize business code to uppercase at write time.
      if (table === 'businesses') {
        items.forEach(item => {
          if (typeof item?.code === 'string') item.code = item.code.trim().toUpperCase();
        });
      }

      if (!UNSCOPED_TABLES.has(table)) {
        if (!businessId) {
          return new Response(JSON.stringify({ error: 'X-Business-ID header required for POST' }), { status: 400, headers: jsonHeaders() });
        }
        // Always stamp businessId from the trusted header (not client body)
        items.forEach(item => { item.businessId = businessId; });

        // Stamp branchId for branch-specific tables
        if (!GLOBAL_TABLES.has(table)) {
          if (!branchId) {
            return new Response(JSON.stringify({ error: 'X-Branch-ID header required for POST to this table' }), { status: 400, headers: jsonHeaders() });
          }
          items.forEach(item => { item.branchId = branchId; });
        }
      }

      const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('${table}')`).all();
      const validCols = new Set(pragma.map((r: any) => r.name));
      const cols = Object.keys(items[0]).filter(k => validCols.has(k));
      if (cols.length === 0) return new Response(JSON.stringify({ error: 'No valid columns to insert' }), { status: 400, headers: jsonHeaders() });

      const sql = `INSERT OR REPLACE INTO ${table} (${cols.map(c => '"' + c + '"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const stmt = env.DB.prepare(sql);
      const batch = items.map(item => stmt.bind(...cols.map(col => serializeValue(item[col]))));
      await env.DB.batch(batch);
      return new Response(JSON.stringify({ success: true, count: items.length }), { headers: jsonHeaders() });
    }

    // ── DELETE ───────────────────────────────────────────────────────────────
    if (request.method === 'DELETE') {
      let id = recordId;
      if (!id) {
        const body = await request.json() as any;
        id = body?.id;
      }
      if (!id) return new Response(JSON.stringify({ error: 'ID required for DELETE' }), { status: 400, headers: jsonHeaders() });

      if (table === 'businesses') {
        // Cascade delete: remove ALL data for this business
        const cascadeTables = ['users', 'products', 'productIngredients', 'transactions', 'cashPicks', 'shifts', 'endOfDayReports', 'stockMovements', 'expenses', 'customers', 'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries', 'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories', 'branches', 'financialAccounts'];
        const batch = cascadeTables.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE businessId = ?`).bind(id));
        batch.push(env.DB.prepare(`DELETE FROM businesses WHERE id = ?`).bind(id));
        await env.DB.batch(batch);
      } else if (table === 'loginAttempts') {
        await env.DB.prepare(`DELETE FROM loginAttempts WHERE id = ?`).bind(id).run();
      } else if (GLOBAL_TABLES.has(table)) {
        if (!businessId) return new Response(JSON.stringify({ error: 'X-Business-ID required for DELETE' }), { status: 400, headers: jsonHeaders() });
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ?`).bind(id, businessId).run();
      } else {
        if (!businessId || !branchId) return new Response(JSON.stringify({ error: 'X-Business-ID and X-Branch-ID required for DELETE' }), { status: 400, headers: jsonHeaders() });
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ? AND branchId = ?`).bind(id, businessId, branchId).run();
      }
      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders() });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders() });

  } catch (err: any) {
    console.error('[Worker Error]', err);
    return new Response(JSON.stringify({ error: 'Worker Error', message: err.message }), { status: 500, headers: jsonHeaders() });
  }
};
