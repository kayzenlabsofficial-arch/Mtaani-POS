import { authorizeRequest, canAccessBranch, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ALLOWED_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID, X-Branch-ID',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(v => String(v || '').trim()).filter(Boolean))).slice(0, 100)
    : [];
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auditLogs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entityId TEXT,
      severity TEXT NOT NULL,
      details TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (!env.DB) return json({ error: 'DB binding missing' }, 500);
    const auth = await authorizeRequest(request, env);
    if (!auth.ok) return auth.response;
    if (!auth.service && !ALLOWED_ROLES.has(auth.principal.role)) {
      return json({ error: 'You are not allowed to settle supplier payments.' }, 403);
    }

    const body = await request.json().catch(() => null) as any;
    const businessId = String(request.headers.get('X-Business-ID') || body?.businessId || '').trim();
    const branchId = String(request.headers.get('X-Branch-ID') || body?.branchId || '').trim();
    const supplierId = String(body?.supplierId || body?.supplier?.id || '').trim();
    const payment = body?.payment || {};
    if (!businessId || !branchId || !supplierId) return json({ error: 'Business, branch and supplier are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId) || !canAccessBranch(auth.principal, branchId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const supplier = await env.DB.prepare(`
      SELECT id, name, company, balance, branchId
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first<any>();
    if (!supplier) throw new PolicyError('Supplier was not found.', 404);
    if (supplier.branchId && supplier.branchId !== branchId) throw new PolicyError('Supplier belongs to another branch.', 403);

    const cashAmount = roundMoney(Math.max(0, asNumber(payment.amount)));
    const source = String(payment.source || 'TILL').toUpperCase() === 'ACCOUNT' ? 'ACCOUNT' : 'TILL';
    const method = String(payment.method || 'CASH').toUpperCase();
    const purchaseOrderIds = asStringArray(payment.purchaseOrderIds);
    const creditNoteIds = asStringArray(payment.creditNoteIds);

    let account: any = null;
    if (source === 'ACCOUNT' && cashAmount > 0) {
      const accountId = trimText(payment.accountId, 120);
      if (!accountId) throw new PolicyError('Select the funding account.', 400);
      account = await env.DB.prepare(`
        SELECT id, name, balance, branchId
        FROM financialAccounts
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(accountId, businessId).first<any>();
      if (!account) throw new PolicyError('Selected account was not found.', 404);
      if (account.branchId && account.branchId !== branchId) throw new PolicyError('Selected account belongs to another branch.', 403);
      if (asNumber(account.balance) < cashAmount) throw new PolicyError(`Insufficient funds in "${account.name}".`, 409);
    }

    const creditNotes: any[] = [];
    for (const creditNoteId of creditNoteIds) {
      const cn = await env.DB.prepare(`
        SELECT id, amount, supplierId, status
        FROM creditNotes
        WHERE id = ? AND businessId = ? AND (branchId IS NULL OR branchId = ?)
        LIMIT 1
      `).bind(creditNoteId, businessId, branchId).first<any>();
      if (cn && cn.supplierId === supplierId && (!cn.status || cn.status === 'PENDING')) creditNotes.push(cn);
    }

    const creditTotal = roundMoney(creditNotes.reduce((sum, cn) => sum + asNumber(cn.amount), 0));
    const totalDeduction = roundMoney(cashAmount + creditTotal);
    if (totalDeduction <= 0) throw new PolicyError('Select an invoice, credit note, or enter an amount.', 400);
    if (totalDeduction > asNumber(supplier.balance) + 0.01) {
      throw new PolicyError(`Payment exceeds supplier balance by Ksh ${roundMoney(totalDeduction - asNumber(supplier.balance)).toLocaleString()}.`, 409);
    }

    let invoicesToAllocate: any[] = [];
    if (purchaseOrderIds.length) {
      for (const poId of purchaseOrderIds) {
        const po = await env.DB.prepare(`
          SELECT id, supplierId, status, paymentStatus, totalAmount, paidAmount, orderDate, receivedDate
          FROM purchaseOrders
          WHERE id = ? AND businessId = ? AND branchId = ?
          LIMIT 1
        `).bind(poId, businessId, branchId).first<any>();
        if (po && po.supplierId === supplierId && po.status === 'RECEIVED' && po.paymentStatus !== 'PAID') invoicesToAllocate.push(po);
      }
    } else {
      const { results } = await env.DB.prepare(`
        SELECT id, supplierId, status, paymentStatus, totalAmount, paidAmount, orderDate, receivedDate
        FROM purchaseOrders
        WHERE supplierId = ? AND businessId = ? AND branchId = ? AND status = 'RECEIVED' AND COALESCE(paymentStatus, 'UNPAID') != 'PAID'
      `).bind(supplierId, businessId, branchId).all();
      invoicesToAllocate = ((results || []) as any[])
        .sort((a, b) => asNumber(a.receivedDate || a.orderDate) - asNumber(b.receivedDate || b.orderDate));
    }

    const paymentId = crypto.randomUUID();
    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO supplierPayments (id, supplierId, purchaseOrderIds, creditNoteIds, amount, paymentMethod, transactionCode, timestamp, reference, source, accountId, branchId, businessId, shiftId, preparedBy, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        paymentId,
        supplierId,
        purchaseOrderIds.length ? JSON.stringify(purchaseOrderIds) : null,
        creditNoteIds.length ? JSON.stringify(creditNoteIds) : null,
        cashAmount,
        method,
        trimText(payment.transactionCode, 80) || null,
        now,
        trimText(payment.reference || 'Supplier payment', 160),
        source,
        source === 'ACCOUNT' ? trimText(payment.accountId, 120) : null,
        branchId,
        businessId,
        body?.shiftId || null,
        trimText(body?.preparedBy || auth.principal.userName, 120),
        now,
      ),
    ];

    for (const cn of creditNotes) {
      statements.push(
        env.DB.prepare(`UPDATE creditNotes SET status = 'ALLOCATED', allocatedTo = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(paymentId, now, cn.id, businessId)
      );
    }

    let remainingPool = totalDeduction;
    let allocatedInvoiceCount = 0;
    for (const inv of invoicesToAllocate) {
      if (remainingPool <= 0) break;
      const due = Math.max(0, asNumber(inv.totalAmount) - asNumber(inv.paidAmount));
      const paymentForThisInv = Math.min(due, remainingPool);
      if (paymentForThisInv <= 0) continue;
      const newPaidAmount = roundMoney(asNumber(inv.paidAmount) + paymentForThisInv);
      statements.push(
        env.DB.prepare(`UPDATE purchaseOrders SET paidAmount = ?, paymentStatus = ?, updated_at = ? WHERE id = ? AND businessId = ? AND branchId = ?`)
          .bind(
            newPaidAmount,
            newPaidAmount >= asNumber(inv.totalAmount) - 0.01 ? 'PAID' : 'PARTIAL',
            now,
            inv.id,
            businessId,
            branchId,
          )
      );
      remainingPool = roundMoney(remainingPool - paymentForThisInv);
      allocatedInvoiceCount += 1;
    }

    statements.push(
      env.DB.prepare(`UPDATE suppliers SET balance = MAX(0, COALESCE(balance, 0) - ?), updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(totalDeduction, now, supplierId, businessId)
    );

    if (source === 'ACCOUNT' && account && cashAmount > 0) {
      statements.push(
        env.DB.prepare(`UPDATE financialAccounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(cashAmount, now, account.id, businessId)
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        now,
        auth.principal.userId || null,
        auth.principal.userName || null,
        'supplier.payment.settle',
        'supplierPayment',
        paymentId,
        'INFO',
        `Settled supplier payment of Ksh ${totalDeduction.toLocaleString()} for ${supplier.company || supplier.name}.`,
        businessId,
        branchId,
        now,
      )
    );

    await env.DB.batch(statements);

    return json({
      success: true,
      paymentId,
      cashAmount,
      creditTotal,
      totalDeduction,
      allocatedInvoiceCount,
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not settle supplier payment.' }, status);
  }
};

