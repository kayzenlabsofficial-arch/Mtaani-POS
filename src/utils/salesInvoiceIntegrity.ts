export type SalesInvoiceLineLike = {
  itemType?: 'PRODUCT' | 'SERVICE' | 'CUSTOM' | string;
  itemId?: string;
  quantity: number;
  unitPrice: number;
  taxCategory?: 'A' | 'E' | string;
};

export type SalesInvoiceStateLike = {
  total: number;
  paidAmount?: number;
  balance?: number;
  status?: string;
};

export type SalesInvoiceReportLike = SalesInvoiceStateLike & {
  id?: string;
};

export type CustomerPaymentReportLike = {
  amount: number;
  paymentMethod?: string;
};

export function roundInvoiceMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function salesInvoiceLineSubtotal(line: Pick<SalesInvoiceLineLike, 'quantity' | 'unitPrice'>) {
  return roundInvoiceMoney((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0));
}

export function salesInvoiceLineTax(line: SalesInvoiceLineLike) {
  return line.taxCategory === 'A' ? roundInvoiceMoney(salesInvoiceLineSubtotal(line) * 0.16) : 0;
}

export function calculateSalesInvoiceTotals(lines: SalesInvoiceLineLike[]) {
  const subtotal = roundInvoiceMoney(lines.reduce((sum, line) => sum + salesInvoiceLineSubtotal(line), 0));
  const tax = roundInvoiceMoney(lines.reduce((sum, line) => sum + salesInvoiceLineTax(line), 0));
  return { subtotal, tax, total: roundInvoiceMoney(subtotal + tax) };
}

export function assertValidSalesInvoiceLines(lines: SalesInvoiceLineLike[]) {
  if (lines.length === 0) throw new Error('Add at least one item or service.');
  for (const line of lines) {
    if ((Number(line.quantity) || 0) <= 0) throw new Error('Invoice quantity must be more than zero.');
    if (!Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) throw new Error('Invoice amount cannot be negative.');
    if (String(line.itemType || '').toUpperCase() === 'PRODUCT' && !String(line.itemId || '').trim()) {
      throw new Error('Product line is missing the product ID.');
    }
  }
}

export function nextSalesInvoicePaymentState(invoice: SalesInvoiceStateLike, paymentAmount: number) {
  const amount = roundInvoiceMoney(paymentAmount);
  const total = roundInvoiceMoney(invoice.total);
  const currentPaid = roundInvoiceMoney(invoice.paidAmount || 0);
  const currentBalance = roundInvoiceMoney(invoice.balance ?? Math.max(0, total - currentPaid));

  if (String(invoice.status || '').toUpperCase() === 'CANCELLED') throw new Error('Cannot allocate payment to a cancelled invoice.');
  if (amount <= 0) throw new Error('Enter a valid payment amount.');
  if (amount > currentBalance + 0.01) throw new Error('Payment allocation exceeds an invoice balance.');

  const paidAmount = roundInvoiceMoney(Math.min(total, currentPaid + amount));
  const balance = roundInvoiceMoney(Math.max(0, currentBalance - amount));
  const status = balance <= 0.01 ? 'PAID' : 'PARTIAL';
  return { paidAmount, balance, status };
}

export function unpaidInvoiceCancellationReversal(invoice: SalesInvoiceStateLike) {
  if (String(invoice.status || '').toUpperCase() === 'PAID' || roundInvoiceMoney(invoice.paidAmount || 0) > 0) {
    throw new Error('Cannot cancel an invoice after payment is applied.');
  }
  return {
    totalSpentDelta: -roundInvoiceMoney(invoice.total),
    balanceDelta: -roundInvoiceMoney(invoice.balance ?? invoice.total),
  };
}

export function productInvoiceStockDeductions(lines: SalesInvoiceLineLike[]) {
  const deductions = new Map<string, number>();
  for (const line of lines) {
    if (String(line.itemType || '').toUpperCase() !== 'PRODUCT') continue;
    const productId = String(line.itemId || '').trim();
    if (!productId) continue;
    deductions.set(productId, roundInvoiceMoney((deductions.get(productId) || 0) + (Number(line.quantity) || 0)));
  }
  return deductions;
}

export function salesInvoiceReportMetrics(invoices: SalesInvoiceReportLike[], payments: CustomerPaymentReportLike[] = []) {
  const activeInvoices = invoices.filter(invoice => String(invoice.status || '').toUpperCase() !== 'CANCELLED');
  const revenueCreated = roundInvoiceMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
  const receivableBalance = roundInvoiceMoney(activeInvoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0));
  const customerCollections = roundInvoiceMoney(payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  return { revenueCreated, receivableBalance, customerCollections };
}
