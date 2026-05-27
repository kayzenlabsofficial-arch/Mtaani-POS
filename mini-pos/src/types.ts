export type Role = 'ADMIN' | 'CASHIER';
export type PaymentMethod = 'CASH' | 'MPESA' | 'CREDIT';

export type User = {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type Product = {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  sellingPrice: number;
  costPrice: number;
  stockQuantity: number;
  isActive: number;
  createdAt?: number;
  updatedAt?: number;
};

export type StoreProfile = {
  id: string;
  storeName: string;
  logoDataUrl?: string | null;
  updatedAt?: number;
};

export type CartLine = {
  productId: string;
  quantity: number;
};

export type Sale = {
  id: string;
  receiptNumber: string;
  tillId: string;
  paymentMethod: PaymentMethod;
  mpesaReference?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  total: number;
  cogs: number;
  status: 'PAID' | 'CREDIT';
  cashierName?: string | null;
  timestamp: number;
};

export type SaleItem = {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  lineCost: number;
};

export type StockReceipt = {
  id: string;
  receiptNumber: string;
  note?: string | null;
  totalCost: number;
  receivedBy?: string | null;
  timestamp: number;
};

export type StockMovement = {
  id: string;
  productId: string;
  productName: string;
  type: 'RECEIVE' | 'SALE' | 'ADJUST';
  quantity: number;
  unitCost: number;
  referenceId?: string | null;
  note?: string | null;
  timestamp: number;
};

export type Customer = {
  id: string;
  name: string;
  phone?: string | null;
  balance: number;
  totalCredit: number;
  totalPaid: number;
};

export type ReportSummary = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  salesByMethod: Record<PaymentMethod, number>;
  creditOutstanding: number;
  stockValue: number;
  stockAddedCost: number;
  stockAddedQuantity: number;
  topProducts: Array<{ productId: string; name: string; quantity: number; sales: number; cogs: number }>;
};
