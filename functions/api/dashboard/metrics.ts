import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { DEFAULT_SHOP_ID } from '../inventoryIntegrity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const STAFF_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER', 'CASHIER']);
const DAY_MS = 24 * 60 * 60 * 1000;

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Shop-ID',
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

function localDayStart(timestamp = Date.now()) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function safeDayStart(raw: string | null) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return localDayStart();
  if (Math.abs(value - Date.now()) > 31 * DAY_MS) return localDayStart();
  return value;
}

async function safeFirst<T extends Record<string, any>>(db: D1Database, sql: string, binds: unknown[] = []): Promise<T | null> {
  return db.prepare(sql).bind(...binds).first<T>().catch(() => null);
}

async function salesCount(db: D1Database, businessId: string, start: number, end: number) {
  const [transactions, invoices] = await Promise.all([
    safeFirst<{ count: number }>(
      db,
      `
        SELECT COUNT(*) AS count
        FROM transactions
        WHERE businessId = ?
          AND timestamp >= ?
          AND timestamp < ?
          AND UPPER(COALESCE(status, '')) NOT IN ('VOIDED', 'QUOTE', 'REFUNDED')
      `,
      [businessId, start, end],
    ),
    safeFirst<{ count: number }>(
      db,
      `
        SELECT COUNT(*) AS count
        FROM salesInvoices
        WHERE businessId = ?
          AND issueDate >= ?
          AND issueDate < ?
          AND UPPER(COALESCE(status, '')) != 'CANCELLED'
      `,
      [businessId, start, end],
    ),
  ]);

  return Number(transactions?.count || 0) + Number(invoices?.count || 0);
}

async function expenseTotal(db: D1Database, businessId: string, shopId: string, start: number, end: number) {
  const row = await safeFirst<{ total: number }>(
    db,
    `
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE businessId = ?
        AND COALESCE(NULLIF(shopId, ''), ?) = ?
        AND timestamp >= ?
        AND timestamp < ?
        AND UPPER(COALESCE(status, 'APPROVED')) = 'APPROVED'
    `,
    [businessId, DEFAULT_SHOP_ID, shopId, start, end],
  );
  return Number(row?.total || 0);
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function lowStockCount(db: D1Database, businessId: string) {
  const [productsResult, ingredientsResult] = await Promise.all([
    db.prepare(`
      SELECT id, stockQuantity, reorderPoint, isBundle, components
      FROM products
      WHERE businessId = ?
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
    db.prepare(`
      SELECT productId, ingredientProductId, quantity
      FROM productIngredients
      WHERE businessId = ?
    `).bind(businessId).all<any>().catch(() => ({ results: [] })),
  ]);

  const products = (productsResult.results || []) as any[];
  const ingredients = (ingredientsResult.results || []) as any[];
  const productStock = new Map(products.map(product => [String(product.id), Number(product.stockQuantity || 0)]));

  return products.filter(product => {
    let stock = Number(product.stockQuantity || 0);
    const isBundle = product.isBundle === true || product.isBundle === 1 || product.isBundle === '1';
    if (isBundle) {
      const rows = ingredients
        .filter(row => String(row.productId || '') === String(product.id || ''))
        .map(row => ({ id: String(row.ingredientProductId || ''), quantity: Number(row.quantity || 0) }))
        .filter(row => row.id && row.quantity > 0);
      const fallbackRows = Array.isArray(parseMaybeJson(product.components))
        ? parseMaybeJson(product.components)
            .map((row: any) => ({ id: String(row?.productId || ''), quantity: Number(row?.quantity || 0) }))
            .filter((row: any) => row.id && row.quantity > 0)
        : [];
      const bundleRows = rows.length ? rows : fallbackRows;
      stock = bundleRows.length
        ? Math.max(0, Math.min(...bundleRows.map(row => Math.floor(Number(productStock.get(row.id) || 0) / row.quantity))))
        : 0;
    }
    return stock > 0 && stock <= Number(product.reorderPoint || 5);
  }).length;
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: 'DB binding missing' }, 500);

  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!auth.service && !STAFF_ROLES.has(auth.principal.role)) return json({ error: 'Access denied.' }, 403);

  const businessId = String(request.headers.get('X-Business-ID') || auth.principal.businessId || '').trim();
  if (!businessId || !canAccessBusiness(auth.principal, businessId)) {
    return json({ error: 'Access denied.' }, 403);
  }

  const url = new URL(request.url);
  const todayStart = safeDayStart(url.searchParams.get('todayStart'));
  const todayEnd = todayStart + DAY_MS;
  const yesterdayStart = todayStart - DAY_MS;
  const shopId = String(request.headers.get('X-Shop-ID') || url.searchParams.get('shopId') || DEFAULT_SHOP_ID).trim() || DEFAULT_SHOP_ID;

  const [lowStock, customersServed, previousCustomersServed, totalExpenses, previousExpenses] = await Promise.all([
    lowStockCount(env.DB, businessId),
    salesCount(env.DB, businessId, todayStart, todayEnd),
    salesCount(env.DB, businessId, yesterdayStart, todayStart),
    expenseTotal(env.DB, businessId, shopId, todayStart, todayEnd),
    expenseTotal(env.DB, businessId, shopId, yesterdayStart, todayStart),
  ]);
  const canReturnExpenseTotals = auth.service || ['ROOT', 'ADMIN', 'MANAGER'].includes(String(auth.principal.role || '').toUpperCase());

  return json({
    lowStockCount: Number(lowStock || 0),
    customersServed,
    previousCustomersServed,
    totalExpenses: canReturnExpenseTotals ? totalExpenses : 0,
    previousExpenses: canReturnExpenseTotals ? previousExpenses : 0,
  });
};
