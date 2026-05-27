import { ensureSchema, json, onOptions, requireRole } from './_utils';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  const principal = await requireRole(request, env.DB, ['ADMIN', 'CASHIER']);
  if (principal instanceof Response) return principal;
  await ensureSchema(env.DB);
  const sales = await env.DB.prepare(`
    SELECT * FROM sales ORDER BY timestamp DESC LIMIT 200
  `).all<any>();
  const saleItems = await env.DB.prepare(`
    SELECT * FROM saleItems WHERE saleId IN (SELECT id FROM sales ORDER BY timestamp DESC LIMIT 200)
  `).all<any>();
  const receipts = principal.role === 'ADMIN'
    ? await env.DB.prepare(`SELECT * FROM stockReceipts ORDER BY timestamp DESC LIMIT 100`).all<any>()
    : { results: [] };
  const movements = principal.role === 'ADMIN'
    ? await env.DB.prepare(`SELECT * FROM stockMovements WHERE type = 'RECEIVE' ORDER BY timestamp DESC LIMIT 500`).all<any>()
    : { results: [] };
  return json({ sales: sales.results || [], saleItems: saleItems.results || [], stockReceipts: receipts.results || [], stockMovements: movements.results || [] });
};
