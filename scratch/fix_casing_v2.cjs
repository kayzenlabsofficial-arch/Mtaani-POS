const fs = require('fs');
const path = require('path');

const rootDir = process.argv[2];

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) {
            if (!file.includes('node_modules') && !file.includes('.git') && !file.includes('dist')) {
                results = results.concat(walk(file));
            }
        } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk(rootDir);

const replacements = [
    { from: /Tax-Free/g, to: 'Tax-free' },
    { from: /Walk-in Customer/g, to: 'Walk-in customer' },
    { from: /Current Sale/g, to: 'Current sale' },
    { from: /Register Session/g, to: 'Register session' },
    { from: /Cart is Empty/g, to: 'Cart is empty' },
    { from: /Total Amount/g, to: 'Total amount' },
    { from: /Clear All/g, to: 'Clear all' },
    { from: /Total Amount Due/g, to: 'Total amount due' },
    { from: /Amount Tendered/g, to: 'Amount tendered' },
    { from: /Change to give/g, to: 'Change to give' },
    { from: /Complete Sale/g, to: 'Complete sale' },
    { from: /Paying Customer/g, to: 'Paying customer' },
    { from: /Phone Number/g, to: 'Phone number' },
    { from: /Send Prompt/g, to: 'Send prompt' },
    { from: /Verify Manually/g, to: 'Verify manually' },
    { from: /Sales Receipt/g, to: 'Sales receipt' },
    { from: /Amount Paid/g, to: 'Amount paid' },
    { from: /Change Given/g, to: 'Change given' },
    { from: /Approvals Needed/g, to: 'Approvals needed' },
    { from: /Shift Revenue/g, to: 'Shift revenue' },
    { from: /Shifts Today/g, to: 'Shifts today' },
    { from: /Cash Receipts/g, to: 'Cash receipts' },
    { from: /Expected Cash in Drawer/g, to: 'Expected cash in drawer' },
    { from: /Payment Method Split/g, to: 'Payment method split' },
    { from: /Top Products/g, to: 'Top products' },
    { from: /No Sales Yet/g, to: 'No sales yet' },
    { from: /Sales Trend/g, to: 'Sales trend' },
    { from: /Daily Actions/g, to: 'Daily actions' },
    { from: /Pick Cash/g, to: 'Pick cash' },
    { from: /Close Shift/g, to: 'Close shift' },
    { from: /Close Day/g, to: 'Close day' },
    { from: /Inventory Status/g, to: 'Inventory status' },
    { from: /Active Products/g, to: 'Active products' },
    { from: /Low Stock Alerts/g, to: 'Low stock alerts' },
    { from: /Live Sales Feed/g, to: 'Live sales feed' },
    { from: /Active Cashier Sessions/g, to: 'Active cashier sessions' },
    { from: /Registered Accounts/g, to: 'Registered accounts' },
    { from: /Create Staff Account/g, to: 'Create staff account' },
    { from: /Full Name/g, to: 'Full name' },
    { from: /Default Password/g, to: 'Default password' },
    { from: /Category Architecture/g, to: 'Category architecture' },
    { from: /Add New Category/g, to: 'Add new category' },
    { from: /Category Name/g, to: 'Category name' },
    { from: /Choose Icon/g, to: 'Choose icon' },
    { from: /Theme Color/g, to: 'Theme color' },
    { from: /Create New Account/g, to: 'Create new account' },
    { from: /Aggregated Metrics/g, to: 'Aggregated metrics' },
    { from: /Finalize Business Day/g, to: 'Finalize business day' },
];

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    replacements.forEach(r => {
        content = content.replace(r.from, r.to);
    });

    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated casing: ${file}`);
    }
});
