import { authorizeRequest, canAccessBusiness } from '../authUtils';
import { PolicyError } from '../salesSecurity';

interface Env {
  DB: D1Database;
  API_SECRET?: string;
}

const ALLOWED_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

const corsHeaders = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Business-ID',
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

function asInvoiceAllocations(value: unknown): { purchaseOrderId: string; amount: number }[] {
  if (!Array.isArray(value)) return [];
  const allocations = new Map<string, number>();
  for (const item of value.slice(0, 100)) {
    const purchaseOrderId = String(item?.purchaseOrderId || item?.id || '').trim();
    const amount = roundMoney(asNumber(item?.amount));
    if (!purchaseOrderId || amount <= 0) continue;
    allocations.set(purchaseOrderId, roundMoney((allocations.get(purchaseOrderId) || 0) + amount));
  }
  return Array.from(allocations.entries()).map(([purchaseOrderId, amount]) => ({ purchaseOrderId, amount }));
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function pickedCashAccountId(businessId: string) {
  return trimText(`picked_cash_${businessId}`, 160);
}

async function ensurePickedCashAccount(db: D1Database, businessId: string) {
  const id = pickedCashAccountId(businessId);
  const now = Date.now();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    INSERT OR IGNORE INTO financialAccounts (id, name, type, balance, businessId, accountNumber, updated_at)
    VALUES (?, 'Main account', 'CASH', 0, ?, 'PICKED-CASH', ?)
  `).bind(id, businessId, now).run();
  await db.prepare(`
    UPDATE financialAccounts
    SET name = 'Main account', type = 'CASH', accountNumber = 'PICKED-CASH',
        updated_at = ?
    WHERE id = ? AND businessId = ?
  `).bind(now, id, businessId).run();
  return db.prepare(`
    SELECT id, name, balance
    FROM financialAccounts
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(id, businessId).first<any>();
}

async function ensureSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS supplierPayments (
      id TEXT PRIMARY KEY,
      supplierId TEXT NOT NULL,
      purchaseOrderId TEXT,
      purchaseOrderIds TEXT,
      invoiceAllocations TEXT,
      creditNoteIds TEXT,
      amount REAL NOT NULL,
      paymentMethod TEXT NOT NULL,
      transactionCode TEXT,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      source TEXT,
      accountId TEXT,
      shopId TEXT,
      shiftId TEXT,
      preparedBy TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
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
      updated_at INTEGER
    )
  `).run();

  const paymentColumns = [
    'purchaseOrderId TEXT',
    'purchaseOrderIds TEXT',
    'invoiceAllocations TEXT',
    'creditNoteIds TEXT',
    'reference TEXT',
    'source TEXT',
    'accountId TEXT',
    'shopId TEXT',
    'shiftId TEXT',
    'preparedBy TEXT',
    'businessId TEXT',
    'updated_at INTEGER',
  ];
  for (const column of paymentColumns) {
    try { await db.prepare(`ALTER TABLE supplierPayments ADD COLUMN ${column}`).run(); } catch {}
  }
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
    const shopId = trimText(body?.shopId || 'single-shop', 160);
    const supplierId = String(body?.supplierId || body?.supplier?.id || '').trim();
    const payment = body?.payment || {};
    if (!businessId || !supplierId) return json({ error: 'Business and supplier are required.' }, 400);
    if (!canAccessBusiness(auth.principal, businessId)) {
      return json({ error: 'Access denied.' }, 403);
    }

    await ensureSchema(env.DB);
    const supplier = await env.DB.prepare(`
      SELECT id, name, company, balance
      FROM suppliers
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(supplierId, businessId).first<any>();
    if (!supplier) throw new PolicyError('Supplier was not found.', 404);

    const cashAmount = roundMoney(Math.max(0, asNumber(payment.amount)));
    const source = String(payment.source || 'TILL').toUpperCase() === 'ACCOUNT' ? 'ACCOUNT' : 'TILL';
    const method = String(payment.method || 'CASH').toUpperCase();
    const purchaseOrderIds = asStringArray(payment.purchaseOrderIds);
    const requestedInvoiceAllocations = asInvoiceAllocations(payment.invoiceAllocations);
    const creditNoteIds = asStringArray(payment.creditNoteIds);

    let account: any = null;
    if (source === 'ACCOUNT' && cashAmount > 0) {
      account = await ensurePickedCashAccount(env.DB, businessId);
      if (!account) throw new PolicyError('Selected account was not found.', 404);
      if (asNumber(account.balance) < cashAmount) throw new PolicyError(`Insufficient funds in "${account.name}".`, 409);
    }

    const creditNotes: any[] = [];
    for (const creditNoteId of creditNoteIds) {
      const cn = await env.DB.prepare(`
        SELECT id, amount, supplierId, status
        FROM creditNotes
        WHERE id = ? AND businessId = ?
        LIMIT 1
      `).bind(creditNoteId, businessId).first<any>();
      if (cn && cn.supplierId === supplierId && (!cn.status || cn.status === 'PENDING')) creditNotes.push(cn);
    }

    const creditTotal = roundMoney(creditNotes.reduce((sum, cn) => sum + asNumber(cn.amount), 0));

    const fetchInvoice = async (poId: string) => env.DB.prepare(`
      SELECT id, supplierId, status, paymentStatus, totalAmount, paidAmount, orderDate, receivedDate, invoiceNumber, poNumber
      FROM purchaseOrders
      WHERE id = ? AND businessId = ?
      LIMIT 1
    `).bind(poId, businessId).first<any>();

    let invoicesToAllocate: Array<any & { allocationAmount?: number }> = [];
    let storedInvoiceAllocations: { purchaseOrderId: string; amount: number; invoiceNumber?: string; poNumber?: string }[] = [];
    let totalDeduction = roundMoney(cashAmount + creditTotal);

    if (requestedInvoiceAllocations.length) {
      let allocationTotal = 0;
      for (const allocation of requestedInvoiceAllocations) {
        const po = await fetchInvoice(allocation.purchaseOrderId);
        if (!po) throw new PolicyError('One of the selected invoices was not found.', 404);
        if (po.supplierId !== supplierId) throw new PolicyError('One selected invoice belongs to another supplier.', 403);
        if (po.status !== 'RECEIVED' || po.paymentStatus === 'PAID') {
          throw new PolicyError('One selected invoice is not open for payment.', 409);
        }

        const due = roundMoney(Math.max(0, asNumber(po.totalAmount) - asNumber(po.paidAmount)));
        if (allocation.amount > due + 0.01) {
          const ref = po.invoiceNumber || po.poNumber || po.id.split('-')[0].toUpperCase();
          throw new PolicyError(`Payment for invoice ${ref} exceeds the remaining balance.`, 409);
        }

        allocationTotal = roundMoney(allocationTotal + allocation.amount);
        invoicesToAllocate.push({ ...po, allocationAmount: allocation.amount });
        storedInvoiceAllocations.push({
          purchaseOrderId: po.id,
          amount: allocation.amount,
          invoiceNumber: po.invoiceNumber || undefined,
          poNumber: po.poNumber || undefined,
        });
      }

      if (creditTotal > allocationTotal + 0.01) {
        throw new PolicyError('Selected credits exceed the invoice amounts. Add another invoice or reduce the credit selection.', 409);
      }
      const expectedCashAmount = roundMoney(Math.max(0, allocationTotal - creditTotal));
      if (Math.abs(cashAmount - expectedCashAmount) > 0.01) {
        throw new PolicyError(`Cash amount must be Ksh ${expectedCashAmount.toLocaleString()} for the selected invoice allocations.`, 409);
      }
      totalDeduction = allocationTotal;
    } else if (purchaseOrderIds.length) {
      for (const poId of purchaseOrderIds) {
        const po = await fetchInvoice(poId);
        if (po && po.supplierId === supplierId && po.status === 'RECEIVED' && po.paymentStatus !== 'PAID') invoicesToAllocate.push(po);
      }
    } else {
      const { results } = await env.DB.prepare(`
        SELECT id, supplierId, status, paymentStatus, totalAmount, paidAmount, orderDate, receivedDate, invoiceNumber, poNumber
        FROM purchaseOrders
        WHERE supplierId = ? AND businessId = ? AND status = 'RECEIVED' AND COALESCE(paymentStatus, 'UNPAID') != 'PAID'
      `).bind(supplierId, businessId).all();
      invoicesToAllocate = ((results || []) as any[])
        .sort((a, b) => asNumber(a.receivedDate || a.orderDate) - asNumber(b.receivedDate || b.orderDate));
    }

    if (totalDeduction <= 0) throw new PolicyError('Select an invoice, credit note, or enter an amount.', 400);
    if (totalDeduction > asNumber(supplier.balance) + 0.01) {
      throw new PolicyError(`Payment exceeds supplier balance by Ksh ${roundMoney(totalDeduction - asNumber(supplier.balance)).toLocaleString()}.`, 409);
    }

    const paymentId = crypto.randomUUID();
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];

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
      const paymentForThisInv = roundMoney(Math.min(due, inv.allocationAmount ?? remainingPool));
      if (paymentForThisInv <= 0) continue;
      const newPaidAmount = roundMoney(asNumber(inv.paidAmount) + paymentForThisInv);
      if (!requestedInvoiceAllocations.length) {
        storedInvoiceAllocations.push({
          purchaseOrderId: inv.id,
          amount: paymentForThisInv,
          invoiceNumber: inv.invoiceNumber || undefined,
          poNumber: inv.poNumber || undefined,
        });
      }
      statements.push(
        env.DB.prepare(`UPDATE purchaseOrders SET paidAmount = ?, paymentStatus = ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(
            newPaidAmount,
            newPaidAmount >= asNumber(inv.totalAmount) - 0.01 ? 'PAID' : 'PARTIAL',
            now,
            inv.id,
            businessId, )
      );
      remainingPool = roundMoney(remainingPool - paymentForThisInv);
      allocatedInvoiceCount += 1;
    }

    const storedPurchaseOrderIds = storedInvoiceAllocations.map(allocation => allocation.purchaseOrderId);
    statements.unshift(
      env.DB.prepare(`
        INSERT INTO supplierPayments (id, supplierId, purchaseOrderId, purchaseOrderIds, invoiceAllocations, creditNoteIds, amount, paymentMethod, transactionCode, timestamp, reference, source, accountId, shopId, businessId, shiftId, preparedBy, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        paymentId,
        supplierId,
        storedPurchaseOrderIds[0] || null,
        storedPurchaseOrderIds.length ? JSON.stringify(storedPurchaseOrderIds) : (purchaseOrderIds.length ? JSON.stringify(purchaseOrderIds) : null),
        storedInvoiceAllocations.length ? JSON.stringify(storedInvoiceAllocations) : null,
        creditNoteIds.length ? JSON.stringify(creditNoteIds) : null,
        cashAmount,
        method,
        trimText(payment.transactionCode, 80) || null,
        now,
        trimText(payment.reference || 'Supplier payment', 160),
        source,
        source === 'ACCOUNT' ? pickedCashAccountId(businessId) : null,
        shopId,
        businessId,
        body?.shiftId || null,
        trimText(body?.preparedBy || auth.principal.userName, 120),
        now,
      )
    );

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
        INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        businessId, now,
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
      invoiceAllocations: storedInvoiceAllocations,
    });
  } catch (err: any) {
    const status = err instanceof PolicyError ? err.status : 500;
    return json({ error: err?.message || 'Could not settle supplier payment.' }, status);
  }
};
