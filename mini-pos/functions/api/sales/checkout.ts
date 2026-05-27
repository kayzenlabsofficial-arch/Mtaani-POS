import { buildCheckoutDraft, makeId, text } from '../_domain';
import { ensureSchema, json, onOptions, readJson, requireRole } from '../_utils';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    const principal = await requireRole(request, env.DB, ['ADMIN', 'CASHIER']);
    if (principal instanceof Response) return principal;
    await ensureSchema(env.DB);
    const body = await readJson(request) as any;
    const productIds = Array.from(new Set((Array.isArray(body.items) ? body.items : []).map((item: any) => text(item.productId || item.id, 160)).filter(Boolean)));
    if (!productIds.length) return json({ error: 'Add at least one product to the cart.' }, 400);
    const { results } = await env.DB.prepare(`SELECT * FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`).bind(...productIds).all<any>();
    const draft = buildCheckoutDraft({ payload: body, products: (results || []) as any[], cashier: principal });
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO sales (id, receiptNumber, tillId, paymentMethod, mpesaReference, customerId, customerName, subtotal, total, cogs, status, cashierId, cashierName, timestamp, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        draft.sale.id,
        draft.sale.receiptNumber,
        draft.sale.tillId,
        draft.sale.paymentMethod,
        draft.sale.mpesaReference,
        draft.sale.customerId,
        draft.sale.customerName,
        draft.sale.subtotal,
        draft.sale.total,
        draft.sale.cogs,
        draft.sale.status,
        principal.id,
        principal.name,
        draft.sale.timestamp,
        draft.sale.updatedAt,
      ),
    ];
    for (const item of draft.items) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO saleItems (id, saleId, productId, productName, quantity, unitPrice, unitCost, lineTotal, lineCost, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(item.id, item.saleId, item.productId, item.productName, item.quantity, item.unitPrice, item.unitCost, item.lineTotal, item.lineCost, item.createdAt),
        env.DB.prepare(`UPDATE products SET stockQuantity = stockQuantity - ?, updatedAt = ? WHERE id = ?`)
          .bind(item.quantity, draft.sale.updatedAt, item.productId),
        env.DB.prepare(`
          INSERT INTO stockMovements (id, productId, productName, type, quantity, unitCost, referenceId, note, timestamp, updatedAt)
          VALUES (?, ?, ?, 'SALE', ?, ?, ?, ?, ?, ?)
        `).bind(makeId('stock_move'), item.productId, item.productName, -item.quantity, item.unitCost, draft.sale.id, draft.sale.receiptNumber, draft.sale.timestamp, draft.sale.updatedAt),
      );
    }
    if (draft.customer) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO customers (id, name, phone, balance, totalCredit, totalPaid, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            phone = COALESCE(excluded.phone, customers.phone),
            balance = ROUND(customers.balance + excluded.balance, 2),
            totalCredit = ROUND(customers.totalCredit + excluded.totalCredit, 2),
            updatedAt = excluded.updatedAt
        `).bind(draft.customer.id, draft.customer.name, draft.customer.phone, draft.customer.balanceIncrease, draft.customer.balanceIncrease, draft.sale.timestamp, draft.sale.updatedAt),
      );
    }
    await env.DB.batch(statements);
    return json({ success: true, sale: draft.sale, items: draft.items });
  } catch (err: any) {
    return json({ error: err?.message || 'Checkout failed.' }, 400);
  }
};
