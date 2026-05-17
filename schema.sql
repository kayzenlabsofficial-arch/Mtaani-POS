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
    costPrice REAL,
    taxCategory TEXT NOT NULL,
    stockQuantity REAL NOT NULL,
    unit TEXT,
    barcode TEXT NOT NULL,
    imageUrl TEXT,
    reorderPoint REAL,
    isBundle INTEGER DEFAULT 0,
    components TEXT,
    businessId TEXT,
    branchId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS productIngredients (
    id TEXT PRIMARY KEY,
    productId TEXT NOT NULL,
    ingredientProductId TEXT NOT NULL,
    quantity REAL NOT NULL,
    businessId TEXT,
    updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_productIngredients_product ON productIngredients(productId);

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
    changeGiven REAL,
    mpesaReference TEXT,
    mpesaCode TEXT,
    mpesaCustomer TEXT,
    mpesaCheckoutRequestId TEXT,
    cashierId TEXT,
    cashierName TEXT,
    customerId TEXT,
    customerName TEXT,
    discount REAL,
    discountType TEXT,
    splitPayments TEXT,
    splitData TEXT,
    isSynced INTEGER,
    approvedBy TEXT,
    pendingRefundItems TEXT,
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
    shiftId TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    openingFloat REAL,
    cashierName TEXT NOT NULL,
    status TEXT NOT NULL,
    branchId TEXT,
    lastSyncAt INTEGER,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS endOfDayReports (
    id TEXT PRIMARY KEY,
    shiftId TEXT,
    timestamp INTEGER NOT NULL,
    openingFloat REAL,
    totalSales REAL NOT NULL,
    grossSales REAL NOT NULL,
    taxTotal REAL NOT NULL,
    cashSales REAL NOT NULL,
    mpesaSales REAL NOT NULL,
    totalExpenses REAL NOT NULL,
    totalPicks REAL NOT NULL,
    totalRefunds REAL,
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
    source TEXT,
    accountId TEXT,
    productId TEXT,
    quantity REAL,
    preparedBy TEXT,
    approvedBy TEXT,
    shiftId TEXT,
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

CREATE TABLE IF NOT EXISTS customerPayments (
    id TEXT PRIMARY KEY,
    customerId TEXT NOT NULL,
    amount REAL NOT NULL,
    paymentMethod TEXT NOT NULL,
    transactionCode TEXT,
    reference TEXT,
    allocations TEXT,
    timestamp INTEGER NOT NULL,
    preparedBy TEXT,
    branchId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS serviceItems (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    price REAL NOT NULL,
    taxCategory TEXT DEFAULT 'A',
    isActive INTEGER DEFAULT 1,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS salesInvoices (
    id TEXT PRIMARY KEY,
    invoiceNumber TEXT NOT NULL,
    customerId TEXT NOT NULL,
    customerName TEXT,
    customerPhone TEXT,
    customerEmail TEXT,
    items TEXT NOT NULL,
    subtotal REAL NOT NULL,
    tax REAL NOT NULL,
    total REAL NOT NULL,
    paidAmount REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    status TEXT NOT NULL,
    issueDate INTEGER NOT NULL,
    dueDate INTEGER,
    notes TEXT,
    preparedBy TEXT,
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
    address TEXT,
    kraPin TEXT,
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
    creditNoteIds TEXT,
    amount REAL NOT NULL,
    paymentMethod TEXT NOT NULL,
    transactionCode TEXT,
    timestamp INTEGER NOT NULL,
    reference TEXT,
    source TEXT,
    accountId TEXT,
    shiftId TEXT,
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
    status TEXT DEFAULT 'PENDING',
    allocatedTo TEXT,
    productId TEXT,
    quantity REAL,
    branchId TEXT,
    businessId TEXT,
    shiftId TEXT,
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
    poNumber TEXT,
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
    location TEXT,
    tillNumber TEXT,
    kraPin TEXT,
    receiptFooter TEXT,
    ownerModeEnabled INTEGER DEFAULT 0,
    autoApproveOwnerActions INTEGER DEFAULT 1,
    cashSweepEnabled INTEGER DEFAULT 1,
    cashDrawerLimit REAL DEFAULT 5000,
    cashFloatTarget REAL DEFAULT 1000,
    aiAssistantEnabled INTEGER DEFAULT 1,
    aiDailyRequestLimit INTEGER DEFAULT 20,
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
CREATE INDEX IF NOT EXISTS idx_salesInvoices_customer ON salesInvoices(customerId);
CREATE INDEX IF NOT EXISTS idx_transactions_branch ON transactions(branchId);
CREATE INDEX IF NOT EXISTS idx_shifts_branch ON shifts(branchId);

-- MIGRATION: Add branchId to existing tables (will fail if already present, which is fine in a script)
-- sqlite doesn't have "IF NOT EXISTS" for ADD COLUMN, so we'll run these individually if needed
-- or just rely on the "CREATE TABLE IF NOT EXISTS" above for fresh installs.
-- The following lines are for reference or manual execution:
-- ALTER TABLE transactions ADD COLUMN branchId TEXT;
-- ALTER TABLE transactions ADD COLUMN approvedBy TEXT;
-- ALTER TABLE transactions ADD COLUMN pendingRefundItems TEXT;
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
-- ALTER TABLE products ADD COLUMN isBundle INTEGER DEFAULT 0;
-- ALTER TABLE products ADD COLUMN components TEXT;
-- CREATE TABLE IF NOT EXISTS productIngredients (id TEXT PRIMARY KEY, productId TEXT NOT NULL, ingredientProductId TEXT NOT NULL, quantity REAL NOT NULL, businessId TEXT, updated_at INTEGER);
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
-- ALTER TABLE settings ADD COLUMN location TEXT;
-- ALTER TABLE settings ADD COLUMN ownerModeEnabled INTEGER DEFAULT 0;
-- ALTER TABLE settings ADD COLUMN autoApproveOwnerActions INTEGER DEFAULT 1;
-- ALTER TABLE settings ADD COLUMN cashSweepEnabled INTEGER DEFAULT 1;
-- ALTER TABLE settings ADD COLUMN cashDrawerLimit REAL DEFAULT 5000;
-- ALTER TABLE settings ADD COLUMN cashFloatTarget REAL DEFAULT 1000;
-- ALTER TABLE categories ADD COLUMN businessId TEXT;
-- ALTER TABLE branches ADD COLUMN businessId TEXT;

CREATE TABLE IF NOT EXISTS mpesaCallbacks (
    checkoutRequestId TEXT PRIMARY KEY,
    merchantRequestId TEXT,
    resultCode INTEGER,
    resultDesc TEXT,
    amount REAL,
    receiptNumber TEXT,
    phoneNumber TEXT,
    businessId TEXT,
    branchId TEXT,
    timestamp INTEGER,
    utilizedTransactionId TEXT,
    utilizedCustomerId TEXT,
    utilizedCustomerName TEXT,
    utilizedAt INTEGER
);

-- MIGRATION: Fix mpesaCallbacks missing columns
-- ALTER TABLE mpesaCallbacks ADD COLUMN businessId TEXT;
-- ALTER TABLE mpesaCallbacks ADD COLUMN branchId TEXT;
-- ALTER TABLE mpesaCallbacks ADD COLUMN utilizedTransactionId TEXT;
-- ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerId TEXT;
-- ALTER TABLE mpesaCallbacks ADD COLUMN utilizedCustomerName TEXT;
-- ALTER TABLE mpesaCallbacks ADD COLUMN utilizedAt INTEGER;

CREATE TABLE IF NOT EXISTS expenseAccounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    businessId TEXT,
    updated_at INTEGER
);

-- Offline sync / device monitoring
CREATE TABLE IF NOT EXISTS deviceSyncStatus (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    cashierName TEXT,
    lastSyncAt INTEGER,
    updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deviceSyncStatus_branch ON deviceSyncStatus(businessId, branchId, lastSyncAt);

-- Idempotency keys for outbox flush (prevents duplicates on reconnect/retry)
CREATE TABLE IF NOT EXISTS idempotencyKeys (
    id TEXT PRIMARY KEY, -- `${businessId}|${branchId}|${idempotencyKey}`
    businessId TEXT NOT NULL,
    branchId TEXT NOT NULL,
    idempotencyKey TEXT NOT NULL,
    operation TEXT NOT NULL,
    deviceId TEXT,
    cashierName TEXT,
    createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_idempotencyKeys_lookup ON idempotencyKeys(businessId, branchId, idempotencyKey);

CREATE TABLE IF NOT EXISTS aiUsage (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL,
    userId TEXT NOT NULL,
    userName TEXT,
    branchId TEXT,
    day TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_aiUsage_scope ON aiUsage(businessId, userId, day);

CREATE TABLE IF NOT EXISTS billingAccounts (
    businessId TEXT PRIMARY KEY,
    monthlyBaseFee REAL DEFAULT 3000,
    pricePerBranch REAL DEFAULT 500,
    discountType TEXT DEFAULT 'FIXED',
    discountValue REAL DEFAULT 0,
    dueDay INTEGER DEFAULT 5,
    bannerEnabled INTEGER DEFAULT 0,
    bannerMessage TEXT,
    allowPartial INTEGER DEFAULT 1,
    minPaymentAmount REAL DEFAULT 500,
    status TEXT DEFAULT 'ACTIVE',
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS billingInvoices (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL,
    period TEXT NOT NULL,
    branchCount INTEGER DEFAULT 0,
    monthlyBaseFee REAL DEFAULT 0,
    pricePerBranch REAL DEFAULT 0,
    subtotal REAL DEFAULT 0,
    discountType TEXT DEFAULT 'FIXED',
    discountValue REAL DEFAULT 0,
    discountAmount REAL DEFAULT 0,
    totalDue REAL DEFAULT 0,
    amountPaid REAL DEFAULT 0,
    balance REAL DEFAULT 0,
    dueDate INTEGER,
    status TEXT DEFAULT 'PENDING',
    notes TEXT,
    created_at INTEGER,
    updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_billingInvoices_business ON billingInvoices(businessId, period);

CREATE TABLE IF NOT EXISTS billingPayments (
    id TEXT PRIMARY KEY,
    invoiceId TEXT NOT NULL,
    businessId TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT NOT NULL,
    status TEXT DEFAULT 'PAID',
    receiptNumber TEXT,
    phoneNumber TEXT,
    checkoutRequestId TEXT,
    merchantRequestId TEXT,
    resultCode INTEGER,
    resultDesc TEXT,
    recordedBy TEXT,
    notes TEXT,
    timestamp INTEGER,
    updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_billingPayments_invoice ON billingPayments(invoiceId, status);
CREATE INDEX IF NOT EXISTS idx_billingPayments_checkout ON billingPayments(checkoutRequestId);
