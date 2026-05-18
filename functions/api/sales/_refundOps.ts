import type { Principal } from '../_authUtils';
import { PolicyError } from '../_salesSecurity';

type RefundLine = { productId: string; quantity: number };

const APPROVER_ROLES = new Set(['ROOT', 'ADMIN', 'MANAGER']);

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000000) / 1000000;
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
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      total REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      discountAmount REAL,
      discountReason TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      timestamp INTEGER NOT NULL,
      status TEXT NOT NULL,
      paymentMethod TEXT,
      amountTendered REAL,
      changeGiven REAL,
      mpesaReference TEXT,
      mpesaCode TEXT,
      mpesaCustomer TEXT,
      mpesaCheckoutRequestId TEXT,
      cashierId TEXT,
      cashierName TEXT,
      customerId TEXT,
      customerName TEXT,
      discount REAL,
      discountType TEXT,
      splitPayments TEXT,
      splitData TEXT,
      isSynced INTEGER,
      approvedBy TEXT,
      pendingRefundItems TEXT,
      shiftId TEXT,
      branchId TEXT,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      sellingPrice REAL NOT NULL DEFAULT 0,
      costPrice REAL,
      taxCategory TEXT NOT NULL DEFAULT 'A',
      stockQuantity REAL NOT NULL DEFAULT 0,
      unit TEXT,
      barcode TEXT NOT NULL DEFAULT '',
      imageUrl TEXT,
      reorderPoint REAL,
      expiryTracking INTEGER DEFAULT 0,
      expiryDate INTEGER,
      isBundle INTEGER DEFAULT 0,
      components TEXT,
      businessId TEXT,
      branchId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS productIngredients (
      id TEXT PRIMARY KEY,
      productId TEXT NOT NULL,
      ingredientProductId TEXT NOT NULL,
      quantity REAL NOT NULL,
      businessId TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS financialAccounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      balance REAL NOT NULL DEFAULT 0,
      businessId TEXT,
      branchId TEXT,
      accountNumber TEXT,
      updated_at INTEGER
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotencyKeys (
      id TEXT PRIMARY KEY,
      businessId TEXT NOT NULL,
      branchId TEXT NOT NULL,
      idempotencyKey TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT,
      cashierName TEXT,
      transactionId TEXT,
      createdAt INTEGER NOT NULL
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
  for (const sql of [
    'ALTER TABLE transactions ADD COLUMN approvedBy TEXT',
    'ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT',
    'ALTER TABLE transactions ADD COLUMN branchId TEXT',
    'ALTER TABLE transactions ADD COLUMN businessId TEXT',
    'ALTER TABLE transactions ADD COLUMN shiftId TEXT',
    'ALTER TABLE transactions ADD COLUMN updated_at INTEGER',
    'ALTER TABLE products ADD COLUMN businessId TEXT',
    'ALTER TABLE products ADD COLUMN branchId TEXT',
    'ALTER TABLE products ADD COLUMN expiryTracking INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN expiryDate INTEGER',
    'ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN components TEXT',
    'ALTER TABLE products ADD COLUMN updated_at INTEGER',
    'ALTER TABLE productIngredients ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN reference TEXT',
    'ALTER TABLE stockMovements ADD COLUMN branchId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN businessId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN shiftId TEXT',
    'ALTER TABLE stockMovements ADD COLUMN updated_at INTEGER',
    'ALTER TABLE financialAccounts ADD COLUMN branchId TEXT',
    'ALTER TABLE financialAccounts ADD COLUMN updated_at INTEGER',
    'ALTER TABLE idempotencyKeys ADD COLUMN transactionId TEXT',
    'CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey)',
    'CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_transaction ON idempotencyKeys(businessId, branchId, transactionId)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
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

function normalizeRefundLines(lines: RefundLine[]): RefundLine[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    const productId = trimText(line.productId, 120);
    const quantity = Math.max(0, asNumber(line.quantity));
    if (!productId || quantity <= 0) continue;
    merged.set(productId, roundQuantity((merged.get(productId) || 0) + quantity));
  }
  return Array.from(merged.entries())
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function refundLineKey(lines: RefundLine[]) {
  return normalizeRefundLines(lines)
    .map(line => `${line.productId}:${line.quantity}`)
    .join('|');
}

function sameRefundLines(left: RefundLine[], right: RefundLine[]) {
  return refundLineKey(left) === refundLineKey(right);
}

async function loadIdempotentRefundTransaction(
  db: D1Database,
  businessId: string,
  branchId: string,
  idempotencyKey?: string,
) {
  const cleanKey = trimText(idempotencyKey, 240);
  if (!cleanKey) return null;
  const rowId = `${businessId}|${branchId}|${cleanKey}`;
  const row = await db.prepare(`
    SELECT operation, transactionId
    FROM idempotencyKeys
    WHERE id = ? AND businessId = ? AND branchId = ?
    LIMIT 1
  `).bind(rowId, businessId, branchId).first<any>();
  if (!row) return null;
  if (row.operation !== 'sales.refund.approve') {
    throw new PolicyError('Refund retry key is already used for another operation.', 409);
  }
  const transactionId = trimText(row.transactionId, 120);
  if (!transactionId) throw new PolicyError('Refund retry key is already used.', 409);
  return loadTransaction(db, businessId, branchId, transactionId);
}

function idempotencyStatement(db: D1Database, args: {
  businessId: string;
  branchId: string;
  transactionId: string;
  idempotencyKey?: string;
  cashierName?: string | null;
}) {
  const cleanKey = trimText(args.idempotencyKey, 240);
  if (!cleanKey) return null;
  const rowId = `${args.businessId}|${args.branchId}|${cleanKey}`;
  return db.prepare(`
    INSERT INTO idempotencyKeys (id, businessId, branchId, idempotencyKey, operation, deviceId, cashierName, transactionId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    rowId,
    args.businessId,
    args.branchId,
    cleanKey,
    'sales.refund.approve',
    null,
    args.cashierName || null,
    args.transactionId,
    Date.now(),
  );
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
  if (tx.status === 'PENDING_REFUND') {
    const pendingLines = normalizeRefundLines(asArray(tx.pendingRefundItems));
    const requestedLines = args.itemsToReturn?.length
      ? refundLinesFor(tx, args.itemsToReturn)
      : pendingLines;
    if (pendingLines.length > 0 && sameRefundLines(pendingLines, requestedLines)) {
      tx.pendingRefundItems = pendingLines;
      return { transaction: tx, statements: [], idempotent: true };
    }
    throw new PolicyError('A different refund request is already pending for this receipt.', 409);
  }
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
  return { transaction: tx, statements, idempotent: false };
}

export async function prepareRefundApproval(db: D1Database, args: {
  businessId: string;
  branchId: string;
  principal: Principal;
  service: boolean;
  transactionId: string;
  itemsToReturn?: RefundLine[];
  approvedBy?: string;
  idempotencyKey?: string;
}) {
  if (!args.service && !APPROVER_ROLES.has(args.principal.role)) {
    throw new PolicyError('You are not allowed to approve refunds.', 403);
  }

  if (!trimText(args.idempotencyKey, 240)) {
    throw new PolicyError('Refund approval retry key is required.', 400);
  }

  const idempotentTransaction = await loadIdempotentRefundTransaction(
    db,
    args.businessId,
    args.branchId,
    args.idempotencyKey,
  );
  if (idempotentTransaction) {
    return { transaction: idempotentTransaction, statements: [], idempotent: true };
  }

  const tx = await loadTransaction(db, args.businessId, args.branchId, args.transactionId);
  if (tx.status !== 'PENDING_REFUND' && tx.status !== 'PAID' && tx.status !== 'PARTIAL_REFUND') {
    throw new PolicyError('This receipt is not waiting for refund approval.', 409);
  }
  if (tx.status !== 'PENDING_REFUND' && !args.itemsToReturn?.length) {
    throw new PolicyError('Select the items to refund.', 400);
  }

  const lines = refundLinesFor(tx, args.itemsToReturn);
  if (lines.length === 0) throw new PolicyError('No refundable items selected.', 400);
  const refundAmount = refundAmountFor(tx, lines);
  const statements: D1PreparedStatement[] = [];
  const now = Date.now();
  const idemStatement = idempotencyStatement(db, {
    businessId: args.businessId,
    branchId: args.branchId,
    transactionId: tx.id,
    idempotencyKey: args.idempotencyKey,
    cashierName: args.principal.userName || null,
  });
  if (idemStatement) statements.push(idemStatement);

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

  return { transaction: tx, statements, idempotent: false };
}
