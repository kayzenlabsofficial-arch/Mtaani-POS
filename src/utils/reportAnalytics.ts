import {
  cashRefundAmount,
  lineNetRevenueForTransaction,
  lineTaxForTransaction,
  netItemQuantity,
  paymentAmountForMethod,
  roundMoney,
  splitPaymentDetails,
  transactionItems,
  transactionNetMetrics,
  transactionOriginalNetTotal,
  type TenderMethod,
  type TransactionLike,
} from './posMoney';
import {
  calculateProfitLossPeriod,
  creditSalesAmountForTransaction,
  invoiceItemUnitCost,
  invoiceItems,
  reportableTransaction,
  transactionItemUnitCost,
  type ProfitLossInvoiceLike,
  type ProfitLossProductLike,
  type ProfitLossPurchaseOrderLike,
} from './profitLoss';
import { isApprovedExpense, normalizeExpenseSource } from './expenseIntegrity';

export type ReportPeriodBounds = {
  start: number;
  end: number;
  label?: string;
};

export type ReportTrendBucket = {
  name: string;
  start: number;
  end: number;
  revenue: number;
  orders: number;
};

export type ReportTenderTotals = {
  cashSales: number;
  mpesaSales: number;
  pdqSales: number;
  creditSales: number;
  invoiceCreditSales: number;
  customerCashPayments: number;
  customerMpesaPayments: number;
  customerPdqPayments: number;
  customerOtherPayments: number;
  collectionsTotal: number;
};

export type ReportProductPerformanceRow = {
  id: string;
  name: string;
  group: string;
  unit: string;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number;
  tax: number;
  stock: number | null;
  reorderPoint?: number | string | null;
  source: 'Product' | 'Service' | 'Custom';
  avgPrice: number;
  margin: number;
  share: number;
};

export type ReportCashierPerformanceRow = {
  name: string;
  revenue: number;
  orders: number;
  averageBasket: number;
};

export type ReportCategoryPerformanceRow = {
  name: string;
  revenue: number;
  cogs: number;
  profit: number;
  tax: number;
  qty: number;
  margin: number;
  share: number;
};

export type CloseReportTotals = {
  txs: any[];
  invoices: any[];
  expenses: any[];
  picks: any[];
  refunds: any[];
  supplierPayments: any[];
  customerPayments: any[];
  openingCash: number;
  grossSales: number;
  totalSales: number;
  taxTotal: number;
  cashSales: number;
  customerCashPayments: number;
  mpesaSales: number;
  customerMpesaPayments: number;
  pdqSales: number;
  totalExpenses: number;
  supplierPaymentsTotal: number;
  remittanceTotal: number;
  totalPicks: number;
  totalRefunds: number;
  cashRefunds: number;
  expectedBeforePicks: number;
  expectedCash: number;
};

type ReportTransactionLike = TransactionLike & {
  id?: string;
  timestamp?: number | string | null;
  cashierName?: string | null;
  shiftId?: string | null;
};

type ReportInvoiceLike = ProfitLossInvoiceLike & {
  invoiceNumber?: string | null;
  issueDate?: number | string | null;
  timestamp?: number | string | null;
  preparedBy?: string | null;
  shiftId?: string | null;
};

type ReportProductLike = ProfitLossProductLike & {
  id?: string;
  name?: string;
  category?: string | null;
  unit?: string | null;
  stockQuantity?: number | string | null;
  reorderPoint?: number | string | null;
};

type ReportPaymentLike = {
  amount?: number | string | null;
  timestamp?: number | string | null;
  paymentMethod?: string | null;
  shiftId?: string | null;
};

type MoneyMovementLike = {
  amount?: number | string | null;
  cashAmount?: number | string | null;
  timestamp?: number | string | null;
  issueDate?: number | string | null;
  source?: string | null;
  status?: string | null;
  shiftId?: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function moneyNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveMoney(value: unknown): number {
  return Math.max(0, moneyNumber(value));
}

function inBounds(timestamp: unknown, bounds: ReportPeriodBounds): boolean {
  const ts = moneyNumber(timestamp);
  return ts >= bounds.start && ts <= bounds.end;
}

function recordTimestamp(record: any): number {
  return moneyNumber(record?.timestamp ?? record?.issueDate ?? record?.orderDate ?? record?.receivedDate ?? record?.updated_at);
}

function invoiceTimestamp(invoice: ReportInvoiceLike): number {
  return moneyNumber(invoice?.issueDate ?? invoice?.timestamp);
}

function activeInvoice(invoice: ReportInvoiceLike | null | undefined): boolean {
  return String(invoice?.status || '').toUpperCase() !== 'CANCELLED';
}

function closeReportableTransaction(transaction: { status?: string | null }): boolean {
  return !['VOIDED', 'QUOTE'].includes(String(transaction?.status || '').toUpperCase());
}

function approvedMoneyStatus(record: { status?: string | null }): boolean {
  return isApprovedExpense(record);
}

function invoiceBaseLineAmount(item: any): number {
  return roundMoney(positiveMoney(item?.quantity) * positiveMoney(item?.unitPrice));
}

function invoiceTaxableBase(invoice: ReportInvoiceLike): number {
  return invoiceItems(invoice).reduce((sum, item) => (
    String(item?.taxCategory || '').toUpperCase() === 'A'
      ? sum + invoiceBaseLineAmount(item)
      : sum
  ), 0);
}

function invoiceItemTax(invoice: ReportInvoiceLike, item: any): number {
  if (String(item?.taxCategory || '').toUpperCase() !== 'A') return 0;
  const storedTax = positiveMoney(invoice?.tax);
  const base = invoiceBaseLineAmount(item);
  const taxableBase = invoiceTaxableBase(invoice);
  if (storedTax > 0 && taxableBase > 0) return roundMoney(storedTax * (base / taxableBase));
  return roundMoney(base * 0.16);
}

function productById(products: ReportProductLike[]): Map<string, ReportProductLike> {
  const map = new Map<string, ReportProductLike>();
  for (const product of products || []) {
    const id = String(product?.id || '').trim();
    if (id) map.set(id, product);
  }
  return map;
}

function productRowKeyForInvoiceItem(item: any, source: ReportProductPerformanceRow['source'], product?: ReportProductLike) {
  const itemId = String(item?.itemId || item?.productId || '').trim();
  if (product?.id) return String(product.id);
  if (itemId) return itemId;
  return `${source}:${String(item?.name || 'Item').trim().toLowerCase()}`;
}

function makePeriodRows(bounds: ReportPeriodBounds, rangeHint?: string): Array<{ start: number; end: number; name: string }> {
  const now = Date.now();
  const end = bounds.end > 0 ? bounds.end : now;
  const start = bounds.start > 0 ? bounds.start : new Date(new Date(end).getFullYear(), new Date(end).getMonth() - 11, 1).getTime();
  const spanDays = Math.max(1, Math.ceil((end - start + 1) / DAY_MS));
  const useMonthly = ['ALL', 'QUARTER', 'MONTHLY'].includes(String(rangeHint || '').toUpperCase()) || spanDays > 45;

  if (useMonthly) {
    const rows: Array<{ start: number; end: number; name: string }> = [];
    const cursor = new Date(start);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end && rows.length < 12) {
      const rowStart = new Date(cursor);
      const rowEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
      rows.push({
        start: Math.max(rowStart.getTime(), start),
        end: Math.min(rowEnd.getTime(), end),
        name: rowStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return rows;
  }

  const rows: Array<{ start: number; end: number; name: string }> = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= end) {
    const rowStart = new Date(cursor);
    const rowEnd = new Date(cursor);
    rowEnd.setHours(23, 59, 59, 999);
    rows.push({
      start: Math.max(rowStart.getTime(), start),
      end: Math.min(rowEnd.getTime(), end),
      name: rowStart.toLocaleDateString('en-US', spanDays <= 8 ? { weekday: 'short' } : { day: '2-digit', month: 'short' }),
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

export function filterReportTransactions(transactions: ReportTransactionLike[] = [], bounds: ReportPeriodBounds): ReportTransactionLike[] {
  return transactions.filter(transaction => inBounds(transaction?.timestamp, bounds) && reportableTransaction(transaction));
}

export function filterReportInvoices(invoices: ReportInvoiceLike[] = [], bounds: ReportPeriodBounds): ReportInvoiceLike[] {
  return invoices.filter(invoice => inBounds(invoiceTimestamp(invoice), bounds) && activeInvoice(invoice));
}

export function buildSalesTrendBuckets(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  bounds: ReportPeriodBounds;
  rangeHint?: string;
}): ReportTrendBucket[] {
  const rows = makePeriodRows(args.bounds, args.rangeHint);
  const transactions = args.transactions || [];
  const invoices = args.salesInvoices || [];
  return rows.map(row => {
    const rowBounds = { start: row.start, end: row.end };
    const txs = filterReportTransactions(transactions, rowBounds);
    const invoiceRows = filterReportInvoices(invoices, rowBounds);
    const revenue = roundMoney(
      txs.reduce((sum, tx) => sum + transactionNetMetrics(tx).netTotal, 0)
      + invoiceRows.reduce((sum, invoice) => sum + positiveMoney(invoice?.total), 0),
    );
    return {
      name: row.name,
      start: row.start,
      end: row.end,
      revenue,
      orders: txs.filter(tx => transactionNetMetrics(tx).netTotal > 0).length
        + invoiceRows.filter(invoice => positiveMoney(invoice?.total) > 0).length,
    };
  });
}

export function buildHourlySalesData(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  bounds: ReportPeriodBounds;
}): Array<{ name: string; hour: number; revenue: number }> {
  const rows = Array.from({ length: 24 }, (_, hour) => ({ name: `${String(hour).padStart(2, '0')}:00`, hour, revenue: 0 }));
  for (const transaction of filterReportTransactions(args.transactions || [], args.bounds)) {
    const hour = new Date(moneyNumber(transaction.timestamp)).getHours();
    rows[hour].revenue = roundMoney(rows[hour].revenue + transactionNetMetrics(transaction).netTotal);
  }
  for (const invoice of filterReportInvoices(args.salesInvoices || [], args.bounds)) {
    const hour = new Date(invoiceTimestamp(invoice)).getHours();
    rows[hour].revenue = roundMoney(rows[hour].revenue + positiveMoney(invoice.total));
  }
  return rows;
}

export function buildCashierPerformance(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  bounds: ReportPeriodBounds;
}): ReportCashierPerformanceRow[] {
  const rows = new Map<string, { revenue: number; orders: number }>();
  const add = (name: string, revenue: number, countOrder: boolean) => {
    const key = name || 'Staff';
    const current = rows.get(key) || { revenue: 0, orders: 0 };
    current.revenue = roundMoney(current.revenue + revenue);
    if (countOrder) current.orders += 1;
    rows.set(key, current);
  };

  for (const transaction of filterReportTransactions(args.transactions || [], args.bounds)) {
    const revenue = transactionNetMetrics(transaction).netTotal;
    add(String(transaction?.cashierName || 'Unknown'), revenue, revenue > 0);
  }
  for (const invoice of filterReportInvoices(args.salesInvoices || [], args.bounds)) {
    const revenue = positiveMoney(invoice?.total);
    add(String(invoice?.preparedBy || 'Staff'), revenue, revenue > 0);
  }

  return Array.from(rows.entries())
    .map(([name, row]) => ({
      name,
      revenue: roundMoney(row.revenue),
      orders: row.orders,
      averageBasket: row.orders > 0 ? roundMoney(row.revenue / row.orders) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export function buildProductPerformance(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  products?: ReportProductLike[];
  purchaseOrders?: ProfitLossPurchaseOrderLike[];
  bounds: ReportPeriodBounds;
}): ReportProductPerformanceRow[] {
  const products = args.products || [];
  const productMap = productById(products);
  const rows = new Map<string, ReportProductPerformanceRow>();

  const ensureRow = (
    id: string,
    name: string,
    group: string,
    unit: string,
    stock: number | null,
    source: ReportProductPerformanceRow['source'],
    reorderPoint?: number | string | null,
  ) => {
    const key = id || `${source}:${name}`.toLowerCase();
    const existing = rows.get(key);
    if (existing) return existing;
    const row: ReportProductPerformanceRow = {
      id: key,
      name: name || 'Unnamed item',
      group: group || 'Uncategorized',
      unit: unit || 'units',
      stock,
      reorderPoint,
      source,
      qty: 0,
      revenue: 0,
      cogs: 0,
      profit: 0,
      tax: 0,
      avgPrice: 0,
      margin: 0,
      share: 0,
    };
    rows.set(key, row);
    return row;
  };

  for (const product of products) {
    ensureRow(
      String(product?.id || ''),
      String(product?.name || 'Unnamed product'),
      String(product?.category || 'Uncategorized'),
      String(product?.unit || 'units'),
      moneyNumber(product?.stockQuantity),
      'Product',
      product?.reorderPoint,
    );
  }

  for (const transaction of filterReportTransactions(args.transactions || [], args.bounds)) {
    const metrics = transactionNetMetrics(transaction);
    for (const item of transactionItems(transaction)) {
      const productId = String(item?.productId || '').trim();
      if (!productId) continue;
      const qty = netItemQuantity(transaction, item);
      if (qty <= 0) continue;
      const product = productMap.get(productId);
      const revenue = lineNetRevenueForTransaction(transaction, item, metrics);
      const tax = lineTaxForTransaction(transaction, item, metrics);
      const unitCost = transactionItemUnitCost(item, {
        products,
        purchaseOrders: args.purchaseOrders || [],
        timestamp: transaction?.timestamp,
      });
      const cogs = roundMoney(unitCost * qty);
      const row = ensureRow(
        productId,
        String(item?.name || product?.name || 'Unnamed product'),
        String(product?.category || item?.category || 'Uncategorized'),
        String(item?.unit || product?.unit || 'units'),
        product ? moneyNumber(product.stockQuantity) : null,
        'Product',
        product?.reorderPoint,
      );
      row.qty = roundMoney(row.qty + qty);
      row.revenue = roundMoney(row.revenue + revenue);
      row.cogs = roundMoney(row.cogs + cogs);
      row.profit = roundMoney(row.profit + revenue - cogs);
      row.tax = roundMoney(row.tax + tax);
    }
  }

  for (const invoice of filterReportInvoices(args.salesInvoices || [], args.bounds)) {
    for (const item of invoiceItems(invoice)) {
      const qty = positiveMoney(item?.quantity);
      if (qty <= 0) continue;
      const itemType = String(item?.itemType || '').toUpperCase();
      const source: ReportProductPerformanceRow['source'] = itemType === 'SERVICE'
        ? 'Service'
        : itemType === 'CUSTOM'
          ? 'Custom'
          : 'Product';
      const itemId = String(item?.itemId || item?.productId || '').trim();
      const product = source === 'Product' && itemId ? productMap.get(itemId) : undefined;
      const baseRevenue = invoiceBaseLineAmount(item);
      const tax = invoiceItemTax(invoice, item);
      const revenue = roundMoney(baseRevenue + tax);
      const unitCost = invoiceItemUnitCost(item, {
        products,
        purchaseOrders: args.purchaseOrders || [],
        timestamp: invoiceTimestamp(invoice),
      });
      const cogs = roundMoney(unitCost * qty);
      const row = ensureRow(
        productRowKeyForInvoiceItem(item, source, product),
        String(item?.name || product?.name || 'Invoice item'),
        String(product?.category || (source === 'Service' ? 'Services' : source === 'Custom' ? 'Custom Sales' : 'Uncategorized')),
        String(product?.unit || 'units'),
        product ? moneyNumber(product.stockQuantity) : null,
        source,
        product?.reorderPoint,
      );
      row.qty = roundMoney(row.qty + qty);
      row.revenue = roundMoney(row.revenue + revenue);
      row.cogs = roundMoney(row.cogs + cogs);
      row.profit = roundMoney(row.profit + revenue - cogs);
      row.tax = roundMoney(row.tax + tax);
    }
  }

  const totalRevenue = Array.from(rows.values()).reduce((sum, row) => sum + row.revenue, 0);
  return Array.from(rows.values())
    .map(row => ({
      ...row,
      revenue: roundMoney(row.revenue),
      cogs: roundMoney(row.cogs),
      profit: roundMoney(row.profit),
      tax: roundMoney(row.tax),
      avgPrice: row.qty > 0 ? roundMoney(row.revenue / row.qty) : 0,
      margin: row.revenue > 0 ? roundMoney((row.profit / row.revenue) * 100) : 0,
      share: totalRevenue > 0 ? roundMoney((row.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export function buildCategoryPerformance(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  products?: ReportProductLike[];
  purchaseOrders?: ProfitLossPurchaseOrderLike[];
  bounds: ReportPeriodBounds;
}): ReportCategoryPerformanceRow[] {
  const productRows = buildProductPerformance(args).filter(row => row.qty > 0 || row.revenue > 0 || row.cogs > 0 || row.tax > 0);
  const categoryRows = new Map<string, ReportCategoryPerformanceRow>();
  for (const productRow of productRows) {
    const current = categoryRows.get(productRow.group) || {
      name: productRow.group,
      revenue: 0,
      cogs: 0,
      profit: 0,
      tax: 0,
      qty: 0,
      margin: 0,
      share: 0,
    };
    current.revenue = roundMoney(current.revenue + productRow.revenue);
    current.cogs = roundMoney(current.cogs + productRow.cogs);
    current.profit = roundMoney(current.profit + productRow.profit);
    current.tax = roundMoney(current.tax + productRow.tax);
    current.qty = roundMoney(current.qty + productRow.qty);
    categoryRows.set(productRow.group, current);
  }

  const totalRevenue = Array.from(categoryRows.values()).reduce((sum, row) => sum + row.revenue, 0);
  return Array.from(categoryRows.values())
    .map(row => ({
      ...row,
      margin: row.revenue > 0 ? roundMoney((row.profit / row.revenue) * 100) : 0,
      share: totalRevenue > 0 ? roundMoney((row.revenue / totalRevenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
}

export function customerStatementCreditAmount(sale: TransactionLike & { recordType?: string; total?: number | string | null }): number {
  if (sale?.recordType === 'SALES_INVOICE') return positiveMoney(sale?.total);
  const method = String(sale?.paymentMethod || '').toUpperCase();
  if (method === 'CREDIT') return transactionOriginalNetTotal(sale);
  if (method !== 'SPLIT') return 0;
  const split = splitPaymentDetails(sale);
  return String(split?.secondaryMethod || '').toUpperCase() === 'CREDIT'
    ? positiveMoney(split?.secondaryAmount)
    : 0;
}

export function buildTenderTotals(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  customerPayments?: ReportPaymentLike[];
  bounds: ReportPeriodBounds;
}): ReportTenderTotals {
  const transactions = filterReportTransactions(args.transactions || [], args.bounds);
  const invoices = filterReportInvoices(args.salesInvoices || [], args.bounds);
  const customerPayments = (args.customerPayments || []).filter(payment => inBounds(payment?.timestamp, args.bounds));
  const customerByMethod = (method: TenderMethod) => roundMoney(customerPayments
    .filter(payment => String(payment?.paymentMethod || '').toUpperCase() === method)
    .reduce((sum, payment) => sum + positiveMoney(payment?.amount), 0));
  const collectionsTotal = roundMoney(customerPayments.reduce((sum, payment) => sum + positiveMoney(payment?.amount), 0));
  const customerCashPayments = customerByMethod('CASH');
  const customerMpesaPayments = customerByMethod('MPESA');
  const customerPdqPayments = customerByMethod('PDQ');
  return {
    cashSales: roundMoney(transactions.reduce((sum, transaction) => sum + paymentAmountForMethod(transaction, 'CASH'), 0)),
    mpesaSales: roundMoney(transactions.reduce((sum, transaction) => sum + paymentAmountForMethod(transaction, 'MPESA'), 0)),
    pdqSales: roundMoney(transactions.reduce((sum, transaction) => sum + paymentAmountForMethod(transaction, 'PDQ'), 0)),
    creditSales: roundMoney(transactions.reduce((sum, transaction) => sum + creditSalesAmountForTransaction(transaction), 0)),
    invoiceCreditSales: roundMoney(invoices.reduce((sum, invoice) => sum + positiveMoney(invoice?.total), 0)),
    customerCashPayments,
    customerMpesaPayments,
    customerPdqPayments,
    customerOtherPayments: roundMoney(Math.max(0, collectionsTotal - customerCashPayments - customerMpesaPayments - customerPdqPayments)),
    collectionsTotal,
  };
}

export function calculateReportPeriodSummary(args: {
  label: string;
  bounds: ReportPeriodBounds;
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  expenses?: any[];
  products?: ReportProductLike[];
  purchaseOrders?: ProfitLossPurchaseOrderLike[];
  customerPayments?: ReportPaymentLike[];
  deductTaxInPL?: boolean;
}) {
  const profitLoss = calculateProfitLossPeriod({
    label: args.label,
    bounds: args.bounds,
    transactions: args.transactions || [],
    salesInvoices: args.salesInvoices || [],
    expenses: args.expenses || [],
    products: args.products || [],
    purchaseOrders: args.purchaseOrders || [],
    deductTaxInPL: args.deductTaxInPL,
  });
  const tenderTotals = buildTenderTotals({
    transactions: args.transactions || [],
    salesInvoices: args.salesInvoices || [],
    customerPayments: args.customerPayments || [],
    bounds: args.bounds,
  });
  return { ...profitLoss, tenderTotals };
}

function recordInCloseScope(record: any, since: number, until: number, shiftId?: string | null): boolean {
  if (shiftId && record?.shiftId) return String(record.shiftId) === String(shiftId);
  const ts = recordTimestamp(record);
  return ts >= since && ts <= until;
}

export function calculateCloseReportTotals(args: {
  transactions?: ReportTransactionLike[];
  salesInvoices?: ReportInvoiceLike[];
  expenses?: MoneyMovementLike[];
  picks?: MoneyMovementLike[];
  refunds?: MoneyMovementLike[];
  supplierPayments?: MoneyMovementLike[];
  customerPayments?: ReportPaymentLike[];
  openingCash?: number;
  since: number;
  until?: number;
  shiftId?: string | null;
}): CloseReportTotals {
  const since = moneyNumber(args.since);
  const until = moneyNumber(args.until, Date.now());
  const shiftId = args.shiftId;
  const txs = (args.transactions || []).filter(tx => recordInCloseScope(tx, since, until, shiftId) && closeReportableTransaction(tx));
  const invoices = (args.salesInvoices || []).filter(invoice => recordInCloseScope(invoice, since, until, shiftId) && activeInvoice(invoice));
  const expenses = (args.expenses || []).filter(row => recordInCloseScope(row, since, until, shiftId) && approvedMoneyStatus(row));
  const picks = (args.picks || []).filter(row => recordInCloseScope(row, since, until, shiftId) && approvedMoneyStatus(row));
  const refunds = (args.refunds || []).filter(row => recordInCloseScope(row, since, until, shiftId) && approvedMoneyStatus(row));
  const supplierPayments = (args.supplierPayments || []).filter(row => recordInCloseScope(row, since, until, shiftId));
  const customerPayments = (args.customerPayments || []).filter(row => recordInCloseScope(row, since, until, shiftId));

  const openingCash = positiveMoney(args.openingCash);
  const cashSales = roundMoney(txs.reduce((sum, tx) => sum + paymentAmountForMethod(tx, 'CASH'), 0));
  const mpesaSales = roundMoney(txs.reduce((sum, tx) => sum + paymentAmountForMethod(tx, 'MPESA'), 0));
  const pdqSales = roundMoney(txs.reduce((sum, tx) => sum + paymentAmountForMethod(tx, 'PDQ'), 0));
  const customerCashPayments = roundMoney(customerPayments
    .filter(payment => String(payment?.paymentMethod || '').toUpperCase() === 'CASH')
    .reduce((sum, payment) => sum + positiveMoney(payment?.amount), 0));
  const customerMpesaPayments = roundMoney(customerPayments
    .filter(payment => String(payment?.paymentMethod || '').toUpperCase() === 'MPESA')
    .reduce((sum, payment) => sum + positiveMoney(payment?.amount), 0));
  const grossSales = roundMoney(
    txs.reduce((sum, tx) => sum + transactionNetMetrics(tx).netSubtotal, 0)
    + invoices.reduce((sum, invoice) => sum + positiveMoney(invoice?.subtotal ?? invoice?.total), 0),
  );
  const totalSales = roundMoney(
    txs.reduce((sum, tx) => sum + transactionNetMetrics(tx).netTotal, 0)
    + invoices.reduce((sum, invoice) => sum + positiveMoney(invoice?.total), 0),
  );
  const taxTotal = roundMoney(
    txs.reduce((sum, tx) => sum + transactionNetMetrics(tx).netTax, 0)
    + invoices.reduce((sum, invoice) => sum + positiveMoney(invoice?.tax), 0),
  );
  const totalExpenses = roundMoney(expenses
    .filter(row => normalizeExpenseSource(row?.source) === 'TILL')
    .reduce((sum, row) => sum + positiveMoney(row?.amount), 0));
  const supplierPaymentsTotal = roundMoney(supplierPayments
    .filter(row => String(row?.source || '').toUpperCase() === 'TILL')
    .reduce((sum, row) => sum + positiveMoney(row?.amount), 0));
  const remittanceTotal = roundMoney(totalExpenses + supplierPaymentsTotal);
  const totalPicks = roundMoney(picks.reduce((sum, row) => sum + positiveMoney(row?.amount), 0));
  const totalRefunds = roundMoney(refunds.reduce((sum, row) => sum + positiveMoney(row?.amount), 0));
  const cashRefunds = roundMoney(refunds.reduce((sum, row) => sum + cashRefundAmount({
    ...row,
    amount: moneyNumber(row?.amount),
    cashAmount: moneyNumber(row?.cashAmount),
  }), 0));
  const expectedBeforePicks = roundMoney(openingCash + cashSales + customerCashPayments - remittanceTotal - cashRefunds);
  const expectedCash = roundMoney(Math.max(0, expectedBeforePicks - totalPicks));

  return {
    txs,
    invoices,
    expenses,
    picks,
    refunds,
    supplierPayments,
    customerPayments,
    openingCash,
    grossSales,
    totalSales,
    taxTotal,
    cashSales,
    customerCashPayments,
    mpesaSales,
    customerMpesaPayments,
    pdqSales,
    totalExpenses,
    supplierPaymentsTotal,
    remittanceTotal,
    totalPicks,
    totalRefunds,
    cashRefunds,
    expectedBeforePicks,
    expectedCash,
  };
}
