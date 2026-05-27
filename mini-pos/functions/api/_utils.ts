import { text } from './_domain';

export type MiniPrincipal = {
  id: string;
  name: string;
  username: string;
  role: 'ADMIN' | 'CASHIER';
};

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export const onOptions = () => new Response(null, {
  headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  },
});

export async function readJson(request: Request) {
  return request.json().catch(() => ({}));
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt = randomToken().slice(0, 24)) {
  const normalized = String(password || '');
  if (normalized.length < 4) throw new Error('Password must be at least 4 characters.');
  const data = new TextEncoder().encode(`${salt}:${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return `sha256:${salt}:${bytesToHex(digest)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [, salt] = String(stored || '').split(':');
  if (!salt) return false;
  return await hashPassword(password, salt) === stored;
}

export async function ensureSchema(db: D1Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL, role TEXT NOT NULL, isActive INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS storeProfile (id TEXT PRIMARY KEY, storeName TEXT NOT NULL, logoDataUrl TEXT, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT, barcode TEXT, sellingPrice REAL NOT NULL DEFAULT 0, costPrice REAL NOT NULL DEFAULT 0, stockQuantity REAL NOT NULL DEFAULT 0, isActive INTEGER NOT NULL DEFAULT 1, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TRIGGER IF NOT EXISTS prevent_negative_product_stock
      BEFORE UPDATE OF stockQuantity ON products
      WHEN NEW.stockQuantity < -0.000001
      BEGIN
        SELECT RAISE(ABORT, 'Insufficient stock.');
      END`,
    `CREATE TABLE IF NOT EXISTS stockReceipts (id TEXT PRIMARY KEY, receiptNumber TEXT NOT NULL, note TEXT, totalCost REAL NOT NULL DEFAULT 0, receivedBy TEXT, timestamp INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS stockMovements (id TEXT PRIMARY KEY, productId TEXT NOT NULL, productName TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, unitCost REAL NOT NULL DEFAULT 0, referenceId TEXT, note TEXT, timestamp INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, balance REAL NOT NULL DEFAULT 0, totalCredit REAL NOT NULL DEFAULT 0, totalPaid REAL NOT NULL DEFAULT 0, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, receiptNumber TEXT NOT NULL, tillId TEXT NOT NULL DEFAULT 'default_till', paymentMethod TEXT NOT NULL, mpesaReference TEXT, customerId TEXT, customerName TEXT, subtotal REAL NOT NULL, total REAL NOT NULL, cogs REAL NOT NULL, status TEXT NOT NULL, cashierId TEXT, cashierName TEXT, timestamp INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS saleItems (id TEXT PRIMARY KEY, saleId TEXT NOT NULL, productId TEXT NOT NULL, productName TEXT NOT NULL, quantity REAL NOT NULL, unitPrice REAL NOT NULL, unitCost REAL NOT NULL, lineTotal REAL NOT NULL, lineCost REAL NOT NULL, createdAt INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS creditPayments (id TEXT PRIMARY KEY, customerId TEXT NOT NULL, amount REAL NOT NULL, paymentMethod TEXT NOT NULL, reference TEXT, receivedBy TEXT, timestamp INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_products_active ON products(isActive, name)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp)`,
    `CREATE INDEX IF NOT EXISTS idx_saleItems_sale ON saleItems(saleId)`,
  ];
  for (const sql of statements) await db.prepare(sql).run();
  await db.prepare(`
    INSERT OR IGNORE INTO storeProfile (id, storeName, logoDataUrl, updatedAt)
    VALUES ('core', 'Smart POS Mini', NULL, ?)
  `).bind(Date.now()).run();
}

export async function needsSetup(db: D1Database) {
  await ensureSchema(db);
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'`).first<any>();
  return Number(row?.count || 0) === 0;
}

export async function createSession(db: D1Database, userId: string) {
  const token = randomToken();
  const now = Date.now();
  const expiresAt = now + 1000 * 60 * 60 * 24 * 14;
  await db.prepare(`INSERT INTO sessions (token, userId, expiresAt, createdAt) VALUES (?, ?, ?, ?)`)
    .bind(token, userId, expiresAt, now)
    .run();
  return { token, expiresAt };
}

export async function authenticate(request: Request, db: D1Database): Promise<MiniPrincipal | Response> {
  await ensureSchema(db);
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return json({ error: 'Sign in required.' }, 401);
  const row = await db.prepare(`
    SELECT users.id, users.name, users.username, users.role, users.isActive, sessions.expiresAt
    FROM sessions
    JOIN users ON users.id = sessions.userId
    WHERE sessions.token = ?
    LIMIT 1
  `).bind(token).first<any>();
  if (!row || Number(row.expiresAt || 0) < Date.now() || Number(row.isActive || 0) !== 1) {
    return json({ error: 'Session expired.' }, 401);
  }
  return { id: row.id, name: row.name, username: row.username, role: row.role };
}

export async function requireRole(request: Request, db: D1Database, roles: Array<'ADMIN' | 'CASHIER'>) {
  const principal = await authenticate(request, db);
  if (principal instanceof Response) return principal;
  if (!roles.includes(principal.role)) return json({ error: 'You are not allowed to do this.' }, 403);
  return principal;
}

export function cleanLogoDataUrl(value: unknown) {
  const logo = text(value, 180000);
  if (!logo) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(logo)) {
    throw new Error('Logo must be a PNG, JPEG, or WEBP data URL.');
  }
  return logo;
}
