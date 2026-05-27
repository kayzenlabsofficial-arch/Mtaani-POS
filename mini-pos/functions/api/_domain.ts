export type MiniRole = 'ADMIN' | 'CASHIER';
export type PaymentMethod = 'CASH' | 'MPESA' | 'CREDIT';

export type ProductRow = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  sellingPrice: number;
  costPrice: number;
  stockQuantity: number;
  isActive?: number | boolean;
};

export type CheckoutInput = {
  paymentMethod: PaymentMethod;
  mpesaReference?: string;
  customer?: { name?: string; phone?: string };
  items: Array<{ productId: string; quantity: number }>;
};

export type SaleItemDraft = {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  lineCost: number;
  createdAt: number;
};

export type SaleDraft = {
  id: string;
  receiptNumber: string;
  tillId: 'default_till';
  paymentMethod: PaymentMethod;
  mpesaReference: string | null;
  customerId: string | null;
  customerName: string | null;
  subtotal: number;
  total: number;
  cogs: number;
  status: 'PAID' | 'CREDIT';
  cashierId: string | null;
  cashierName: string | null;
  timestamp: number;
  updatedAt: number;
};

export type CheckoutDraft = {
  sale: SaleDraft;
  items: SaleItemDraft[];
  stockDeductions: Array<{ productId: string; quantity: number }>;
  customer?: {
    id: string;
    name: string;
    phone: string | null;
    balanceIncrease: number;
  };
};

export type StockReceiveInput = {
  note?: string;
  items: Array<{ productId: string; quantity: number; unitCost: number }>;
};

export type StockReceiveLine = {
  product: ProductRow;
  quantity: number;
  unitCost: number;
  nextCostPrice: number;
  nextStockQuantity: number;
  lineCost: number;
};

export type CreditSettlementDraft = {
  amount: number;
  paymentMethod: 'CASH' | 'MPESA';
  reference: string | null;
  nextBalance: number;
};

export function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export function qty(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000000) / 1000000;
}

export function text(value: unknown, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function makeReceiptNumber(prefix: string, now = Date.now()) {
  const date = new Date(now);
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${prefix}-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

export function normalizePaymentMethod(value: unknown): PaymentMethod {
  const method = text(value, 20).toUpperCase();
  if (method === 'MPESA' || method === 'CREDIT') return method;
  return 'CASH';
}

export function rejectUnsupportedCheckoutFields(payload: Record<string, any>) {
  const forbidden = [
    'discount',
    'discountAmount',
    'discountType',
    'discountReason',
    'splitPayments',
    'splitData',
    'heldOrderId',
    'tax',
    'taxTotal',
  ];
  const used = forbidden.filter(key => payload[key] !== undefined && payload[key] !== null && payload[key] !== '');
  if (used.length) {
    throw new Error(`Smart POS Mini does not support ${used.join(', ')}.`);
  }
}

export function normalizeCheckoutInput(payload: Record<string, any>): CheckoutInput {
  rejectUnsupportedCheckoutFields(payload);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems
    .map((item: any) => ({
      productId: text(item?.productId || item?.id, 160),
      quantity: qty(item?.quantity),
    }))
    .filter(item => item.productId && item.quantity > 0);
  if (!items.length) throw new Error('Add at least one product to the cart.');

  const paymentMethod = normalizePaymentMethod(payload.paymentMethod || payload.method);
  const mpesaReference = paymentMethod === 'MPESA' ? text(payload.mpesaReference || payload.reference, 80) : '';
  const customer = paymentMethod === 'CREDIT'
    ? {
        name: text(payload.customer?.name || payload.customerName, 120),
        phone: text(payload.customer?.phone || payload.customerPhone, 40),
      }
    : undefined;
  if (paymentMethod === 'CREDIT' && !customer?.name) throw new Error('Customer name is required for credit sales.');

  return { paymentMethod, mpesaReference, customer, items };
}

export function buildCheckoutDraft(args: {
  payload: Record<string, any>;
  products: ProductRow[];
  cashier?: { id?: string | null; name?: string | null };
  now?: number;
}): CheckoutDraft {
  const input = normalizeCheckoutInput(args.payload);
  const now = args.now || Date.now();
  const productMap = new Map(args.products.map(product => [product.id, product]));
  const cart = new Map<string, number>();
  for (const item of input.items) {
    cart.set(item.productId, qty((cart.get(item.productId) || 0) + item.quantity));
  }

  const saleId = text(args.payload.id, 160) || makeId('sale');
  const items: SaleItemDraft[] = [];
  const stockDeductions: CheckoutDraft['stockDeductions'] = [];
  let subtotal = 0;
  let cogs = 0;

  for (const [productId, quantity] of cart.entries()) {
    const product = productMap.get(productId);
    if (!product || Number(product.isActive ?? 1) === 0) throw new Error('One product in the cart is not available.');
    if (quantity <= 0) throw new Error('Cart quantities must be above zero.');
    if (qty(product.stockQuantity) + 0.000001 < quantity) {
      throw new Error(`Insufficient stock for ${product.name}.`);
    }
    const unitPrice = money(product.sellingPrice);
    const unitCost = money(product.costPrice);
    const lineTotal = money(unitPrice * quantity);
    const lineCost = money(unitCost * quantity);
    subtotal = money(subtotal + lineTotal);
    cogs = money(cogs + lineCost);
    items.push({
      id: makeId('sale_item'),
      saleId,
      productId,
      productName: product.name,
      quantity,
      unitPrice,
      unitCost,
      lineTotal,
      lineCost,
      createdAt: now,
    });
    stockDeductions.push({ productId, quantity });
  }

  const customerName = input.customer?.name || null;
  const customerPhone = input.customer?.phone || null;
  const customerId = input.paymentMethod === 'CREDIT'
    ? `customer_${(customerPhone || customerName || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || crypto.randomUUID()}`
    : null;
  return {
    sale: {
      id: saleId,
      receiptNumber: makeReceiptNumber('SM', now),
      tillId: 'default_till',
      paymentMethod: input.paymentMethod,
      mpesaReference: input.paymentMethod === 'MPESA' ? input.mpesaReference || null : null,
      customerId,
      customerName,
      subtotal,
      total: subtotal,
      cogs,
      status: input.paymentMethod === 'CREDIT' ? 'CREDIT' : 'PAID',
      cashierId: args.cashier?.id || null,
      cashierName: args.cashier?.name || null,
      timestamp: now,
      updatedAt: now,
    },
    items,
    stockDeductions,
    customer: customerId && customerName
      ? { id: customerId, name: customerName, phone: customerPhone, balanceIncrease: subtotal }
      : undefined,
  };
}

export function nextWeightedCost(currentStock: unknown, currentCost: unknown, addedQty: unknown, addedCost: unknown) {
  const stock = Math.max(0, qty(currentStock));
  const cost = Math.max(0, money(currentCost));
  const incomingQty = qty(addedQty);
  const incomingCost = money(addedCost);
  if (incomingQty <= 0) throw new Error('Received quantity must be above zero.');
  if (incomingCost < 0) throw new Error('Unit cost cannot be negative.');
  const nextStock = qty(stock + incomingQty);
  if (nextStock <= 0) return incomingCost;
  return money(((stock * cost) + (incomingQty * incomingCost)) / nextStock);
}

export function buildStockReceiveLines(products: ProductRow[], input: StockReceiveInput): StockReceiveLine[] {
  const productMap = new Map(products.map(product => [product.id, product]));
  const lines = (Array.isArray(input.items) ? input.items : [])
    .map(item => ({
      productId: text(item.productId, 160),
      quantity: qty(item.quantity),
      unitCost: money(item.unitCost),
    }))
    .filter(item => item.productId && item.quantity > 0);
  if (!lines.length) throw new Error('Add at least one stock item to receive.');

  return lines.map(line => {
    const product = productMap.get(line.productId);
    if (!product) throw new Error('One stock item was not found.');
    const nextCostPrice = nextWeightedCost(product.stockQuantity, product.costPrice, line.quantity, line.unitCost);
    const nextStockQuantity = qty(product.stockQuantity + line.quantity);
    return {
      product,
      quantity: line.quantity,
      unitCost: line.unitCost,
      nextCostPrice,
      nextStockQuantity,
      lineCost: money(line.quantity * line.unitCost),
    };
  });
}

export function buildCreditSettlementDraft(input: Record<string, any>, customerBalance: unknown): CreditSettlementDraft {
  const amount = money(input.amount);
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  if (paymentMethod === 'CREDIT') throw new Error('Credit settlement must be Cash or M-Pesa.');
  if (amount <= 0) throw new Error('Payment amount must be above zero.');
  const balance = money(customerBalance);
  if (amount > balance + 0.01) throw new Error('Payment cannot exceed customer balance.');
  return {
    amount,
    paymentMethod,
    reference: text(input.reference, 80) || null,
    nextBalance: money(Math.max(0, balance - amount)),
  };
}

export function buildReportSummary(rows: {
  sales: Array<{ paymentMethod: string; total: number; cogs: number; status?: string }>;
  saleItems: Array<{ productId: string; productName: string; quantity: number; lineTotal: number; lineCost: number }>;
  customers: Array<{ balance: number }>;
  products: Array<{ stockQuantity: number; costPrice: number }>;
  stockReceipts?: Array<{ totalCost: number }>;
  stockMovements?: Array<{ type: string; quantity: number }>;
}) {
  const salesByMethod = { CASH: 0, MPESA: 0, CREDIT: 0 };
  let revenue = 0;
  let cogs = 0;
  for (const sale of rows.sales) {
    const method = normalizePaymentMethod(sale.paymentMethod);
    const total = money(sale.total);
    salesByMethod[method] = money(salesByMethod[method] + total);
    revenue = money(revenue + total);
    cogs = money(cogs + money(sale.cogs));
  }
  const topProducts = Array.from(rows.saleItems.reduce((map, item) => {
    const current = map.get(item.productId) || { productId: item.productId, name: item.productName, quantity: 0, sales: 0, cogs: 0 };
    current.quantity = qty(current.quantity + qty(item.quantity));
    current.sales = money(current.sales + money(item.lineTotal));
    current.cogs = money(current.cogs + money(item.lineCost));
    map.set(item.productId, current);
    return map;
  }, new Map<string, { productId: string; name: string; quantity: number; sales: number; cogs: number }>()).values())
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 8);

  return {
    revenue,
    cogs,
    grossProfit: money(revenue - cogs),
    salesByMethod,
    creditOutstanding: money(rows.customers.reduce((sum, customer) => sum + money(customer.balance), 0)),
    stockValue: money(rows.products.reduce((sum, product) => sum + (qty(product.stockQuantity) * money(product.costPrice)), 0)),
    stockAddedCost: money((rows.stockReceipts || []).reduce((sum, receipt) => sum + money(receipt.totalCost), 0)),
    stockAddedQuantity: qty((rows.stockMovements || []).filter(row => row.type === 'RECEIVE').reduce((sum, row) => sum + qty(row.quantity), 0)),
    topProducts,
  };
}
