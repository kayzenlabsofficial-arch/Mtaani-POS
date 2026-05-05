-- ============================================================
-- MTAANI POS - DEFINITIVE D1 SCHEMA (matches Dexie exactly)
-- Run with: npx wrangler d1 execute mtaani_pos_db --remote --file=schema.sql
-- ============================================================


CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    isActive INTEGER DEFAULT 1,
    updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    sellingPrice REAL NOT NULL,
    taxCategory TEXT NOT NULL,
    stockQuantity REAL NOT NULL,
    unit TEXT,
    barcode TEXT NOT NULL,
    imageUrl TEXT,
    businessId TEXT,
    branchId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    total REAL NOT NULL,
    subtotal REAL NOT NULL,
    tax REAL NOT NULL,
    discountAmount REAL,
    discountReason TEXT,
    items TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,
    paymentMethod TEXT,
    amountTendered REAL,
    cashierName TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS cashPicks (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,
    userName TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    openingFloat REAL NOT NULL,
    cashierName TEXT NOT NULL,
    status TEXT NOT NULL,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS endOfDayReports (
    id TEXT PRIMARY KEY,
    shiftId TEXT,
    timestamp INTEGER NOT NULL,
    openingFloat REAL NOT NULL,
    totalSales REAL NOT NULL,
    grossSales REAL NOT NULL,
    taxTotal REAL NOT NULL,
    cashSales REAL NOT NULL,
    mpesaSales REAL NOT NULL,
    totalExpenses REAL NOT NULL,
    totalPicks REAL NOT NULL,
    expectedCash REAL NOT NULL,
    reportedCash REAL NOT NULL,
    difference REAL NOT NULL,
    cashierName TEXT NOT NULL,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS stockMovements (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    type TEXT NOT NULL,
    quantity REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    reference TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    timestamp INTEGER NOT NULL,
    userName TEXT,
    status TEXT NOT NULL,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    totalSpent REAL,
    balance REAL,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    email TEXT,
    balance REAL,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

-- supplierPayments: matches Dexie interface exactly (including purchaseOrderId/purchaseOrderIds)
CREATE TABLE IF NOT EXISTS supplierPayments (
    id TEXT PRIMARY KEY,
    supplierId TEXT NOT NULL,
    purchaseOrderId TEXT,
    purchaseOrderIds TEXT,
    amount REAL NOT NULL,
    paymentMethod TEXT NOT NULL,
    transactionCode TEXT,
    timestamp INTEGER NOT NULL,
    reference TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS creditNotes (
    id TEXT PRIMARY KEY,
    supplierId TEXT NOT NULL,
    amount REAL NOT NULL,
    reference TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    reason TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS dailySummaries (
    id TEXT PRIMARY KEY,
    date INTEGER NOT NULL,
    shiftIds TEXT NOT NULL,
    totalSales REAL NOT NULL,
    grossSales REAL NOT NULL,
    taxTotal REAL NOT NULL,
    totalExpenses REAL NOT NULL,
    totalPicks REAL NOT NULL,
    totalVariance REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

-- stockAdjustmentRequests: matches Dexie interface exactly
CREATE TABLE IF NOT EXISTS stockAdjustmentRequests (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    productName TEXT,
    oldQty REAL,
    newQty REAL,
    requestedQuantity REAL,
    reason TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,
    preparedBy TEXT,
    approvedBy TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS purchaseOrders (
    id TEXT PRIMARY KEY,
    supplierId TEXT NOT NULL,
    items TEXT NOT NULL,
    totalAmount REAL NOT NULL,
    status TEXT NOT NULL,
    approvalStatus TEXT NOT NULL,
    paymentStatus TEXT,
    paidAmount REAL,
    orderDate INTEGER NOT NULL,
    expectedDate INTEGER,
    receivedDate INTEGER,
    invoiceNumber TEXT,
    preparedBy TEXT,
    approvedBy TEXT,
    receivedBy TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    storeName TEXT NOT NULL,
    tillNumber TEXT,
    kraPin TEXT,
    receiptFooter TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    iconName TEXT NOT NULL,
    color TEXT NOT NULL,
    businessId TEXT,
    branchId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    phone TEXT,
    tillNumber TEXT,
    kraPin TEXT,
    isActive INTEGER NOT NULL DEFAULT 1,
    businessId TEXT,
    mpesaConsumerKey TEXT,
    mpesaConsumerSecret TEXT,
    mpesaPasskey TEXT,
    mpesaEnv TEXT,
    mpesaType TEXT DEFAULT 'paybill',
    mpesaStoreNumber TEXT,
    updated_at INTEGER
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
CREATE INDEX IF NOT EXISTS idx_transactions_branch ON transactions(branchId);
CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branchId);

-- MIGRATION: Add branchId to existing tables (will fail if already present, which is fine in a script)
-- sqlite doesn't have "IF NOT EXISTS" for ADD COLUMN, so we'll run these individually if needed
-- or just rely on the "CREATE TABLE IF NOT EXISTS" above for fresh installs.
-- The following lines are for reference or manual execution:
-- ALTER TABLE transactions ADD COLUMN branchId TEXT;
-- ALTER TABLE shifts ADD COLUMN branchId TEXT;
-- ALTER TABLE endOfDayReports ADD COLUMN branchId TEXT;
-- ALTER TABLE expenses ADD COLUMN branchId TEXT;
-- ALTER TABLE cashPicks ADD COLUMN branchId TEXT;
-- ALTER TABLE stockMovements ADD COLUMN branchId TEXT;
-- ALTER TABLE stockAdjustmentRequests ADD COLUMN branchId TEXT;
-- ALTER TABLE purchaseOrders ADD COLUMN branchId TEXT;
-- ALTER TABLE supplierPayments ADD COLUMN branchId TEXT;
-- ALTER TABLE dailySummaries ADD COLUMN branchId TEXT;

-- MIGRATION: Add businessId to existing tables
-- ALTER TABLE users ADD COLUMN businessId TEXT;
-- ALTER TABLE products ADD COLUMN businessId TEXT;
-- ALTER TABLE transactions ADD COLUMN businessId TEXT;
-- ALTER TABLE cashPicks ADD COLUMN businessId TEXT;
-- ALTER TABLE shifts ADD COLUMN businessId TEXT;
-- ALTER TABLE endOfDayReports ADD COLUMN businessId TEXT;
-- ALTER TABLE stockMovements ADD COLUMN businessId TEXT;
-- ALTER TABLE expenses ADD COLUMN businessId TEXT;
-- ALTER TABLE customers ADD COLUMN businessId TEXT;
-- ALTER TABLE suppliers ADD COLUMN businessId TEXT;
-- ALTER TABLE supplierPayments ADD COLUMN businessId TEXT;
-- ALTER TABLE creditNotes ADD COLUMN businessId TEXT;
-- ALTER TABLE dailySummaries ADD COLUMN businessId TEXT;
-- ALTER TABLE stockAdjustmentRequests ADD COLUMN businessId TEXT;
-- ALTER TABLE purchaseOrders ADD COLUMN businessId TEXT;
-- ALTER TABLE settings ADD COLUMN businessId TEXT;
-- ALTER TABLE categories ADD COLUMN businessId TEXT;
-- ALTER TABLE branches ADD COLUMN businessId TEXT;
