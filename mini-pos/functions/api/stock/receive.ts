import { buildStockReceiveLines, makeId, makeReceiptNumber, money, text } from '../_domain';
import { ensureSchema, json, onOptions, readJson, requireRole } from '../_utils';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    const principal = await requireRole(request, env.DB, ['ADMIN']);
    if (principal instanceof Response) return principal;
    await ensureSchema(env.DB);
    const body = await readJson(request) as any;
    const productIds = Array.from(new Set((Array.isArray(body.items) ? body.items : []).map((item: any) => text(item.productId, 160)).filter(Boolean)));
    if (!productIds.length) return json({ error: 'Add at least one stock item to receive.' }, 400);
    const placeholders = productIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).bind(...productIds).all<any>();
    const lines = buildStockReceiveLines((results || []) as any[], { note: body.note, items: body.items });
    const now = Date.now();
    const receiptId = makeId('stock_receipt');
    const receiptNumber = makeReceiptNumber('SR', now);
    const note = text(body.note, 240) || null;
    const totalCost = money(lines.reduce((sum, line) => sum + line.lineCost, 0));
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO stockReceipts (id, receiptNumber, note, totalCost, receivedBy, timestamp, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(receiptId, receiptNumber, note, totalCost, principal.name, now, now),
    ];

    for (const line of lines) {
      statements.push(
        env.DB.prepare(`UPDATE products SET stockQuantity = ?, costPrice = ?, updatedAt = ? WHERE id = ?`)
          .bind(line.nextStockQuantity, line.nextCostPrice, now, line.product.id),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, productName, type, quantity, unitCost, referenceId, note, timestamp, updatedAt)
          VALUES (?, ?, ?, 'RECEIVE', ?, ?, ?, ?, ?, ?)
        `).bind(makeId('stock_move'), line.product.id, line.product.name, line.quantity, line.unitCost, receiptId, note, now, now),
      );
    }

    await env.DB.batch(statements);
    return json({ success: true, receipt: { id: receiptId, receiptNumber, note, totalCost, receivedBy: principal.name, timestamp: now }, lines });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not receive stock.' }, 400);
  }
};
