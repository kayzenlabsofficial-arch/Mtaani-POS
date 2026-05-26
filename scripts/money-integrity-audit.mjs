#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const path = process.argv[2];

const money = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const roundMoney = (value) => Math.round(value * 100) / 100;
const parseMaybeJson = (value) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};
const asArray = (value) => {
  const parsed = parseMaybeJson(value);
  return Array.isArray(parsed) ? parsed : [];
};
const lineNet = (item, quantity = money(item?.quantity)) => {
  const price = Math.max(0, money(item?.snapshotPrice));
  const discount = Math.min(price, Math.max(0, money(item?.discountAmount)));
  return roundMoney(Math.max(0, (price - discount) * Math.max(0, quantity)));
};
const refundLineTotal = (refund) => roundMoney(asArray(refund?.items).reduce((sum, item) => sum + money(item?.amount), 0));
const transactionExpectedTotal = (tx) => {
  const subtotal = Math.max(0, money(tx?.subtotal));
  const storedDiscount = Math.max(0, money(tx?.discountAmount ?? tx?.discount));
  const itemDiscount = asArray(tx?.items).reduce((sum, item) => {
    const price = Math.max(0, money(item?.snapshotPrice));
    const discount = Math.min(price, Math.max(0, money(item?.discountAmount)));
    return sum + (discount * Math.max(0, money(item?.quantity)));
  }, 0);
  const discount = Math.max(storedDiscount, itemDiscount);
  if (subtotal > 0 && discount > 0) return roundMoney(Math.max(0, subtotal - discount));
  const itemTotal = asArray(tx?.items).reduce((sum, item) => sum + lineNet(item), 0);
  return itemTotal > 0 ? roundMoney(itemTotal) : roundMoney(Math.max(0, money(tx?.total)));
};
const split = (value) => {
  const parsed = parseMaybeJson(value);
  return parsed?.splitPayments || parsed || {};
};
const creditAmountForSale = (tx) => {
  const method = String(tx?.paymentMethod || '').toUpperCase();
  const total = transactionExpectedTotal(tx);
  if (method === 'CREDIT') return total;
  const details = split(tx?.splitPayments || tx?.splitData);
  if (method === 'SPLIT' && String(details?.secondaryMethod || '').toUpperCase() === 'CREDIT') {
    return roundMoney(Math.min(total, Math.max(0, money(details?.secondaryAmount))));
  }
  return 0;
};

function rows(payload, key) {
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}

function duplicateKeyFindings(records, keyFn, label) {
  const buckets = new Map();
  for (const row of records) {
    const key = keyFn(row);
    if (!key) continue;
    const list = buckets.get(key) || [];
    list.push(row);
    buckets.set(key, list);
  }
  return Array.from(buckets.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({
      type: 'DUPLICATE_REFERENCE',
      severity: 'HIGH',
      message: `${label} ${key} appears ${list.length} times.`,
      ids: list.map(row => row.id).filter(Boolean),
    }));
}

async function main() {
  if (!path) {
    console.log('Usage: npm run audit:money -- <export.json>');
    console.log('The JSON file should contain arrays such as transactions, refunds, customerPayments, salesInvoices, and purchaseOrders.');
    return;
  }

  const payload = JSON.parse(await readFile(path, 'utf8'));
  const transactions = rows(payload, 'transactions');
  const refunds = rows(payload, 'refunds');
  const customerPayments = rows(payload, 'customerPayments');
  const salesInvoices = rows(payload, 'salesInvoices');
  const purchaseOrders = rows(payload, 'purchaseOrders');
  const findings = [];

  const transactionsById = new Map(transactions.map(tx => [String(tx.id || ''), tx]));
  const invoicesById = new Map(salesInvoices.map(invoice => [String(invoice.id || ''), invoice]));
  const refundedByOriginal = new Map();

  for (const tx of transactions) {
    const expected = transactionExpectedTotal(tx);
    const stored = money(tx.total);
    const hasDiscount = money(tx.discountAmount ?? tx.discount) > 0 || asArray(tx.items).some(item => money(item?.discountAmount) > 0);
    if (hasDiscount && Math.abs(stored - expected) > 0.01) {
      findings.push({
        type: 'DISCOUNT_TOTAL_MISMATCH',
        severity: 'HIGH',
        message: `Transaction ${tx.id || '(missing id)'} stores total ${stored} but expected discounted net ${expected}.`,
      });
    }
  }

  for (const refund of refunds) {
    const status = String(refund.status || 'APPROVED').toUpperCase();
    if (status !== 'APPROVED') continue;
    const amount = money(refund.amount);
    const cashAmount = money(refund.cashAmount ?? refund.amount);
    if (String(refund.paymentMethod || '').toUpperCase() !== 'CASH') {
      findings.push({
        type: 'REFUND_NOT_CASH',
        severity: 'HIGH',
        message: `Refund ${refund.refundNumber || refund.id} is marked as ${refund.paymentMethod || '(blank)'} instead of CASH.`,
      });
    }
    if (String(refund.source || '').toUpperCase() !== 'TILL') {
      findings.push({
        type: 'REFUND_NOT_FROM_TILL',
        severity: 'HIGH',
        message: `Refund ${refund.refundNumber || refund.id} source is ${refund.source || '(blank)'} instead of TILL.`,
      });
    }
    if (Math.abs(cashAmount - amount) > 0.01) {
      findings.push({
        type: 'REFUND_CASH_AMOUNT_MISMATCH',
        severity: 'HIGH',
        message: `Refund ${refund.refundNumber || refund.id} has amount ${amount} but cashAmount ${cashAmount}.`,
      });
    }
    if (!String(refund.shiftId || '').trim()) {
      findings.push({
        type: 'REFUND_MISSING_SHIFT',
        severity: 'MEDIUM',
        message: `Refund ${refund.refundNumber || refund.id} has no shiftId, so till cash cannot be tied to a shift.`,
      });
    }

    const itemTotal = refundLineTotal(refund);
    if (asArray(refund.items).length > 0 && Math.abs(itemTotal - amount) > 0.01) {
      findings.push({
        type: 'REFUND_ITEM_TOTAL_MISMATCH',
        severity: 'HIGH',
        message: `Refund ${refund.refundNumber || refund.id} item total ${itemTotal} does not match refund amount ${amount}.`,
      });
    }

    const original = transactionsById.get(String(refund.originalTransactionId || ''));
    if (!original) continue;
    const maxRefund = transactionExpectedTotal(original);
    if (amount > maxRefund + 0.01) {
      findings.push({
        type: 'REFUND_EXCEEDS_ORIGINAL',
        severity: 'HIGH',
        message: `Refund ${refund.refundNumber || refund.id} amount ${amount} exceeds original net sale ${maxRefund}.`,
      });
    }
    const originalId = String(refund.originalTransactionId || '');
    refundedByOriginal.set(originalId, roundMoney((refundedByOriginal.get(originalId) || 0) + amount));
  }

  for (const [originalId, refunded] of refundedByOriginal.entries()) {
    const original = transactionsById.get(originalId);
    if (!original) continue;
    const maxRefund = transactionExpectedTotal(original);
    if (refunded > maxRefund + 0.01) {
      findings.push({
        type: 'REFUND_TOTAL_EXCEEDS_ORIGINAL',
        severity: 'HIGH',
        message: `Approved refunds allocate ${refunded} to sale ${originalId}, above original net sale ${maxRefund}.`,
      });
    }
  }

  findings.push(...duplicateKeyFindings(
    refunds.filter(refund => String(refund.refundNumber || '').trim()),
    refund => `${refund.businessId || 'unknown'}:${String(refund.refundNumber || '').trim().toUpperCase()}`,
    'Refund receipt',
  ));

  findings.push(...duplicateKeyFindings(
    salesInvoices,
    invoice => `${invoice.businessId || 'unknown'}:${String(invoice.invoiceNumber || '').trim().toUpperCase()}`,
    'Sales invoice',
  ));
  findings.push(...duplicateKeyFindings(
    purchaseOrders.filter(po => String(po.invoiceNumber || '').trim()),
    po => `${po.businessId || 'unknown'}:${po.supplierId || 'unknown'}:${String(po.invoiceNumber || '').trim().toUpperCase()}`,
    'Supplier invoice',
  ));

  const paidBySource = new Map();
  for (const payment of customerPayments) {
    const allocations = asArray(payment.allocations);
    const allocationTotal = allocations.reduce((sum, allocation) => sum + money(allocation?.amount), 0);
    if (allocationTotal > money(payment.amount) + 0.01) {
      findings.push({
        type: 'CUSTOMER_PAYMENT_OVERALLOCATED',
        severity: 'HIGH',
        message: `Customer payment ${payment.id || '(missing id)'} allocates ${roundMoney(allocationTotal)} from payment ${money(payment.amount)}.`,
      });
    }
    for (const allocation of allocations) {
      const key = `${String(allocation?.sourceType || '').toUpperCase()}:${allocation?.sourceId || ''}`;
      paidBySource.set(key, roundMoney((paidBySource.get(key) || 0) + money(allocation?.amount)));
    }
  }

  for (const [key, paid] of paidBySource.entries()) {
    const [sourceType, sourceId] = key.split(':');
    if (sourceType === 'SALE') {
      const sale = transactionsById.get(sourceId);
      if (sale && paid > creditAmountForSale(sale) + 0.01) {
        findings.push({
          type: 'CUSTOMER_PAYMENT_EXCEEDS_SALE_DEBT',
          severity: 'HIGH',
          message: `Customer payments allocate ${paid} to sale ${sourceId}, above credit amount ${creditAmountForSale(sale)}.`,
        });
      }
    }
    if (sourceType === 'INVOICE') {
      const invoice = invoicesById.get(sourceId);
      if (invoice && paid > money(invoice.total) + 0.01) {
        findings.push({
          type: 'CUSTOMER_PAYMENT_EXCEEDS_INVOICE',
          severity: 'HIGH',
          message: `Customer payments allocate ${paid} to invoice ${invoice.invoiceNumber || sourceId}, above invoice total ${money(invoice.total)}.`,
        });
      }
    }
  }

  console.log(`Money integrity audit checked ${transactions.length} transactions, ${refunds.length} refunds, ${customerPayments.length} customer payments, ${salesInvoices.length} sales invoices, and ${purchaseOrders.length} purchase orders.`);
  if (findings.length === 0) {
    console.log('No money integrity findings detected.');
    return;
  }
  console.log(JSON.stringify({ findingCount: findings.length, findings }, null, 2));
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
