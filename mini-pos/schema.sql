CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'CASHIER')),
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS storeProfile (
  id TEXT PRIMARY KEY,
  storeName TEXT NOT NULL,
  logoDataUrl TEXT,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  sellingPrice REAL NOT NULL DEFAULT 0,
  costPrice REAL NOT NULL DEFAULT 0,
  stockQuantity REAL NOT NULL DEFAULT 0,
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS prevent_negative_product_stock
BEFORE UPDATE OF stockQuantity ON products
WHEN NEW.stockQuantity < -0.000001
BEGIN
  SELECT RAISE(ABORT, 'Insufficient stock.');
END;

CREATE TABLE IF NOT EXISTS stockReceipts (
  id TEXT PRIMARY KEY,
  receiptNumber TEXT NOT NULL,
  note TEXT,
  totalCost REAL NOT NULL DEFAULT 0,
  receivedBy TEXT,
  timestamp INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stockMovements (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  productName TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('RECEIVE', 'SALE', 'ADJUST')),
  quantity REAL NOT NULL,
  unitCost REAL NOT NULL DEFAULT 0,
  referenceId TEXT,
  note TEXT,
  timestamp INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  balance REAL NOT NULL DEFAULT 0,
  totalCredit REAL NOT NULL DEFAULT 0,
  totalPaid REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  receiptNumber TEXT NOT NULL,
  tillId TEXT NOT NULL DEFAULT 'default_till',
  paymentMethod TEXT NOT NULL CHECK (paymentMethod IN ('CASH', 'MPESA', 'CREDIT')),
  mpesaReference TEXT,
  customerId TEXT,
  customerName TEXT,
  subtotal REAL NOT NULL,
  total REAL NOT NULL,
  cogs REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PAID', 'CREDIT')),
  cashierId TEXT,
  cashierName TEXT,
  timestamp INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS saleItems (
  id TEXT PRIMARY KEY,
  saleId TEXT NOT NULL,
  productId TEXT NOT NULL,
  productName TEXT NOT NULL,
  quantity REAL NOT NULL,
  unitPrice REAL NOT NULL,
  unitCost REAL NOT NULL,
  lineTotal REAL NOT NULL,
  lineCost REAL NOT NULL,
  createdAt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS creditPayments (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  amount REAL NOT NULL,
  paymentMethod TEXT NOT NULL CHECK (paymentMethod IN ('CASH', 'MPESA')),
  reference TEXT,
  receivedBy TEXT,
  timestamp INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_active ON products(isActive, name);
CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp);
CREATE INDEX IF NOT EXISTS idx_saleItems_sale ON saleItems(saleId);
CREATE INDEX IF NOT EXISTS idx_stockMovements_product ON stockMovements(productId, timestamp);
CREATE INDEX IF NOT EXISTS idx_creditPayments_customer ON creditPayments(customerId, timestamp);
