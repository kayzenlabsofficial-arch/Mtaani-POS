const fs = require('fs');
const path = require('path');

const renames = {
  'functions/api/authUtils.ts': 'functions/api/_authUtils.ts',
  'functions/api/runtime-config.ts': 'functions/api/_runtime-config.ts',
  'functions/api/salesSecurity.ts': 'functions/api/_salesSecurity.ts',
  'functions/api/expenses/expenseOps.ts': 'functions/api/expenses/_expenseOps.ts',
  'functions/api/sales/refundOps.ts': 'functions/api/sales/_refundOps.ts',
  'functions/api/mpesa/mpesaService.ts': 'functions/api/mpesa/_mpesaService.ts',
  'functions/api/mpesa/secureCredentials.ts': 'functions/api/mpesa/_secureCredentials.ts',
};

// Perform renames
for (const [oldPath, newPath] of Object.entries(renames)) {
  if (fs.existsSync(oldPath)) {
    fs.renameSync(oldPath, newPath);
    console.log(`Renamed ${oldPath} to ${newPath}`);
  }
}

// Find all .ts files
function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (filePath.endsWith('.ts')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const allTsFiles = getAllFiles('functions');

const importReplacements = [
  { from: /['"](\.\.\/|\.\/)authUtils['"]/g, to: "'$1_authUtils'" },
  { from: /['"](\.\.\/|\.\/)runtime-config['"]/g, to: "'$1_runtime-config'" },
  { from: /['"](\.\.\/|\.\/)salesSecurity['"]/g, to: "'$1_salesSecurity'" },
  { from: /['"](\.\.\/|\.\/)expenseOps['"]/g, to: "'$1_expenseOps'" },
  { from: /['"](\.\.\/|\.\/)refundOps['"]/g, to: "'$1_refundOps'" },
  { from: /['"](\.\.\/|\.\/)mpesaService['"]/g, to: "'$1_mpesaService'" },
  { from: /['"](\.\.\/|\.\/)secureCredentials['"]/g, to: "'$1_secureCredentials'" },
];

for (const file of allTsFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;

  for (const rep of importReplacements) {
    if (rep.from.test(content)) {
      content = content.replace(rep.from, rep.to);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated imports in ${file}`);
  }
}
