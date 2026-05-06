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

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // Remove uppercase and tracking classes
    const newContent = content
        .replace(/\buppercase\b/g, '')
        .replace(/\btracking-widest\b/g, '')
        .replace(/\btracking-wider\b/g, '')
        .replace(/\bfont-black\b(?=.*?text-\[10px\])/g, 'font-bold') // Fix muddy small text
        .replace(/PAID VIA/g, 'Paid via')
        .replace(/TAX-FREE/g, 'Tax-free')
        .replace(/ALL GOOD/g, 'All good')
        .replace(/UNKNOWN/g, 'Unknown');

    if (content !== newContent) {
        fs.writeFileSync(file, newContent, 'utf8');
        console.log(`Updated: ${file}`);
    }
});
