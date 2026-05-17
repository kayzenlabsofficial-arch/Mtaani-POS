/**
 * db.ts — Online-first data layer using CloudDB + Cloudflare D1.
 *
 * All data is stored in Cloudflare D1. An in-memory cache speeds up reads.
 * Dexie/IndexedDB is no longer used.
 */

import { CloudTable, setupRemoteDB } from './clouddb';

// ── Interfaces (unchanged) ─────────────────────────────────────────────────

export interface Business {
  id: string;
  name: string;
  code: string;
  isActive?: number;
  updated_at?: number;
}

export interface User {
  id: string;
  name: string;
  password: string;
  role: 'ADMIN' | 'CASHIER' | 'MANAGER' | 'ROOT';
  businessId: string;
  branchId?: string; // Assigned branch for isolation
  updated_at?: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  costPrice?: number;
  taxCategory: 'A' | 'C' | 'E';
  stockQuantity: number; // Changed to allow decimals
  unit?: string; // e.g. 'pcs', 'm', 'kg', 'tot'
  barcode: string;
  reorderPoint?: number; // Minimum stock before alarm triggers
  imageUrl?: string;
  isBundle?: boolean | number | string;
  components?: { productId: string; quantity: number }[];
  businessId: string;
  branchId: string;
  updated_at?: number;
}

export interface ProductIngredient {
  id: string;
  productId: string;
  ingredientProductId: string;
  quantity: number;
  businessId: string;
  updated_at?: number;
}

export interface TransactionItem {
  productId: string;
  name: string;
  snapshotPrice: number;
  snapshotCost?: number;
  quantity: number; // Changed to allow decimals
  unit?: string;
  category?: string;
  returnedQuantity?: number;
  taxCategory?: 'A' | 'C' | 'E';
}

export interface Transaction {
  id: string;
  total: number;
  subtotal?: number;
  tax?: number;
  discountAmount?: number;
  discountReason?: string;
  items: TransactionItem[];
  timestamp: number;
  status: 'QUOTE' | 'PAID' | 'UNPAID' | 'VOIDED' | 'REFUNDED' | 'PARTIAL_REFUND' | 'PENDING_REFUND';
  paymentMethod?: 'CASH' | 'MPESA' | 'PDQ' | 'CREDIT' | 'SPLIT';
  splitPayments?: {
    cashAmount: number;
    secondaryMethod: 'MPESA' | 'PDQ' | 'CREDIT';
    secondaryAmount: number;
    secondaryReference?: string;
  };
  amountTendered?: number;
  changeGiven?: number;
  mpesaReference?: string;
  cashierName?: string;
  cashierId?: string;
  preparedBy?: string;
  approvedBy?: string;
  customerId?: string;
  customerName?: string;
  branchId: string;
  businessId: string;
  shiftId?: string; // Link to the specific shift session
  mpesaCode?: string;
  mpesaCustomer?: string;
  mpesaCheckoutRequestId?: string;
  pendingRefundItems?: { productId: string; quantity: number }[];
  discount?: number;
  discountType?: string;
  splitData?: any;
  isSynced?: number;
  updated_at?: number;
}

export interface CashPick {
  id: string;
  amount: number;
  timestamp: number;
  status: 'PENDING' | 'APPROVED';
  userName?: string;
  branchId: string;
  businessId: string;
  shiftId?: string; // Link to the specific shift session
  updated_at?: number;
}

export interface EndOfDayReport {
  id: string;
  shiftId?: string;
  timestamp: number;
  totalSales: number;
  grossSales: number;
  taxTotal: number;
  cashSales: number;
  mpesaSales: number;
  totalExpenses: number;
  totalPicks: number;
  totalRefunds?: number; // Total amount refunded during this shift
  expectedCash: number;
  reportedCash: number;
  difference: number;
  cashierName: string;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface Shift {
  id: string;
  startTime: number;
  endTime?: number;
  cashierName: string;
  status: 'OPEN' | 'CLOSED';
  branchId: string;
  businessId: string;
  lastSyncAt?: number;  // Timestamp of last successful cloud sync
  updated_at?: number;
}

export interface DailySummary {
  id: string;
  date: number;
  shiftIds: string[];
  totalSales: number;
  grossSales: number;
  taxTotal: number;
  totalExpenses: number;
  totalPicks: number;
  totalVariance: number;
  timestamp: number;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  type: 'IN' | 'OUT' | 'ADJUST' | 'RETURN';
  quantity: number; // Changed to allow decimals
  timestamp: number;
  reference: string;
  branchId: string;
  businessId: string;
  shiftId?: string; // Link to the shift if applicable (e.g. shop item expense)
  updated_at?: number;
}

export interface StockAdjustmentRequest {
  id: string;
  productId: string;
  productName: string;
  oldQty: number; // Changed to allow decimals
  newQty: number; // Changed to allow decimals
  reason: string;
  timestamp: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  preparedBy?: string;
  approvedBy?: string;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  totalSpent: number;
  balance: number;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface CustomerPayment {
  id: string;
  customerId: string;
  amount: number;
  paymentMethod: 'CASH' | 'MPESA' | 'BANK' | 'PDQ' | 'CHEQUE';
  transactionCode?: string;
  reference: string;
  allocations?: { sourceType: 'SALE' | 'INVOICE'; sourceId: string; amount: number }[];
  timestamp: number;
  preparedBy?: string;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface ServiceItem {
  id: string;
  name: string;
  category: string;
  description?: string;
  price: number;
  taxCategory: 'A' | 'E';
  isActive: boolean | number;
  businessId: string;
  updated_at?: number;
}

export interface SalesInvoiceItem {
  itemType: 'PRODUCT' | 'SERVICE' | 'CUSTOM';
  itemId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  taxCategory?: 'A' | 'E';
}

export interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  items: SalesInvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  paidAmount: number;
  balance: number;
  status: 'SENT' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  issueDate: number;
  dueDate?: number;
  notes?: string;
  preparedBy?: string;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface Supplier {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  address?: string;
  kraPin?: string;
  balance: number;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface CreditNote {
  id: string;
  supplierId: string;
  amount: number;
  reference: string;
  timestamp: number;
  reason: string;
  status: 'PENDING' | 'ALLOCATED';
  allocatedTo?: string; // e.g. an Invoice/PO reference
  productId?: string;
  quantity?: number;
  branchId?: string;
  businessId: string;
  shiftId?: string;
  updated_at?: number;
}

export interface SupplierPayment {
  id: string;
  supplierId: string;
  purchaseOrderId?: string;
  purchaseOrderIds?: string[];
  creditNoteIds?: string[];
  amount: number;
  paymentMethod: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE';
  transactionCode?: string;
  timestamp: number;
  reference: string;
  preparedBy?: string;
  source: 'TILL' | 'ACCOUNT'; // Fund source
  accountId?: string; // Link to FinancialAccount if source is ACCOUNT
  branchId: string;
  businessId: string;
  shiftId?: string; // Link to the shift
  updated_at?: number;
}

export interface Expense {
  id: string;
  amount: number;
  category: string;
  description: string;
  timestamp: number;
  userName?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  preparedBy?: string;
  approvedBy?: string;
  source: 'TILL' | 'ACCOUNT' | 'SHOP';
  accountId?: string; // Link to FinancialAccount if source is ACCOUNT
  productId?: string;
  quantity?: number;
  branchId: string;
  businessId: string;
  shiftId?: string; // Link to the shift
  updated_at?: number;
}

export interface FinancialAccount {
  id: string;
  name: string;
  type: 'BANK' | 'MPESA' | 'CASH';
  accountNumber?: string;
  balance: number;
  branchId?: string; // Optional: Link to a specific branch for local cash/accounts
  businessId: string;
  updated_at?: number;
}

export interface ExpenseAccount {
  id: string;
  name: string;
  description?: string;
  businessId: string;
  updated_at?: number;
}

export interface BusinessSettings {
  id: string;
  storeName: string;
  location: string;
  tillNumber: string;
  kraPin: string;
  receiptFooter: string;
  ownerModeEnabled?: number;
  autoApproveOwnerActions?: number;
  cashSweepEnabled?: number;
  cashDrawerLimit?: number;
  cashFloatTarget?: number;
  aiAssistantEnabled?: number;
  aiDailyRequestLimit?: number;
  businessId: string;
  updated_at?: number;
}

export interface Branch {
  id: string;
  name: string;
  location: string;
  phone?: string;
  tillNumber?: string;
  kraPin?: string;
  isActive: boolean;
  businessId: string;
  mpesaConsumerKey?: string;
  mpesaConsumerSecret?: string;
  mpesaPasskey?: string;
  mpesaEnv?: 'sandbox' | 'production';
  mpesaType?: 'paybill' | 'buygoods';
  mpesaStoreNumber?: string;
  mpesaConsumerKeySet?: boolean;
  mpesaConsumerSecretSet?: boolean;
  mpesaPasskeySet?: boolean;
  mpesaConfigured?: boolean;
  updated_at?: number;
}

export interface Category {
  id: string;
  name: string;
  iconName: string;
  color: string;
  businessId: string;
  branchId: string;
  updated_at?: number;
}

export interface PurchaseOrderItem {
  productId: string;
  name: string;
  expectedQuantity: number;
  receivedQuantity: number;
  unitCost: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  items: PurchaseOrderItem[];
  totalAmount: number;
  status: 'PENDING' | 'RECEIVED' | 'CANCELLED';
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  paymentStatus?: 'UNPAID' | 'PARTIAL' | 'PAID';
  paidAmount?: number;
  orderDate: number;
  expectedDate?: number;
  receivedDate?: number;
  invoiceNumber?: string;
  poNumber?: string;
  preparedBy?: string;
  approvedBy?: string;
  branchId: string;
  businessId: string;
  updated_at?: number;
}

// ── CloudDB ────────────────────────────────────────────────────────────────

export interface LoginAttempt {
  id: string; // Business Code
  count: number;
  lockedUntil: number | null;
  updated_at?: number;
}

class MtaaniCloudDB {

  businesses          = new CloudTable<Business>('businesses');
  loginAttempts       = new CloudTable<LoginAttempt>('loginAttempts');

  products            = new CloudTable<Product>('products');
  productIngredients  = new CloudTable<ProductIngredient>('productIngredients');
  transactions        = new CloudTable<Transaction>('transactions');
  cashPicks           = new CloudTable<CashPick>('cashPicks');
  endOfDayReports     = new CloudTable<EndOfDayReport>('endOfDayReports');
  stockMovements      = new CloudTable<StockMovement>('stockMovements');
  customers           = new CloudTable<Customer>('customers');
  customerPayments    = new CloudTable<CustomerPayment>('customerPayments');
  serviceItems        = new CloudTable<ServiceItem>('serviceItems');
  salesInvoices       = new CloudTable<SalesInvoice>('salesInvoices');
  suppliers           = new CloudTable<Supplier>('suppliers');
  supplierPayments    = new CloudTable<SupplierPayment>('supplierPayments');
  expenses            = new CloudTable<Expense>('expenses');
  settings            = new CloudTable<BusinessSettings>('settings');
  purchaseOrders      = new CloudTable<PurchaseOrder>('purchaseOrders');
  stockAdjustmentRequests = new CloudTable<StockAdjustmentRequest>('stockAdjustmentRequests');
  shifts              = new CloudTable<Shift>('shifts');
  dailySummaries      = new CloudTable<DailySummary>('dailySummaries');
  users               = new CloudTable<User>('users');
  creditNotes         = new CloudTable<CreditNote>('creditNotes');
  categories          = new CloudTable<Category>('categories');
  branches            = new CloudTable<Branch>('branches');
  expenseAccounts     = new CloudTable<ExpenseAccount>('expenseAccounts');
  financialAccounts   = new CloudTable<FinancialAccount>('financialAccounts');

  /**
   * Clear all tenant-scoped caches (everything except businesses).
   * This prevents cross-tenant "id collisions" (e.g. settings id "core") from
   * showing stale UI when switching businesses or after logout.
   */
  resetTenantCaches(): void {
    this.users.reset();
    this.branches.reset();
    this.settings.reset();

    // Branch-scoped / operational tables
    this.products.reset();
    this.productIngredients.reset();
    this.transactions.reset();
    this.cashPicks.reset();
    this.endOfDayReports.reset();
    this.stockMovements.reset();
    this.customers.reset();
    this.customerPayments.reset();
    this.serviceItems.reset();
    this.salesInvoices.reset();
    this.suppliers.reset();
    this.supplierPayments.reset();
    this.expenses.reset();
    this.purchaseOrders.reset();
    this.stockAdjustmentRequests.reset();
    this.shifts.reset();
    this.dailySummaries.reset();
    this.creditNotes.reset();
    this.categories.reset();
    this.expenseAccounts.reset();
    this.financialAccounts.reset();
    this.loginAttempts.reset();

  }

  /** Load initial bootstrap data (businesses) from D1. Call once on app startup. */
  async init(): Promise<void> {
    // 1. Ensure remote tables exist
    try {
      await setupRemoteDB();
    } catch (e) {
      console.warn('[DB] Remote setup failed or already done.', e);
    }

    // 2. Hydrate ONLY businesses. 
    // Other global tables (users, branches, settings) require an activeBusinessId
    // and will be hydrated during the login flow via db.sync().
    await Promise.all([
      this.businesses.hydrate()
    ]);
  }

  /** Force reload all data from cloud. Use for 'Hard Sync' buttons. */
  async sync(): Promise<void> {
    // Lazy import to break the circular dependency: db → store → db
    const { useStore } = await import('./store');
    const state = useStore.getState();
    const reloads: Array<() => Promise<void>> = [
      () => this.businesses.reload(),
      () => this.users.reload(),
      () => this.branches.reload(),
      () => this.settings.reload(),
    ];

    if (state.activeBranchId) {
      reloads.push(
        () => this.products.reload(),
        () => this.productIngredients.reload(),
        () => this.transactions.reload(),
        () => this.cashPicks.reload(),
        () => this.endOfDayReports.reload(),
        () => this.stockMovements.reload(),
        () => this.customers.reload(),
        () => this.customerPayments.reload(),
        () => this.serviceItems.reload(),
        () => this.salesInvoices.reload(),
        () => this.suppliers.reload(),
        () => this.supplierPayments.reload(),
        () => this.expenses.reload(),
        () => this.purchaseOrders.reload(),
        () => this.stockAdjustmentRequests.reload(),
        () => this.shifts.reload(),
        () => this.dailySummaries.reload(),
        () => this.creditNotes.reload(),
        () => this.categories.reload(),
        () => this.expenseAccounts.reload(),
        () => this.financialAccounts.reload()

      );
    }

    if (state.isSystemAdmin || state.currentUser?.role === 'ROOT') {
      reloads.push(() => this.loginAttempts.reload());
    }

    // Run all reloads in parallel for speed — failures are logged but don't block others
    const results = await Promise.allSettled(reloads.map(fn => fn()));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.warn(`[DB] sync: reload #${i} failed:`, result.reason);
      }
    });
  }

  /** Alias used by legacy components */
  syncAll = this.sync.bind(this);
}

export const db = new MtaaniCloudDB();

// ── Background Sync Wire-up ────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  import('./clouddb').then(({ startBackgroundSync }) => {
    // clouddb dispatches 'db:sync-request' on window so this listener fires.
    window.addEventListener('db:sync-request', () => {
      db.sync().catch(console.error);
    });
    // Start the 30s background sync loop
    startBackgroundSync(30000);
  });
}
