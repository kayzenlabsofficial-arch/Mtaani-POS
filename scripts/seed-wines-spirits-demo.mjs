import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const databaseName = 'mtaani_pos_db';
const target = process.argv.includes('--local') ? '--local' : '--remote';
const skipSchema = process.argv.includes('--skip-schema');
const now = new Date('2026-05-24T14:00:00+03:00').getTime();
const businessId = 'biz_demo';
const accountId = `picked_cash_${businessId}`;
const password1234 = 'pbkdf2$sha256$100000$bXRhYW5pLWRlbW8tMTIzNA$0H3NluJ1_VQ-RFjLskjyBsbAYUryclBBRVFXwE_PTLI';

function ts(value) {
  return new Date(value).getTime();
}

function q(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function json(value) {
  return JSON.stringify(value);
}

function insert(table, columns, rows) {
  if (!rows.length) return '';
  const values = rows
    .map(row => `(${columns.map(column => q(row[column])).join(', ')})`)
    .join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`;
}

function runWrangler(args) {
  const wrangler = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
  const result = process.platform === 'win32'
    ? spawnSync('cmd', ['/c', wrangler, ...args], { cwd: root, stdio: 'inherit' })
    : spawnSync(wrangler, args, { cwd: root, stdio: 'inherit' });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const categories = [
  ['cat_whisky', 'Whisky', 'wine', '#1D4ED8'],
  ['cat_vodka', 'Vodka', 'droplets', '#0F766E'],
  ['cat_gin', 'Gin', 'sparkles', '#047857'],
  ['cat_brandy', 'Brandy', 'flame', '#B45309'],
  ['cat_wine', 'Wine', 'glass-water', '#BE123C'],
  ['cat_beer', 'Beer', 'beer', '#CA8A04'],
  ['cat_mixers', 'Mixers', 'cup-soda', '#0891B2'],
  ['cat_cigarettes', 'Cigarettes', 'package', '#475569'],
].map(([id, name, iconName, color]) => ({ id, name, iconName, color, businessId, updated_at: now }));

const tills = [
  { id: 'till_front', name: 'Front counter', isActive: 1, businessId, updated_at: now },
  { id: 'till_express', name: 'Express till', isActive: 1, businessId, updated_at: now },
  { id: 'till_wholesale', name: 'Wholesale till', isActive: 1, businessId, updated_at: now },
];

const suppliers = [
  {
    id: 'sup_eabl',
    name: 'EABL Sales Desk',
    company: 'East African Breweries',
    phone: '0711002200',
    email: 'orders@eabl.example',
    address: 'Ruaraka, Nairobi',
    kraPin: 'P051111111A',
    balance: 42500,
    businessId,
    updated_at: now,
  },
  {
    id: 'sup_kwal',
    name: 'KWAL Distribution',
    company: 'Kenya Wine Agencies Ltd',
    phone: '0722003300',
    email: 'sales@kwal.example',
    address: 'Industrial Area, Nairobi',
    kraPin: 'P052222222B',
    balance: 0,
    businessId,
    updated_at: now,
  },
  {
    id: 'sup_viva',
    name: 'Grace Wairimu',
    company: 'Viva Spirits Distributors',
    phone: '0733004400',
    email: 'viva.orders@example.com',
    address: 'Kirinyaga Road, Nairobi',
    kraPin: 'P053333333C',
    balance: 58000,
    businessId,
    updated_at: now,
  },
  {
    id: 'sup_mixers',
    name: 'Baraka Supplies',
    company: 'Baraka Mixers & Sodas',
    phone: '0744005500',
    email: 'baraka@example.com',
    address: 'Ngara, Nairobi',
    kraPin: 'P054444444D',
    balance: 7600,
    businessId,
    updated_at: now,
  },
];

const products = [
  ['prod_jw_red_750', 'Johnnie Walker Red Label 750ml', 'Whisky', 2200, 1680, 'A', 18, 'bottle', '616110000001', 6, ['sup_viva']],
  ['prod_jw_black_750', 'Johnnie Walker Black Label 750ml', 'Whisky', 4200, 3350, 'A', 10, 'bottle', '616110000002', 4, ['sup_viva']],
  ['prod_jameson_750', 'Jameson Irish Whiskey 750ml', 'Whisky', 3600, 2920, 'A', 14, 'bottle', '616110000003', 5, ['sup_viva']],
  ['prod_glenfiddich_12_750', 'Glenfiddich 12 Years 750ml', 'Whisky', 7800, 6300, 'A', 5, 'bottle', '616110000004', 2, ['sup_viva']],
  ['prod_sm_antiquary_750', 'Scottish Leader 750ml', 'Whisky', 1600, 1180, 'A', 24, 'bottle', '616110000005', 8, ['sup_viva']],
  ['prod_sm_top_secret_250', 'Best Whisky 250ml', 'Whisky', 380, 270, 'A', 42, 'bottle', '616110000006', 15, ['sup_viva']],
  ['prod_smirnoff_750', 'Smirnoff Vodka 750ml', 'Vodka', 1650, 1240, 'A', 20, 'bottle', '616110000007', 7, ['sup_eabl']],
  ['prod_smirnoff_250', 'Smirnoff Vodka 250ml', 'Vodka', 520, 390, 'A', 36, 'bottle', '616110000008', 12, ['sup_eabl']],
  ['prod_absolute_750', 'Absolut Vodka 750ml', 'Vodka', 2900, 2320, 'A', 9, 'bottle', '616110000009', 4, ['sup_viva']],
  ['prod_kibao_250', 'Kibao Vodka 250ml', 'Vodka', 320, 230, 'A', 60, 'bottle', '616110000010', 20, ['sup_viva']],
  ['prod_gordons_750', 'Gordons Gin 750ml', 'Gin', 1850, 1390, 'A', 16, 'bottle', '616110000011', 6, ['sup_eabl']],
  ['prod_gilbeys_750', 'Gilbeys Gin 750ml', 'Gin', 1450, 1080, 'A', 19, 'bottle', '616110000012', 7, ['sup_eabl']],
  ['prod_hennessy_vs_750', 'Hennessy VS 750ml', 'Brandy', 6400, 5200, 'A', 6, 'bottle', '616110000013', 3, ['sup_viva']],
  ['prod_viceroy_750', 'Viceroy Brandy 750ml', 'Brandy', 1350, 980, 'A', 22, 'bottle', '616110000014', 8, ['sup_kwal']],
  ['prod_4th_street_red', '4th Street Sweet Red 750ml', 'Wine', 850, 610, 'A', 30, 'bottle', '616110000015', 10, ['sup_kwal']],
  ['prod_4th_street_white', '4th Street Sweet White 750ml', 'Wine', 850, 610, 'A', 28, 'bottle', '616110000016', 10, ['sup_kwal']],
  ['prod_drosty_hof_red', 'Drostdy-Hof Red 750ml', 'Wine', 1100, 810, 'A', 14, 'bottle', '616110000017', 6, ['sup_kwal']],
  ['prod_guinness_can', 'Guinness Can 500ml', 'Beer', 280, 210, 'A', 96, 'can', '616110000018', 30, ['sup_eabl']],
  ['prod_tusker_lager', 'Tusker Lager 500ml', 'Beer', 260, 195, 'A', 120, 'bottle', '616110000019', 36, ['sup_eabl']],
  ['prod_tusker_malt', 'Tusker Malt 500ml', 'Beer', 290, 220, 'A', 84, 'bottle', '616110000020', 24, ['sup_eabl']],
  ['prod_whitecap', 'White Cap Lager 500ml', 'Beer', 280, 210, 'A', 72, 'bottle', '616110000021', 24, ['sup_eabl']],
  ['prod_heineken', 'Heineken 330ml', 'Beer', 330, 255, 'A', 48, 'bottle', '616110000022', 18, ['sup_eabl']],
  ['prod_tonic_500', 'Schweppes Tonic 500ml', 'Mixers', 120, 82, 'A', 64, 'bottle', '616110000023', 20, ['sup_mixers']],
  ['prod_coke_500', 'Coca-Cola 500ml', 'Mixers', 100, 72, 'A', 90, 'bottle', '616110000024', 24, ['sup_mixers']],
  ['prod_ice_bag', 'Ice Cubes 2kg', 'Mixers', 180, 110, 'E', 25, 'bag', '616110000025', 8, ['sup_mixers']],
  ['prod_marlboro', 'Marlboro Gold Pack', 'Cigarettes', 450, 350, 'A', 35, 'pack', '616110000026', 10, ['sup_mixers']],
].map(([id, name, category, sellingPrice, costPrice, taxCategory, stockQuantity, unit, barcode, reorderPoint, supplierIds]) => ({
  id,
  name,
  category,
  sellingPrice,
  costPrice,
  discountType: 'NONE',
  discountValue: 0,
  taxCategory,
  stockQuantity,
  unit,
  barcode,
  imageUrl: '',
  reorderPoint,
  supplierIds: json(supplierIds),
  expiryTracking: 0,
  expiryDate: null,
  isBundle: 0,
  components: null,
  businessId,
  updated_at: now,
}));

const productById = Object.fromEntries(products.map(product => [product.id, product]));

function line(productId, quantity) {
  const product = productById[productId];
  return {
    id: product.id,
    productId: product.id,
    name: product.name,
    category: product.category,
    quantity,
    cartQuantity: quantity,
    sellingPrice: product.sellingPrice,
    costPrice: product.costPrice,
    taxCategory: product.taxCategory,
    unit: product.unit,
    total: product.sellingPrice * quantity,
  };
}

const transactions = [
  {
    id: 'sale_20260524_001',
    items: [line('prod_tusker_lager', 12), line('prod_guinness_can', 6), line('prod_4th_street_red', 2)],
    timestamp: ts('2026-05-24T08:30:00+03:00'),
    paymentMethod: 'MPESA',
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_walkin',
    customerName: 'Walk-in Customer',
    mpesaReference: 'QEO24A001',
    mpesaCode: 'QEO24A001',
    shiftId: 'shift_today_front',
  },
  {
    id: 'sale_20260524_002',
    items: [line('prod_jameson_750', 1), line('prod_coke_500', 6), line('prod_ice_bag', 2)],
    timestamp: ts('2026-05-24T09:45:00+03:00'),
    paymentMethod: 'CASH',
    amountTendered: 5000,
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_walkin',
    customerName: 'Walk-in Customer',
    shiftId: 'shift_today_front',
  },
  {
    id: 'sale_20260524_003',
    items: [line('prod_jw_black_750', 1), line('prod_hennessy_vs_750', 1)],
    timestamp: ts('2026-05-24T10:20:00+03:00'),
    paymentMethod: 'PDQ',
    cashierId: 'user_manager',
    cashierName: 'Manager',
    customerId: 'cust_savannah',
    customerName: 'Savannah Events',
    shiftId: 'shift_today_front',
  },
  {
    id: 'sale_20260524_004',
    items: [line('prod_smirnoff_250', 5), line('prod_kibao_250', 10), line('prod_tonic_500', 10)],
    timestamp: ts('2026-05-24T11:10:00+03:00'),
    paymentMethod: 'CASH',
    amountTendered: 10000,
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_walkin',
    customerName: 'Walk-in Customer',
    shiftId: 'shift_today_front',
  },
  {
    id: 'sale_20260524_005',
    items: [line('prod_gilbeys_750', 2), line('prod_4th_street_white', 4), line('prod_heineken', 12)],
    timestamp: ts('2026-05-24T12:05:00+03:00'),
    paymentMethod: 'CREDIT',
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_uncle_mike',
    customerName: 'Uncle Mike Bar',
    shiftId: 'shift_today_front',
  },
  {
    id: 'sale_20260523_001',
    items: [line('prod_jw_red_750', 3), line('prod_smirnoff_750', 2), line('prod_tusker_malt', 24)],
    timestamp: ts('2026-05-23T13:35:00+03:00'),
    paymentMethod: 'MPESA',
    cashierId: 'user_manager',
    cashierName: 'Manager',
    customerId: 'cust_quickmart',
    customerName: 'Quickmart Staff Party',
    mpesaReference: 'QEN23M211',
    mpesaCode: 'QEN23M211',
    shiftId: 'shift_20260523_front',
  },
  {
    id: 'sale_20260522_001',
    items: [line('prod_glenfiddich_12_750', 1), line('prod_jameson_750', 2), line('prod_tonic_500', 12)],
    timestamp: ts('2026-05-22T17:25:00+03:00'),
    paymentMethod: 'CASH',
    amountTendered: 20000,
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_walkin',
    customerName: 'Walk-in Customer',
    shiftId: 'shift_20260522_front',
  },
  {
    id: 'sale_20260521_001',
    items: [line('prod_viceroy_750', 4), line('prod_4th_street_red', 8), line('prod_coke_500', 12)],
    timestamp: ts('2026-05-21T19:10:00+03:00'),
    paymentMethod: 'MPESA',
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_savannah',
    customerName: 'Savannah Events',
    mpesaReference: 'QEL21S410',
    mpesaCode: 'QEL21S410',
    shiftId: 'shift_20260521_front',
  },
  {
    id: 'sale_20260520_001',
    items: [line('prod_tusker_lager', 48), line('prod_guinness_can', 24), line('prod_whitecap', 24)],
    timestamp: ts('2026-05-20T15:45:00+03:00'),
    paymentMethod: 'CASH',
    amountTendered: 40000,
    cashierId: 'user_manager',
    cashierName: 'Manager',
    customerId: 'cust_the_den',
    customerName: 'The Den Lounge',
    shiftId: 'shift_20260520_wholesale',
  },
  {
    id: 'sale_20260519_001',
    items: [line('prod_hennessy_vs_750', 2), line('prod_jw_black_750', 2), line('prod_ice_bag', 6)],
    timestamp: ts('2026-05-19T20:15:00+03:00'),
    paymentMethod: 'PDQ',
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_walkin',
    customerName: 'Walk-in Customer',
    shiftId: 'shift_20260519_front',
  },
  {
    id: 'sale_20260518_001',
    items: [line('prod_smirnoff_750', 4), line('prod_gordons_750', 2), line('prod_tonic_500', 24)],
    timestamp: ts('2026-05-18T18:30:00+03:00'),
    paymentMethod: 'MPESA',
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    customerId: 'cust_walkin',
    customerName: 'Walk-in Customer',
    mpesaReference: 'QEK18D090',
    mpesaCode: 'QEK18D090',
    shiftId: 'shift_20260518_front',
  },
];

const transactionRows = transactions.map(tx => {
  const subtotal = tx.items.reduce((sum, item) => sum + item.total, 0);
  const total = subtotal;
  return {
    id: tx.id,
    total,
    subtotal,
    tax: 0,
    discountAmount: 0,
    discountReason: null,
    items: json(tx.items),
    timestamp: tx.timestamp,
    status: 'COMPLETED',
    paymentMethod: tx.paymentMethod,
    amountTendered: tx.amountTendered ?? total,
    changeGiven: Math.max(0, Number(tx.amountTendered || total) - total),
    mpesaReference: tx.mpesaReference || null,
    mpesaCode: tx.mpesaCode || null,
    mpesaCustomer: tx.paymentMethod === 'MPESA' ? '254712345678' : null,
    mpesaCheckoutRequestId: null,
    cashierId: tx.cashierId,
    cashierName: tx.cashierName,
    customerId: tx.customerId,
    customerName: tx.customerName,
    discount: 0,
    discountType: 'NONE',
    splitPayments: null,
    splitData: null,
    isSynced: 1,
    approvedBy: null,
    pendingRefundItems: null,
    shiftId: tx.shiftId,
    businessId,
    updated_at: now,
  };
});

const customers = [
  ['cust_walkin', 'Walk-in Customer', '', '', 0, 0],
  ['cust_uncle_mike', 'Uncle Mike Bar', '0712456123', 'unclemike@example.com', 10140, 10140],
  ['cust_savannah', 'Savannah Events', '0721123456', 'events@savannah.example', 27800, 0],
  ['cust_the_den', 'The Den Lounge', '0733221100', 'den@example.com', 31680, 0],
  ['cust_quickmart', 'Quickmart Staff Party', '0745667788', 'party@example.com', 15560, 0],
].map(([id, name, phone, email, totalSpent, balance]) => ({ id, name, phone, email, totalSpent, balance, businessId, updated_at: now }));

const shifts = [
  {
    id: 'shift_today_front',
    startTime: ts('2026-05-24T07:15:00+03:00'),
    endTime: null,
    cashierId: 'user_cashier',
    cashierName: 'Cashier',
    tillId: 'till_front',
    tillName: 'Front counter',
    openingCash: 3000,
    closingCash: null,
    expectedCash: null,
    cashVariance: null,
    closeBreakdown: null,
    status: 'OPEN',
    lastSyncAt: now,
    businessId,
    updated_at: now,
  },
  ['shift_20260523_front', '2026-05-23T08:00:00+03:00', '2026-05-23T21:45:00+03:00', 'Manager', 'till_front', 'Front counter', 3000, 12300, 12300, 0],
  ['shift_20260522_front', '2026-05-22T08:00:00+03:00', '2026-05-22T21:30:00+03:00', 'Cashier', 'till_front', 'Front counter', 3000, 19320, 19320, 0],
  ['shift_20260521_front', '2026-05-21T08:00:00+03:00', '2026-05-21T22:00:00+03:00', 'Cashier', 'till_front', 'Front counter', 3000, 3000, 3000, 0],
  ['shift_20260520_wholesale', '2026-05-20T09:00:00+03:00', '2026-05-20T18:30:00+03:00', 'Manager', 'till_wholesale', 'Wholesale till', 5000, 34680, 34680, 0],
  ['shift_20260519_front', '2026-05-19T08:00:00+03:00', '2026-05-19T22:10:00+03:00', 'Cashier', 'till_front', 'Front counter', 3000, 3000, 3000, 0],
  ['shift_20260518_front', '2026-05-18T08:00:00+03:00', '2026-05-18T21:20:00+03:00', 'Cashier', 'till_front', 'Front counter', 3000, 3000, 3000, 0],
].map(row => Array.isArray(row) ? {
  id: row[0],
  startTime: ts(row[1]),
  endTime: ts(row[2]),
  cashierId: row[3] === 'Manager' ? 'user_manager' : 'user_cashier',
  cashierName: row[3],
  tillId: row[4],
  tillName: row[5],
  openingCash: row[6],
  closingCash: row[7],
  expectedCash: row[8],
  cashVariance: row[9],
  closeBreakdown: null,
  status: 'CLOSED',
  lastSyncAt: now,
  businessId,
  updated_at: now,
} : row);

const cashPicks = [
  { id: 'pick_20260524_001', amount: 18500, timestamp: ts('2026-05-24T12:30:00+03:00'), status: 'APPROVED', userName: 'Cashier', accountId, shopId: null, businessId, shiftId: 'shift_today_front', updated_at: now },
  { id: 'pick_20260523_001', amount: 12000, timestamp: ts('2026-05-23T20:15:00+03:00'), status: 'APPROVED', userName: 'Manager', accountId, shopId: null, businessId, shiftId: 'shift_20260523_front', updated_at: now },
  { id: 'pick_pending_001', amount: 8000, timestamp: ts('2026-05-24T13:30:00+03:00'), status: 'PENDING', userName: 'Cashier', accountId, shopId: null, businessId, shiftId: 'shift_today_front', updated_at: now },
];

const expenses = [
  ['exp_rent_may', 45000, 'Rent', 'May shop rent', ts('2026-05-02T10:00:00+03:00'), 'Admin', 'APPROVED', 'ACCOUNT', accountId, null, null],
  ['exp_licenses', 6500, 'Licensing', 'County liquor license top-up', ts('2026-05-15T11:30:00+03:00'), 'Admin', 'APPROVED', 'ACCOUNT', accountId, null, null],
  ['exp_delivery', 1800, 'Delivery', 'Motorbike delivery to The Den Lounge', ts('2026-05-20T16:10:00+03:00'), 'Manager', 'APPROVED', 'TILL', null, null, 'shift_20260520_wholesale'],
  ['exp_ice_restock', 2200, 'Supplies', 'Emergency ice restock', ts('2026-05-24T10:35:00+03:00'), 'Cashier', 'APPROVED', 'TILL', null, null, 'shift_today_front'],
  ['exp_cleaning', 900, 'Cleaning', 'Cleaning supplies', ts('2026-05-23T09:10:00+03:00'), 'Manager', 'APPROVED', 'TILL', null, null, 'shift_20260523_front'],
  ['exp_pending_signage', 3500, 'Marketing', 'New shelf price labels', ts('2026-05-24T13:10:00+03:00'), 'Cashier', 'PENDING', 'TILL', null, null, 'shift_today_front'],
].map(([id, amount, category, description, timestamp, userName, status, source, accountIdValue, productId, shiftId]) => ({
  id,
  amount,
  category,
  description,
  timestamp,
  userName,
  status,
  preparedBy: userName,
  approvedBy: status === 'APPROVED' ? 'Admin' : null,
  source,
  accountId: accountIdValue,
  productId,
  quantity: null,
  shopId: null,
  businessId,
  shiftId,
  updated_at: now,
}));

const purchaseOrders = [
  {
    id: 'po_eabl_001',
    supplierId: 'sup_eabl',
    items: json([
      { productId: 'prod_tusker_lager', name: 'Tusker Lager 500ml', quantity: 120, unitCost: 195, total: 23400 },
      { productId: 'prod_guinness_can', name: 'Guinness Can 500ml', quantity: 96, unitCost: 210, total: 20160 },
      { productId: 'prod_tusker_malt', name: 'Tusker Malt 500ml', quantity: 84, unitCost: 220, total: 18480 },
    ]),
    totalAmount: 62040,
    status: 'RECEIVED',
    approvalStatus: 'APPROVED',
    paymentStatus: 'PARTIAL',
    paidAmount: 19540,
    orderDate: ts('2026-05-16T09:00:00+03:00'),
    expectedDate: ts('2026-05-17T09:00:00+03:00'),
    receivedDate: ts('2026-05-17T14:10:00+03:00'),
    invoiceNumber: 'EABL-INV-2405',
    poNumber: 'LPO-WS-001',
    preparedBy: 'Manager',
    approvedBy: 'Admin',
    receivedBy: 'Manager',
    businessId,
    updated_at: now,
  },
  {
    id: 'po_viva_001',
    supplierId: 'sup_viva',
    items: json([
      { productId: 'prod_jw_black_750', name: 'Johnnie Walker Black Label 750ml', quantity: 12, unitCost: 3350, total: 40200 },
      { productId: 'prod_jameson_750', name: 'Jameson Irish Whiskey 750ml', quantity: 12, unitCost: 2920, total: 35040 },
      { productId: 'prod_hennessy_vs_750', name: 'Hennessy VS 750ml', quantity: 6, unitCost: 5200, total: 31200 },
    ]),
    totalAmount: 106440,
    status: 'RECEIVED',
    approvalStatus: 'APPROVED',
    paymentStatus: 'PARTIAL',
    paidAmount: 48440,
    orderDate: ts('2026-05-18T10:00:00+03:00'),
    expectedDate: ts('2026-05-19T09:00:00+03:00'),
    receivedDate: ts('2026-05-19T15:40:00+03:00'),
    invoiceNumber: 'VIVA-9482',
    poNumber: 'LPO-WS-002',
    preparedBy: 'Manager',
    approvedBy: 'Admin',
    receivedBy: 'Cashier',
    businessId,
    updated_at: now,
  },
  {
    id: 'po_mixers_pending',
    supplierId: 'sup_mixers',
    items: json([
      { productId: 'prod_tonic_500', name: 'Schweppes Tonic 500ml', quantity: 48, unitCost: 82, total: 3936 },
      { productId: 'prod_coke_500', name: 'Coca-Cola 500ml', quantity: 60, unitCost: 72, total: 4320 },
    ]),
    totalAmount: 8256,
    status: 'PENDING',
    approvalStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    paidAmount: 0,
    orderDate: ts('2026-05-24T09:20:00+03:00'),
    expectedDate: ts('2026-05-25T10:00:00+03:00'),
    receivedDate: null,
    invoiceNumber: '',
    poNumber: 'LPO-WS-003',
    preparedBy: 'Cashier',
    approvedBy: null,
    receivedBy: null,
    businessId,
    updated_at: now,
  },
];

const supplierPayments = [
  { id: 'sp_eabl_cash_001', supplierId: 'sup_eabl', purchaseOrderId: 'po_eabl_001', purchaseOrderIds: json(['po_eabl_001']), invoiceAllocations: json([{ purchaseOrderId: 'po_eabl_001', amount: 19540, invoiceNumber: 'EABL-INV-2405', poNumber: 'LPO-WS-001' }]), creditNoteIds: null, amount: 19540, paymentMethod: 'CASH', transactionCode: null, timestamp: ts('2026-05-20T13:00:00+03:00'), reference: 'Till payment to EABL', source: 'TILL', accountId: null, shopId: null, shiftId: 'shift_20260520_wholesale', preparedBy: 'Manager', businessId, updated_at: now },
  { id: 'sp_viva_account_001', supplierId: 'sup_viva', purchaseOrderId: 'po_viva_001', purchaseOrderIds: json(['po_viva_001']), invoiceAllocations: json([{ purchaseOrderId: 'po_viva_001', amount: 24000, invoiceNumber: 'VIVA-9482', poNumber: 'LPO-WS-002' }]), creditNoteIds: null, amount: 24000, paymentMethod: 'BANK', transactionCode: 'MAIN-TRF-2405', timestamp: ts('2026-05-22T11:15:00+03:00'), reference: 'Main account transfer', source: 'ACCOUNT', accountId, shopId: null, shiftId: null, preparedBy: 'Admin', businessId, updated_at: now },
];

const creditNotes = [
  { id: 'cn_kwal_001', supplierId: 'sup_kwal', amount: 3200, reference: 'KWAL-CN-115', timestamp: ts('2026-05-21T12:00:00+03:00'), reason: 'Returned two broken wine bottles', status: 'PENDING', allocatedTo: null, items: json([{ productId: 'prod_4th_street_red', name: '4th Street Sweet Red 750ml', quantity: 2, unitCost: 610, amount: 1220 }]), productId: null, quantity: null, shopId: null, businessId, shiftId: null, updated_at: now },
];

const financialAccountAdjustments = [
  { id: 'main_adj_opening', accountId, amount: 145000, direction: 'SET', balanceBefore: 0, balanceAfter: 145000, reason: 'Owner opening balance for demo', userName: 'Admin', timestamp: ts('2026-05-15T09:00:00+03:00'), businessId, updated_at: now },
];

const mainAccountBalance = 145000 + 18500 + 12000 - 45000 - 6500 - 24000;

const financialAccounts = [
  { id: accountId, name: 'Main account', type: 'CASH', accountNumber: 'PICKED-CASH', balance: mainAccountBalance, shopId: null, businessId, updated_at: now },
];

const stockMovements = products.map(product => ({
  id: `stock_opening_${product.id}`,
  productId: product.id,
  type: 'IN',
  quantity: product.stockQuantity,
  timestamp: ts('2026-05-15T09:15:00+03:00'),
  reference: 'Opening demo stock',
  shopId: null,
  businessId,
  shiftId: null,
  expiryDate: null,
  updated_at: now,
}));

const expenseAccounts = [
  ['exp_acc_rent', 'Rent', 'Shop rent and landlord payments'],
  ['exp_acc_licenses', 'Licensing', 'County licenses and compliance fees'],
  ['exp_acc_delivery', 'Delivery', 'Rider and delivery costs'],
  ['exp_acc_supplies', 'Supplies', 'Ice, bags, cleaning and counter supplies'],
  ['exp_acc_marketing', 'Marketing', 'Promotions, labels and signage'],
].map(([id, name, description]) => ({ id, name, description, businessId, updated_at: now }));

const serviceItems = [
  { id: 'svc_delivery', name: 'Delivery within estate', category: 'Delivery', description: 'Local delivery service', price: 250, taxCategory: 'E', isActive: 1, businessId, updated_at: now },
  { id: 'svc_party_setup', name: 'Party setup support', category: 'Events', description: 'Event drinks setup and packing', price: 1500, taxCategory: 'A', isActive: 1, businessId, updated_at: now },
];

const salesInvoices = [
  {
    id: 'inv_uncle_mike_001',
    invoiceNumber: 'INV-WS-001',
    customerId: 'cust_uncle_mike',
    customerName: 'Uncle Mike Bar',
    customerPhone: '0712456123',
    customerEmail: 'unclemike@example.com',
    items: json([
      { itemType: 'PRODUCT', itemId: 'prod_gilbeys_750', name: 'Gilbeys Gin 750ml', quantity: 2, unitPrice: 1450, taxCategory: 'A' },
      { itemType: 'PRODUCT', itemId: 'prod_4th_street_white', name: '4th Street Sweet White 750ml', quantity: 4, unitPrice: 850, taxCategory: 'A' },
      { itemType: 'PRODUCT', itemId: 'prod_heineken', name: 'Heineken 330ml', quantity: 12, unitPrice: 330, taxCategory: 'A' },
    ]),
    subtotal: 10140,
    tax: 0,
    total: 10140,
    paidAmount: 0,
    balance: 10140,
    status: 'SENT',
    issueDate: ts('2026-05-24T12:10:00+03:00'),
    dueDate: ts('2026-05-31T12:10:00+03:00'),
    notes: 'Weekend stock supplied on credit.',
    preparedBy: 'Cashier',
    shopId: null,
    businessId,
    updated_at: now,
  },
];

const hrStaff = [
  ['hr_admin', 'Demo Admin', '0700000001', 'admin@mtaani.example', 'Owner', 'Management', 100000, 'MONTHLY'],
  ['hr_cashier', 'Cashier Demo', '0700000002', 'cashier@mtaani.example', 'Cashier', 'Sales', 28000, 'MONTHLY'],
  ['hr_manager', 'Manager Demo', '0700000003', 'manager@mtaani.example', 'Shop Manager', 'Operations', 42000, 'MONTHLY'],
  ['hr_runner', 'Kevin Runner', '0700000004', 'runner@mtaani.example', 'Delivery Rider', 'Delivery', 1200, 'DAILY'],
].map(([id, fullName, phone, email, roleTitle, department, baseSalary, payCycle]) => ({
  id,
  fullName,
  phone,
  email,
  roleTitle,
  department,
  nationalId: '',
  kraPin: '',
  nhifNumber: '',
  nssfNumber: '',
  hireDate: ts('2026-01-05T09:00:00+03:00'),
  status: 'ACTIVE',
  baseSalary,
  payCycle,
  emergencyContact: '',
  notes: 'Seed demo staff record',
  shopId: null,
  businessId,
  updated_at: now,
}));

const dailySummaries = [
  ['daily_20260520', '2026-05-20T00:00:00+03:00', ['shift_20260520_wholesale'], 31680, 31680, 0, 1800, 0, 0, ts('2026-05-20T23:00:00+03:00')],
  ['daily_20260521', '2026-05-21T00:00:00+03:00', ['shift_20260521_front'], 13400, 13400, 0, 0, 0, 0, ts('2026-05-21T23:00:00+03:00')],
  ['daily_20260522', '2026-05-22T00:00:00+03:00', ['shift_20260522_front'], 16320, 16320, 0, 0, 0, 0, ts('2026-05-22T23:00:00+03:00')],
  ['daily_20260523', '2026-05-23T00:00:00+03:00', ['shift_20260523_front'], 15560, 15560, 0, 900, 12000, 0, ts('2026-05-23T23:00:00+03:00')],
  ['daily_20260524', '2026-05-24T00:00:00+03:00', ['shift_today_front'], transactionRows.filter(row => row.timestamp >= ts('2026-05-24T00:00:00+03:00')).reduce((sum, row) => sum + row.total, 0), transactionRows.filter(row => row.timestamp >= ts('2026-05-24T00:00:00+03:00')).reduce((sum, row) => sum + row.total, 0), 0, 2200, 18500, 0, now],
].map(([id, date, shiftIds, totalSales, grossSales, taxTotal, totalExpenses, totalPicks, totalVariance, timestamp]) => ({
  id,
  date: ts(date),
  shiftIds: json(shiftIds),
  totalSales,
  grossSales,
  taxTotal,
  totalExpenses,
  totalPicks,
  totalRefunds: 0,
  totalVariance,
  timestamp,
  shopId: null,
  businessId,
  updated_at: now,
}));

const endOfDayReports = dailySummaries
  .filter(row => row.id !== 'daily_20260524')
  .map(row => ({
    id: `eod_${row.id.replace('daily_', '')}`,
    shiftId: JSON.parse(row.shiftIds)[0],
    tillId: JSON.parse(row.shiftIds)[0].includes('wholesale') ? 'till_wholesale' : 'till_front',
    tillName: JSON.parse(row.shiftIds)[0].includes('wholesale') ? 'Wholesale till' : 'Front counter',
    timestamp: row.timestamp,
    totalSales: row.totalSales,
    grossSales: row.grossSales,
    taxTotal: row.taxTotal,
    cashSales: transactionRows.filter(tx => tx.shiftId === JSON.parse(row.shiftIds)[0] && tx.paymentMethod === 'CASH').reduce((sum, tx) => sum + tx.total, 0),
    customerCashPayments: 0,
    mpesaSales: transactionRows.filter(tx => tx.shiftId === JSON.parse(row.shiftIds)[0] && tx.paymentMethod === 'MPESA').reduce((sum, tx) => sum + tx.total, 0),
    pdqSales: transactionRows.filter(tx => tx.shiftId === JSON.parse(row.shiftIds)[0] && tx.paymentMethod === 'PDQ').reduce((sum, tx) => sum + tx.total, 0),
    totalExpenses: row.totalExpenses,
    supplierPaymentsTotal: supplierPayments.filter(payment => payment.shiftId === JSON.parse(row.shiftIds)[0]).reduce((sum, payment) => sum + payment.amount, 0),
    remittanceTotal: 0,
    totalPicks: row.totalPicks,
    totalRefunds: 0,
    cashRefunds: 0,
    openingCash: JSON.parse(row.shiftIds)[0].includes('wholesale') ? 5000 : 3000,
    closingCash: 0,
    expectedCash: 0,
    reportedCash: 0,
    difference: row.totalVariance,
    cashierName: JSON.parse(row.shiftIds)[0].includes('20260520') || JSON.parse(row.shiftIds)[0].includes('20260523') ? 'Manager' : 'Cashier',
    cashierId: JSON.parse(row.shiftIds)[0].includes('20260520') || JSON.parse(row.shiftIds)[0].includes('20260523') ? 'user_manager' : 'user_cashier',
    closeBreakdown: null,
    shopId: null,
    businessId,
    updated_at: now,
  }))
  .map(report => ({
    ...report,
    expectedCash: report.openingCash + report.cashSales - report.totalExpenses - report.supplierPaymentsTotal - report.totalPicks,
    reportedCash: report.openingCash + report.cashSales - report.totalExpenses - report.supplierPaymentsTotal - report.totalPicks + report.difference,
    closingCash: report.openingCash + report.cashSales - report.totalExpenses - report.supplierPaymentsTotal - report.totalPicks + report.difference,
  }));

const users = [
  { id: 'user_admin', name: 'admin', password: password1234, role: 'ADMIN', businessId, updated_at: now },
  { id: 'user_cashier', name: 'Cashier', password: password1234, role: 'CASHIER', businessId, updated_at: now },
  { id: 'user_manager', name: 'Manager', password: password1234, role: 'MANAGER', businessId, updated_at: now },
];

const business = [{ id: businessId, name: 'Mtaani Wines & Spirits', code: 'MTAANI01', isActive: 1, updated_at: now }];
const settings = [{
  id: `settings_${businessId}`,
  storeName: 'Mtaani Wines & Spirits',
  location: 'Nairobi, Kenya',
  tillNumber: '789123',
  kraPin: 'P051234567M',
  receiptFooter: 'Thank you for shopping with Mtaani Wines & Spirits.',
  ownerModeEnabled: 1,
  autoApproveOwnerActions: 1,
  cashSweepEnabled: 1,
  cashDrawerLimit: 15000,
  salesTills: json(tills.map(({ id, name, isActive }) => ({ id, name, isActive: !!isActive }))),
  defaultOpeningFloat: 3000,
  mpesaConsumerKey: '',
  mpesaConsumerSecret: '',
  mpesaPasskey: '',
  mpesaEnv: 'sandbox',
  mpesaType: 'till',
  mpesaStoreNumber: '789123',
  businessId,
  updated_at: now,
}];

const stockAdjustmentRequests = [
  { id: 'stock_adj_pending_ice', productId: 'prod_ice_bag', productName: 'Ice Cubes 2kg', oldQty: 25, newQty: 35, requestedQuantity: 35, reason: 'Counted extra bags in freezer', timestamp: ts('2026-05-24T13:00:00+03:00'), status: 'PENDING', preparedBy: 'Cashier', approvedBy: null, shopId: null, businessId, updated_at: now },
];

const auditLogs = [
  { id: 'audit_seed_wines_demo', ts: now, userId: 'user_admin', userName: 'Admin', action: 'demo.seed', entity: 'business', entityId: businessId, severity: 'INFO', details: 'Seeded wines and spirits demo data.', businessId, updated_at: now },
];

const deleteTables = [
  'auditLogs',
  'financialAccountAdjustments',
  'financialAccounts',
  'expenseAccounts',
  'mpesaCallbacks',
  'categories',
  'salesTills',
  'settings',
  'purchaseOrders',
  'stockAdjustmentRequests',
  'dailySummaries',
  'creditNotes',
  'supplierPayments',
  'suppliers',
  'salesInvoices',
  'serviceItems',
  'customerPayments',
  'customers',
  'hrPayrollAdjustments',
  'hrAttendance',
  'hrStaffDocuments',
  'hrStaff',
  'expenses',
  'stockMovements',
  'endOfDayReports',
  'shifts',
  'refunds',
  'cashPicks',
  'transactions',
  'productIngredients',
  'products',
  'deviceSyncStatus',
  'idempotencyKeys',
  'users',
];

const seedSql = [
  '-- Wines and spirits demo seed for Mtaani POS.',
  'PRAGMA foreign_keys = OFF;',
  ...deleteTables.map(table => `DELETE FROM ${table} WHERE businessId IN (SELECT id FROM businesses WHERE id = ${q(businessId)} OR code IN ('DEMO', 'MTAANI01'));`),
  "DELETE FROM loginAttempts WHERE id LIKE 'LOGIN:DEMO:%' OR id LIKE 'LOGIN:MTAANI01:%';",
  `DELETE FROM businesses WHERE id = ${q(businessId)} OR code IN ('DEMO', 'MTAANI01');`,
  insert('businesses', ['id', 'name', 'code', 'isActive', 'updated_at'], business),
  insert('users', ['id', 'name', 'password', 'role', 'businessId', 'updated_at'], users),
  insert('settings', ['id', 'storeName', 'location', 'tillNumber', 'kraPin', 'receiptFooter', 'ownerModeEnabled', 'autoApproveOwnerActions', 'cashSweepEnabled', 'cashDrawerLimit', 'salesTills', 'defaultOpeningFloat', 'mpesaConsumerKey', 'mpesaConsumerSecret', 'mpesaPasskey', 'mpesaEnv', 'mpesaType', 'mpesaStoreNumber', 'businessId', 'updated_at'], settings),
  insert('salesTills', ['id', 'name', 'isActive', 'businessId', 'updated_at'], tills),
  insert('categories', ['id', 'name', 'iconName', 'color', 'businessId', 'updated_at'], categories),
  insert('expenseAccounts', ['id', 'name', 'description', 'businessId', 'updated_at'], expenseAccounts),
  insert('financialAccounts', ['id', 'name', 'type', 'balance', 'businessId', 'accountNumber', 'updated_at'], financialAccounts),
  insert('financialAccountAdjustments', ['id', 'accountId', 'amount', 'direction', 'balanceBefore', 'balanceAfter', 'reason', 'userName', 'timestamp', 'businessId', 'updated_at'], financialAccountAdjustments),
  insert('suppliers', ['id', 'name', 'company', 'phone', 'email', 'address', 'kraPin', 'balance', 'businessId', 'updated_at'], suppliers),
  insert('customers', ['id', 'name', 'phone', 'email', 'totalSpent', 'balance', 'businessId', 'updated_at'], customers),
  insert('serviceItems', ['id', 'name', 'category', 'description', 'price', 'taxCategory', 'isActive', 'businessId', 'updated_at'], serviceItems),
  insert('products', ['id', 'name', 'category', 'sellingPrice', 'costPrice', 'discountType', 'discountValue', 'taxCategory', 'stockQuantity', 'unit', 'barcode', 'imageUrl', 'reorderPoint', 'supplierIds', 'expiryTracking', 'expiryDate', 'isBundle', 'components', 'businessId', 'updated_at'], products),
  insert('stockMovements', ['id', 'productId', 'type', 'quantity', 'timestamp', 'reference', 'businessId', 'shiftId', 'expiryDate', 'updated_at'], stockMovements),
  insert('shifts', ['id', 'startTime', 'endTime', 'cashierId', 'cashierName', 'tillId', 'tillName', 'openingCash', 'closingCash', 'expectedCash', 'cashVariance', 'closeBreakdown', 'status', 'businessId', 'lastSyncAt', 'updated_at'], shifts),
  insert('transactions', ['id', 'total', 'subtotal', 'tax', 'discountAmount', 'discountReason', 'items', 'timestamp', 'status', 'paymentMethod', 'amountTendered', 'changeGiven', 'mpesaReference', 'mpesaCode', 'mpesaCustomer', 'mpesaCheckoutRequestId', 'cashierId', 'cashierName', 'customerId', 'customerName', 'discount', 'discountType', 'splitPayments', 'splitData', 'isSynced', 'approvedBy', 'pendingRefundItems', 'shiftId', 'businessId', 'updated_at'], transactionRows),
  insert('cashPicks', ['id', 'amount', 'timestamp', 'status', 'userName', 'accountId', 'businessId', 'shiftId', 'updated_at'], cashPicks),
  insert('expenses', ['id', 'amount', 'category', 'description', 'timestamp', 'userName', 'status', 'preparedBy', 'approvedBy', 'source', 'accountId', 'productId', 'quantity', 'businessId', 'shiftId', 'updated_at'], expenses),
  insert('purchaseOrders', ['id', 'supplierId', 'items', 'totalAmount', 'status', 'approvalStatus', 'paymentStatus', 'paidAmount', 'orderDate', 'expectedDate', 'receivedDate', 'invoiceNumber', 'poNumber', 'preparedBy', 'approvedBy', 'receivedBy', 'businessId', 'updated_at'], purchaseOrders),
  insert('supplierPayments', ['id', 'supplierId', 'purchaseOrderId', 'purchaseOrderIds', 'invoiceAllocations', 'creditNoteIds', 'amount', 'paymentMethod', 'transactionCode', 'timestamp', 'reference', 'source', 'accountId', 'shopId', 'shiftId', 'preparedBy', 'businessId', 'updated_at'], supplierPayments),
  insert('creditNotes', ['id', 'supplierId', 'amount', 'reference', 'timestamp', 'reason', 'status', 'allocatedTo', 'items', 'productId', 'quantity', 'businessId', 'shiftId', 'updated_at'], creditNotes),
  insert('salesInvoices', ['id', 'invoiceNumber', 'customerId', 'customerName', 'customerPhone', 'customerEmail', 'items', 'subtotal', 'tax', 'total', 'paidAmount', 'balance', 'status', 'issueDate', 'dueDate', 'notes', 'preparedBy', 'businessId', 'updated_at'], salesInvoices),
  insert('dailySummaries', ['id', 'date', 'shiftIds', 'totalSales', 'grossSales', 'taxTotal', 'totalExpenses', 'totalPicks', 'totalRefunds', 'totalVariance', 'timestamp', 'businessId', 'updated_at'], dailySummaries),
  insert('endOfDayReports', ['id', 'shiftId', 'tillId', 'tillName', 'timestamp', 'totalSales', 'grossSales', 'taxTotal', 'cashSales', 'customerCashPayments', 'mpesaSales', 'pdqSales', 'totalExpenses', 'supplierPaymentsTotal', 'remittanceTotal', 'totalPicks', 'totalRefunds', 'cashRefunds', 'openingCash', 'closingCash', 'expectedCash', 'reportedCash', 'difference', 'cashierName', 'cashierId', 'closeBreakdown', 'businessId', 'updated_at'], endOfDayReports),
  insert('stockAdjustmentRequests', ['id', 'productId', 'productName', 'oldQty', 'newQty', 'requestedQuantity', 'reason', 'timestamp', 'status', 'preparedBy', 'approvedBy', 'businessId', 'updated_at'], stockAdjustmentRequests),
  insert('hrStaff', ['id', 'fullName', 'phone', 'email', 'roleTitle', 'department', 'nationalId', 'kraPin', 'nhifNumber', 'nssfNumber', 'hireDate', 'status', 'baseSalary', 'payCycle', 'emergencyContact', 'notes', 'businessId', 'updated_at'], hrStaff),
  insert('auditLogs', ['id', 'ts', 'userId', 'userName', 'action', 'entity', 'entityId', 'severity', 'details', 'businessId', 'updated_at'], auditLogs),
].filter(Boolean).join('\n\n');

if (!skipSchema) {
  runWrangler(['d1', 'execute', databaseName, target, '--file', path.join(root, 'schema.sql')]);
}

const tempDir = await mkdtemp(path.join(tmpdir(), 'mtaani-wines-seed-'));
const seedPath = path.join(tempDir, 'seed-wines-spirits-demo.sql');

try {
  await writeFile(seedPath, seedSql, 'utf8');
  runWrangler(['d1', 'execute', databaseName, target, '--file', seedPath]);
  console.log('\nSeed complete: Mtaani Wines & Spirits');
  console.log('Business code: MTAANI01');
  console.log('Admin login: admin / 1234');
  console.log('Cashier login: Cashier / 1234');
  console.log('Manager login: Manager / 1234');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
