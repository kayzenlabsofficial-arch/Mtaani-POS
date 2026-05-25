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
    const original = transactionsById.get(String(refund.originalTransactionId || ''));
    if (!original) continue;
    const maxRefund = transactionExpectedTotal(original);
    if (money(refund.amount) > maxRefund + 0.01) {
      findings.push({
        type: 'REFUND_EXCEEDS_ORIGINAL',
        severity: 'HIGH',
        message: `Refund ${refund.refundNumber || refund.id} amount ${money(refund.amount)} exceeds original net sale ${maxRefund}.`,
      });
    }
  }

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
