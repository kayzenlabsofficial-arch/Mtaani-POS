import { jsPDF } from 'jspdf';

// ─── Layout ───────────────────────────────────────────────────────────────────
const M = 14;          // page margin mm
const W = 210 - M * 2; // content width (A4)

// ─── Color helpers ────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const slate900: RGB = [15, 23, 42];
const slate600: RGB = [71, 85, 105];
const slate400: RGB = [148, 163, 184];
const slate100: RGB = [241, 245, 249];
const white: RGB    = [255, 255, 255];
const brandBlue: RGB = [0, 61, 155];
const brandBlueDark: RGB = [0, 45, 115];
const brandBlueLight: RGB = [219, 234, 254];
const green:  RGB = [22, 163, 74];
const red:    RGB = [220, 38, 38];
const orange: RGB = [234, 88, 12];
const blue:   RGB = [37, 99, 235];
const purple: RGB = [88, 28, 135];

const sf = (d: jsPDF, c: RGB) => d.setFillColor(c[0], c[1], c[2]);
const st = (d: jsPDF, c: RGB) => d.setTextColor(c[0], c[1], c[2]);
const sd = (d: jsPDF, c: RGB) => d.setDrawColor(c[0], c[1], c[2]);

function textValue(value: any, fallback = '-'): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function fitLine(doc: jsPDF, value: any, maxWidth: number): string {
  const text = textValue(value);
  if (doc.getTextWidth(text) <= maxWidth) return text;

  const suffix = '...';
  if (doc.getTextWidth(suffix) > maxWidth) return '';

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = `${text.slice(0, mid).trimEnd()}${suffix}`;
    if (doc.getTextWidth(candidate) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}${suffix}`;
}

function splitToFit(doc: jsPDF, value: any, maxWidth: number, maxLines = 2): string[] {
  const text = textValue(value);
  const raw = doc.splitTextToSize(text, Math.max(1, maxWidth));
  const lines = (Array.isArray(raw) ? raw : [String(raw)]).filter(Boolean);
  if (lines.length <= maxLines) return lines.length ? lines : ['-'];

  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitLine(doc, [kept[maxLines - 1], ...lines.slice(maxLines)].join(' '), maxWidth);
  return kept;
}

function pageBottom(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight() - 18;
}

// ─── Shared drawing primitives ────────────────────────────────────────────────
function banner(doc: jsPDF, title: string, ref: string, date: string, bizName = 'MTAANI POS'): number {
  const top = 10;
  const rightPanelW = 58;
  const rightX = M + W - rightPanelW;
  const rightMax = rightPanelW - 10;
  const leftMax = W - rightPanelW - 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const bizLines = splitToFit(doc, bizName.toUpperCase(), leftMax, 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const locationLines = splitToFit(doc, 'Mtaani Street, Nairobi CBD, Kenya', leftMax, 1);
  const contactLines = splitToFit(doc, 'Email: hello@mtaanipos.co.ke | Tel: +254 700 123 456', leftMax, 1);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  const titleLines = splitToFit(doc, title.toUpperCase(), rightMax, 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const refLines = splitToFit(doc, `DOCUMENT REF: ${ref}`, rightMax, 2);
  const dateLines = splitToFit(doc, `DATE: ${date}`, rightMax, 1);

  const leftNeeded = 13 + bizLines.length * 5.5 + locationLines.length * 4 + contactLines.length * 4;
  const rightNeeded = 11 + titleLines.length * 5 + 2 + refLines.length * 4 + dateLines.length * 4;
  const headerH = Math.max(38, leftNeeded, rightNeeded);

  sf(doc, brandBlue);
  doc.rect(M, top, W, headerH, 'F');
  sf(doc, brandBlueDark);
  doc.rect(M, top, 4, headerH, 'F');
  sf(doc, [37, 99, 235] as RGB);
  doc.rect(rightX, top, rightPanelW, headerH, 'F');

  let leftY = top + 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  st(doc, white);
  bizLines.forEach(line => {
    doc.text(line, M + 5, leftY);
    leftY += 5.5;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  st(doc, brandBlueLight);
  leftY += 1.5;
  locationLines.forEach(line => {
    doc.text(line, M + 5, leftY);
    leftY += 4;
  });
  contactLines.forEach(line => {
    doc.text(line, M + 5, leftY);
    leftY += 4;
  });

  let rightY = top + 11;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  st(doc, white);
  titleLines.forEach(line => {
    doc.text(line, M + W - 5, rightY, { align: 'right' });
    rightY += 5;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  st(doc, brandBlueLight);
  rightY += 2;
  refLines.forEach(line => {
    doc.text(line, M + W - 5, rightY, { align: 'right' });
    rightY += 4;
  });
  dateLines.forEach(line => {
    doc.text(line, M + W - 5, rightY, { align: 'right' });
    rightY += 4;
  });

  return top + headerH + 8; // y after header
}

function hLine(doc: jsPDF, y: number): number {
  sd(doc, slate100);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + W, y);
  return y + 6;
}

function kvRow(doc: jsPDF, label: string, value: string, y: number, valC: RGB = slate900): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  st(doc, slate400);
  doc.text(fitLine(doc, label.toUpperCase() + ':', 32), M, y);
  doc.setFont('helvetica', 'normal');
  st(doc, valC);
  const lines = splitToFit(doc, value || '-', W - 37, 3);
  doc.text(lines, M + 35, y);
  return y + Math.max(6, lines.length * 4.5);
}

/** Manual table with borders */
function table(
  doc: jsPDF,
  headers: string[],
  colW: number[],
  rows: string[][],
  y: number
): number {
  const headerH = 8;
  const minRowH = 8;
  const lineH = 3.8;
  const rawTotal = colW.reduce((sum, width) => sum + width, 0) || W;
  const widths = colW.map(width => width * (W / rawTotal));
  const xs: number[] = [M];
  widths.forEach((width, i) => xs.push(xs[i] + width));
  const rightAligned = (header: string) => /amount|debit|credit|balance|expected|reported|variance|total/i.test(header);

  const drawHeader = () => {
    sf(doc, brandBlue);
    doc.rect(M, y, W, headerH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    st(doc, white);
    headers.forEach((header, i) => {
      const isRight = rightAligned(header);
      const tx = isRight ? xs[i] + widths[i] - 2 : xs[i] + 2;
      doc.text(fitLine(doc, header, widths[i] - 4), tx, y + 5.3, { align: isRight ? 'right' : 'left' });
    });
    y += headerH;
  };

  drawHeader();

  rows.forEach((cells, ri) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const wrapped = headers.map((_, i) => splitToFit(doc, cells[i] ?? '', widths[i] - 4, 3));
    const rowH = Math.max(minRowH, 4 + Math.max(...wrapped.map(lines => lines.length)) * lineH);

    if (y + rowH > pageBottom(doc)) {
      footer(doc);
      doc.addPage();
      y = 18;
      drawHeader();
    }

    if (ri % 2 === 0) {
      sf(doc, [250, 252, 255] as RGB);
      doc.rect(M, y, W, rowH, 'F');
    }

    sd(doc, slate100);
    doc.setLineWidth(0.12);
    widths.forEach((width, i) => {
      doc.rect(xs[i], y, width, rowH);
    });

    st(doc, slate900);
    wrapped.forEach((lines, i) => {
      const isRight = rightAligned(headers[i]);
      const tx = isRight ? xs[i] + widths[i] - 2 : xs[i] + 2;
      doc.text(lines, tx, y + 4.8, { align: isRight ? 'right' : 'left' });
    });
    y += rowH;
  });

  return y + 6;
}

function bigTotal(doc: jsPDF, label: string, value: string, y: number, color: RGB): number {
  if (y + 24 > pageBottom(doc)) {
    footer(doc);
    doc.addPage();
    y = 18;
  }

  sf(doc, color);
  doc.rect(M, y, W, 18, 'F');
  sf(doc, [255, 255, 255] as RGB);
  doc.rect(M, y, 2, 18, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  st(doc, color === brandBlue ? brandBlueLight : slate100);
  doc.text(fitLine(doc, label, W - 12), M + 6, y + 7);
  doc.setFontSize(16);
  st(doc, white);
  doc.text(fitLine(doc, value, W - 12), M + W - 6, y + 13, { align: 'right' });
  return y + 25;
}

function footer(doc: jsPDF) {
  const h = doc.internal.pageSize.getHeight();
  const y = h - 12;
  sd(doc, slate100);
  doc.setLineWidth(0.3);
  doc.line(M, y - 4, M + W, y - 4);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  st(doc, slate600);
  doc.text(
    fitLine(doc, `Made by Mtaani POS - ${new Date().toLocaleString()}`, W),
    M + W / 2, y, { align: 'center' }
  );
}

function safe(n: any): number { return Number(n) || 0; }
function ksh(n: any): string { return `Ksh ${safe(n).toLocaleString()}`; }
function looksLikeOpaqueId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    || /^demo_branch_/i.test(value)
    || value.length > 28;
}

function branchLabel(record: any, fallback = 'Main Branch'): string {
  const named = safeStr(record?.branchName || record?.branch?.name || record?.branchLabel, '');
  if (named) return named;
  const raw = safeStr(record?.branchId, '');
  if (!raw || looksLikeOpaqueId(raw)) return fallback;
  return raw;
}
function safeStr(s: any, fallback = '—'): string {
  if (s === null || s === undefined) return fallback;
  return String(s) || fallback;
}

// ─── Thermal Receipt (80mm) ──────────────────────────────────────────────────
function buildReceipt(r: any, bizName = 'MTAANI POS', location = 'Nairobi, Kenya'): Blob {
  const TW = 80; // 80mm width
  const TM = 4;  // margin
  const CW = TW - TM * 2;
  
  // Dynamic height calculation
  const items = Array.isArray(r.items) ? r.items : [];
  const itemH = items.length * 8;
  const totalH = 45 + itemH + 50; // estimated
  
  const doc = new jsPDF({ unit: 'mm', format: [TW, totalH] });
  let y = 8;
  
  // Header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  st(doc, slate900);
  doc.text(bizName.toUpperCase(), TW / 2, y, { align: 'center' });
  y += 5;
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  st(doc, slate600);
  doc.text(location, TW / 2, y, { align: 'center' });
  y += 4;
  doc.text(`Cashier: ${safeStr(r.cashierName)} | Branch: ${branchLabel(r)}`, TW / 2, y, { align: 'center' });
  y += 8;
  
  // Info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  st(doc, slate900);
  doc.text('SALES RECEIPT', TM, y);
  y += 5;
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  st(doc, slate400);
  const ref = safeStr(r.invoiceNumber || (r.id || '').split('-')[0], 'SALE').toUpperCase();
  doc.text(`REF: ${ref}`, TM, y);
  doc.text(new Date(r.timestamp).toLocaleString('en-KE'), TW - TM, y, { align: 'right' });
  y += 5;
  doc.text(`Status: ${safeStr(r.status, 'PAID')}`, TM, y);
  doc.text(`Method: ${safeStr(r.paymentMethod, 'CASH')}`, TW - TM, y, { align: 'right' });
  y += 5;
  
  sd(doc, slate900);
  doc.setLineWidth(0.3);
  doc.line(TM, y, TW - TM, y);
  y += 6;
  
  // Items table-like view
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  st(doc, slate900);
  doc.text('Item', TM, y);
  doc.text('Qty', TM + 35, y);
  doc.text('Price', TW - TM, y, { align: 'right' });
  y += 4;
  
  doc.setLineWidth(0.1);
  doc.line(TM, y, TW - TM, y);
  y += 5;
  
  doc.setFont('helvetica', 'normal');
  items.forEach(item => {
    const qty = safe(item.quantity);
    const price = safe(item.snapshotPrice);
    const total = qty * price;
    
    // Name (wrapped if too long)
    const name = safeStr(item.name);
    const lines = doc.splitTextToSize(name, 32);
    doc.text(lines, TM, y);
    
    doc.text(String(qty), TM + 35, y);
    doc.text(ksh(total), TW - TM, y, { align: 'right' });
    
    y += lines.length * 4 + 1;
  });
  
  y += 2;
  doc.line(TM, y, TW - TM, y);
  y += 6;
  
  // Totals
  const row = (label: string, val: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 8);
    st(doc, slate900);
    doc.text(label, TM, y);
    doc.text(val, TW - TM, y, { align: 'right' });
    y += 5;
  };
  
  row('Subtotal', ksh(r.subtotal));
  if (safe(r.discountAmount) > 0) row('Discount', `-${ksh(r.discountAmount)}`);
  row('VAT (16%)', ksh(r.tax));
  y += 2;
  row('TOTAL', ksh(r.total), true);
  
  y += 4;
  // Payment Details (Tendered & Change)
  const tethered = safe(r.amountTendered);
  if (r.paymentMethod === 'SPLIT' && r.splitPayments) {
    row('Paid (Cash)', ksh(r.splitPayments.cashAmount || 0));
    row(`Paid (${safeStr(r.splitPayments.secondaryMethod, 'Secondary')})`, ksh(r.splitPayments.secondaryAmount || 0));
    if (r.splitPayments.secondaryReference) {
      row('Reference', safeStr(r.splitPayments.secondaryReference));
    }
  } else if (tethered > 0) {
    row(`Paid (${r.paymentMethod || 'CASH'})`, ksh(tethered));
    const change = safe(r.changeGiven || (tethered - safe(r.total)));
    if (change > 0) {
      st(doc, green);
      row('Change', ksh(change), true);
    }
  } else if (r.paymentMethod) {
    st(doc, slate600);
    row('Paid via', r.paymentMethod);
  }

  // M-Pesa Specifics
  if (r.mpesaCode) {
    st(doc, slate600);
    row('M-Pesa Code', r.mpesaCode);
  }
  if (r.mpesaCustomer) {
    st(doc, slate600);
    row('M-Pesa Cust', r.mpesaCustomer);
  }
  y += 2;
  sd(doc, slate100);
  doc.setLineWidth(0.15);
  doc.line(TM, y, TW - TM, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  st(doc, slate600);
  doc.text('Return policy: returns accepted with valid receipt only.', TW / 2, y, { align: 'center' });
  
  y += 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  st(doc, slate400);
  doc.text('Thank you for shopping with us!', TW / 2, y, { align: 'center' });
  y += 4;
  doc.text('Keep this receipt for returns', TW / 2, y, { align: 'center' });
  
  return doc.output('blob');
}

// ─── Expense ──────────────────────────────────────────────────────────────────
function buildExpense(r: any, bizName?: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ref = safeStr((r.id || '').split('-')[0], 'EXP').toUpperCase();
  let y = banner(doc, 'Expense Document', ref, new Date(r.timestamp).toLocaleString('en-KE'), bizName);
  y = hLine(doc, y);
  y = kvRow(doc, 'Category', safeStr(r.category, 'General'), y);
  y = kvRow(doc, 'Description', safeStr(r.description, 'No description provided.'), y);
  y = kvRow(doc, 'Recorded By', safeStr(r.cashierName), y);
  y = kvRow(doc, 'Status', safeStr(r.status, 'APPROVED'), y);
  y += 6;
  y = bigTotal(doc, 'AMOUNT SPENT', ksh(r.amount), y, orange);
  footer(doc);
  return doc.output('blob');
}

// ─── Purchase Order ───────────────────────────────────────────────────────────
function buildPO(r: any, supplier?: any, bizName?: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const fallbackRef = (r.poNumber || r.id || '').startsWith('PO-') ? (r.poNumber || r.id) : (r.id || '').split('-')[0];
  const ref = safeStr(r.invoiceNumber || fallbackRef, 'LPO').toUpperCase();
  const dateStr = new Date(r.orderDate || r.timestamp || Date.now()).toLocaleDateString('en-KE', { 
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' 
  });
  
  let y = banner(doc, 'Purchase Order', ref, dateStr, bizName);
  y = hLine(doc, y);
  
  // Supplier Info Section
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); st(doc, slate900);
  doc.text('SUPPLIER DETAILS', M, y);
  y += 6;
  y = kvRow(doc, 'Company', safeStr(supplier?.company || r.supplierName), y);
  y = kvRow(doc, 'Address', safeStr(supplier?.address), y);
  y = kvRow(doc, 'KRA PIN', safeStr(supplier?.kraPin), y);
  y = kvRow(doc, 'Contact', `${safeStr(supplier?.name)} (${safeStr(supplier?.phone)})`, y);
  y += 4;
  
  y = hLine(doc, y);
  y += 2;


  const items: any[] = Array.isArray(r.items) ? r.items : [];
  const isReceived = r.status === 'RECEIVED';
  
  const nameW = W - 10 - 24 - 30 - 30;
  const rows = items.map((item, i) => {
    const qty = isReceived ? safe(item.receivedQuantity) : safe(item.expectedQuantity);
    const cost = safe(item.unitCost);
    return [
      `${i + 1}`,
      safeStr(item.name),
      `${qty}`,
      ksh(cost),
      ksh(qty * cost),
    ];
  });

  y = table(
    doc, 
    ['#', 'Item Description', isReceived ? 'Recd' : 'Qty', 'Unit Cost', 'Subtotal'], 
    [10, nameW, 24, 30, 30], 
    rows, 
    y
  );

  y += 2;
  y = bigTotal(doc, 'GRAND TOTAL', ksh(r.totalAmount), y, slate900);
  
  // Terms & Signature
  y += 10;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); st(doc, slate900);
  doc.text('Instructions & Terms:', M, y);
  y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); st(doc, slate600);
  doc.text('1. Please supply the above items as per the agreed unit prices and delivery schedule.', M, y);
  y += 5;
  doc.text('2. All invoices must clearly state the Purchase Order Reference number above.', M, y);
  y += 5;
  doc.text('3. This document was made by the system. No signature is needed.', M, y);
  
  footer(doc);
  return doc.output('blob');
}

// ─── Supplier Payment ─────────────────────────────────────────────────────────
function buildRemittance(r: any, supplierName?: string, bizName?: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ref = (r.id || '').split('-')[0].toUpperCase();
  let y = banner(doc, 'Supplier Payment Note', ref, new Date(r.timestamp).toLocaleString('en-KE'), bizName);
  y = hLine(doc, y);
  y = kvRow(doc, 'Supplier', safeStr(supplierName), y);
  y = kvRow(doc, 'Payment Method', safeStr(r.paymentMethod, 'CASH'), y);
  
  // Only show reference if it's NOT the auto-generated breakdown string
  const isBreakdownRef = r.reference?.toLowerCase().includes('pay inv') || r.reference?.toLowerCase().includes('less credit');
  if (r.reference && !isBreakdownRef) {
    y = kvRow(doc, 'Transaction Reference', safeStr(r.reference), y);
  }

  y = kvRow(doc, 'Recorded By', safeStr(r.preparedBy || r.cashierName), y);
  y += 6;

  const rows = [
    ...(r.invoiceDetails || []).map((i: any) => [new Date(i.date).toLocaleDateString(), 'INVOICE', String(i.ref).toUpperCase(), ksh(i.amount)]),
    ...(r.creditNoteDetails || []).map((c: any) => [new Date(c.date).toLocaleDateString(), 'CREDIT NOTE', String(c.ref).toUpperCase(), `-${ksh(c.amount)}`]),
  ];

  if (rows.length > 0) {
    y = table(doc, ['Date', 'Type', 'Reference', 'Amount'], [35, 35, 60, 52], rows, y);
    y += 2;
  }

  y = bigTotal(doc, 'TOTAL CASH REMITTED', ksh(r.amount), y, purple);

  footer(doc);
  return doc.output('blob');
}

// ─── Thermal Report (80mm) ───────────────────────────────────────────────────
function buildReport(r: any, bizName = 'MTAANI POS'): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const isDaily = r.recordType === 'DAILY_SUMMARY';
  const ref = safeStr((r.id || '').split('-')[0], 'RPT').toUpperCase();
  let y = banner(
    doc,
    isDaily ? 'Daily Business Summary' : 'End of Shift Report',
    ref,
    new Date(r.timestamp).toLocaleString('en-KE'),
    bizName
  );
  y = hLine(doc, y);
  const summaryTop = y;
  sf(doc, [248, 250, 252] as RGB);
  doc.roundedRect(M, summaryTop - 4, W, 25, 3, 3, 'F');
  y = kvRow(doc, 'Report Type', isDaily ? 'Daily Summary' : 'End of Shift', y);
  y = kvRow(doc, 'Branch', branchLabel(r), y);
  y = kvRow(doc, 'Prepared By', safeStr(r.cashierName, 'System'), y);
  y += 6;

  const grossSales = safe(r.grossSales ?? r.totalSales);
  const cashSales = safe(r.cashSales ?? (grossSales - safe(r.mpesaSales)));
  const mpesaSales = safe(r.mpesaSales);
  const expenses = safe(r.totalExpenses);
  const banked = safe(r.totalPicks);
  const taxTotal = safe(r.taxTotal);
  const expected = safe(r.expectedCash);
  const reported = safe(r.reportedCash || expected);
  const diff = safe(r.difference ?? r.totalVariance);

  y = table(
    doc,
    ['Money Item', 'Amount', 'Type', 'Note'],
    [70, 36, 24, 52],
    [
      ['Gross Sales', ksh(grossSales), 'IN', 'Sales before deductions'],
      ['Cash Sales', ksh(cashSales), 'IN', 'Cash receipts'],
      ['M-Pesa Sales', ksh(mpesaSales), 'IN', 'Mobile money receipts'],
      ['Expenses', ksh(expenses), 'OUT', 'Business cost'],
      ['Banked / Cash Picks', ksh(banked), 'OUT', 'Transferred from till'],
      ['VAT (16%)', ksh(taxTotal), 'TAX', 'Tax component']
    ],
    y
  );

  y = bigTotal(doc, 'NET SALES', ksh(safe(r.totalSales ?? grossSales)), y, brandBlue);

  const paymentBase = Math.max(grossSales, 1);
  const cashPct = Math.max(0, Math.min(100, (cashSales / paymentBase) * 100));
  const mpesaPct = Math.max(0, Math.min(100, (mpesaSales / paymentBase) * 100));
  const chartX = M;
  const chartW = W;
  const barW = chartW - 48;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  st(doc, slate900);
  doc.text('PAYMENT MIX', chartX, y);
  y += 6;

  sf(doc, slate100);
  doc.rect(chartX + 32, y - 3.5, barW, 4, 'F');
  sf(doc, green);
  doc.rect(chartX + 32, y - 3.5, (barW * cashPct) / 100, 4, 'F');
  st(doc, slate600);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Cash', chartX, y);
  doc.text(`${cashPct.toFixed(1)}%`, chartX + chartW, y, { align: 'right' });
  y += 8;

  sf(doc, slate100);
  doc.rect(chartX + 32, y - 3.5, barW, 4, 'F');
  sf(doc, blue);
  doc.rect(chartX + 32, y - 3.5, (barW * mpesaPct) / 100, 4, 'F');
  st(doc, slate600);
  doc.text('M-Pesa', chartX, y);
  doc.text(`${mpesaPct.toFixed(1)}%`, chartX + chartW, y, { align: 'right' });
  y += 10;

  y = table(
    doc,
    ['Cash Check', 'Expected', 'Counted', 'Difference'],
    [70, 40, 40, 40],
    [[
      isDaily ? 'Business Day Close' : 'Shift Till Close',
      ksh(expected),
      ksh(reported),
      ksh(diff)
    ]],
    y
  );

  const ok = Math.abs(diff) < 0.01;
  y = bigTotal(doc, ok ? 'STATUS: BALANCED' : 'STATUS: VARIANCE FOUND', ksh(Math.abs(diff)), y, ok ? green : red);
  footer(doc);
  return doc.output('blob');
}

// ─── Supplier Statement (A4) ──────────────────────────────────────────────────
export function buildStatementPDF(s: any, invoices: any[], payments: any[], creditNotes: any[], bizName?: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const dateStr = new Date().toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
  let y = banner(doc, 'Supplier Statement', (s.company || '').slice(0, 3).toUpperCase(), dateStr, bizName);
  y = hLine(doc, y);

  // Supplier Summary
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); st(doc, slate900);
  const companyLines = splitToFit(doc, safeStr(s.company).toUpperCase(), W, 2);
  doc.text(companyLines, M, y);
  y += companyLines.length * 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); st(doc, slate600);
  const contactLines = splitToFit(doc, `Contact: ${safeStr(s.name)} | Tel: ${safeStr(s.phone)}`, W, 2);
  doc.text(contactLines, M, y);
  y += contactLines.length * 4;
  const emailLines = splitToFit(doc, `Email: ${safeStr(s.email, 'N/A')}`, W, 2);
  doc.text(emailLines, M, y);
  y += emailLines.length * 4 + 6;

  // Big Balance Box
  const safe = (n: any) => Number(n) || 0;
  const ksh = (n: any) => `Ksh ${safe(n).toLocaleString()}`;
  
  sf(doc, s.balance > 0 ? red : green);
  doc.rect(M, y, W, 20, 'F');
  st(doc, white);
  doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('OUTSTANDING LEDGER BALANCE', M + 6, y + 8);
  doc.setFontSize(18);
  doc.text(fitLine(doc, ksh(s.balance), W - 12), M + W - 6, y + 14, { align: 'right' });
  y += 30;

  // Transaction Table
  const allTx = [
    ...(invoices || []).map(i => ({ date: i.orderDate, type: 'INVOICE', ref: i.invoiceNumber || i.id.split('-')[0], amt: i.totalAmount, bal: 'DR' })),
    ...(payments || []).map(p => ({ date: p.timestamp, type: 'PAYMENT', ref: p.reference || 'PAY', amt: p.amount, bal: 'CR' })),
    ...(creditNotes || []).map(c => ({ 
      date: c.timestamp, 
      type: 'CREDIT', 
      ref: c.reference || 'CRN', 
      amt: c.amount, 
      bal: 'CR',
      status: c.status 
    })).filter(c => c.status === 'ALLOCATED')
  ].sort((a, b) => a.date - b.date);

  let running = 0;
  const rows = allTx.map(tx => {
    if (tx.bal === 'DR') running += tx.amt;
    else running -= tx.amt;
    
    return [
      new Date(tx.date).toLocaleDateString('en-KE'),
      tx.type,
      String(tx.ref).toUpperCase(),
      tx.bal === 'DR' ? ksh(tx.amt) : '',
      tx.bal === 'CR' ? ksh(tx.amt) : '',
      ksh(running)
    ];
  });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); st(doc, slate900);
  doc.text('TRANSACTION HISTORY', M, y - 4);
  
  y = table(
    doc,
    ['Date', 'Type', 'Reference', 'Debit (+)', 'Credit (-)', 'Balance'],
    [25, 25, 32, 35, 35, 30],
    rows,
    y
  );

  footer(doc);
  return doc.output('blob');
}


// ─── Download trigger (works everywhere, no share sheet needed) ───────────────
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// ─── Build blob by record type ────────────────────────────────────────────────
function buildPDF(record: any, supplier?: any, bizName?: string, location?: string): Blob {
  switch (record?.recordType) {
    case 'SALE':             return buildReceipt(record, bizName, location);
    case 'EXPENSE':          return buildReceipt(record, bizName, location); // fallback or buildExpense with location
    case 'PURCHASE_ORDER':   return buildPO(record, supplier, bizName);
    case 'SUPPLIER_PAYMENT': return buildRemittance(record, supplier?.company || supplier, bizName);
    case 'CLOSE_DAY_REPORT':
    case 'DAILY_SUMMARY':    return buildReport(record, bizName);
    default:                 return buildReceipt(record, bizName, location); // treat unknown as receipt
  }
}

// ─── Main export: generate + share/download ───────────────────────────────────
export async function generateAndShareDocument(
  record: any,
  filename: string,
  supplier?: any,
  forceDownload = false,
  bizName?: string,
  location?: string
): Promise<void> {
  const blob = buildPDF(record, supplier, bizName, location);
  const file = new File([blob], `${filename}.pdf`, { type: 'application/pdf' });

  // Try native share API (Android PWA, iOS Safari)
  if (
    !forceDownload &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: `Mtaani POS — ${filename}`,
        text: `Document: ${filename}`,
      });
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // user cancelled
      // Any other error → fall through to download
    }
  }

  // Fallback (desktop, unsupported browsers): trigger file download
  download(blob, filename);
}

// ─── Legacy: used by Reports tab to capture chart view ───────────────────────
export async function shareDocument(elementId: string, filename: string) {
  const { default: html2canvas } = await import('html2canvas');
  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Element #${elementId} not found`);

  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, (canvas.height * pw) / canvas.width, '', 'FAST');
  download(pdf.output('blob'), filename);
}

export async function generateAndDownloadStatement(s: any, invoices: any[], payments: any[], creditNotes: any[]) {
    const blob = buildStatementPDF(s, invoices, payments, creditNotes);
    download(blob, `Statement-${s.company}`);
}

export async function generateAndDownloadCustomerStatement(customer: any, sales: any[], payments: any[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = banner(doc, 'Customer Statement', `CUS-${safeStr(customer?.id, '').slice(0, 8).toUpperCase()}`, new Date().toLocaleDateString());

  y = kvRow(doc, 'Customer', safeStr(customer?.name), y);
  y = kvRow(doc, 'Phone', safeStr(customer?.phone), y);
  y = kvRow(doc, 'Email', safeStr(customer?.email), y);
  y = kvRow(doc, 'Current Balance', ksh(customer?.balance), y, safe(customer?.balance) > 0 ? red : green);
  y = hLine(doc, y + 2);

  const creditAmount = (sale: any) => {
    if (sale.paymentMethod === 'CREDIT') return safe(sale.total);
    if (sale.paymentMethod === 'SPLIT' && sale.splitPayments?.secondaryMethod === 'CREDIT') return safe(sale.splitPayments.secondaryAmount);
    return 0;
  };
  const rows = [
    ...(sales || []).map(sale => [
      new Date(sale.timestamp).toLocaleDateString(),
      'SALE',
      safeStr(sale.id, '').split('-')[0].toUpperCase(),
      (sale.items || []).map((item: any) => `${item.name} x ${item.quantity}`).join(', ').slice(0, 44),
      ksh(creditAmount(sale)),
      '',
    ]),
    ...(payments || []).map(payment => [
      new Date(payment.timestamp).toLocaleDateString(),
      'PAYMENT',
      safeStr(payment.transactionCode || payment.id, '').split('-')[0].toUpperCase(),
      safeStr(payment.reference || payment.paymentMethod).slice(0, 44),
      '',
      ksh(payment.amount),
    ]),
  ].sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime());

  if (rows.length) {
    y = table(doc, ['Date', 'Type', 'Ref', 'Details', 'Debit', 'Credit'], [24, 22, 24, 60, 25, 25], rows, y);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    st(doc, slate400);
    doc.text('No credit sales or payments recorded for this customer.', M, y + 10);
    y += 20;
  }

  const totalSales = (sales || []).reduce((sum, sale) => sum + creditAmount(sale), 0);
  const totalPayments = (payments || []).reduce((sum, payment) => sum + safe(payment.amount), 0);
  y = hLine(doc, y + 6);
  y = kvRow(doc, 'Credit Sales', ksh(totalSales), y);
  y = kvRow(doc, 'Payments', ksh(totalPayments), y, green);
  y = kvRow(doc, 'Outstanding', ksh(customer?.balance), y, safe(customer?.balance) > 0 ? red : green);
  footer(doc);
  download(doc.output('blob'), `Customer-Statement-${safeStr(customer?.name, 'Customer').replace(/\s+/g, '-')}`);
}

export async function generateAndDownloadProfitLossReport(report: {
  title: string;
  periodLabel: string;
  totalRevenue: number;
  grossSales: number;
  discounts: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
  tax: number;
  deductTaxInPL?: boolean;
  creditSales: number;
  orderCount: number;
  expenseBreakdown: { name: string; value: number }[];
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = banner(doc, 'Profit and Loss', report.title, new Date().toLocaleDateString());
  y = kvRow(doc, 'Period', report.periodLabel, y);
  y = kvRow(doc, 'Orders', String(report.orderCount), y);
  y = hLine(doc, y + 2);

  y = table(doc, ['Line Item', 'Amount'], [130, 50], [
    ['Gross Sales', ksh(report.grossSales)],
    ['Discounts', `-${ksh(report.discounts)}`],
    ['Net Revenue', ksh(report.totalRevenue)],
    ['VAT Treatment', report.deductTaxInPL ? 'Deducted from P&L' : 'Shown only, not deducted'],
    [report.deductTaxInPL ? 'Tax Deducted' : 'Tax Informational', report.deductTaxInPL ? `-${ksh(report.tax)}` : ksh(report.tax)],
    ['Cost of Goods Sold', `-${ksh(report.cogs)}`],
    ['Gross Profit', ksh(report.grossProfit)],
    ['Operating Expenses', `-${ksh(report.expenses)}`],
    ['Net Profit / Loss', ksh(report.netProfit)],
    ['Credit Sales Included', ksh(report.creditSales)],
  ], y);

  if (report.expenseBreakdown.length) {
    y = hLine(doc, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    st(doc, slate900);
    doc.text('Expense Breakdown', M, y);
    y += 6;
    y = table(doc, ['Category', 'Amount'], [130, 50], report.expenseBreakdown.map(row => [row.name, ksh(row.value)]), y);
  }

  y = hLine(doc, y + 6);
  bigTotal(doc, report.netProfit >= 0 ? 'Net Profit' : 'Net Loss', ksh(report.netProfit), y, report.netProfit >= 0 ? brandBlue : red);
  footer(doc);
  download(doc.output('blob'), `Profit-Loss-${report.title.replace(/\s+/g, '-')}`);
}

