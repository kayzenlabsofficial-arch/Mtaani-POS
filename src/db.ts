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
  role: 'ADMIN' | 'CASHIER' | 'MANAGER';
  businessId: string;
  updated_at?: number;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  sellingPrice: number;
  taxCategory: 'A' | 'C' | 'E';
  stockQuantity: number; // Changed to allow decimals
  unit?: string; // e.g. 'pcs', 'm', 'kg', 'tot'
  barcode: string;
  imageUrl?: string;
  businessId: string;
  updated_at?: number;
}

export interface TransactionItem {
  productId: string;
  name: string;
  snapshotPrice: number;
  quantity: number; // Changed to allow decimals
  unit?: string;
  returnedQuantity?: number;
  taxCategory: 'A' | 'C' | 'E';
}

export interface Transaction {
  id: string;
  total: number;
  subtotal: number;
  tax: number;
  discountAmount?: number;
  discountReason?: string;
  items: TransactionItem[];
  timestamp: number;
  status: 'QUOTE' | 'PAID' | 'VOIDED' | 'REFUNDED' | 'PARTIAL_REFUND' | 'PENDING_REFUND';
  paymentMethod?: 'CASH' | 'MPESA';
  amountTendered?: number;
  changeGiven?: number;
  cashierName?: string;
  preparedBy?: string;
  approvedBy?: string;
  branchId: string;
  businessId: string;
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
  updated_at?: number;
}

export interface EndOfDayReport {
  id: string;
  shiftId?: string;
  timestamp: number;
  openingFloat: number;
  totalSales: number;
  grossSales: number;
  taxTotal: number;
  cashSales: number;
  mpesaSales: number;
  totalExpenses: number;
  totalPicks: number;
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
  openingFloat: number;
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
  businessId: string;
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
  branchId: string;
  businessId: string;
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
  branchId: string;
  businessId: string;
  updated_at?: number;
}

export interface BusinessSettings {
  id: string;
  storeName: string;
  tillNumber: string;
  kraPin: string;
  receiptFooter: string;
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
  updated_at?: number;
}

export interface Category {
  id: string;
  name: string;
  iconName: string;
  color: string;
  businessId: string;
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

class MtaaniCloudDB {
  businesses          = new CloudTable<Business>('businesses');
  products            = new CloudTable<Product>('products');
  transactions        = new CloudTable<Transaction>('transactions');
  cashPicks           = new CloudTable<CashPick>('cashPicks');
  endOfDayReports     = new CloudTable<EndOfDayReport>('endOfDayReports');
  stockMovements      = new CloudTable<StockMovement>('stockMovements');
  customers           = new CloudTable<Customer>('customers');
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

  /** Load all tables from D1 in parallel. Call once on app startup. */
  async init(): Promise<void> {
    // 1. Ensure remote tables exist
    try {
      await setupRemoteDB();
    } catch (e) {
      console.warn('[DB] Remote setup failed or already done.', e);
    }

    // 2. Hydrate all tables from D1
    await Promise.all([
      this.businesses.hydrate(),
      this.products.hydrate(),
      this.transactions.hydrate(),
      this.cashPicks.hydrate(),
      this.endOfDayReports.hydrate(),
      this.stockMovements.hydrate(),
      this.customers.hydrate(),
      this.suppliers.hydrate(),
      this.supplierPayments.hydrate(),
      this.expenses.hydrate(),
      this.settings.hydrate(),
      this.purchaseOrders.hydrate(),
      this.stockAdjustmentRequests.hydrate(),
      this.shifts.hydrate(),
      this.dailySummaries.hydrate(),
      this.users.hydrate(),
      this.creditNotes.hydrate(),
      this.categories.hydrate(),
      this.branches.hydrate(),
    ]);
  }

  /** Force reload all data from cloud. Use for 'Hard Sync' buttons. */
  async sync(): Promise<void> {
    await Promise.all([
      this.businesses.reload(),
      this.products.reload(),
      this.transactions.reload(),
      this.cashPicks.reload(),
      this.endOfDayReports.reload(),
      this.stockMovements.reload(),
      this.customers.reload(),
      this.suppliers.reload(),
      this.supplierPayments.reload(),
      this.expenses.reload(),
      this.settings.reload(),
      this.purchaseOrders.reload(),
      this.stockAdjustmentRequests.reload(),
      this.shifts.reload(),
      this.dailySummaries.reload(),
      this.users.reload(),
      this.creditNotes.reload(),
      this.categories.reload(),
      this.branches.reload(),
    ]);
  }

  /** Alias used by legacy components */
  syncAll = this.sync.bind(this);
}

export const db = new MtaaniCloudDB();

// ── seedInitialData ────────────────────────────────────────────────────────
// Seeds D1 with default data if the database is empty.

import { useStore } from './store';

export const seedInitialData = async () => {
  try {
    // Determine active business ID or fallback to default
    let businessId = useStore.getState().activeBusinessId;
    if (!businessId) {
       // If no business ID is set, check if a default business exists, else create it
       const defaultBiz = await db.businesses.get('biz_001');
       if (!defaultBiz) {
         await db.businesses.add({ id: 'biz_001', name: 'Default Business', code: 'MTAANI01' });
       }
       businessId = 'biz_001';
       useStore.getState().setActiveBusinessId(businessId);
    }

    // ── Users ────────────────────────────────────────────────────────────────
    const userCount = await db.users.count();
    if (userCount === 0) {
      await db.users.bulkAdd([
        { id: 'u1', name: 'Admin',           password: 'admin123', role: 'ADMIN',   businessId },
        { id: 'u2', name: 'Default Cashier', password: '0000',     role: 'CASHIER', businessId },
        { id: 'u3', name: 'Store Manager',   password: '5555',     role: 'MANAGER', businessId },
      ]);
    } else {
      // Ensure admin always exists with correct credentials
      const admin = (await db.users.toArray()).find(u => u.role === 'ADMIN');
      if (!admin) {
        await db.users.add({ id: `u1_${businessId}`, name: 'Admin', password: 'admin123', role: 'ADMIN', businessId });
      }
    }

    // ── Branches ──────────────────────────────────────────────────────────────
    const branchCount = await db.branches.count();
    if (branchCount === 0) {
      await db.branches.bulkAdd([
        { id: 'branch_main', name: 'Main Branch', location: 'Nairobi', isActive: true, businessId },
      ]);
    }

    // ── Categories ────────────────────────────────────────────────────────────
    const catCount = await db.categories.count();
    if (catCount === 0) {
      await db.categories.bulkAdd([
        { id: 'cat1', name: 'Food Stuffs', iconName: 'Utensils',    color: 'orange', businessId },
        { id: 'cat2', name: 'Beverages',   iconName: 'GlassWater',  color: 'blue',   businessId },
        { id: 'cat3', name: 'Supplies',    iconName: 'ShoppingBag', color: 'purple', businessId },
        { id: 'cat4', name: 'Utilities',   iconName: 'Lightbulb',   color: 'yellow', businessId },
        { id: 'cat5', name: 'Other',       iconName: 'Package',     color: 'slate',  businessId },
      ]);
    }

    // ── Products ──────────────────────────────────────────────────────────────
    const productCount = await db.products.count();
    if (productCount === 0) {
      await db.products.bulkAdd([
        { id: '1', name: 'Premium Coffee 500g', category: 'Beverages',  sellingPrice: 1200, taxCategory: 'A', stockQuantity: 45,  barcode: '600123', businessId },
        { id: '2', name: 'Maize Flour 2kg',     category: 'Food Stuffs', sellingPrice: 180,  taxCategory: 'C', stockQuantity: 120, barcode: '600456', businessId },
        { id: '3', name: 'Cooking Oil 1L',      category: 'Food Stuffs', sellingPrice: 350,  taxCategory: 'A', stockQuantity: 12,  barcode: '600789', businessId },
        { id: '4', name: 'Sugar 1kg',           category: 'Food Stuffs', sellingPrice: 150,  taxCategory: 'A', stockQuantity: 200, barcode: '600111', businessId },
        { id: '5', name: 'Tea Leaves 250g',     category: 'Beverages',  sellingPrice: 200,  taxCategory: 'A', stockQuantity: 80,  barcode: '600222', businessId },
        { id: '6', name: 'Salt 500g',           category: 'Food Stuffs', sellingPrice: 30,   taxCategory: 'C', stockQuantity: 300, barcode: '600333', businessId },
        { id: '7', name: 'Milk 1L',             category: 'Beverages',  sellingPrice: 100,  taxCategory: 'A', stockQuantity: 50,  barcode: '600444', businessId },
      ]);
    }

    // ── Suppliers ─────────────────────────────────────────────────────────────
    const supplierCount = await db.suppliers.count();
    if (supplierCount === 0) {
      await db.suppliers.bulkAdd([
        { id: 's1', name: 'John Kamau', company: 'Nairobi Wholesale',  phone: '0711222333', email: 'sales@nairobiwholesale.com', balance: 15000, branchId: 'branch_main', businessId },
        { id: 's2', name: 'Mary Atieno', company: 'Fresh Produce Hub', phone: '0722333444', email: 'mary@freshproduce.com', balance: 5400, branchId: 'branch_main', businessId },
      ]);
    }

    // ── Customers ─────────────────────────────────────────────────────────────
    const customerCount = await db.customers.count();
    if (customerCount === 0) {
      await db.customers.bulkAdd([
        { id: 'c1', name: 'Alice Wambui', phone: '0700111222', email: 'alice@gmail.com', totalSpent: 4500, balance: 0, branchId: 'branch_main', businessId },
        { id: 'c2', name: 'Bob Otieno',   phone: '0711999888', email: 'bob@yahoo.com',   totalSpent: 1200, balance: 0, branchId: 'branch_main', businessId },
      ]);
    }

    // ── Expenses ──────────────────────────────────────────────────────────────
    const expenseCount = await db.expenses.count();
    if (expenseCount === 0) {
      const now = Date.now();
      await db.expenses.bulkAdd([
        { id: 'e1', amount: 3500, category: 'Utilities', description: 'Electricity Bill - April', timestamp: now - 86400000 * 2, status: 'APPROVED', branchId: 'branch_main', businessId },
        { id: 'e2', amount: 1200, category: 'Supplies',  description: 'Cleaning Detergents',      timestamp: now - 86400000 * 1, status: 'APPROVED', branchId: 'branch_main', businessId },
      ]);
    }

    // ── Sample Transactions ────────────────────────────────────────────────────
    const txCount = await db.transactions.count();
    if (txCount === 0) {
      const now = Date.now();
      await db.transactions.bulkAdd([
        {
          id: 't1', subtotal: 2400, tax: 384, discountAmount: 200, total: 2584,
          timestamp: now - 3600000 * 5, status: 'PAID', paymentMethod: 'MPESA',
          cashierName: 'Admin', branchId: 'branch_main', businessId,
          items: [{ productId: '1', name: 'Premium Coffee 500g', snapshotPrice: 1200, quantity: 2, taxCategory: 'A' }]
        },
        {
          id: 't2', subtotal: 350, tax: 56, total: 406,
          timestamp: now - 3600000 * 2, status: 'PAID', paymentMethod: 'CASH',
          cashierName: 'Admin', branchId: 'branch_main', businessId,
          items: [{ productId: '3', name: 'Cooking Oil 1L', snapshotPrice: 350, quantity: 1, taxCategory: 'A' }]
        },
      ]);
    }

    // ── Credit Notes ──────────────────────────────────────────────────────────
    const cnCount = await db.creditNotes.count();
    if (cnCount === 0) {
      await db.creditNotes.add({
        id: 'cn1', supplierId: 's1', amount: 2500,
        reference: 'CRN-001', timestamp: Date.now() - 86400000, reason: 'Damaged goods return',
        businessId
      });
    }

  } catch (err) {
    console.error('[DB] Seed error:', err);
  }
};
