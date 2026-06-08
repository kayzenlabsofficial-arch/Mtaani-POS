-- ============================================================
-- SMART POS - DEFINITIVE D1 SCHEMA (matches Dexie exactly)
-- Run with: npx wrangler d1 execute smart_pos_db --remote --file=schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    isActive INTEGER DEFAULT 1,
    billingStatus TEXT NOT NULL DEFAULT 'OK',
    billingAmountDue REAL DEFAULT 0,
    billingDueAt INTEGER,
    billingMessage TEXT,
    billingLastPaidAt INTEGER,
    updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    businessId TEXT,
    mustChangePassword INTEGER DEFAULT 0,
    isBootstrapAdmin INTEGER DEFAULT 0,
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
    shopId TEXT,
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

CREATE TRIGGER IF NOT EXISTS products_non_negative_stock_guard
BEFORE UPDATE OF stockQuantity ON products
WHEN NEW.stockQuantity < -0.0001
BEGIN
    SELECT RAISE(ABORT, 'Insufficient stock.');
END;

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
    shopId TEXT,
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
    shopId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    refundNumber TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_till
ON shifts(businessId, COALESCE(NULLIF(shopId, ''), 'single-shop'), tillId)
WHERE UPPER(COALESCE(status, '')) = 'OPEN'
  AND COALESCE(tillId, '') != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_cashier
ON shifts(businessId, COALESCE(NULLIF(shopId, ''), 'single-shop'), cashierId)
WHERE UPPER(COALESCE(status, '')) = 'OPEN'
  AND COALESCE(cashierId, '') != '';

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
    customerMpesaPayments REAL DEFAULT 0,
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
    shopId TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_hrStaff_status ON hrStaff(businessId, shopId, status);
CREATE INDEX IF NOT EXISTS idx_hrStaffDocuments_staff ON hrStaffDocuments(businessId, shopId, staffId);
CREATE INDEX IF NOT EXISTS idx_hrAttendance_staff_date ON hrAttendance(businessId, shopId, staffId, date);
CREATE INDEX IF NOT EXISTS idx_hrPayrollAdjustments_staff_date ON hrPayrollAdjustments(businessId, shopId, staffId, effectiveDate);

CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    totalSpent REAL,
    balance REAL,
    shopId TEXT,
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
    shopId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_customerPayments_code ON customerPayments(businessId, transactionCode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customerPayments_unique_code ON customerPayments(businessId, transactionCode)
    WHERE transactionCode IS NOT NULL AND transactionCode != '';

CREATE TRIGGER IF NOT EXISTS customerPayments_balance_guard
BEFORE INSERT ON customerPayments
WHEN NEW.amount > 0
BEGIN
    SELECT RAISE(ABORT, 'Customer was not found.')
    WHERE NOT EXISTS (
        SELECT 1 FROM customers
        WHERE id = NEW.customerId
          AND businessId = NEW.businessId
    );
    SELECT RAISE(ABORT, 'Payment cannot exceed the customer balance.')
    WHERE (
        SELECT COALESCE(balance, 0)
        FROM customers
        WHERE id = NEW.customerId
          AND businessId = NEW.businessId
    ) + 0.01 < NEW.amount;
END;

CREATE TRIGGER IF NOT EXISTS customerPayments_code_guard
BEFORE INSERT ON customerPayments
WHEN NEW.transactionCode IS NOT NULL AND NEW.transactionCode != ''
BEGIN
    SELECT RAISE(ABORT, 'This payment code has already been used.')
    WHERE EXISTS (
        SELECT 1 FROM customerPayments
        WHERE businessId = NEW.businessId
          AND UPPER(COALESCE(transactionCode, '')) = UPPER(NEW.transactionCode)
    );
END;

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
    shiftId TEXT,
    shopId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_salesInvoices_business_number ON salesInvoices(businessId, invoiceNumber);

CREATE TRIGGER IF NOT EXISTS customerPayments_invoice_allocation_guard
BEFORE INSERT ON customerPayments
WHEN NEW.allocations IS NOT NULL AND TRIM(NEW.allocations) != ''
BEGIN
    SELECT RAISE(ABORT, 'Payment allocations are invalid.')
    WHERE json_valid(NEW.allocations) = 0;
    SELECT RAISE(ABORT, 'Payment allocation refers to an invoice that was not found.')
    WHERE EXISTS (
        SELECT 1
        FROM json_each(NEW.allocations) allocation
        WHERE UPPER(COALESCE(json_extract(allocation.value, '$.sourceType'), '')) = 'INVOICE'
          AND NOT EXISTS (
              SELECT 1
              FROM salesInvoices invoice
              WHERE invoice.id = json_extract(allocation.value, '$.sourceId')
                AND invoice.customerId = NEW.customerId
                AND invoice.businessId = NEW.businessId
          )
    );
    SELECT RAISE(ABORT, 'Cannot allocate payment to a cancelled invoice.')
    WHERE EXISTS (
        SELECT 1
        FROM json_each(NEW.allocations) allocation
        JOIN salesInvoices invoice
          ON invoice.id = json_extract(allocation.value, '$.sourceId')
         AND invoice.customerId = NEW.customerId
         AND invoice.businessId = NEW.businessId
        WHERE UPPER(COALESCE(json_extract(allocation.value, '$.sourceType'), '')) = 'INVOICE'
          AND invoice.status = 'CANCELLED'
    );
    SELECT RAISE(ABORT, 'Payment allocation exceeds an invoice balance.')
    WHERE EXISTS (
        SELECT 1
        FROM json_each(NEW.allocations) allocation
        JOIN salesInvoices invoice
          ON invoice.id = json_extract(allocation.value, '$.sourceId')
         AND invoice.customerId = NEW.customerId
         AND invoice.businessId = NEW.businessId
        WHERE UPPER(COALESCE(json_extract(allocation.value, '$.sourceType'), '')) = 'INVOICE'
          AND CAST(COALESCE(json_extract(allocation.value, '$.amount'), 0) AS REAL) > COALESCE(invoice.balance, invoice.total, 0) + 0.01
    );
END;

CREATE TRIGGER IF NOT EXISTS customerPayments_immutable_money_guard
BEFORE UPDATE OF customerId, amount, allocations, businessId ON customerPayments
BEGIN
    SELECT RAISE(ABORT, 'Customer payment records cannot be edited after saving.')
    WHERE COALESCE(NEW.customerId, '') != COALESCE(OLD.customerId, '')
       OR ABS(COALESCE(NEW.amount, 0) - COALESCE(OLD.amount, 0)) > 0.0001
       OR COALESCE(NEW.allocations, '') != COALESCE(OLD.allocations, '')
       OR COALESCE(NEW.businessId, '') != COALESCE(OLD.businessId, '');
END;

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    company TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    kraPin TEXT,
    balance REAL,
    shopId TEXT,
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
    shopId TEXT,
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
    shopId TEXT,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS dailySummaries (
    id TEXT PRIMARY KEY,
    date INTEGER NOT NULL,
    shiftIds TEXT NOT NULL,
    totalSales REAL NOT NULL,
    grossSales REAL NOT NULL,
    taxTotal REAL NOT NULL,
    cashSales REAL DEFAULT 0,
    customerCashPayments REAL DEFAULT 0,
    customerMpesaPayments REAL DEFAULT 0,
    mpesaSales REAL DEFAULT 0,
    pdqSales REAL DEFAULT 0,
    totalExpenses REAL NOT NULL,
    supplierPaymentsTotal REAL DEFAULT 0,
    remittanceTotal REAL DEFAULT 0,
    totalPicks REAL NOT NULL,
    totalRefunds REAL,
    cashRefunds REAL DEFAULT 0,
    openingCash REAL DEFAULT 0,
    expectedCash REAL DEFAULT 0,
    reportedCash REAL DEFAULT 0,
    totalVariance REAL NOT NULL,
    shiftReports TEXT,
    timestamp INTEGER NOT NULL,
    shopId TEXT,
    businessId TEXT,
    updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dailySummaries_business_date
ON dailySummaries(businessId, COALESCE(NULLIF(shopId, ''), 'single-shop'), date);

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
    shopId TEXT,
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
    shopId TEXT,
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
    accessControl TEXT,
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
CREATE INDEX IF NOT EXISTS idx_products_business_shop ON products(businessId, shopId);
CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_stockmovements_product ON stockMovements(productId);
CREATE INDEX IF NOT EXISTS idx_stockmovements_business_shop_product ON stockMovements(businessId, shopId, productId);
CREATE INDEX IF NOT EXISTS idx_stockadjustments_business_shop ON stockAdjustmentRequests(businessId, shopId);
CREATE INDEX IF NOT EXISTS idx_purchaseorders_business_shop ON purchaseOrders(businessId, shopId);
CREATE INDEX IF NOT EXISTS idx_creditnotes_business_shop ON creditNotes(businessId, shopId);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_shop ON suppliers(businessId, shopId);
CREATE INDEX IF NOT EXISTS idx_expenses_business_shop_timestamp ON expenses(businessId, shopId, timestamp);
CREATE INDEX IF NOT EXISTS idx_expenses_business_status_timestamp ON expenses(businessId, status, timestamp);
CREATE INDEX IF NOT EXISTS idx_cashPicks_business_shop_timestamp ON cashPicks(businessId, shopId, timestamp);
CREATE INDEX IF NOT EXISTS idx_endofday_business_shop_timestamp ON endOfDayReports(businessId, shopId, timestamp);
CREATE INDEX IF NOT EXISTS idx_shifts_business_shop_status ON shifts(businessId, shopId, status);
CREATE INDEX IF NOT EXISTS idx_dailySummaries_business_shop_date ON dailySummaries(businessId, shopId, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchaseOrders_business_poNumber ON purchaseOrders(businessId, poNumber)
    WHERE poNumber IS NOT NULL AND poNumber != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchaseOrders_supplier_invoice ON purchaseOrders(businessId, supplierId, invoiceNumber)
    WHERE invoiceNumber IS NOT NULL AND invoiceNumber != '';
CREATE INDEX IF NOT EXISTS idx_salesInvoices_customer ON salesInvoices(customerId);

CREATE TABLE IF NOT EXISTS mpesaCallbacks (
    checkoutRequestId TEXT PRIMARY KEY,
    merchantRequestId TEXT,
    resultCode INTEGER,
    resultDesc TEXT,
    amount REAL,
    receiptNumber TEXT,
    phoneNumber TEXT,
    provider TEXT DEFAULT 'MPESA',
    redirectUrl TEXT,
    businessId TEXT,
    timestamp INTEGER,
    utilizedTransactionId TEXT,
    utilizedCustomerId TEXT,
    utilizedCustomerName TEXT,
    utilizedAt INTEGER
);

CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_receipt ON mpesaCallbacks(businessId, receiptNumber);
CREATE INDEX IF NOT EXISTS idx_mpesaCallbacks_utilized ON mpesaCallbacks(businessId, utilizedTransactionId);

CREATE TABLE IF NOT EXISTS mpesaCredentials (
    businessId TEXT PRIMARY KEY,
    settingsId TEXT,
    paymentProvider TEXT NOT NULL DEFAULT 'MPESA',
    environment TEXT NOT NULL DEFAULT 'sandbox',
    accountType TEXT NOT NULL DEFAULT 'paybill',
    product TEXT NOT NULL DEFAULT 'M-PESA EXPRESS',
    shortcode TEXT,
    storeNumber TEXT,
    consumerKeyCipher TEXT,
    consumerSecretCipher TEXT,
    passkeyCipher TEXT,
    credentialsVersion TEXT DEFAULT 'enc:v2',
    lastTestAt INTEGER,
    lastTestStatus TEXT,
    lastTestMessage TEXT,
    created_at INTEGER,
    updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS billingPayments (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL,
    phone TEXT,
    amount REAL NOT NULL,
    reference TEXT,
    checkoutRequestId TEXT UNIQUE,
    merchantRequestId TEXT,
    receiptNumber TEXT,
    resultCode INTEGER,
    resultDesc TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    provider TEXT DEFAULT 'MPESA',
    redirectUrl TEXT,
    createdAt INTEGER,
    updated_at INTEGER
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

CREATE TRIGGER IF NOT EXISTS financialAccounts_non_negative_balance_guard
BEFORE UPDATE OF balance ON financialAccounts
WHEN NEW.balance < -0.0001
BEGIN
    SELECT RAISE(ABORT, 'Insufficient account balance.');
END;

CREATE TABLE IF NOT EXISTS financialAccountAdjustments (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    amount REAL NOT NULL,
    direction TEXT NOT NULL,
    balanceBefore REAL NOT NULL,
    balanceAfter REAL NOT NULL,
    reason TEXT,
    userName TEXT,
    timestamp INTEGER NOT NULL,
    businessId TEXT,
    updated_at INTEGER
);

-- Offline sync / device monitoring
CREATE TABLE IF NOT EXISTS deviceSyncStatus (
    id TEXT PRIMARY KEY,
    businessId TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    shopId TEXT,
    cashierName TEXT,
    lastSyncAt INTEGER,
    pendingOutboxCount INTEGER DEFAULT 0,
    failedOutboxCount INTEGER DEFAULT 0,
    oldestPendingAt INTEGER,
    lastErrorAt INTEGER,
    lastSyncError TEXT,
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
