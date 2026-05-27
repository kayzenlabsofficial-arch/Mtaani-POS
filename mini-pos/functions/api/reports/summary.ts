import { buildReportSummary } from '../_domain';
import { ensureSchema, json, onOptions, requireRole } from '../_utils';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  const principal = await requireRole(request, env.DB, ['ADMIN']);
  if (principal instanceof Response) return principal;
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const from = Number(url.searchParams.get('from') || 0);
  const to = Number(url.searchParams.get('to') || Date.now());
  const sales = await env.DB.prepare(`SELECT * FROM sales WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC`).bind(from, to).all<any>();
  const saleItems = await env.DB.prepare(`
    SELECT saleItems.*
    FROM saleItems
    JOIN sales ON sales.id = saleItems.saleId
    WHERE sales.timestamp >= ? AND sales.timestamp <= ?
  `).bind(from, to).all<any>();
  const customers = await env.DB.prepare(`SELECT balance FROM customers`).all<any>();
  const products = await env.DB.prepare(`SELECT stockQuantity, costPrice FROM products WHERE isActive = 1`).all<any>();
  const stockReceipts = await env.DB.prepare(`SELECT totalCost FROM stockReceipts WHERE timestamp >= ? AND timestamp <= ?`).bind(from, to).all<any>();
  const stockMovements = await env.DB.prepare(`SELECT type, quantity FROM stockMovements WHERE timestamp >= ? AND timestamp <= ?`).bind(from, to).all<any>();
  return json({ summary: buildReportSummary({
    sales: (sales.results || []) as any[],
    saleItems: (saleItems.results || []) as any[],
    customers: (customers.results || []) as any[],
    products: (products.results || []) as any[],
    stockReceipts: (stockReceipts.results || []) as any[],
    stockMovements: (stockMovements.results || []) as any[],
  }) });
};
