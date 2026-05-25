export type TenderMethod = 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT';

export type SaleItemLike = {
  productId?: string;
  name?: string;
  category?: string;
  unit?: string;
  quantity?: number;
  snapshotPrice?: number;
  snapshotCost?: number;
  discountAmount?: number;
  returnedQuantity?: number;
  taxCategory?: string;
};

export type TransactionLike = {
  total?: number;
  subtotal?: number;
  tax?: number;
  discountAmount?: number;
  discount?: number;
  status?: string;
  paymentMethod?: string;
  splitPayments?: unknown;
  splitData?: unknown;
  items?: SaleItemLike[] | string;
};

export type TransactionNetMetrics = {
  ratio: number;
  netSubtotal: number;
  netTotal: number;
  netTax: number;
  netDiscount: number;
  discountFactor: number;
  remainingGross: number;
  remainingNet: number;
  originalGross: number;
  originalNet: number;
};

export function asMoneyNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function parseMaybeJson<T = unknown>(value: unknown): T | unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value;
  }
}

export function arrayFromMaybeJson<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const parsed = parseMaybeJson(value);
  return Array.isArray(parsed) ? parsed as T[] : [];
}

export function transactionItems(transaction: TransactionLike): SaleItemLike[] {
  return arrayFromMaybeJson<SaleItemLike>(transaction?.items);
}

export function lineQuantity(item: SaleItemLike, quantityOverride?: number): number {
  return Math.max(0, asMoneyNumber(quantityOverride ?? item?.quantity));
}

export function lineUnitPrice(item: SaleItemLike): number {
  return Math.max(0, asMoneyNumber(item?.snapshotPrice));
}

export function lineUnitDiscount(item: SaleItemLike): number {
  return Math.min(lineUnitPrice(item), Math.max(0, asMoneyNumber(item?.discountAmount)));
}

export function lineGrossAmount(item: SaleItemLike, quantityOverride?: number): number {
  return roundMoney(lineUnitPrice(item) * lineQuantity(item, quantityOverride));
}

export function lineDiscountAmount(item: SaleItemLike, quantityOverride?: number): number {
  return roundMoney(lineUnitDiscount(item) * lineQuantity(item, quantityOverride));
}

export function lineNetAmount(item: SaleItemLike, quantityOverride?: number): number {
  return roundMoney(Math.max(0, lineGrossAmount(item, quantityOverride) - lineDiscountAmount(item, quantityOverride)));
}

export function netItemQuantity(transaction: TransactionLike, item: SaleItemLike): number {
  if (String(transaction?.status || '').toUpperCase() === 'REFUNDED') return 0;
  return Math.max(0, asMoneyNumber(item?.quantity) - asMoneyNumber(item?.returnedQuantity));
}

export function transactionOriginalGrossSubtotal(transaction: TransactionLike): number {
  const items = transactionItems(transaction);
  const itemGross = roundMoney(items.reduce((sum, item) => sum + lineGrossAmount(item), 0));
  return itemGross > 0 ? itemGross : roundMoney(Math.max(0, asMoneyNumber(transaction?.subtotal ?? transaction?.total)));
}

export function transactionItemDiscountTotal(transaction: TransactionLike): number {
  return roundMoney(transactionItems(transaction).reduce((sum, item) => sum + lineDiscountAmount(item), 0));
}

export function transactionExpectedDiscount(transaction: TransactionLike): number {
  const storedDiscount = Math.max(0, asMoneyNumber(transaction?.discountAmount ?? transaction?.discount));
  const itemDiscount = transactionItemDiscountTotal(transaction);
  return roundMoney(Math.max(storedDiscount, itemDiscount));
}

export function transactionOriginalNetTotal(transaction: TransactionLike): number {
  const subtotal = Math.max(0, asMoneyNumber(transaction?.subtotal));
  const discount = transactionExpectedDiscount(transaction);
  if (subtotal > 0 && discount > 0) return roundMoney(Math.max(0, subtotal - discount));
  const itemNet = roundMoney(transactionItems(transaction).reduce((sum, item) => sum + lineNetAmount(item), 0));
  if (itemNet > 0) return itemNet;
  return roundMoney(Math.max(0, asMoneyNumber(transaction?.total)));
}

export function refundedAmountFromReturnedLines(transaction: TransactionLike): number {
  const amount = transactionItems(transaction).reduce((sum, item) => {
    return sum + lineNetAmount(item, asMoneyNumber(item?.returnedQuantity));
  }, 0);
  return roundMoney(Math.min(transactionOriginalNetTotal(transaction), amount));
}

export function transactionNetMetrics(transaction: TransactionLike): TransactionNetMetrics {
  const status = String(transaction?.status || '').toUpperCase();
  const items = transactionItems(transaction);
  const originalGross = transactionOriginalGrossSubtotal(transaction);
  const originalNet = transactionOriginalNetTotal(transaction);
  const itemDiscountTotal = transactionItemDiscountTotal(transaction);
  const expectedDiscount = transactionExpectedDiscount(transaction);
  const remainingGross = roundMoney(items.reduce((sum, item) => sum + lineGrossAmount(item, netItemQuantity(transaction, item)), 0));
  const remainingNet = roundMoney(items.reduce((sum, item) => sum + lineNetAmount(item, netItemQuantity(transaction, item)), 0));
  const ratio = originalGross > 0
    ? Math.min(1, Math.max(0, remainingGross / originalGross))
    : status === 'REFUNDED'
      ? 0
      : 1;
  const netSubtotal = roundMoney(Math.max(0, asMoneyNumber(transaction?.subtotal ?? originalGross)) * ratio);
  const netDiscount = roundMoney(expectedDiscount * ratio);
  const itemDiscountsCoverTransactionDiscount = itemDiscountTotal > 0 && itemDiscountTotal >= expectedDiscount - 0.01;
  const netTotal = items.length > 0
    ? itemDiscountsCoverTransactionDiscount
      ? remainingNet
      : roundMoney(originalNet * ratio)
    : roundMoney(Math.max(0, asMoneyNumber(transaction?.total ?? originalNet)) * ratio);
  const netTax = roundMoney(Math.max(0, asMoneyNumber(transaction?.tax)) * ratio);
  const discountFactor = remainingGross > 0 ? netTotal / remainingGross : 0;

  return {
    ratio,
    netSubtotal,
    netTotal,
    netTax,
    netDiscount,
    discountFactor,
    remainingGross,
    remainingNet,
    originalGross,
    originalNet,
  };
}

export function lineNetRevenueForTransaction(
  transaction: TransactionLike,
  item: SaleItemLike,
  metrics = transactionNetMetrics(transaction),
): number {
  const qty = netItemQuantity(transaction, item);
  if (qty <= 0) return 0;
  const directLineNet = lineNetAmount(item, qty);
  if (lineUnitDiscount(item) > 0) return directLineNet;
  if (transactionExpectedDiscount(transaction) > 0 && metrics.remainingGross > 0) {
    return roundMoney(lineGrossAmount(item, qty) * metrics.discountFactor);
  }
  return directLineNet;
}

export function lineTaxForTransaction(
  transaction: TransactionLike,
  item: SaleItemLike,
  metrics = transactionNetMetrics(transaction),
): number {
  const lineRevenue = lineNetRevenueForTransaction(transaction, item, metrics);
  if (metrics.netTotal <= 0 || metrics.netTax <= 0 || lineRevenue <= 0) return 0;
  return roundMoney(metrics.netTax * (lineRevenue / metrics.netTotal));
}

export function splitPaymentDetails(record: TransactionLike): any {
  const rawSplit = parseMaybeJson(record?.splitPayments);
  if (rawSplit && typeof rawSplit === 'object') return rawSplit;
  const splitData = parseMaybeJson(record?.splitData) as any;
  if (splitData?.splitPayments) return splitData.splitPayments;
  return splitData && typeof splitData === 'object' ? splitData : null;
}

export function paymentAmountForMethod(record: TransactionLike, method: TenderMethod): number {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === method) return transactionOriginalNetTotal(record);
  if (paymentMethod !== 'SPLIT') return 0;
  const split = splitPaymentDetails(record);
  if (method === 'CASH') return roundMoney(Math.max(0, asMoneyNumber(split?.cashAmount)));
  return String(split?.secondaryMethod || '').toUpperCase() === method
    ? roundMoney(Math.max(0, asMoneyNumber(split?.secondaryAmount)))
    : 0;
}

export function cashRefundAmount(record: { status?: string; source?: string; cashAmount?: number; amount?: number }): number {
  if (String(record?.status || 'APPROVED').toUpperCase() === 'REJECTED') return 0;
  const source = String(record?.source || '').toUpperCase();
  if (source === 'TILL' || source === 'MIXED') {
    return roundMoney(Math.max(0, asMoneyNumber(record?.cashAmount ?? record?.amount)));
  }
  return roundMoney(Math.max(0, asMoneyNumber(record?.cashAmount)));
}
