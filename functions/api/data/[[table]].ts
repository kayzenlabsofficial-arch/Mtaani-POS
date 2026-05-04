interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ALLOWED_TABLES = new Set([
  'users', 'products', 'transactions', 'cashPicks', 'shifts',
  'endOfDayReports', 'stockMovements', 'expenses', 'customers',
  'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries',
  'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories',
  'branches', 'system'
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Business-ID'
};

function jsonHeaders() {
  return { 'Content-Type': 'application/json', ...corsHeaders };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS businesses (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, sellingPrice REAL NOT NULL, taxCategory TEXT NOT NULL, stockQuantity REAL NOT NULL, unit TEXT, barcode TEXT NOT NULL, imageUrl TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, total REAL NOT NULL, subtotal REAL NOT NULL, tax REAL NOT NULL, discountAmount REAL, discountReason TEXT, items TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, paymentMethod TEXT, amountTendered REAL, cashierName TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS cashPicks (id TEXT PRIMARY KEY, amount REAL NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, userName TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, startTime INTEGER NOT NULL, endTime INTEGER, openingFloat REAL NOT NULL, cashierName TEXT NOT NULL, status TEXT NOT NULL, branchId TEXT, lastSyncAt INTEGER, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS endOfDayReports (id TEXT PRIMARY KEY, shiftId TEXT, timestamp INTEGER NOT NULL, openingFloat REAL NOT NULL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, cashSales REAL NOT NULL, mpesaSales REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, expectedCash REAL NOT NULL, reportedCash REAL NOT NULL, difference REAL NOT NULL, cashierName TEXT NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT, timestamp INTEGER NOT NULL, userName TEXT, status TEXT NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT, totalSpent REAL, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT, phone TEXT, email TEXT, balance REAL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS supplierPayments (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, purchaseOrderId TEXT, purchaseOrderIds TEXT, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, transactionCode TEXT, timestamp INTEGER NOT NULL, reference TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS creditNotes (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, amount REAL NOT NULL, reference TEXT NOT NULL, timestamp INTEGER NOT NULL, reason TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS dailySummaries (id TEXT PRIMARY KEY, date INTEGER NOT NULL, shiftIds TEXT NOT NULL, totalSales REAL NOT NULL, grossSales REAL NOT NULL, taxTotal REAL NOT NULL, totalExpenses REAL NOT NULL, totalPicks REAL NOT NULL, totalVariance REAL NOT NULL, timestamp INTEGER NOT NULL, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT, oldQty REAL, newQty REAL, requestedQuantity REAL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL, status TEXT NOT NULL, preparedBy TEXT, approvedBy TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS purchaseOrders (id TEXT PRIMARY KEY, supplierId TEXT NOT NULL, items TEXT NOT NULL, totalAmount REAL NOT NULL, status TEXT NOT NULL, approvalStatus TEXT NOT NULL, paymentStatus TEXT, paidAmount REAL, orderDate INTEGER NOT NULL, expectedDate INTEGER, receivedDate INTEGER, invoiceNumber TEXT, branchId TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, storeName TEXT NOT NULL, tillNumber TEXT, kraPin TEXT, receiptFooter TEXT, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, iconName TEXT NOT NULL, color TEXT NOT NULL, businessId TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, phone TEXT, tillNumber TEXT, kraPin TEXT, isActive INTEGER NOT NULL DEFAULT 1, businessId TEXT, updated_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
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
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (table === 'system') {
      if (recordId === 'ping') return new Response(JSON.stringify({ success: true, message: 'pong' }), { headers: jsonHeaders() });
      if (recordId === 'status') return new Response(JSON.stringify({ success: true, env: { hasDB: !!env.DB, hasSecret: !!env.API_SECRET, envKeys: Object.keys(env) } }), { headers: jsonHeaders() });
    }
    const apiKey = request.headers.get('X-API-Key');
    const businessId = request.headers.get('X-Business-ID');
    const expectedKey = env.API_SECRET || 'mtaani-pos-auth-token-2026';
    if (apiKey !== expectedKey) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders() });
    if (!env.DB) return new Response(JSON.stringify({ error: 'DB binding missing' }), { status: 500, headers: jsonHeaders() });
    
    // Add businesses to ALLOWED_TABLES dynamically
    if (table === 'businesses') {
      ALLOWED_TABLES.add('businesses');
    }
    
    if (!table || !ALLOWED_TABLES.has(table)) return new Response(JSON.stringify({ error: 'Table not allowed' }), { status: 400, headers: jsonHeaders() });
    if (table === 'system' && recordId === 'setup') {
      const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(s => s.length > 0);
      for (const s of statements) await env.DB.prepare(s).run();
      try { await env.DB.prepare('ALTER TABLE products ADD COLUMN unit TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN preparedBy TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE stockAdjustmentRequests ADD COLUMN approvedBy TEXT').run(); } catch (e) {}
      try { await env.DB.prepare('ALTER TABLE shifts ADD COLUMN lastSyncAt INTEGER').run(); } catch (e) {}
      
      // MIGRATION: Attempt to add businessId to all tables if it doesn't exist
      const tables = ['users', 'products', 'transactions', 'cashPicks', 'shifts', 'endOfDayReports', 'stockMovements', 'expenses', 'customers', 'suppliers', 'supplierPayments', 'creditNotes', 'dailySummaries', 'stockAdjustmentRequests', 'purchaseOrders', 'settings', 'categories', 'branches'];
      for (const t of tables) {
        try { await env.DB.prepare(`ALTER TABLE ${t} ADD COLUMN businessId TEXT`).run(); } catch (e) {}
      }
      
      return new Response(JSON.stringify({ success: true, message: 'Database initialized.' }), { headers: jsonHeaders() });
    }
    if (request.method === 'GET') {
      if (table === 'businesses') {
        const { results } = await env.DB.prepare(`SELECT * FROM ${table}`).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      } else {
        if (!businessId) return new Response(JSON.stringify({ error: 'X-Business-ID header required' }), { status: 400, headers: jsonHeaders() });
        const { results } = await env.DB.prepare(`SELECT * FROM ${table} WHERE businessId = ?`).bind(businessId).all();
        return new Response(JSON.stringify(results.map(deserializeRow)), { headers: jsonHeaders() });
      }
    }
    if (request.method === 'POST') {
      const body = await request.json() as any;
      const items = Array.isArray(body) ? body : [body];
      if (items.length === 0) return new Response(JSON.stringify({ success: true, count: 0 }), { headers: jsonHeaders() });
      
      // Inject businessId into payload for all non-business tables
      if (table !== 'businesses') {
        if (!businessId) return new Response(JSON.stringify({ error: 'X-Business-ID header required for POST' }), { status: 400, headers: jsonHeaders() });
        items.forEach(item => { item.businessId = businessId; });
      }

      const { results: pragma } = await env.DB.prepare(`PRAGMA table_info('${table}')`).all();
      const validCols = new Set(pragma.map((r: any) => r.name));
      const cols = Object.keys(items[0]).filter(k => validCols.has(k));
      const sql = `INSERT OR REPLACE INTO ${table} (${cols.map(c => '"'+c+'"').join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const stmt = env.DB.prepare(sql);
      const batch = items.map(item => stmt.bind(...cols.map(col => serializeValue(item[col]))));
      await env.DB.batch(batch);
      return new Response(JSON.stringify({ success: true, count: items.length }), { headers: jsonHeaders() });
    }
    if (request.method === 'DELETE') {
      const id = recordId ?? (await request.json() as any)?.id;
      if (table === 'businesses') {
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
      } else {
        if (!businessId) return new Response(JSON.stringify({ error: 'X-Business-ID header required for DELETE' }), { status: 400, headers: jsonHeaders() });
        await env.DB.prepare(`DELETE FROM ${table} WHERE id = ? AND businessId = ?`).bind(id, businessId).run();
      }
      return new Response(JSON.stringify({ success: true }), { headers: jsonHeaders() });
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: jsonHeaders() });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Worker Error', message: err.message }), { status: 500, headers: jsonHeaders() });
  }
};
