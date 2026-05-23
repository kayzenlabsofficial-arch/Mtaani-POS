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
    discountType TEXT DEFAULT 'NONE',
    discountValue REAL DEFAULT 0,
    taxCategory TEXT NOT NULL,
    stockQuantity REAL NOT NULL,
    unit TEXT,
    barcode TEXT NOT NULL,
    imageUrl TEXT,
    reorderPoint REAL,
    supplierIds TEXT,
    expiryTracking INTEGER DEFAULT 0,
    expiryDate INTEGER,
    isBundle INTEGER DEFAULT 0,
    components TEXT,
    businessId TEXT,
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
    shiftId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS cashPicks (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,
    userName TEXT,
    accountId TEXT,
    shiftId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    originalTransactionId TEXT NOT NULL,
    receiptNumber TEXT,
    amount REAL NOT NULL,
    cashAmount REAL DEFAULT 0,
    paymentMethod TEXT,
    source TEXT,
    items TEXT,
    timestamp INTEGER NOT NULL,
    cashierName TEXT,
    approvedBy TEXT,
    status TEXT NOT NULL DEFAULT 'APPROVED',
    shiftId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    startTime INTEGER NOT NULL,
    endTime INTEGER,
    cashierId TEXT,
    cashierName TEXT NOT NULL,
    tillId TEXT,
    tillName TEXT,
    openingCash REAL DEFAULT 0,
    closingCash REAL,
    expectedCash REAL,
    cashVariance REAL,
    closeBreakdown TEXT,
    status TEXT NOT NULL,
    lastSyncAt INTEGER,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS endOfDayReports (
    id TEXT PRIMARY KEY,
    shiftId TEXT,
    tillId TEXT,
    tillName TEXT,
    timestamp INTEGER NOT NULL,
    totalSales REAL NOT NULL,
    grossSales REAL NOT NULL,
    taxTotal REAL NOT NULL,
    cashSales REAL NOT NULL,
    customerCashPayments REAL DEFAULT 0,
    mpesaSales REAL NOT NULL,
    pdqSales REAL,
    totalExpenses REAL NOT NULL,
    supplierPaymentsTotal REAL,
    remittanceTotal REAL,
    totalPicks REAL NOT NULL,
    totalRefunds REAL,
    cashRefunds REAL DEFAULT 0,
    openingCash REAL DEFAULT 0,
    closingCash REAL,
    expectedCash REAL NOT NULL,
    reportedCash REAL NOT NULL,
    difference REAL NOT NULL,
    cashierId TEXT,
    cashierName TEXT NOT NULL,
    closeBreakdown TEXT,
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
    businessId TEXT,
    shiftId TEXT,
    expiryDate INTEGER,
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
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS hrStaff (
    id TEXT PRIMARY KEY,
    fullName TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    roleTitle TEXT NOT NULL,
    department TEXT,
    nationalId TEXT,
    kraPin TEXT,
    nhifNumber TEXT,
    nssfNumber TEXT,
    hireDate INTEGER,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    baseSalary REAL DEFAULT 0,
    payCycle TEXT DEFAULT 'MONTHLY',
    emergencyContact TEXT,
    notes TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS hrStaffDocuments (
    id TEXT PRIMARY KEY,
    staffId TEXT NOT NULL,
    name TEXT NOT NULL,
    documentType TEXT NOT NULL,
    documentNumber TEXT,
    issueDate INTEGER,
    expiryDate INTEGER,
    fileName TEXT,
    fileUrl TEXT,
    notes TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS hrAttendance (
    id TEXT PRIMARY KEY,
    staffId TEXT NOT NULL,
    date INTEGER NOT NULL,
    checkIn TEXT,
    checkOut TEXT,
    status TEXT NOT NULL,
    hoursWorked REAL,
    notes TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS hrPayrollAdjustments (
    id TEXT PRIMARY KEY,
    staffId TEXT NOT NULL,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    amount REAL NOT NULL,
    effectiveDate INTEGER NOT NULL,
    recurring INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    notes TEXT,
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
    shiftId TEXT,
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
    businessId TEXT,
    updated_at INTEGER
);

-- supplierPayments: matches Dexie interface exactly (including purchaseOrderId/purchaseOrderIds)
CREATE TABLE IF NOT EXISTS supplierPayments (
    id TEXT PRIMARY KEY,
    supplierId TEXT NOT NULL,
    purchaseOrderId TEXT,
    purchaseOrderIds TEXT,
    invoiceAllocations TEXT,
    creditNoteIds TEXT,
    amount REAL NOT NULL,
    paymentMethod TEXT NOT NULL,
    transactionCode TEXT,
    timestamp INTEGER NOT NULL,
    reference TEXT,
    source TEXT,
    accountId TEXT,
    shiftId TEXT,
    preparedBy TEXT,
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
    items TEXT,
    productId TEXT,
    quantity REAL,
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
    totalRefunds REAL,
    totalVariance REAL NOT NULL,
    timestamp INTEGER NOT NULL,
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
    salesTills TEXT,
    defaultOpeningFloat REAL DEFAULT 0,
    mpesaConsumerKey TEXT,
    mpesaConsumerSecret TEXT,
    mpesaPasskey TEXT,
    mpesaEnv TEXT DEFAULT 'sandbox',
    mpesaType TEXT DEFAULT 'paybill',
    mpesaStoreNumber TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS salesTills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    isActive INTEGER DEFAULT 1,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    iconName TEXT NOT NULL,
    color TEXT NOT NULL,
    businessId TEXT,
    updated_at INTEGER
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
CREATE INDEX IF NOT EXISTS idx_salesInvoices_customer ON salesInvoices(customerId);

CREATE TABLE IF NOT EXISTS mpesaCallbacks (
    checkoutRequestId TEXT PRIMARY KEY,
    merchantRequestId TEXT,
    resultCode INTEGER,
    resultDesc TEXT,
    amount REAL,
    receiptNumber TEXT,
    phoneNumber TEXT,
    businessId TEXT,
    timestamp INTEGER,
    utilizedTransactionId TEXT,
    utilizedCustomerId TEXT,
    utilizedCustomerName TEXT,
    utilizedAt INTEGER
);

CREATE TABLE IF NOT EXISTS expenseAccounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS financialAccounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    businessId TEXT,
    accountNumber TEXT,
    updated_at INTEGER
);

-- Offline sync / device monitoring
CREATE TABLE IF NOT EXISTS deviceSyncStatus (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    cashierName TEXT,
    lastSyncAt INTEGER,
    updated_at INTEGER
);

-- Idempotency keys for outbox flush (prevents duplicates on reconnect/retry)
CREATE TABLE IF NOT EXISTS idempotencyKeys (
    id TEXT PRIMARY KEY, -- `${businessId}|${idempotencyKey}`
    businessId TEXT NOT NULL,
    idempotencyKey TEXT NOT NULL,
    operation TEXT NOT NULL,
    deviceId TEXT,
    cashierName TEXT,
    transactionId TEXT,
    createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loginAttempts (
    id TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    lockedUntil INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS auditLogs (
    id TEXT PRIMARY KEY,
    ts INTEGER NOT NULL,
    userId TEXT,
    userName TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entityId TEXT,
    severity TEXT NOT NULL,
    details TEXT,
    businessId TEXT,
    updated_at INTEGER
);
