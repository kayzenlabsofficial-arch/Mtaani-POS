import { buildCreditSettlementDraft, makeId, text } from '../_domain';
import { ensureSchema, json, onOptions, readJson, requireRole } from '../_utils';

export const onRequestOptions: PagesFunction<Env> = async () => onOptions();

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
  const principal = await requireRole(request, env.DB, ['ADMIN', 'CASHIER']);
  if (principal instanceof Response) return principal;
  const { results } = await env.DB.prepare(`SELECT * FROM customers ORDER BY balance DESC, name ASC`).all();
  return json({ customers: results || [] });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing.' }, 500);
    const principal = await requireRole(request, env.DB, ['ADMIN', 'CASHIER']);
    if (principal instanceof Response) return principal;
    await ensureSchema(env.DB);
    const body = await readJson(request) as any;
    const customerId = text(body.customerId, 160);
    if (!customerId) return json({ error: 'Customer and amount are required.' }, 400);
    const customer = await env.DB.prepare(`SELECT * FROM customers WHERE id = ?`).bind(customerId).first<any>();
    if (!customer) return json({ error: 'Customer was not found.' }, 404);
    const draft = buildCreditSettlementDraft(body, customer.balance);
    const now = Date.now();
    const paymentId = makeId('credit_payment');
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO creditPayments (id, customerId, amount, paymentMethod, reference, receivedBy, timestamp, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(paymentId, customerId, draft.amount, draft.paymentMethod, draft.reference, principal.name, now, now),
      env.DB.prepare(`
        UPDATE customers
        SET balance = ROUND(MAX(0, balance - ?), 2),
            totalPaid = ROUND(totalPaid + ?, 2),
            updatedAt = ?
        WHERE id = ?
      `).bind(draft.amount, draft.amount, now, customerId),
    ]);
    return json({ success: true, paymentId, customerBalance: draft.nextBalance });
  } catch (err: any) {
    return json({ error: err?.message || 'Could not record customer payment.' }, 400);
  }
};
