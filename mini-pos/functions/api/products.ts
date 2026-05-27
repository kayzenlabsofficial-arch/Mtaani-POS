import { ensureSchema, json, onOptions, readJson, requireRole } from './_utils';
import { money, qty, text } from './_domain';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  const principal = await requireRole(request, env.DB, ['ADMIN', 'CASHIER']);
  if (principal instanceof Response) return principal;
  const { results } = await env.DB.prepare(`
    SELECT id, name, sku, barcode, sellingPrice, costPrice, stockQuantity, isActive, createdAt, updatedAt
    FROM products
    ORDER BY isActive DESC, name ASC
  `).all();
  return json({ products: results || [] });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    const principal = await requireRole(request, env.DB, ['ADMIN']);
    if (principal instanceof Response) return principal;
    await ensureSchema(env.DB);
    const body = await readJson(request) as any;
    const action = text(body.action || 'SAVE', 20).toUpperCase();
    const now = Date.now();

    if (action === 'DELETE') {
      const id = text(body.id || body.productId, 160);
      if (!id) return json({ error: 'Product is required.' }, 400);
      await env.DB.prepare(`UPDATE products SET isActive = 0, updatedAt = ? WHERE id = ?`).bind(now, id).run();
      return json({ success: true, id });
    }

    const id = text(body.id, 160) || `product_${crypto.randomUUID()}`;
    const name = text(body.name, 160);
    if (!name) return json({ error: 'Product name is required.' }, 400);
    const sellingPrice = money(body.sellingPrice);
    const costPrice = money(body.costPrice);
    const stockQuantity = Math.max(0, qty(body.stockQuantity || 0));
    if (sellingPrice < 0 || costPrice < 0) return json({ error: 'Prices cannot be negative.' }, 400);
    const existing = await env.DB.prepare(`SELECT createdAt, stockQuantity, costPrice FROM products WHERE id = ?`).bind(id).first<any>();
    await env.DB.prepare(`
      INSERT INTO products (id, name, sku, barcode, sellingPrice, costPrice, stockQuantity, isActive, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        sku = excluded.sku,
        barcode = excluded.barcode,
        sellingPrice = excluded.sellingPrice,
        costPrice = excluded.costPrice,
        stockQuantity = excluded.stockQuantity,
        isActive = excluded.isActive,
        updatedAt = excluded.updatedAt
    `).bind(
      id,
      name,
      text(body.sku, 80) || null,
      text(body.barcode, 80) || null,
      sellingPrice,
      costPrice,
      existing ? qty(existing.stockQuantity) : stockQuantity,
      Number(body.isActive ?? 1) ? 1 : 0,
      Number(existing?.createdAt || now),
      now,
    ).run();
    const product = await env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first<any>();
    return json({ success: true, product });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not save product.' }, 400);
  }
};
