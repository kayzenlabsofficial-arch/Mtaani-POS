#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BUSINESS_ID = 'biz_001';
const BUSINESS_CODE = 'MTAANI01';
const MAIN_BRANCH_ID = '160c0ce9-48ae-4711-9ef9-238d04a86b47';
const BASE = new Date('2026-05-16T09:00:00+03:00').getTime();
const DAY = 24 * 60 * 60 * 1000;
const NOW = BASE;

const args = new Set(process.argv.slice(2));
const databaseName = process.argv.find(arg => arg.startsWith('--database='))?.split('=')[1] || 'mtaani_pos_db';
const targetFlag = args.has('--local') ? '--local' : '--remote';

function at(daysAgo, hour = 10, minute = 0) {
  const d = new Date(BASE - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function sqlValue(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertRows(table, columns, rows, chunkSize = 25) {
  const statements = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    const values = chunk
      .map(row => `(${columns.map(column => sqlValue(row[column])).join(', ')})`)
      .join(',\n');
    statements.push(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES\n${values};`);
  }
  return statements.join('\n');
}

function saleItem(product, quantity) {
  return {
    productId: product.id,
    name: product.name,
    snapshotPrice: product.sellingPrice,
    snapshotCost: product.costPrice,
    quantity,
    unit: product.unit,
    category: product.category,
    taxCategory: product.taxCategory,
  };
}

const branches = [
  {
    id: MAIN_BRANCH_ID,
    name: 'Main Branch',
    location: 'Nairobi CBD Demo HQ',
    phone: '0700000100',
    tillNumber: '333111',
    kraPin: 'P000111222D',
    isActive: 1,
    businessId: BUSINESS_ID,
    mpesaConsumerKey: 'demo-consumer-key-main',
    mpesaConsumerSecret: 'demo-consumer-secret-main',
    mpesaPasskey: 'demo-passkey-main',
    mpesaEnv: 'sandbox',
    mpesaType: 'paybill',
    mpesaStoreNumber: '001',
    updated_at: NOW,
  },
  {
    id: 'demo_branch_cbd',
    name: 'CBD Express',
    location: 'Tom Mboya Street',
    phone: '0700000200',
    tillNumber: '333222',
    kraPin: 'P000111222D',
    isActive: 1,
    businessId: BUSINESS_ID,
    mpesaConsumerKey: 'demo-consumer-key-cbd',
    mpesaConsumerSecret: 'demo-consumer-secret-cbd',
    mpesaPasskey: 'demo-passkey-cbd',
    mpesaEnv: 'sandbox',
    mpesaType: 'paybill',
    mpesaStoreNumber: '002',
    updated_at: NOW,
  },
  {
    id: 'demo_branch_estate',
    name: 'Estate Outlet',
    location: 'Pipeline Estate',
    phone: '0700000300',
    tillNumber: '333333',
    kraPin: 'P000111222D',
    isActive: 1,
    businessId: BUSINESS_ID,
    mpesaConsumerKey: 'demo-consumer-key-estate',
    mpesaConsumerSecret: 'demo-consumer-secret-estate',
    mpesaPasskey: 'demo-passkey-estate',
    mpesaEnv: 'sandbox',
    mpesaType: 'till',
    mpesaStoreNumber: '003',
    updated_at: NOW,
  },
  {
    id: 'demo_branch_wholesale',
    name: 'Wholesale Depot',
    location: 'Industrial Area',
    phone: '0700000400',
    tillNumber: '333444',
    kraPin: 'P000111222D',
    isActive: 1,
    businessId: BUSINESS_ID,
    mpesaConsumerKey: 'demo-consumer-key-wholesale',
    mpesaConsumerSecret: 'demo-consumer-secret-wholesale',
    mpesaPasskey: 'demo-passkey-wholesale',
    mpesaEnv: 'sandbox',
    mpesaType: 'paybill',
    mpesaStoreNumber: '004',
    updated_at: NOW,
  },
];

const users = [
  { id: 'demo_user_admin', name: 'Demo Admin', password: 'admin123', role: 'ADMIN', businessId: BUSINESS_ID, branchId: null, updated_at: NOW },
  { id: 'demo_user_manager', name: 'Demo Manager', password: '5555', role: 'MANAGER', businessId: BUSINESS_ID, branchId: MAIN_BRANCH_ID, updated_at: NOW },
  { id: 'demo_user_cashier_main', name: 'Main Cashier', password: '0000', role: 'CASHIER', businessId: BUSINESS_ID, branchId: MAIN_BRANCH_ID, updated_at: NOW },
  { id: 'demo_user_cashier_cbd', name: 'CBD Cashier', password: '1111', role: 'CASHIER', businessId: BUSINESS_ID, branchId: 'demo_branch_cbd', updated_at: NOW },
  { id: 'demo_user_cashier_estate', name: 'Estate Cashier', password: '2222', role: 'CASHIER', businessId: BUSINESS_ID, branchId: 'demo_branch_estate', updated_at: NOW },
  { id: 'demo_user_stock', name: 'Stock Controller', password: '3333', role: 'MANAGER', businessId: BUSINESS_ID, branchId: 'demo_branch_wholesale', updated_at: NOW },
];

const settings = [
  {
    id: `core_${BUSINESS_ID}`,
    storeName: 'Mtaani Demo Mart',
    location: 'Nairobi CBD',
    tillNumber: '333111',
    kraPin: 'P000111222D',
    receiptFooter: 'Demo data for training. Thank you for shopping with Mtaani.',
    ownerModeEnabled: 1,
    autoApproveOwnerActions: 1,
    cashSweepEnabled: 1,
    cashDrawerLimit: 25000,
    cashFloatTarget: 5000,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  },
];

const categories = [
  ['demo_cat_wines', 'Wines', 'Wine', 'rose'],
  ['demo_cat_spirits', 'Spirits', 'GlassWater', 'indigo'],
  ['demo_cat_beer', 'Beer and Cider', 'Beer', 'amber'],
  ['demo_cat_soft', 'Soft Drinks', 'CupSoda', 'cyan'],
  ['demo_cat_fresh', 'Fresh Foods', 'Salad', 'emerald'],
  ['demo_cat_grocery', 'Grocery', 'ShoppingBasket', 'blue'],
  ['demo_cat_household', 'Household', 'Home', 'slate'],
  ['demo_cat_combos', 'Combos', 'PackagePlus', 'violet'],
  ['demo_cat_services', 'Services', 'Wrench', 'orange'],
].map(([id, name, iconName, color]) => ({ id, name, iconName, color, businessId: BUSINESS_ID, branchId: null, updated_at: NOW }));

const products = [
  ['demo_prod_jameson_750', 'Jameson Irish Whiskey 750ml', 'Spirits', 3500, 2650, 'A', 24, 'btl', '890001', 6],
  ['demo_prod_jw_black_750', 'Johnnie Walker Black 750ml', 'Spirits', 4200, 3300, 'A', 18, 'btl', '890002', 5],
  ['demo_prod_smnr_750', 'Smirnoff Vodka 750ml', 'Spirits', 1750, 1280, 'A', 35, 'btl', '890003', 8],
  ['demo_prod_gilbeys_750', 'Gilbeys Gin 750ml', 'Spirits', 1500, 1120, 'A', 30, 'btl', '890004', 8],
  ['demo_prod_robertson_red', 'Robertson Sweet Red 750ml', 'Wines', 1450, 980, 'A', 28, 'btl', '890005', 7],
  ['demo_prod_fourth_street', 'Fourth Street Sweet White 750ml', 'Wines', 1250, 840, 'A', 26, 'btl', '890006', 7],
  ['demo_prod_tusker_500', 'Tusker Lager 500ml', 'Beer and Cider', 240, 172, 'A', 180, 'btl', '890007', 36],
  ['demo_prod_whitecap_500', 'White Cap Lager 500ml', 'Beer and Cider', 250, 180, 'A', 150, 'btl', '890008', 30],
  ['demo_prod_guarana_330', 'Guarana Cider 330ml', 'Beer and Cider', 180, 128, 'A', 120, 'can', '890009', 24],
  ['demo_prod_coke_500', 'Coca Cola 500ml', 'Soft Drinks', 100, 68, 'A', 200, 'btl', '890010', 48],
  ['demo_prod_sprite_500', 'Sprite 500ml', 'Soft Drinks', 100, 68, 'A', 170, 'btl', '890011', 48],
  ['demo_prod_tonic_500', 'Schweppes Tonic 500ml', 'Soft Drinks', 130, 90, 'A', 90, 'btl', '890012', 24],
  ['demo_prod_water_500', 'Bottled Water 500ml', 'Soft Drinks', 60, 35, 'E', 210, 'btl', '890013', 48],
  ['demo_prod_ugali_flour', 'Maize Flour 2kg', 'Grocery', 220, 178, 'E', 95, 'bag', '890014', 20],
  ['demo_prod_rice_2kg', 'Pishori Rice 2kg', 'Grocery', 420, 340, 'E', 60, 'bag', '890015', 15],
  ['demo_prod_sugar_2kg', 'Sugar 2kg', 'Grocery', 390, 315, 'E', 70, 'bag', '890016', 15],
  ['demo_prod_milk_500', 'Fresh Milk 500ml', 'Grocery', 75, 58, 'E', 110, 'pkt', '890017', 30],
  ['demo_prod_bread', 'Family Bread 600g', 'Grocery', 95, 72, 'E', 80, 'loaf', '890018', 20],
  ['demo_prod_eggs_tray', 'Eggs Tray 30pc', 'Grocery', 450, 365, 'E', 22, 'tray', '890019', 5],
  ['demo_prod_tomatoes_kg', 'Tomatoes 1kg', 'Fresh Foods', 160, 100, 'E', 55, 'kg', '890020', 12],
  ['demo_prod_onions_kg', 'Onions 1kg', 'Fresh Foods', 140, 90, 'E', 60, 'kg', '890021', 12],
  ['demo_prod_kachumbari', 'Kachumbari Pack', 'Fresh Foods', 80, 45, 'E', 70, 'pack', '890022', 15],
  ['demo_prod_charcoal', 'Charcoal 4kg', 'Household', 300, 220, 'C', 40, 'bag', '890023', 10],
  ['demo_prod_detergent', 'Detergent Powder 1kg', 'Household', 260, 190, 'A', 75, 'pkt', '890024', 16],
  ['demo_prod_tissue', 'Tissue Pack 10pc', 'Household', 420, 310, 'A', 45, 'pack', '890025', 10],
  ['demo_prod_airtime', 'Airtime Service', 'Services', 100, 96, 'E', 999, 'svc', '890026', 100],
  ['demo_prod_delivery', 'Delivery Fee', 'Services', 150, 30, 'E', 999, 'svc', '890027', 100],
  ['demo_prod_party_pack', 'Party Mixer Pack', 'Combos', 4600, 3550, 'A', 0, 'pack', '890028', 4],
  ['demo_prod_breakfast_pack', 'Breakfast Pack', 'Combos', 760, 570, 'E', 0, 'pack', '890029', 6],
  ['demo_prod_lunch_pack', 'Lunch Combo Pack', 'Combos', 520, 390, 'E', 0, 'pack', '890030', 8],
].map(([id, name, category, sellingPrice, costPrice, taxCategory, stockQuantity, unit, barcode, reorderPoint]) => ({
  id,
  name,
  category,
  sellingPrice,
  costPrice,
  taxCategory,
  stockQuantity,
  unit,
  barcode,
  imageUrl: '',
  reorderPoint,
  isBundle: id.includes('_pack') ? 1 : 0,
  components: null,
  businessId: BUSINESS_ID,
  branchId: MAIN_BRANCH_ID,
  updated_at: NOW,
}));

const productById = new Map(products.map(product => [product.id, product]));
productById.get('demo_prod_party_pack').components = [
  { productId: 'demo_prod_smnr_750', quantity: 1 },
  { productId: 'demo_prod_tonic_500', quantity: 4 },
  { productId: 'demo_prod_coke_500', quantity: 4 },
];
productById.get('demo_prod_breakfast_pack').components = [
  { productId: 'demo_prod_bread', quantity: 2 },
  { productId: 'demo_prod_milk_500', quantity: 4 },
  { productId: 'demo_prod_eggs_tray', quantity: 1 },
];
productById.get('demo_prod_lunch_pack').components = [
  { productId: 'demo_prod_ugali_flour', quantity: 1 },
  { productId: 'demo_prod_tomatoes_kg', quantity: 2 },
  { productId: 'demo_prod_onions_kg', quantity: 1 },
  { productId: 'demo_prod_kachumbari', quantity: 2 },
];

const productIngredients = [];
for (const bundle of products.filter(product => product.isBundle)) {
  for (const component of bundle.components) {
    productIngredients.push({
      id: `demo_ing_${bundle.id}_${component.productId}`,
      productId: bundle.id,
      ingredientProductId: component.productId,
      quantity: component.quantity,
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  }
}

const expenseAccounts = [
  ['demo_expacc_rent', 'Rent and Rates', 'Shop rent, licenses, rates'],
  ['demo_expacc_utilities', 'Utilities', 'Power, water, internet'],
  ['demo_expacc_transport', 'Transport', 'Delivery, rider, loading fees'],
  ['demo_expacc_staff', 'Staff Welfare', 'Meals, advances, airtime'],
  ['demo_expacc_repairs', 'Repairs and Maintenance', 'Equipment repairs'],
  ['demo_expacc_packaging', 'Packaging', 'Bags, labels, receipt rolls'],
  ['demo_expacc_marketing', 'Marketing', 'Promotions and signage'],
  ['demo_expacc_stockloss', 'Stock Loss', 'Spoilage, breakages, shrinkage'],
].map(([id, name, description]) => ({ id, name, description, businessId: BUSINESS_ID, updated_at: NOW }));

const financialAccounts = [
  ['demo_acc_main_till', 'Main Branch Cash Drawer', 'CASH', 18650, BUSINESS_ID, MAIN_BRANCH_ID, 'CASH-MAIN'],
  ['demo_acc_cbd_till', 'CBD Express Cash Drawer', 'CASH', 12420, BUSINESS_ID, 'demo_branch_cbd', 'CASH-CBD'],
  ['demo_acc_estate_till', 'Estate Outlet Cash Drawer', 'CASH', 9210, BUSINESS_ID, 'demo_branch_estate', 'CASH-EST'],
  ['demo_acc_wholesale_cash', 'Wholesale Depot Cash Drawer', 'CASH', 24400, BUSINESS_ID, 'demo_branch_wholesale', 'CASH-WHS'],
  ['demo_acc_kcb', 'KCB Operating Account', 'BANK', 385000, BUSINESS_ID, null, '1102233445'],
  ['demo_acc_equity', 'Equity Supplier Account', 'BANK', 220000, BUSINESS_ID, null, '0988877665'],
  ['demo_acc_mpesa', 'M-Pesa Paybill Float', 'MPESA', 68250, BUSINESS_ID, null, '333111'],
].map(([id, name, type, balance, businessId, branchId, accountNumber]) => ({
  id,
  name,
  type,
  balance,
  businessId,
  branchId,
  accountNumber,
  updated_at: NOW,
}));

const suppliers = [
  ['demo_sup_eabl', 'EABL Distributor', 'East African Breweries Ltd', '0711000111', 'orders@eabl.example'],
  ['demo_sup_kwal', 'KWAL Supplies', 'Kenya Wine Agencies Ltd', '0711000222', 'sales@kwal.example'],
  ['demo_sup_fresh', 'Marikiti Fresh Produce', 'Marikiti Market Traders', '0711000333', 'fresh@marikiti.example'],
  ['demo_sup_household', 'Jirani Household Wholesale', 'Jirani Wholesale Ltd', '0711000444', 'orders@jirani.example'],
  ['demo_sup_grocery', 'Unga and Staples Ltd', 'Unga and Staples Ltd', '0711000555', 'sales@staples.example'],
  ['demo_sup_logistics', 'Mtaa Logistics', 'Mtaa Logistics Services', '0711000666', 'dispatch@mtaa.example'],
].map(([id, name, company, phone, email]) => ({ id, name, company, phone, email, balance: 0, branchId: MAIN_BRANCH_ID, businessId: BUSINESS_ID, updated_at: NOW }));

const customerSeed = [
  ['demo_cust_walkin', 'Walk-in Customer', '0700000000', '', MAIN_BRANCH_ID],
  ['demo_cust_school', 'Bright Future School', '0722000101', 'accounts@brightfuture.example', MAIN_BRANCH_ID],
  ['demo_cust_hotel', 'Mama Njeri Hotel', '0722000202', 'orders@mamanjeri.example', MAIN_BRANCH_ID],
  ['demo_cust_office', 'Savanna Offices', '0722000303', 'admin@savanna.example', 'demo_branch_cbd'],
  ['demo_cust_caterer', 'Jikoni Caterers', '0722000404', 'payables@jikoni.example', 'demo_branch_estate'],
  ['demo_cust_regular', 'Kevin Regular', '0722000505', 'kevin@example.com', MAIN_BRANCH_ID],
  ['demo_cust_bar', 'Rafiki Sports Bar', '0722000606', 'rafiki@example.com', 'demo_branch_cbd'],
  ['demo_cust_church', 'Hope Church Kitchen', '0722000707', 'treasury@hope.example', 'demo_branch_estate'],
  ['demo_cust_wholesale', 'Kijiji Mini Shop', '0722000808', 'kijiji@example.com', 'demo_branch_wholesale'],
  ['demo_cust_delivery', 'Delivery Client Account', '0722000909', 'delivery@example.com', MAIN_BRANCH_ID],
  ['demo_cust_vip', 'VIP Regular', '0722001010', 'vip@example.com', MAIN_BRANCH_ID],
  ['demo_cust_event', 'Weekend Event Crew', '0722001111', 'events@example.com', 'demo_branch_cbd'],
];

const customerStats = new Map(customerSeed.map(([id]) => [id, { totalSpent: 0, balance: 0 }]));
const transactions = [];
const customerPayments = [];
const stockMovements = [];

function recordCustomerSale(customerId, total, creditAmount = 0) {
  if (!customerId || !customerStats.has(customerId)) return;
  const stat = customerStats.get(customerId);
  stat.totalSpent = money(stat.totalSpent + total);
  stat.balance = money(stat.balance + creditAmount);
}

function recordCustomerPayment(customerId, amount) {
  if (!customerId || !customerStats.has(customerId)) return;
  const stat = customerStats.get(customerId);
  stat.balance = money(Math.max(0, stat.balance - amount));
}

function addTransaction({
  id,
  branchId,
  daysAgo,
  hour,
  cashierName,
  cashierId,
  productLines,
  status = 'PAID',
  paymentMethod = 'CASH',
  customerId = null,
  customerName = null,
  discountAmount = 0,
  discountReason = null,
  splitPayments = null,
  mpesaReference = null,
  mpesaCode = null,
  amountTendered = null,
  changeGiven = null,
  approvedBy = null,
  pendingRefundItems = null,
}) {
  const items = productLines.map(([productId, quantity]) => saleItem(productById.get(productId), quantity));
  const subtotal = money(items.reduce((sum, item) => sum + item.snapshotPrice * item.quantity, 0));
  const total = money(Math.max(0, subtotal - discountAmount));
  const tax = money(total * 0.16 / 1.16);
  const shiftId = `demo_shift_${branchId}_${Math.max(0, Math.min(13, daysAgo))}`;
  transactions.push({
    id,
    total,
    subtotal,
    tax,
    discountAmount,
    discountReason,
    items,
    timestamp: at(daysAgo, hour, (daysAgo * 7) % 60),
    status,
    paymentMethod,
    amountTendered: amountTendered ?? (paymentMethod === 'CASH' ? Math.ceil(total / 100) * 100 : total),
    changeGiven: changeGiven ?? (paymentMethod === 'CASH' ? money(Math.max(0, Math.ceil(total / 100) * 100 - total)) : 0),
    mpesaReference,
    mpesaCode,
    cashierId,
    cashierName,
    customerId,
    customerName,
    discount: discountAmount,
    discountType: discountAmount ? 'AMOUNT' : null,
    splitPayments,
    splitData: splitPayments,
    isSynced: 1,
    approvedBy,
    pendingRefundItems,
    shiftId,
    branchId,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });

  let creditAmount = 0;
  if (paymentMethod === 'CREDIT') creditAmount = total;
  if (paymentMethod === 'SPLIT' && splitPayments?.secondaryMethod === 'CREDIT') {
    creditAmount = Number(splitPayments.secondaryAmount || 0);
  }
  recordCustomerSale(customerId, total, creditAmount);

  for (const item of items) {
    stockMovements.push({
      id: `demo_move_sale_${id}_${item.productId}`,
      productId: item.productId,
      type: 'OUT',
      quantity: item.quantity,
      timestamp: at(daysAgo, hour, (daysAgo * 7) % 60),
      reference: `Sale ${id}`,
      branchId,
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  }
}

const schoolProducts = [
  ['demo_prod_bread', 6],
  ['demo_prod_milk_500', 12],
  ['demo_prod_ugali_flour', 4],
  ['demo_prod_rice_2kg', 2],
  ['demo_prod_sugar_2kg', 2],
  ['demo_prod_eggs_tray', 1],
  ['demo_prod_lunch_pack', 2],
];

for (let i = 1; i <= 55; i++) {
  const primary = schoolProducts[i % schoolProducts.length];
  const secondary = schoolProducts[(i + 2) % schoolProducts.length];
  addTransaction({
    id: `demo_tx_school_credit_${String(i).padStart(3, '0')}`,
    branchId: MAIN_BRANCH_ID,
    daysAgo: 70 - i,
    hour: 9 + (i % 7),
    cashierName: i % 2 ? 'Main Cashier' : 'Demo Manager',
    cashierId: i % 2 ? 'demo_user_cashier_main' : 'demo_user_manager',
    productLines: [primary, secondary],
    status: 'UNPAID',
    paymentMethod: 'CREDIT',
    customerId: 'demo_cust_school',
    customerName: 'Bright Future School',
    discountAmount: i % 10 === 0 ? 100 : 0,
    discountReason: i % 10 === 0 ? 'School account discount' : null,
  });
}

const paymentAmounts = [2500, 3000, 5000, 4500, 3800, 6000, 2400, 5200, 3000, 4200, 5100, 3900, 4600, 2750, 3500, 4250, 5000, 6500];
paymentAmounts.forEach((amount, index) => {
  const id = `demo_cpay_school_${String(index + 1).padStart(3, '0')}`;
  customerPayments.push({
    id,
    customerId: 'demo_cust_school',
    amount,
    paymentMethod: index % 3 === 0 ? 'MPESA' : 'CASH',
    transactionCode: index % 3 === 0 ? `RFD${1000 + index}` : '',
    reference: `School account payment ${index + 1}`,
    timestamp: at(58 - index * 3, 15, index * 2),
    preparedBy: index % 2 ? 'Main Cashier' : 'Demo Manager',
    branchId: MAIN_BRANCH_ID,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });
  recordCustomerPayment('demo_cust_school', amount);
});

const regularSaleProducts = [
  ['demo_prod_tusker_500', 6],
  ['demo_prod_whitecap_500', 4],
  ['demo_prod_jameson_750', 1],
  ['demo_prod_robertson_red', 2],
  ['demo_prod_coke_500', 8],
  ['demo_prod_tonic_500', 4],
  ['demo_prod_charcoal', 2],
  ['demo_prod_detergent', 2],
  ['demo_prod_party_pack', 1],
  ['demo_prod_breakfast_pack', 1],
  ['demo_prod_lunch_pack', 2],
  ['demo_prod_airtime', 5],
];
const saleBranches = [MAIN_BRANCH_ID, 'demo_branch_cbd', 'demo_branch_estate', 'demo_branch_wholesale'];
const saleCustomers = [null, 'demo_cust_hotel', 'demo_cust_regular', 'demo_cust_bar', 'demo_cust_caterer', 'demo_cust_wholesale', 'demo_cust_vip', 'demo_cust_event'];
const customerNames = Object.fromEntries(customerSeed.map(row => [row[0], row[1]]));

for (let i = 1; i <= 72; i++) {
  const branchId = saleBranches[i % saleBranches.length];
  const customerId = saleCustomers[i % saleCustomers.length];
  const methodCycle = i % 12;
  let paymentMethod = methodCycle === 0 ? 'CREDIT' : methodCycle === 1 ? 'SPLIT' : methodCycle < 5 ? 'MPESA' : methodCycle < 7 ? 'PDQ' : 'CASH';
  let status = paymentMethod === 'CREDIT' ? 'UNPAID' : 'PAID';
  let splitPayments = null;
  let mpesaReference = paymentMethod === 'MPESA' ? `MPESA-DEMO-${2000 + i}` : null;
  let mpesaCode = paymentMethod === 'MPESA' ? `QDEMO${2000 + i}` : null;
  const lines = [
    regularSaleProducts[i % regularSaleProducts.length],
    regularSaleProducts[(i + 5) % regularSaleProducts.length],
  ];
  const tempTotal = money(lines.reduce((sum, [productId, quantity]) => sum + productById.get(productId).sellingPrice * quantity, 0));

  if (paymentMethod === 'SPLIT') {
    splitPayments = {
      cashAmount: money(tempTotal * 0.55),
      secondaryMethod: i % 2 ? 'MPESA' : 'CREDIT',
      secondaryAmount: money(tempTotal * 0.45),
      secondaryReference: `SPLIT-${3000 + i}`,
    };
    if (splitPayments.secondaryMethod === 'CREDIT') status = 'UNPAID';
  }
  if (i === 11) status = 'PARTIAL_REFUND';
  if (i === 27) status = 'PENDING_REFUND';
  if (i === 43) status = 'REFUNDED';

  addTransaction({
    id: `demo_tx_regular_${String(i).padStart(3, '0')}`,
    branchId,
    daysAgo: i % 46,
    hour: 8 + (i % 11),
    cashierName: branchId === MAIN_BRANCH_ID ? 'Main Cashier' : branchId === 'demo_branch_cbd' ? 'CBD Cashier' : branchId === 'demo_branch_estate' ? 'Estate Cashier' : 'Stock Controller',
    cashierId: branchId === MAIN_BRANCH_ID ? 'demo_user_cashier_main' : branchId === 'demo_branch_cbd' ? 'demo_user_cashier_cbd' : branchId === 'demo_branch_estate' ? 'demo_user_cashier_estate' : 'demo_user_stock',
    productLines: lines,
    status,
    paymentMethod,
    customerId,
    customerName: customerId ? customerNames[customerId] : null,
    discountAmount: i % 9 === 0 ? 150 : 0,
    discountReason: i % 9 === 0 ? 'Demo promo' : null,
    splitPayments,
    mpesaReference,
    mpesaCode,
    approvedBy: status.includes('REFUND') ? 'Demo Admin' : null,
    pendingRefundItems: status === 'PENDING_REFUND' ? [{ productId: lines[0][0], quantity: 1 }] : null,
  });
}

for (let i = 1; i <= 8; i++) {
  const customerId = ['demo_cust_hotel', 'demo_cust_caterer', 'demo_cust_bar', 'demo_cust_wholesale'][i % 4];
  const amount = [1200, 1800, 2500, 3200][i % 4];
  customerPayments.push({
    id: `demo_cpay_regular_${String(i).padStart(3, '0')}`,
    customerId,
    amount,
    paymentMethod: i % 2 ? 'MPESA' : 'CASH',
    transactionCode: i % 2 ? `RGC${4000 + i}` : '',
    reference: `Account settlement ${i}`,
    timestamp: at(i * 4, 16, i),
    preparedBy: i % 2 ? 'CBD Cashier' : 'Main Cashier',
    branchId: i % 2 ? 'demo_branch_cbd' : MAIN_BRANCH_ID,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });
  recordCustomerPayment(customerId, amount);
}

const customers = customerSeed.map(([id, name, phone, email, branchId]) => {
  const stat = customerStats.get(id);
  return {
    id,
    name,
    phone,
    email,
    totalSpent: money(stat.totalSpent),
    balance: money(stat.balance),
    branchId,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  };
});

const purchaseOrders = [];
const supplierPayments = [];
const creditNotes = [];
const supplierBalances = new Map(suppliers.map(supplier => [supplier.id, 0]));

function poItems(seed) {
  const picks = [
    ['demo_prod_tusker_500', 48, 172],
    ['demo_prod_whitecap_500', 36, 180],
    ['demo_prod_robertson_red', 12, 980],
    ['demo_prod_smnr_750', 10, 1280],
    ['demo_prod_ugali_flour', 25, 178],
    ['demo_prod_rice_2kg', 18, 340],
    ['demo_prod_tomatoes_kg', 30, 100],
    ['demo_prod_detergent', 18, 190],
  ];
  return [picks[seed % picks.length], picks[(seed + 3) % picks.length]].map(([productId, expectedQuantity, unitCost]) => ({
    productId,
    name: productById.get(productId).name,
    expectedQuantity,
    receivedQuantity: seed % 5 === 0 ? expectedQuantity - 2 : expectedQuantity,
    unitCost,
  }));
}

for (let i = 1; i <= 18; i++) {
  const supplierId = suppliers[i % suppliers.length].id;
  const branchId = saleBranches[i % saleBranches.length];
  const items = poItems(i);
  const totalAmount = money(items.reduce((sum, item) => sum + item.receivedQuantity * item.unitCost, 0));
  const received = i % 6 !== 0;
  const paidAmount = received ? (i % 4 === 0 ? totalAmount : i % 4 === 1 ? money(totalAmount * 0.45) : 0) : 0;
  const paymentStatus = !received ? 'UNPAID' : paidAmount >= totalAmount ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
  purchaseOrders.push({
    id: `demo_po_${String(i).padStart(3, '0')}`,
    supplierId,
    items,
    totalAmount,
    status: received ? 'RECEIVED' : i % 2 ? 'PENDING' : 'CANCELLED',
    approvalStatus: received ? 'APPROVED' : i % 2 ? 'PENDING' : 'REJECTED',
    paymentStatus,
    paidAmount,
    orderDate: at(52 - i * 2, 11, i),
    expectedDate: at(49 - i * 2, 11, i),
    receivedDate: received ? at(47 - i * 2, 15, i) : null,
    invoiceNumber: received ? `INV-DEMO-${5000 + i}` : null,
    poNumber: `PO-DEMO-${String(i).padStart(4, '0')}`,
    preparedBy: i % 2 ? 'Stock Controller' : 'Demo Manager',
    approvedBy: received ? 'Demo Admin' : null,
    receivedBy: received ? 'Stock Controller' : null,
    branchId,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });
  if (received) {
    supplierBalances.set(supplierId, money(supplierBalances.get(supplierId) + totalAmount - paidAmount));
    for (const item of items) {
      stockMovements.push({
        id: `demo_move_po_${String(i).padStart(3, '0')}_${item.productId}`,
        productId: item.productId,
        type: 'IN',
        quantity: item.receivedQuantity,
        timestamp: at(47 - i * 2, 15, i),
        reference: `Received ${`PO-DEMO-${String(i).padStart(4, '0')}`}`,
        branchId,
        businessId: BUSINESS_ID,
        updated_at: NOW,
      });
    }
  }
  if (paidAmount > 0) {
    supplierPayments.push({
      id: `demo_spay_po_${String(i).padStart(3, '0')}`,
      supplierId,
      purchaseOrderId: `demo_po_${String(i).padStart(3, '0')}`,
      purchaseOrderIds: [`demo_po_${String(i).padStart(3, '0')}`],
      creditNoteIds: [],
      amount: paidAmount,
      paymentMethod: i % 2 ? 'BANK' : 'MPESA',
      transactionCode: `SUPPAY-${6000 + i}`,
      timestamp: at(44 - i * 2, 13, i),
      reference: `Payment for PO-DEMO-${String(i).padStart(4, '0')}`,
      source: 'ACCOUNT',
      accountId: i % 2 ? 'demo_acc_kcb' : 'demo_acc_mpesa',
      shiftId: null,
      branchId,
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  }
}

for (let i = 1; i <= 6; i++) {
  const supplierId = suppliers[i % suppliers.length].id;
  const amount = [850, 1200, 450, 2200, 760, 1300][i - 1];
  creditNotes.push({
    id: `demo_credit_note_${String(i).padStart(3, '0')}`,
    supplierId,
    amount,
    reference: `CN-DEMO-${7000 + i}`,
    timestamp: at(35 - i * 3, 14, i),
    reason: i % 2 ? 'Damaged stock returned' : 'Supplier price adjustment',
    status: i % 3 === 0 ? 'ALLOCATED' : 'PENDING',
    allocatedTo: i % 3 === 0 ? `demo_po_${String(i + 2).padStart(3, '0')}` : null,
    productId: i % 2 ? 'demo_prod_tusker_500' : 'demo_prod_detergent',
    quantity: i % 2 ? 4 : 2,
    branchId: saleBranches[i % saleBranches.length],
    businessId: BUSINESS_ID,
    shiftId: null,
    updated_at: NOW,
  });
  if (i % 3 === 0) supplierBalances.set(supplierId, money(Math.max(0, supplierBalances.get(supplierId) - amount)));
}

suppliers.forEach(supplier => {
  supplier.balance = money(supplierBalances.get(supplier.id));
});

const expenses = [];
const expenseTemplates = [
  ['Transport', 'Delivery rider payment', 650, 'TILL', 'demo_expacc_transport'],
  ['Utilities', 'Electricity token', 3200, 'ACCOUNT', 'demo_expacc_utilities'],
  ['Packaging', 'Receipt rolls and carrier bags', 1450, 'ACCOUNT', 'demo_expacc_packaging'],
  ['Staff Welfare', 'Staff lunch allowance', 900, 'TILL', 'demo_expacc_staff'],
  ['Repairs and Maintenance', 'Freezer service', 4800, 'ACCOUNT', 'demo_expacc_repairs'],
  ['Stock Loss', 'Broken bottles written off', 720, 'SHOP', 'demo_expacc_stockloss'],
  ['Marketing', 'Weekend poster printing', 1800, 'ACCOUNT', 'demo_expacc_marketing'],
  ['Rent and Rates', 'Branch rent contribution', 15000, 'ACCOUNT', 'demo_expacc_rent'],
];
for (let i = 1; i <= 36; i++) {
  const [category, description, baseAmount, source, accountId] = expenseTemplates[i % expenseTemplates.length];
  const branchId = saleBranches[i % saleBranches.length];
  const shopExpense = source === 'SHOP';
  expenses.push({
    id: `demo_expense_${String(i).padStart(3, '0')}`,
    amount: money(baseAmount + (i % 5) * 75),
    category,
    description: `${description} ${i}`,
    timestamp: at(i % 48, 12 + (i % 6), i),
    userName: branchId === MAIN_BRANCH_ID ? 'Main Cashier' : 'CBD Cashier',
    status: i % 11 === 0 ? 'PENDING' : i % 17 === 0 ? 'REJECTED' : 'APPROVED',
    source,
    accountId: source === 'ACCOUNT' ? accountId : null,
    productId: shopExpense ? (i % 2 ? 'demo_prod_tusker_500' : 'demo_prod_bread') : null,
    quantity: shopExpense ? (i % 3) + 1 : null,
    preparedBy: branchId === MAIN_BRANCH_ID ? 'Main Cashier' : 'CBD Cashier',
    approvedBy: i % 11 === 0 ? null : 'Demo Manager',
    shiftId: `demo_shift_${branchId}_${Math.max(0, Math.min(13, i % 14))}`,
    branchId,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });
}

const cashPicks = [];
for (let i = 1; i <= 16; i++) {
  cashPicks.push({
    id: `demo_cash_pick_${String(i).padStart(3, '0')}`,
    amount: [3000, 4500, 5500, 2500, 7000][i % 5],
    timestamp: at(i % 28, 17, i),
    status: i % 7 === 0 ? 'PENDING' : 'APPROVED',
    userName: i % 2 ? 'Demo Manager' : 'Main Cashier',
    shiftId: `demo_shift_${saleBranches[i % saleBranches.length]}_${Math.max(0, Math.min(13, i % 14))}`,
    branchId: saleBranches[i % saleBranches.length],
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });
}

const shifts = [];
for (const branch of branches) {
  for (let i = 0; i <= 13; i++) {
    shifts.push({
      id: `demo_shift_${branch.id}_${i}`,
      startTime: at(i, 8, 0),
      endTime: i === 0 ? null : at(i, 20, 30),
      openingFloat: branch.id === MAIN_BRANCH_ID ? 5000 : 3500,
      cashierName: branch.id === MAIN_BRANCH_ID ? 'Main Cashier' : branch.id === 'demo_branch_cbd' ? 'CBD Cashier' : branch.id === 'demo_branch_estate' ? 'Estate Cashier' : 'Stock Controller',
      status: i === 0 ? 'OPEN' : 'CLOSED',
      branchId: branch.id,
      lastSyncAt: at(i, 20, 45),
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  }
}

const endOfDayReports = [];
const dailySummaries = [];
for (const branch of branches) {
  for (let i = 1; i <= 13; i++) {
    const branchTxs = transactions.filter(tx => tx.branchId === branch.id && tx.timestamp >= at(i, 0, 0) && tx.timestamp <= at(i, 23, 59));
    const branchExpenses = expenses.filter(expense => expense.branchId === branch.id && expense.timestamp >= at(i, 0, 0) && expense.timestamp <= at(i, 23, 59) && expense.status !== 'REJECTED');
    const branchPicks = cashPicks.filter(pick => pick.branchId === branch.id && pick.timestamp >= at(i, 0, 0) && pick.timestamp <= at(i, 23, 59) && pick.status === 'APPROVED');
    const totalSales = money(branchTxs.reduce((sum, tx) => sum + tx.total, 0));
    const taxTotal = money(branchTxs.reduce((sum, tx) => sum + tx.tax, 0));
    const totalExpenses = money(branchExpenses.reduce((sum, expense) => sum + expense.amount, 0));
    const totalPicks = money(branchPicks.reduce((sum, pick) => sum + pick.amount, 0));
    const cashSales = money(branchTxs.filter(tx => tx.paymentMethod === 'CASH').reduce((sum, tx) => sum + tx.total, 0));
    const mpesaSales = money(branchTxs.filter(tx => tx.paymentMethod === 'MPESA').reduce((sum, tx) => sum + tx.total, 0));
    const expectedCash = money(3500 + cashSales - totalExpenses - totalPicks);
    const reportedCash = money(expectedCash + ((i % 3) - 1) * 120);
    endOfDayReports.push({
      id: `demo_eod_${branch.id}_${i}`,
      shiftId: `demo_shift_${branch.id}_${i}`,
      timestamp: at(i, 20, 40),
      openingFloat: branch.id === MAIN_BRANCH_ID ? 5000 : 3500,
      totalSales,
      grossSales: totalSales,
      taxTotal,
      cashSales,
      mpesaSales,
      totalExpenses,
      totalPicks,
      totalRefunds: i % 5 === 0 ? 350 : 0,
      expectedCash,
      reportedCash,
      difference: money(reportedCash - expectedCash),
      cashierName: branch.id === MAIN_BRANCH_ID ? 'Main Cashier' : branch.id === 'demo_branch_cbd' ? 'CBD Cashier' : branch.id === 'demo_branch_estate' ? 'Estate Cashier' : 'Stock Controller',
      branchId: branch.id,
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  }
  for (let i = 1; i <= 8; i++) {
    const reports = endOfDayReports.filter(report => report.branchId === branch.id && report.id.endsWith(`_${i}`));
    dailySummaries.push({
      id: `demo_daily_${branch.id}_${i}`,
      date: at(i, 0, 0),
      shiftIds: reports.map(report => report.shiftId),
      totalSales: money(reports.reduce((sum, report) => sum + report.totalSales, 0)),
      grossSales: money(reports.reduce((sum, report) => sum + report.grossSales, 0)),
      taxTotal: money(reports.reduce((sum, report) => sum + report.taxTotal, 0)),
      totalExpenses: money(reports.reduce((sum, report) => sum + report.totalExpenses, 0)),
      totalPicks: money(reports.reduce((sum, report) => sum + report.totalPicks, 0)),
      totalVariance: money(reports.reduce((sum, report) => sum + report.difference, 0)),
      timestamp: at(i, 21, 0),
      branchId: branch.id,
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  }
}

for (const product of products.filter(product => !product.isBundle)) {
  stockMovements.push({
    id: `demo_move_opening_${product.id}`,
    productId: product.id,
    type: 'IN',
    quantity: product.stockQuantity,
    timestamp: at(75, 8, 0),
    reference: 'Demo opening stock',
    branchId: MAIN_BRANCH_ID,
    businessId: BUSINESS_ID,
    updated_at: NOW,
  });
}

const stockAdjustmentRequests = [
  ['demo_adj_001', 'demo_prod_tusker_500', 180, 176, 'Bottle breakage during loading', 'PENDING', 'Main Cashier', null, MAIN_BRANCH_ID],
  ['demo_adj_002', 'demo_prod_bread', 80, 76, 'Expired loaves removed', 'APPROVED', 'Estate Cashier', 'Demo Manager', 'demo_branch_estate'],
  ['demo_adj_003', 'demo_prod_charcoal', 40, 43, 'Physical count found extra bags', 'APPROVED', 'Stock Controller', 'Demo Admin', 'demo_branch_wholesale'],
  ['demo_adj_004', 'demo_prod_robertson_red', 28, 22, 'Rejected pending audit', 'REJECTED', 'CBD Cashier', 'Demo Manager', 'demo_branch_cbd'],
  ['demo_adj_005', 'demo_prod_kachumbari', 70, 65, 'Spoilage after power outage', 'PENDING', 'Main Cashier', null, MAIN_BRANCH_ID],
].map(([id, productId, oldQty, newQty, reason, status, preparedBy, approvedBy, branchId], index) => ({
  id,
  productId,
  productName: productById.get(productId).name,
  oldQty,
  newQty,
  requestedQuantity: newQty,
  reason,
  timestamp: at(index + 1, 10, index),
  status,
  preparedBy,
  approvedBy,
  branchId,
  businessId: BUSINESS_ID,
  updated_at: NOW,
}));

stockAdjustmentRequests
  .filter(req => req.status === 'APPROVED')
  .forEach(req => {
    stockMovements.push({
      id: `demo_move_adjust_${req.id}`,
      productId: req.productId,
      type: 'ADJUST',
      quantity: money(req.newQty - req.oldQty),
      timestamp: req.timestamp,
      reference: `Approved adjustment: ${req.reason}`,
      branchId: req.branchId,
      businessId: BUSINESS_ID,
      updated_at: NOW,
    });
  });

const mpesaCallbacks = [];
transactions
  .filter(tx => tx.paymentMethod === 'MPESA')
  .slice(0, 12)
  .forEach((tx, index) => {
    mpesaCallbacks.push({
      checkoutRequestId: `demo_checkout_${String(index + 1).padStart(3, '0')}`,
      merchantRequestId: `demo_merchant_${String(index + 1).padStart(3, '0')}`,
      resultCode: index === 11 ? 1032 : 0,
      resultDesc: index === 11 ? 'Request cancelled by user' : 'The service request is processed successfully.',
      amount: tx.total,
      receiptNumber: tx.mpesaCode || `RDEM${8000 + index}`,
      phoneNumber: `25472${String(2000000 + index).padStart(7, '0')}`,
      businessId: BUSINESS_ID,
      branchId: tx.branchId,
      timestamp: tx.timestamp + 2 * 60 * 1000,
    });
  });

const deviceSyncStatus = branches.map((branch, index) => ({
  id: `demo_device_${branch.id}`,
  businessId: BUSINESS_ID,
  branchId: branch.id,
  deviceId: `device-demo-${index + 1}`,
  cashierName: branch.id === MAIN_BRANCH_ID ? 'Main Cashier' : branch.id === 'demo_branch_cbd' ? 'CBD Cashier' : branch.id === 'demo_branch_estate' ? 'Estate Cashier' : 'Stock Controller',
  lastSyncAt: at(0, 8 + index, 15),
  updated_at: NOW,
}));

const idempotencyKeys = branches.map((branch, index) => ({
  id: `${BUSINESS_ID}|${branch.id}|demo-key-${index + 1}`,
  businessId: BUSINESS_ID,
  branchId: branch.id,
  idempotencyKey: `demo-key-${index + 1}`,
  operation: index % 2 ? 'sale.create' : 'sync.flush',
  deviceId: `device-demo-${index + 1}`,
  cashierName: deviceSyncStatus[index].cashierName,
  createdAt: at(index, 9, index),
}));

const deleteDemoRows = [
  "DELETE FROM users WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM products WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM productIngredients WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM transactions WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM cashPicks WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM shifts WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM endOfDayReports WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM stockMovements WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM expenses WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM customers WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM customerPayments WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM suppliers WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM supplierPayments WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM creditNotes WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM dailySummaries WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM stockAdjustmentRequests WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM purchaseOrders WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM settings WHERE businessId = 'biz_001' AND id = 'core_biz_001';",
  "DELETE FROM categories WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM branches WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM expenseAccounts WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM financialAccounts WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM mpesaCallbacks WHERE businessId = 'biz_001' AND checkoutRequestId LIKE 'demo_%';",
  "DELETE FROM deviceSyncStatus WHERE businessId = 'biz_001' AND id LIKE 'demo_%';",
  "DELETE FROM idempotencyKeys WHERE businessId = 'biz_001' AND idempotencyKey LIKE 'demo-%';",
];

const sql = [
  `-- Demo seed generated for ${BUSINESS_CODE} / ${BUSINESS_ID}`,
  ...deleteDemoRows,
  insertRows('businesses', ['id', 'name', 'code', 'isActive', 'updated_at'], [
    { id: BUSINESS_ID, name: 'Mtaani Demo Business', code: BUSINESS_CODE, isActive: 1, updated_at: NOW },
  ]),
  insertRows('branches', ['id', 'name', 'location', 'phone', 'tillNumber', 'kraPin', 'isActive', 'businessId', 'mpesaConsumerKey', 'mpesaConsumerSecret', 'mpesaPasskey', 'mpesaEnv', 'mpesaType', 'mpesaStoreNumber', 'updated_at'], branches),
  insertRows('users', ['id', 'name', 'password', 'role', 'businessId', 'branchId', 'updated_at'], users),
  insertRows('settings', ['id', 'storeName', 'location', 'tillNumber', 'kraPin', 'receiptFooter', 'ownerModeEnabled', 'autoApproveOwnerActions', 'cashSweepEnabled', 'cashDrawerLimit', 'cashFloatTarget', 'businessId', 'updated_at'], settings),
  insertRows('categories', ['id', 'name', 'iconName', 'color', 'businessId', 'branchId', 'updated_at'], categories),
  insertRows('products', ['id', 'name', 'category', 'sellingPrice', 'costPrice', 'taxCategory', 'stockQuantity', 'unit', 'barcode', 'imageUrl', 'reorderPoint', 'isBundle', 'components', 'businessId', 'branchId', 'updated_at'], products),
  insertRows('productIngredients', ['id', 'productId', 'ingredientProductId', 'quantity', 'businessId', 'updated_at'], productIngredients),
  insertRows('expenseAccounts', ['id', 'name', 'description', 'businessId', 'updated_at'], expenseAccounts),
  insertRows('financialAccounts', ['id', 'name', 'type', 'balance', 'businessId', 'branchId', 'accountNumber', 'updated_at'], financialAccounts),
  insertRows('suppliers', ['id', 'name', 'company', 'phone', 'email', 'balance', 'branchId', 'businessId', 'updated_at'], suppliers),
  insertRows('customers', ['id', 'name', 'phone', 'email', 'totalSpent', 'balance', 'branchId', 'businessId', 'updated_at'], customers),
  insertRows('transactions', ['id', 'total', 'subtotal', 'tax', 'discountAmount', 'discountReason', 'items', 'timestamp', 'status', 'paymentMethod', 'amountTendered', 'changeGiven', 'mpesaReference', 'mpesaCode', 'cashierId', 'cashierName', 'customerId', 'customerName', 'discount', 'discountType', 'splitPayments', 'splitData', 'isSynced', 'approvedBy', 'pendingRefundItems', 'shiftId', 'branchId', 'businessId', 'updated_at'], transactions),
  insertRows('customerPayments', ['id', 'customerId', 'amount', 'paymentMethod', 'transactionCode', 'reference', 'timestamp', 'preparedBy', 'branchId', 'businessId', 'updated_at'], customerPayments),
  insertRows('purchaseOrders', ['id', 'supplierId', 'items', 'totalAmount', 'status', 'approvalStatus', 'paymentStatus', 'paidAmount', 'orderDate', 'expectedDate', 'receivedDate', 'invoiceNumber', 'poNumber', 'preparedBy', 'approvedBy', 'receivedBy', 'branchId', 'businessId', 'updated_at'], purchaseOrders),
  insertRows('supplierPayments', ['id', 'supplierId', 'purchaseOrderId', 'purchaseOrderIds', 'creditNoteIds', 'amount', 'paymentMethod', 'transactionCode', 'timestamp', 'reference', 'source', 'accountId', 'shiftId', 'branchId', 'businessId', 'updated_at'], supplierPayments),
  insertRows('creditNotes', ['id', 'supplierId', 'amount', 'reference', 'timestamp', 'reason', 'status', 'allocatedTo', 'productId', 'quantity', 'branchId', 'businessId', 'shiftId', 'updated_at'], creditNotes),
  insertRows('expenses', ['id', 'amount', 'category', 'description', 'timestamp', 'userName', 'status', 'source', 'accountId', 'productId', 'quantity', 'preparedBy', 'approvedBy', 'shiftId', 'branchId', 'businessId', 'updated_at'], expenses),
  insertRows('cashPicks', ['id', 'amount', 'timestamp', 'status', 'userName', 'shiftId', 'branchId', 'businessId', 'updated_at'], cashPicks),
  insertRows('shifts', ['id', 'startTime', 'endTime', 'openingFloat', 'cashierName', 'status', 'branchId', 'lastSyncAt', 'businessId', 'updated_at'], shifts),
  insertRows('endOfDayReports', ['id', 'shiftId', 'timestamp', 'openingFloat', 'totalSales', 'grossSales', 'taxTotal', 'cashSales', 'mpesaSales', 'totalExpenses', 'totalPicks', 'totalRefunds', 'expectedCash', 'reportedCash', 'difference', 'cashierName', 'branchId', 'businessId', 'updated_at'], endOfDayReports),
  insertRows('dailySummaries', ['id', 'date', 'shiftIds', 'totalSales', 'grossSales', 'taxTotal', 'totalExpenses', 'totalPicks', 'totalVariance', 'timestamp', 'branchId', 'businessId', 'updated_at'], dailySummaries),
  insertRows('stockMovements', ['id', 'productId', 'type', 'quantity', 'timestamp', 'reference', 'branchId', 'businessId', 'updated_at'], stockMovements),
  insertRows('stockAdjustmentRequests', ['id', 'productId', 'productName', 'oldQty', 'newQty', 'requestedQuantity', 'reason', 'timestamp', 'status', 'preparedBy', 'approvedBy', 'branchId', 'businessId', 'updated_at'], stockAdjustmentRequests),
  insertRows('mpesaCallbacks', ['checkoutRequestId', 'merchantRequestId', 'resultCode', 'resultDesc', 'amount', 'receiptNumber', 'phoneNumber', 'businessId', 'branchId', 'timestamp'], mpesaCallbacks),
  insertRows('deviceSyncStatus', ['id', 'businessId', 'branchId', 'deviceId', 'cashierName', 'lastSyncAt', 'updated_at'], deviceSyncStatus),
  insertRows('idempotencyKeys', ['id', 'businessId', 'branchId', 'idempotencyKey', 'operation', 'deviceId', 'cashierName', 'createdAt'], idempotencyKeys),
].filter(Boolean).join('\n\n');

const tempFile = join(tmpdir(), `mtaani-demo-seed-${Date.now()}.sql`);
writeFileSync(tempFile, sql, 'utf8');

const wranglerPath = process.platform === 'win32'
  ? resolve('node_modules/.bin/wrangler.cmd')
  : resolve('node_modules/.bin/wrangler');
const command = process.platform === 'win32' ? 'cmd.exe' : wranglerPath;
const commandArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', wranglerPath, 'd1', 'execute', databaseName, targetFlag, '--file', tempFile]
  : ['d1', 'execute', databaseName, targetFlag, '--file', tempFile];

console.log(`Seeding ${BUSINESS_CODE} (${BUSINESS_ID}) in ${databaseName} using ${targetFlag}...`);
console.log(`Generated ${transactions.length} transactions, ${customerPayments.length} customer payments, ${purchaseOrders.length} purchase orders, ${expenses.length} expenses.`);

const result = spawnSync(command, commandArgs, {
  stdio: 'inherit',
  shell: false,
});

try {
  unlinkSync(tempFile);
} catch {
  // Ignore cleanup errors.
}

if (result.status !== 0) {
  if (result.error) console.error(result.error.message);
  process.exit(result.status ?? 1);
}

console.log('Demo seed complete.');
console.log('Demo logins:');
console.log('  Business code: MTAANI01');
console.log('  Demo Admin / admin123');
console.log('  Main Cashier / 0000');
console.log('  CBD Cashier / 1111');
