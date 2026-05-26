export type ServerCloseReportTotals = {
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

function n(value: unknown, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function positive(value: unknown) {
  return Math.max(0, n(value));
}

function parseMaybeJson(value: unknown): any {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function splitDetails(record: any) {
  return parseMaybeJson(record?.splitPayments) || parseMaybeJson(record?.splitData)?.splitPayments || parseMaybeJson(record?.splitData) || null;
}

function transactionItems(record: any): any[] {
  const parsed = parseMaybeJson(record?.items);
  return Array.isArray(parsed) ? parsed : [];
}

function lineQty(item: any, fallback = item?.quantity) {
  return Math.max(0, n(fallback));
}

function lineGross(item: any, quantity = item?.quantity) {
  return money(Math.max(0, n(item?.snapshotPrice)) * lineQty(item, quantity));
}

function lineDiscount(item: any, quantity = item?.quantity) {
  const unitPrice = Math.max(0, n(item?.snapshotPrice));
  const unitDiscount = Math.min(unitPrice, Math.max(0, n(item?.discountAmount)));
  return money(unitDiscount * lineQty(item, quantity));
}

function lineNet(item: any, quantity = item?.quantity) {
  return money(Math.max(0, lineGross(item, quantity) - lineDiscount(item, quantity)));
}

function transactionOriginalGrossSubtotal(record: any) {
  const items = transactionItems(record);
  const itemGross = money(items.reduce((sum, item) => sum + lineGross(item), 0));
  return itemGross > 0 ? itemGross : money(Math.max(0, n(record?.subtotal ?? record?.total)));
}

function transactionExpectedDiscount(record: any) {
  const storedDiscount = Math.max(0, n(record?.discountAmount ?? record?.discount));
  const itemDiscount = money(transactionItems(record).reduce((sum, item) => sum + lineDiscount(item), 0));
  return money(Math.max(storedDiscount, itemDiscount));
}

function transactionOriginalNetReportTotal(record: any) {
  const subtotal = Math.max(0, n(record?.subtotal));
  const discount = transactionExpectedDiscount(record);
  if (subtotal > 0 && discount > 0) return money(Math.max(0, subtotal - discount));
  const itemNet = money(transactionItems(record).reduce((sum, item) => sum + lineNet(item), 0));
  return itemNet > 0 ? itemNet : money(Math.max(0, n(record?.total)));
}

function netItemQty(record: any, item: any) {
  if (String(record?.status || '').toUpperCase() === 'REFUNDED') return 0;
  return Math.max(0, n(item?.quantity) - n(item?.returnedQuantity));
}

export function transactionReportMetrics(record: any) {
  const status = String(record?.status || '').toUpperCase();
  const items = transactionItems(record);
  const originalGross = transactionOriginalGrossSubtotal(record);
  const originalNet = transactionOriginalNetReportTotal(record);
  const itemDiscountTotal = money(items.reduce((sum, item) => sum + lineDiscount(item), 0));
  const expectedDiscount = transactionExpectedDiscount(record);
  const remainingGross = money(items.reduce((sum, item) => sum + lineGross(item, netItemQty(record, item)), 0));
  const remainingNet = money(items.reduce((sum, item) => sum + lineNet(item, netItemQty(record, item)), 0));
  const ratio = originalGross > 0
    ? Math.min(1, Math.max(0, remainingGross / originalGross))
    : status === 'REFUNDED'
      ? 0
      : 1;
  const itemDiscountsCoverTransactionDiscount = itemDiscountTotal > 0 && itemDiscountTotal >= expectedDiscount - 0.01;
  const netTotal = items.length > 0
    ? itemDiscountsCoverTransactionDiscount
      ? remainingNet
      : money(originalNet * ratio)
    : money(Math.max(0, n(record?.total ?? originalNet)) * ratio);
  return {
    ratio,
    netSubtotal: money(Math.max(0, n(record?.subtotal ?? originalGross)) * ratio),
    netTotal,
    netTax: money(Math.max(0, n(record?.tax)) * ratio),
  };
}

export function paymentAmount(record: any, method: 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT') {
  const paymentMethod = String(record?.paymentMethod || '').toUpperCase();
  if (paymentMethod === method) return transactionOriginalNetReportTotal(record);
  if (paymentMethod !== 'SPLIT') return 0;
  const split = splitDetails(record);
  if (method === 'CASH') return positive(split?.cashAmount);
  return String(split?.secondaryMethod || '').toUpperCase() === method ? positive(split?.secondaryAmount) : 0;
}

export function recordInCloseScope(record: any, since: number, until: number, shiftId?: string | null) {
  if (shiftId && record?.shiftId) return String(record.shiftId) === String(shiftId);
  const ts = n(record?.timestamp ?? record?.issueDate ?? record?.orderDate);
  return ts >= since && ts <= until;
}

export function cashRefundAmount(record: any) {
  if (String(record?.status || 'APPROVED').toUpperCase() === 'REJECTED') return 0;
  const source = String(record?.source || '').toUpperCase();
  if (source === 'TILL' || source === 'MIXED') return positive(record?.cashAmount ?? record?.amount);
  return positive(record?.cashAmount);
}

function approved(record: any) {
  return String(record?.status || 'APPROVED').toUpperCase() === 'APPROVED';
}

function expenseSource(record: any) {
  const source = String(record?.source || '').toUpperCase();
  if (source === 'ACCOUNT' || source === 'SHOP') return source;
  return 'TILL';
}

export function calculateServerCloseReportTotals(args: {
  transactions?: any[];
  invoices?: any[];
  expenses?: any[];
  picks?: any[];
  refunds?: any[];
  supplierPayments?: any[];
  customerPayments?: any[];
  openingCash?: number;
  since: number;
  until: number;
  shiftId?: string | null;
}): ServerCloseReportTotals {
  const { since, until, shiftId } = args;
  const txs = (args.transactions || []).filter(row => (
    recordInCloseScope(row, since, until, shiftId)
    && !['VOIDED', 'QUOTE'].includes(String(row.status || '').toUpperCase())
  ));
  const invoices = (args.invoices || []).filter(row => (
    recordInCloseScope(row, since, until, shiftId)
    && String(row.status || '').toUpperCase() !== 'CANCELLED'
  ));
  const expenses = (args.expenses || []).filter(row => recordInCloseScope(row, since, until, shiftId) && approved(row));
  const picks = (args.picks || []).filter(row => recordInCloseScope(row, since, until, shiftId) && approved(row));
  const refunds = (args.refunds || []).filter(row => recordInCloseScope(row, since, until, shiftId) && approved(row));
  const supplierPayments = (args.supplierPayments || []).filter(row => recordInCloseScope(row, since, until, shiftId));
  const customerPayments = (args.customerPayments || []).filter(row => recordInCloseScope(row, since, until, shiftId));

  const openingCash = positive(args.openingCash);
  const cashSales = money(txs.reduce((sum, row) => sum + paymentAmount(row, 'CASH'), 0));
  const mpesaSales = money(txs.reduce((sum, row) => sum + paymentAmount(row, 'MPESA'), 0));
  const pdqSales = money(txs.reduce((sum, row) => sum + paymentAmount(row, 'PDQ'), 0));
  const customerCashPayments = money(customerPayments
    .filter(row => String(row.paymentMethod || '').toUpperCase() === 'CASH')
    .reduce((sum, row) => sum + positive(row.amount), 0));
  const customerMpesaPayments = money(customerPayments
    .filter(row => String(row.paymentMethod || '').toUpperCase() === 'MPESA')
    .reduce((sum, row) => sum + positive(row.amount), 0));
  const grossSales = money(
    txs.reduce((sum, row) => sum + transactionReportMetrics(row).netSubtotal, 0)
    + invoices.reduce((sum, row) => sum + positive(row.subtotal ?? row.total), 0),
  );
  const totalSales = money(
    txs.reduce((sum, row) => sum + transactionReportMetrics(row).netTotal, 0)
    + invoices.reduce((sum, row) => sum + positive(row.total), 0),
  );
  const taxTotal = money(
    txs.reduce((sum, row) => sum + transactionReportMetrics(row).netTax, 0)
    + invoices.reduce((sum, row) => sum + positive(row.tax), 0),
  );
  const totalExpenses = money(expenses
    .filter(row => expenseSource(row) === 'TILL')
    .reduce((sum, row) => sum + positive(row.amount), 0));
  const supplierPaymentsTotal = money(supplierPayments
    .filter(row => String(row.source || '').toUpperCase() === 'TILL')
    .reduce((sum, row) => sum + positive(row.amount), 0));
  const remittanceTotal = money(totalExpenses + supplierPaymentsTotal);
  const totalPicks = money(picks.reduce((sum, row) => sum + positive(row.amount), 0));
  const totalRefunds = money(refunds.reduce((sum, row) => sum + positive(row.amount), 0));
  const cashRefunds = money(refunds.reduce((sum, row) => sum + cashRefundAmount(row), 0));
  const expectedBeforePicks = money(openingCash + cashSales + customerCashPayments - remittanceTotal - cashRefunds);
  const expectedCash = money(Math.max(0, expectedBeforePicks - totalPicks));

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
