import type { Principal } from '../authUtils';
import { PolicyError } from '../salesSecurity';

type RefundLine = { productId: string; quantity: number };

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function trimText(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

function asArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function deserializeRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))) {
      try { out[k] = JSON.parse(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function ensureRefundSchema(db: D1Database) {
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
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stockMovements (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      reference TEXT,
      branchId TEXT,
      businessId TEXT,
      shiftId TEXT,
      updated_at INTEGER
    )
  `).run();
}

async function loadTransaction(db: D1Database, businessId: string, branchId: string, transactionId: string) {
  const row = await db.prepare(`
    SELECT *
    FROM transactions
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(transactionId, businessId, branchId).first<any>();
  if (!row) throw new PolicyError('Receipt was not found.', 404);
  return deserializeRow(row);
}

function refundLinesFor(transaction: any, itemsToReturn?: RefundLine[]): RefundLine[] {
  const txItems = asArray(transaction.items);
  const sourceLines = itemsToReturn?.length
    ? itemsToReturn
    : asArray(transaction.pendingRefundItems).length
      ? asArray(transaction.pendingRefundItems)
      : txItems.map(item => ({
          productId: item.productId,
          quantity: Math.max(0, asNumber(item.quantity) - asNumber(item.returnedQuantity)),
        }));

  const lines = sourceLines
    .map(line => ({
      productId: trimText(line.productId, 120),
      quantity: Math.max(0, asNumber(line.quantity)),
    }))
    .filter(line => line.productId && line.quantity > 0);

  for (const line of lines) {
    const item = txItems.find(row => row.productId === line.productId);
    if (!item) throw new PolicyError('Refund includes an item that is not on the receipt.', 400);
    const remaining = Math.max(0, asNumber(item.quantity) - asNumber(item.returnedQuantity));
    if (line.quantity > remaining + 0.0001) throw new PolicyError('Refund quantity exceeds the remaining receipt quantity.', 409);
  }

  return lines;
}

function refundAmountFor(transaction: any, lines: RefundLine[]) {
  const txItems = asArray(transaction.items);
  const amount = lines.reduce((sum, line) => {
    const item = txItems.find(row => row.productId === line.productId);
    return sum + (asNumber(item?.snapshotPrice) * line.quantity);
  }, 0);
  return roundMoney(Math.min(asNumber(transaction.total), amount || asNumber(transaction.total)));
}

function isBundle(product: any) {
  return product?.isBundle === 1 || product?.isBundle === true || product?.isBundle === '1';
}

async function productById(db: D1Database, businessId: string, productId: string) {
  const row = await db.prepare(`
    SELECT id, name, branchId, stockQuantity, isBundle, components
    FROM products
    WHERE id = ? AND businessId = ?
    LIMIT 1
  `).bind(productId, businessId).first<any>();
  return row ? deserializeRow(row) : null;
}

function componentsFromProduct(product: any): RefundLine[] {
  return asArray(product.components)
    .map(component => ({
      productId: trimText(component?.productId || component?.ingredientProductId, 120),
      quantity: asNumber(component?.quantity),
    }))
    .filter(component => component.productId && component.quantity > 0);
}

async function loadBundleComponents(db: D1Database, businessId: string, product: any): Promise<RefundLine[]> {
  const { results } = await db.prepare(`
    SELECT ingredientProductId, quantity
    FROM productIngredients
    WHERE businessId = ? AND productId = ?
  `).bind(businessId, product.id).all();
  const rows = ((results || []) as any[])
    .map(row => ({
      productId: trimText(row.ingredientProductId, 120),
      quantity: asNumber(row.quantity),
    }))
    .filter(row => row.productId && row.quantity > 0);
  return rows.length ? rows : componentsFromProduct(product);
}

function auditStatement(db: D1Database, args: {
  principal: Principal;
  businessId: string;
  branchId: string;
  transactionId: string;
  action: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  details: string;
}) {
  const now = Date.now();
  return db.prepare(`
    INSERT INTO auditLogs (id, ts, userId, userName, action, entity, entityId, severity, details, businessId, branchId, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    now,
    args.principal.userId || null,
    args.principal.userName || null,
    args.action,
    'transaction',
    args.transactionId,
    args.severity,
    args.details,
    args.businessId,
    args.branchId,
    now,
  );
}

export async function prepareRefundRequest(db: D1Database, args: {
  businessId: string;
  branchId: string;
  principal: Principal;
  transactionId: string;
  itemsToReturn?: RefundLine[];
}) {
  const tx = await loadTransaction(db, args.businessId, args.branchId, args.transactionId);
  if (tx.status !== 'PAID' && tx.status !== 'PARTIAL_REFUND') {
    throw new PolicyError('Only paid receipts can be refunded.', 409);
  }
  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError('No refundable items selected.', 400);
  const now = Date.now();
  tx.status = 'PENDING_REFUND';
  tx.pendingRefundItems = lines;
  tx.updated_at = now;

  const statements = [
    db.prepare(`
      UPDATE transactions
      SET status = 'PENDING_REFUND', pendingRefundItems = ?, updated_at = ?
      WHERE id = ? AND businessId = ? AND branchId = ?
    `).bind(JSON.stringify(lines), now, tx.id, args.businessId, args.branchId),
    auditStatement(db, {
      principal: args.principal,
      businessId: args.businessId,
      branchId: args.branchId,
      transactionId: tx.id,
      action: 'sale.refund.request',
      severity: 'WARN',
      details: `Refund request submitted for Ksh ${refundAmountFor(tx, lines).toLocaleString()}.`,
    }),
  ];
  return { transaction: tx, statements };
}

export async function prepareRefundApproval(db: D1Database, args: {
  businessId: string;
  branchId: string;
  principal: Principal;
  service: boolean;
  transactionId: string;
  itemsToReturn?: RefundLine[];
  approvedBy?: string;
}) {
  if (!args.service && !APPROVER_ROLES.has(args.principal.role)) {
    throw new PolicyError('You are not allowed to approve refunds.', 403);
  }

  const tx = await loadTransaction(db, args.businessId, args.branchId, args.transactionId);
  if (tx.status !== 'PENDING_REFUND' && tx.status !== 'PAID' && tx.status !== 'PARTIAL_REFUND') {
    throw new PolicyError('This receipt is not waiting for refund approval.', 409);
  }

  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError('No refundable items selected.', 400);
  const refundAmount = refundAmountFor(tx, lines);
  const statements: D1PreparedStatement[] = [];
  const now = Date.now();

  if (String(tx.paymentMethod || '').toUpperCase() === 'CASH') {
    const cashAccount = await db.prepare(`
      SELECT id, balance
      FROM financialAccounts
      WHERE businessId = ? AND branchId = ? AND type = 'CASH'
      LIMIT 1
    `).bind(args.businessId, args.branchId).first<any>();
    if (cashAccount) {
      if (asNumber(cashAccount.balance) < refundAmount) throw new PolicyError('Insufficient cash account balance for this refund.', 409);
      statements.push(
        db.prepare(`UPDATE financialAccounts SET balance = balance - ?, updated_at = ? WHERE id = ? AND businessId = ?`)
          .bind(refundAmount, now, cashAccount.id, args.businessId)
      );
    }
  }

  const movementDedupe = new Map<string, number>();
  for (const line of lines) {
    const product = await productById(db, args.businessId, line.productId);
    if (!product) continue;
    if (product.branchId && product.branchId !== args.branchId) throw new PolicyError('Refund item belongs to another branch.', 403);

    if (isBundle(product)) {
      const components = await loadBundleComponents(db, args.businessId, product);
      if (components.length === 0) throw new PolicyError(`${product.name} has no ingredients configured.`, 400);
      for (const component of components) {
        movementDedupe.set(component.productId, (movementDedupe.get(component.productId) || 0) + component.quantity * line.quantity);
      }
    } else {
      movementDedupe.set(line.productId, (movementDedupe.get(line.productId) || 0) + line.quantity);
    }
  }

  const txRef = String(tx.id).split('-')[0].toUpperCase();
  for (const [productId, quantity] of movementDedupe.entries()) {
    statements.push(
      db.prepare(`UPDATE products SET stockQuantity = stockQuantity + ?, updated_at = ? WHERE id = ? AND businessId = ?`)
        .bind(quantity, now, productId, args.businessId)
    );
    statements.push(
      db.prepare(`
        INSERT INTO stockMovements (id, productId, type, quantity, timestamp, reference, branchId, businessId, shiftId, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        productId,
        'RETURN',
        quantity,
        now,
        `Return #${txRef}`,
        args.branchId,
        args.businessId,
        tx.shiftId || null,
        now,
      )
    );
  }

  const updatedItems = asArray(tx.items).map(item => ({ ...item }));
  for (const line of lines) {
    const item = updatedItems.find(row => row.productId === line.productId);
    if (item) item.returnedQuantity = asNumber(item.returnedQuantity) + line.quantity;
  }
  const allReturned = updatedItems.every(item => asNumber(item.returnedQuantity) >= asNumber(item.quantity));
  tx.items = updatedItems;
  tx.status = allReturned ? 'REFUNDED' : 'PARTIAL_REFUND';
  tx.pendingRefundItems = undefined;
  tx.approvedBy = trimText(args.approvedBy || args.principal.userName, 120);
  tx.updated_at = now;

  statements.push(
    db.prepare(`
      UPDATE transactions
      SET status = ?, items = ?, pendingRefundItems = NULL, approvedBy = ?, updated_at = ?
      WHERE id = ? AND businessId = ? AND branchId = ?
    `).bind(tx.status, JSON.stringify(updatedItems), tx.approvedBy, now, tx.id, args.businessId, args.branchId)
  );
  statements.push(auditStatement(db, {
    principal: args.principal,
    businessId: args.businessId,
    branchId: args.branchId,
    transactionId: tx.id,
    action: 'sale.refund.approve',
    severity: 'INFO',
    details: `Refund approved for Ksh ${refundAmount.toLocaleString()}.`,
  }));

  return { transaction: tx, statements };
}

