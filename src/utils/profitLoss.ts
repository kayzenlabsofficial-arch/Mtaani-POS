import {
  lineNetRevenueForTransaction,
  netItemQuantity,
  roundMoney,
  splitPaymentDetails,
  transactionItems,
  transactionNetMetrics,
  type SaleItemLike,
  type TransactionLike,
  type TransactionNetMetrics,
} from './posMoney';
import { isApprovedExpense } from './expenseIntegrity';

export const PROFIT_LOSS_REPORTABLE_TRANSACTION_STATUSES = new Set(['PAID', 'UNPAID', 'PARTIAL_REFUND', 'PENDING_REFUND', 'REFUNDED']);

export type ProfitLossBounds = {
  start: number;
  end: number;
  label: string;
};

export type ProfitLossProductLike = {
  id?: string;
  costPrice?: number | string | null;
};

export type ProfitLossPurchaseOrderLike = {
  orderDate?: number | string | null;
  receivedDate?: number | string | null;
  updated_at?: number | string | null;
  items?: unknown;
};

export type ProfitLossInvoiceLike = {
  id?: string;
  issueDate?: number | string | null;
  status?: string | null;
  subtotal?: number | string | null;
  tax?: number | string | null;
  total?: number | string | null;
  items?: unknown;
};

export type ProfitLossExpenseLike = {
  timestamp?: number | string | null;
  status?: string | null;
  category?: string | null;
  amount?: number | string | null;
};

export type ProfitLossCustomerPaymentLike = {
  amount?: number | string | null;
  paymentMethod?: string | null;
};

export type ProfitLossInvoiceItemLike = {
  itemType?: string;
  itemId?: string;
  productId?: string;
  name?: string;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  taxCategory?: string | null;
};

export type ProfitLossPeriod = {
  label: string;
  grossSales: number;
  discounts: number;
  totalRevenue: number;
  cogs: number;
  grossProfit: number;
  grossProfitWithVat: number;
  grossProfitWithoutVat: number;
  expenses: number;
  netProfit: number;
  netProfitWithVat: number;
  netProfitWithoutVat: number;
  tax: number;
  creditSales: number;
  orderCount: number;
  expenseBreakdown: Array<{ name: string; value: number }>;
};

export type CreditCollectionSummary = {
  total: number;
  byMethod: Record<string, number>;
};

function moneyNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function inBounds(timestamp: unknown, bounds: Pick<ProfitLossBounds, 'start' | 'end'>): boolean {
  const ts = moneyNumber(timestamp);
  return ts >= bounds.start && ts <= bounds.end;
}

function arrayFromMaybeJson<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function invoiceItems(invoice: ProfitLossInvoiceLike | null | undefined): ProfitLossInvoiceItemLike[] {
  return arrayFromMaybeJson<ProfitLossInvoiceItemLike>(invoice?.items);
}

export function purchaseItems(purchaseOrder: ProfitLossPurchaseOrderLike | null | undefined): any[] {
  return arrayFromMaybeJson<any>(purchaseOrder?.items);
}

export function reportableTransaction(transaction: TransactionLike | null | undefined): boolean {
  return PROFIT_LOSS_REPORTABLE_TRANSACTION_STATUSES.has(String(transaction?.status || '').toUpperCase());
}

export function expenseBreakdownFor(expenses: ProfitLossExpenseLike[]): Array<{ name: string; value: number }> {
  const totals = expenses.reduce<Record<string, number>>((acc, expense) => {
    const category = String(expense?.category || 'General');
    acc[category] = roundMoney((acc[category] || 0) + Math.max(0, moneyNumber(expense?.amount)));
    return acc;
  }, {});

  return Object.entries(totals)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

function purchaseOrderTimestamp(purchaseOrder: ProfitLossPurchaseOrderLike): number {
  return moneyNumber(purchaseOrder.receivedDate || purchaseOrder.orderDate || purchaseOrder.updated_at);
}

function purchaseOrderUnitCost(productId: string, purchaseOrders: ProfitLossPurchaseOrderLike[], documentTimestamp: number): number | null {
  const matches: Array<{ timestamp: number; unitCost: number }> = [];
  for (const purchaseOrder of purchaseOrders || []) {
    const timestamp = purchaseOrderTimestamp(purchaseOrder);
    for (const item of purchaseItems(purchaseOrder)) {
      if (String(item?.productId || '').trim() !== productId) continue;
      const unitCost = moneyNumber(item?.unitCost ?? item?.costPrice, NaN);
      if (!Number.isFinite(unitCost) || unitCost < 0) continue;
      matches.push({ timestamp, unitCost });
    }
  }

  if (!matches.length) return null;
  const dated = matches
    .filter(row => documentTimestamp <= 0 || row.timestamp <= 0 || row.timestamp <= documentTimestamp)
    .sort((a, b) => b.timestamp - a.timestamp);
  return (dated[0] || matches.sort((a, b) => b.timestamp - a.timestamp)[0]).unitCost;
}

function productCost(productId: string, products: ProfitLossProductLike[]): number | null {
  const product = (products || []).find(row => String(row?.id || '').trim() === productId);
  if (!product) return null;
  const cost = moneyNumber(product.costPrice, NaN);
  return Number.isFinite(cost) && cost >= 0 ? cost : null;
}

export function transactionItemUnitCost(
  item: SaleItemLike,
  args: {
    products?: ProfitLossProductLike[];
    purchaseOrders?: ProfitLossPurchaseOrderLike[];
    timestamp?: number | string | null;
  } = {},
): number {
  const snapshotCost = moneyNumber(item?.snapshotCost, NaN);
  if (Number.isFinite(snapshotCost) && snapshotCost >= 0) return snapshotCost;

  const productId = String(item?.productId || '').trim();
  const productUnitCost = productId ? productCost(productId, args.products || []) : null;
  if (productUnitCost !== null) return productUnitCost;

  const purchasedUnitCost = productId ? purchaseOrderUnitCost(productId, args.purchaseOrders || [], moneyNumber(args.timestamp)) : null;
  if (purchasedUnitCost !== null) return purchasedUnitCost;

  return roundMoney(Math.max(0, moneyNumber(item?.snapshotPrice)) * 0.7);
}

export function invoiceItemUnitCost(
  item: ProfitLossInvoiceItemLike,
  args: {
    products?: ProfitLossProductLike[];
    purchaseOrders?: ProfitLossPurchaseOrderLike[];
    timestamp?: number | string | null;
  } = {},
): number {
  const itemType = String(item?.itemType || '').toUpperCase();
  const productId = String(item?.itemId || item?.productId || '').trim();
  if (itemType && itemType !== 'PRODUCT') return 0;
  if (!productId) return 0;

  const productUnitCost = productCost(productId, args.products || []);
  if (productUnitCost !== null) return productUnitCost;

  const purchasedUnitCost = purchaseOrderUnitCost(productId, args.purchaseOrders || [], moneyNumber(args.timestamp));
  if (purchasedUnitCost !== null) return purchasedUnitCost;

  return roundMoney(Math.max(0, moneyNumber(item?.unitPrice)) * 0.7);
}

export function creditSalesAmountForTransaction(transaction: TransactionLike, metrics = transactionNetMetrics(transaction)): number {
  const method = String(transaction?.paymentMethod || '').toUpperCase();
  if (method === 'CREDIT') return metrics.netTotal;
  if (method !== 'SPLIT') return 0;

  const split = splitPaymentDetails(transaction);
  if (String(split?.secondaryMethod || '').toUpperCase() !== 'CREDIT') return 0;
  return roundMoney(Math.max(0, moneyNumber(split?.secondaryAmount)) * metrics.ratio);
}

export function calculateCreditCollections(payments: ProfitLossCustomerPaymentLike[]): CreditCollectionSummary {
  return (payments || []).reduce<CreditCollectionSummary>((summary, payment) => {
    const method = String(payment?.paymentMethod || 'OTHER').toUpperCase() || 'OTHER';
    const amount = Math.max(0, moneyNumber(payment?.amount));
    summary.byMethod[method] = roundMoney((summary.byMethod[method] || 0) + amount);
    summary.total = roundMoney(summary.total + amount);
    return summary;
  }, { total: 0, byMethod: {} });
}

export function calculateProfitLossPeriod(args: {
  label: string;
  bounds: Pick<ProfitLossBounds, 'start' | 'end'>;
  transactions?: TransactionLike[];
  salesInvoices?: ProfitLossInvoiceLike[];
  expenses?: ProfitLossExpenseLike[];
  products?: ProfitLossProductLike[];
  purchaseOrders?: ProfitLossPurchaseOrderLike[];
  deductTaxInPL?: boolean;
}): ProfitLossPeriod {
  const products = args.products || [];
  const purchaseOrders = args.purchaseOrders || [];
  const transactions = (args.transactions || []).filter(row => inBounds((row as any)?.timestamp, args.bounds) && reportableTransaction(row));
  const salesInvoices = (args.salesInvoices || []).filter(invoice => (
    inBounds(invoice?.issueDate, args.bounds)
    && String(invoice?.status || '').toUpperCase() !== 'CANCELLED'
  ));
  const expenses = (args.expenses || []).filter(expense => (
    inBounds(expense?.timestamp, args.bounds)
    && isApprovedExpense(expense)
  ));
  const transactionMetrics = transactions.map(transaction => ({
    transaction,
    metrics: transactionNetMetrics(transaction),
  }));

  let transactionRevenue = 0;
  let transactionTax = 0;
  let transactionCogs = 0;
  let invoiceRevenue = 0;
  let invoiceTax = 0;
  let invoiceCogs = 0;

  for (const { transaction, metrics } of transactionMetrics) {
    transactionRevenue += metrics.netTotal;
    transactionTax += metrics.netTax;
    for (const item of transactionItems(transaction)) {
      const quantity = netItemQuantity(transaction, item);
      if (quantity <= 0) continue;
      transactionCogs += transactionItemUnitCost(item, {
        products,
        purchaseOrders,
        timestamp: (transaction as any)?.timestamp,
      }) * quantity;
    }
  }

  for (const invoice of salesInvoices) {
    invoiceRevenue += Math.max(0, moneyNumber(invoice.total));
    invoiceTax += Math.max(0, moneyNumber(invoice.tax));
    for (const item of invoiceItems(invoice)) {
      const quantity = Math.max(0, moneyNumber(item.quantity));
      if (quantity <= 0) continue;
      invoiceCogs += invoiceItemUnitCost(item, {
        products,
        purchaseOrders,
        timestamp: invoice.issueDate,
      }) * quantity;
    }
  }

  const grossSales = roundMoney(
    transactionMetrics.reduce((sum, row) => sum + row.metrics.netSubtotal, 0)
    + salesInvoices.reduce((sum, invoice) => sum + Math.max(0, moneyNumber(invoice.subtotal || invoice.total)), 0),
  );
  const discounts = roundMoney(transactionMetrics.reduce((sum, row) => sum + row.metrics.netDiscount, 0));
  const totalRevenue = roundMoney(transactionRevenue + invoiceRevenue);
  const cogs = roundMoney(transactionCogs + invoiceCogs);
  const tax = roundMoney(transactionTax + invoiceTax);
  const expensesTotal = roundMoney(expenses.reduce((sum, expense) => sum + Math.max(0, moneyNumber(expense.amount)), 0));
  const grossProfitWithVat = roundMoney(totalRevenue - cogs);
  const grossProfitWithoutVat = roundMoney(totalRevenue - tax - cogs);
  const netProfitWithVat = roundMoney(grossProfitWithVat - expensesTotal);
  const netProfitWithoutVat = roundMoney(grossProfitWithoutVat - expensesTotal);
  const creditSales = roundMoney(
    transactionMetrics.reduce((sum, row) => sum + creditSalesAmountForTransaction(row.transaction, row.metrics), 0)
    + salesInvoices.reduce((sum, invoice) => sum + Math.max(0, moneyNumber(invoice.total)), 0),
  );
  const orderCount = transactionMetrics.filter(row => row.metrics.netTotal > 0).length
    + salesInvoices.filter(invoice => moneyNumber(invoice.total) > 0).length;

  return {
    label: args.label,
    grossSales,
    discounts,
    totalRevenue,
    cogs,
    grossProfit: args.deductTaxInPL ? grossProfitWithoutVat : grossProfitWithVat,
    grossProfitWithVat,
    grossProfitWithoutVat,
    expenses: expensesTotal,
    netProfit: args.deductTaxInPL ? netProfitWithoutVat : netProfitWithVat,
    netProfitWithVat,
    netProfitWithoutVat,
    tax,
    creditSales,
    orderCount,
    expenseBreakdown: expenseBreakdownFor(expenses),
  };
}
