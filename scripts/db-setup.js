#!/usr/bin/env node

/**
 * MTAANI POS Database Setup Script
 *
 * This script initializes the Cloudflare D1 database with:
 * 1. Full schema creation (all tables and indexes)
 * 2. Essential seed data (admin user, extreme settings, categories, etc.)
 * 3. Uses the same API endpoints as the frontend with proper authentication
 *
 * Usage:
 *   node scripts/db-setup.js [--local|--remote] [--api-secret=your-secret]
 *
 * Environment variables:
 *   - API_SECRET or MTAANI_API_SECRET: service API secret for authentication
 *   - API_BASE_URL: Base URL for API calls (defaults to http://localhost:8788)
 */

// No file system operations needed for this script

// Default configuration
const DEFAULT_API_BASE_URL = 'http://localhost:8788';

// Parse command line arguments
const args = process.argv.slice(2);
const isLocal = args.includes('--local');
const isRemote = args.includes('--remote');
const apiSecretArg = args.find(arg => arg.startsWith('--api-secret='))?.split('=')[1];
const apiUrlArg = args.find(arg => arg.startsWith('--api-url='))?.split('=')[1];

// Determine API base URL
const API_BASE_URL = apiUrlArg || (isLocal ? 'http://localhost:8788' : 
    (isRemote ? 'https://your-app.pages.dev' : DEFAULT_API_BASE_URL));

// Get API secret from environment or arguments. There is deliberately no default.
const API_SECRET = apiSecretArg || process.env.API_SECRET || process.env.MTAANI_API_SECRET || '';

function requireApiSecret() {
  if (!API_SECRET) {
    throw new Error('Missing API secret. Pass --api-secret=... or set API_SECRET / MTAANI_API_SECRET.');
  }
}

// Seed data configuration
const SEED_DATA = {
  users: [
    { id: 'u1', name: 'Admin', password: 'admin123', role: 'ADMIN' },
    { id: 'u2', name: 'Default Cashier', password: '0000', role: 'CASHIER' },
    { id: 'u3', name: 'Store Manager', password: '5555', role: 'MANAGER' }
  ],
  categories: [
    { id: 'cat1', name: 'Whiskeys', iconName: 'GlassWater', color: 'amber' },
    { id: 'cat2', name: 'Beers & Ciders', iconName: 'Beer', color: 'yellow' },
    { id: 'cat3', name: 'Wines', iconName: 'Wine', color: 'red' },
    { id: 'cat4', name: 'Spirits & Vodka', iconName: 'Zap', color: 'blue' },
    { id: 'cat5', name: 'Gin', iconName: 'Leaf', color: 'green' },
    { id: 'cat6', name: 'Soft Drinks & Mixers', iconName: 'GlassWater', color: 'cyan' }
  ],
  products: [
    { id: 'p1', name: 'Jameson Irish Whiskey 750ml', category: 'Whiskeys', sellingPrice: 3500, taxCategory: 'A', stockQuantity: 24, barcode: '734567' },
    { id: 'p2', name: 'Jack Daniels 1L', category: 'Whiskeys', sellingPrice: 5200, taxCategory: 'A', stockQuantity: 12, barcode: '734568' },
    { id: 'p3', name: 'Tusker Lager 500ml', category: 'Beers & Ciders', sellingPrice: 220, taxCategory: 'A', stockQuantity: 120, barcode: '734569' },
    { id: 'p4', name: 'White Cap 500ml', category: 'Beers & Ciders', sellingPrice: 230, taxCategory: 'A', stockQuantity: 96, barcode: '734570' },
    { id: 'p5', name: 'Robertson Sweet Red 750ml', category: 'Wines', sellingPrice: 1400, taxCategory: 'A', stockQuantity: 18, barcode: '734571' },
    { id: 'p6', name: 'Casillero del Diablo 750ml', category: 'Wines', sellingPrice: 2100, taxCategory: 'A', stockQuantity: 10, barcode: '734572' },
    { id: 'p7', name: 'Smirnoff Vodka 750ml', category: 'Spirits & Vodka', sellingPrice: 1800, taxCategory: 'A', stockQuantity: 30, barcode: '734573' },
    { id: 'p8', name: 'Gilbey\'s Gin 750ml', category: 'Gin', sellingPrice: 1500, taxCategory: 'A', stockQuantity: 40, barcode: '734574' },
    { id: 'p9', name: 'Gordon\'s London Dry Gin 750ml', category: 'Gin', sellingPrice: 2400, taxCategory: 'A', stockQuantity: 15, barcode: '734575' },
    { id: 'p10', name: 'Coca Cola 500ml', category: 'Soft Drinks & Mixers', sellingPrice: 100, taxCategory: 'A', stockQuantity: 100, barcode: '734576' },
    { id: 'p11', name: 'Krest Bitter Lemon 500ml', category: 'Soft Drinks & Mixers', sellingPrice: 120, taxCategory: 'A', stockQuantity: 60, barcode: '734577' }
  ],
  suppliers: [
    { id: 's1', name: 'EABL Distributor', company: 'Kenya Breweries Ltd', phone: '0711000111', email: 'orders@eabl.com', balance: 45000 },
    { id: 's2', name: 'KWAL Supplies', company: 'Kenya Wine Agencies', phone: '0722000222', email: 'sales@kwal.co.ke', balance: 12000 }
  ],
  customers: [
    { id: 'c1', name: 'Walk-in Customer', phone: '0000000000', email: '', totalSpent: 0, balance: 0 },
    { id: 'c2', name: 'VIP Regular', phone: '0788111222', email: 'vip@mail.com', totalSpent: 15000, balance: 0 }
  ],
  settings: [
    { id: 'store-settings', storeName: 'MTAANI WINES & SPIRITS', tillNumber: 'WS-001', kraPin: 'P051234567X', receiptFooter: 'Drink Responsibly. Not for Sale to Persons Under 18.' }
  ]
};

// Helper function to make API requests
async function apiRequest(endpoint, method = 'GET', data = null) {
  const url = `${API_BASE_URL}/api/data/${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': API_SECRET
  };

  const options = {
    method,
    headers,
    ...(data && { body: JSON.stringify(data) })
  };

  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`API Request failed for ${method} ${url}:`, error.message);
    throw error;
  }
}

// Check if API is accessible
async function checkApiHealth() {
  try {
    const result = await apiRequest('system/ping');
    console.log('✅ API health check passed:', result);
    return true;
  } catch (error) {
    console.error('❌ API health check failed:', error.message);
    return false;
  }
}

// Initialize database schema
async function initializeSchema() {
  try {
    console.log('🔄 Initializing database schema...');
    const result = await apiRequest('system/setup', 'POST', {});
    console.log('✅ Database schema initialized successfully:', result.message);
    return true;
  } catch (error) {
    console.error('❌ Schema initialization failed:', error.message);
    return false;
  }
}

// Seed data for a specific table
async function seedTable(tableName, data) {
  try {
    console.log(`🔄 Seeding ${tableName} table with ${data.length} records...`);
    
    // Proceed with seeding (POST will perform INSERT OR REPLACE)
    
    const result = await apiRequest(tableName, 'POST', data);
    console.log(`✅ ${tableName} table seeded successfully: ${result.count} records added`);
    return { skipped: false, count: result.count };
  } catch (error) {
    console.error(`❌ Failed to seed ${tableName} table:`, error.message);
    throw error;
  }
}

// Main setup function
async function setupDatabase() {
  requireApiSecret();
  console.log('🚀 Starting MTAANI POS Database Setup');
  console.log(`📊 API Base URL: ${API_BASE_URL}`);
  console.log('🔑 Service API secret provided: yes');
  console.log('---');

  // Check API health
  if (!await checkApiHealth()) {
    console.error('💥 Cannot proceed without a healthy API connection');
    process.exit(1);
  }

  // Initialize schema
  if (!await initializeSchema()) {
    console.error('💥 Schema initialization failed, cannot proceed with seeding');
    process.exit(1);
  }

  // Seed data for each table
  const seedResults = {};
  
  for (const [tableName, data] of Object.entries(SEED_DATA)) {
    try {
      seedResults[tableName] = await seedTable(tableName, data);
    } catch (error) {
      console.error(`💥 Critical error seeding ${tableName}:`, error.message);
      seedResults[tableName] = { error: error.message };
    }
    
    // Small delay between table operations
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Summary
  console.log('\n---');
  console.log('📊 Setup Summary:');
  
  let totalSeeded = 0;
  let totalSkipped = 0;
  let errors = 0;
  
  for (const [table, result] of Object.entries(seedResults)) {
    if (result.error) {
      console.log(`❌ ${table}: ERROR - ${result.error}`);
      errors++;
    } else if (result.skipped) {
      console.log(`ℹ️  ${table}: SKIPPED (${result.count} existing records)`);
      totalSkipped++;
    } else {
      console.log(`✅ ${table}: SUCCESS (${result.count} records seeded)`);
      totalSeeded += result.count;
    }
  }

  console.log('---');
  console.log(`📈 Total records seeded: ${totalSeeded}`);
  console.log(`📊 Tables skipped (already had data): ${totalSkipped}`);
  console.log(`❌ Tables with errors: ${errors}`);
  
  if (errors === 0) {
    console.log('🎉 Database setup completed successfully!');
    console.log('\n🔑 Default Admin Login:');
    console.log('   Username: Admin');
    console.log('   Password: admin123');
  } else {
    console.log('⚠️  Setup completed with errors. Some tables may not be properly seeded.');
    process.exit(1);
  }
}

import { fileURLToPath } from 'url';

// Handle command line execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupDatabase().catch(error => {
    console.error('💥 Fatal error during setup:', error);
    process.exit(1);
  });
}

export {
  setupDatabase,
  SEED_DATA,
  API_BASE_URL,
  API_SECRET
};
