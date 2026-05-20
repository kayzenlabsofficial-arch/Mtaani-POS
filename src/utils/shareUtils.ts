import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Layout ───────────────────────────────────────────────────────────────────
const M = 14;          // page margin mm
const W = 210 - M * 2; // content width (A4)

function contentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - M * 2;
}

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
function banner(doc: jsPDF, title: string, ref: string, date: string, bizName = 'MTAANI POS', location = 'Mtaani Street, Nairobi CBD, Kenya'): number {
  const top = 10;
  const contentW = contentWidth(doc);
  const rightPanelW = 58;
  const rightX = M + contentW - rightPanelW;
  const rightMax = rightPanelW - 10;
  const leftMax = contentW - rightPanelW - 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const bizLines = splitToFit(doc, bizName.toUpperCase(), leftMax, 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const locationLines = splitToFit(doc, location, leftMax, 1);
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
  doc.rect(M, top, contentW, headerH, 'F');
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
    doc.text(line, M + contentW - 5, rightY, { align: 'right' });
    rightY += 5;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  st(doc, brandBlueLight);
  rightY += 2;
  refLines.forEach(line => {
    doc.text(line, M + contentW - 5, rightY, { align: 'right' });
    rightY += 4;
  });
  dateLines.forEach(line => {
    doc.text(line, M + contentW - 5, rightY, { align: 'right' });
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
  const contentW = contentWidth(doc);
  const y = h - 12;
  sd(doc, slate100);
  doc.setLineWidth(0.3);
  doc.line(M, y - 4, M + contentW, y - 4);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  st(doc, slate600);
  doc.text(
    fitLine(doc, `Made by Mtaani POS - ${new Date().toLocaleString()}`, contentW),
    M + contentW / 2, y, { align: 'center' }
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
  const itemH = items.reduce((height: number, item: any) => {
    const nameLines = Math.max(1, Math.ceil(safeStr(item?.name).length / 32));
    return height + (nameLines * 4) + 4 + (safe(item?.discountAmount) > 0 ? 4 : 0);
  }, 0);
  const totalH = 65 + itemH + 55; // estimated
  const createdAt = new Date(r.timestamp || r.issueDate || Date.now());
  const ref = safeStr(r.receiptNumber || r.invoiceNumber || (r.id || '').split('-')[0], 'SALE').toUpperCase();
  const address = safeStr(r.businessAddress || location, location);
  const cashier = safeStr(r.cashierName || r.preparedBy || r.userName, 'Staff');
  const paymentMethod = safeStr(r.paymentMethod, 'CASH').toUpperCase();
  const paymentLabel = paymentMethod === 'MPESA' ? 'M-Pesa' : paymentMethod === 'PDQ' ? 'Card' : paymentMethod === 'SPLIT' ? 'Split' : paymentMethod === 'CREDIT' ? 'Credit' : 'Cash';
  const shiftNumber = r.shiftId ? safeStr(r.shiftId).replace(/^shift_/, '').slice(-16).toUpperCase() : 'N/A';
  const tillNumber = safeStr(r.tillNumber, 'N/A');
  const receiptFooter = safeStr(r.receiptFooter, 'Thank you for shopping with us!');
  
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
  doc.text(address, TW / 2, y, { align: 'center' });
  y += 4;
  doc.text(`Branch: ${branchLabel(r)}`, TW / 2, y, { align: 'center' });
  y += 6;
  
  // Info
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  st(doc, slate900);
  doc.text('SALES RECEIPT', TM, y);
  y += 5;
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  st(doc, slate400);
  doc.text(`Receipt: ${ref}`, TM, y);
  doc.text(createdAt.toLocaleDateString('en-KE'), TW - TM, y, { align: 'right' });
  y += 5;
  doc.text(`Time: ${createdAt.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}`, TM, y);
  doc.text(`Payment: ${paymentLabel}`, TW - TM, y, { align: 'right' });
  y += 5;
  doc.text(`Cashier: ${cashier}`, TM, y);
  doc.text(`Till: ${tillNumber}`, TW - TM, y, { align: 'right' });
  y += 5;
  doc.text(`Shift: ${shiftNumber}`, TM, y);
  doc.text(`Status: ${safeStr(r.status, 'PAID')}`, TW - TM, y, { align: 'right' });
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
    const lineDiscount = safe(item.discountAmount) * qty;
    
    // Name (wrapped if too long)
    const name = safeStr(item.name);
    const lines = doc.splitTextToSize(name, 32);
    doc.text(lines, TM, y);
    
    doc.text(String(qty), TM + 35, y);
    doc.text(ksh(total), TW - TM, y, { align: 'right' });
    
    y += lines.length * 4 + 1;
    if (lineDiscount > 0) {
      doc.setFontSize(6.5);
      st(doc, red);
      doc.text(`Discount: -${ksh(lineDiscount)}`, TM, y);
      doc.setFontSize(7);
      st(doc, slate900);
      y += 4;
    }
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
  if (safe(r.discountAmount) > 0) row('Total discount', `-${ksh(r.discountAmount)}`);
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
  const mpesaReceiptCode = r.mpesaCode || r.mpesaReference || r.paymentReference;
  if (mpesaReceiptCode) {
    st(doc, slate600);
    row('M-Pesa Code', mpesaReceiptCode);
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
  const footerLines = doc.splitTextToSize(receiptFooter, CW);
  doc.text(footerLines, TW / 2, y, { align: 'center' });
  y += footerLines.length * 4;
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

  const rows: string[][] = [
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
function buildCreditNotePDF(r: any, supplier?: any, bizName?: string, location?: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ref = safeStr(r.reference || (r.id || '').split('-')[0], 'CRN').toUpperCase();
  let y = banner(doc, 'Supplier Credit Note', ref, new Date(r.timestamp || Date.now()).toLocaleString('en-KE'), bizName, location);
  y = hLine(doc, y);

  y = kvRow(doc, 'Supplier', safeStr(supplier?.company || supplier || r.supplierName), y);
  y = kvRow(doc, 'Contact', `${safeStr(supplier?.name, 'N/A')} | ${safeStr(supplier?.phone, 'N/A')}`, y);
  y = kvRow(doc, 'Status', safeStr(r.status || 'PENDING'), y, r.status === 'ALLOCATED' ? green : blue);
  y = kvRow(doc, 'Reason', safeStr(r.reason || 'Supplier return credit'), y);
  y += 4;

  const items = parseList(r.items);
  const rows = items.length > 0
    ? items.map((item: any) => [
        safeStr(item.name || item.productId || 'Returned item'),
        `${safe(item.quantity)} ${safeStr(item.unit || 'pcs', 'pcs')}`,
        ksh(item.unitCost),
        ksh(item.amount),
      ])
    : [[
        safeStr(r.productName || r.productId || 'Returned stock'),
        `${safe(r.quantity)} pcs`,
        '',
        ksh(r.amount),
      ]];

  y = table(doc, ['Returned Product', 'Qty', 'Unit Cost', 'Credit Amount'], [78, 28, 35, 41], rows, y);
  y = bigTotal(doc, 'Credit Note Total', ksh(r.amount), y, blue);

  footer(doc);
  return doc.output('blob');
}

function buildRefundPDF(r: any, bizName?: string, location?: string): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ref = safeStr(r.receiptNumber || r.originalTransactionId || r.id, 'REF').toUpperCase();
  let y = banner(doc, 'Refund Document', ref, new Date(r.timestamp || Date.now()).toLocaleString('en-KE'), bizName, location);
  y = hLine(doc, y);

  y = kvRow(doc, 'Original Receipt', safeStr(r.receiptNumber || r.originalTransactionId), y);
  y = kvRow(doc, 'Refund ID', safeStr(r.id), y);
  y = kvRow(doc, 'Payment Source', safeStr(r.source || r.paymentMethod || 'TILL'), y);
  y = kvRow(doc, 'Processed By', safeStr(r.cashierName || r.approvedBy || 'Staff'), y);
  y = kvRow(doc, 'Approved By', safeStr(r.approvedBy || 'Admin'), y);
  if (r.shiftId) y = kvRow(doc, 'Shift ID', safeStr(r.shiftId), y);
  y += 4;

  const items = parseList(r.items);
  const rows = items.length > 0
    ? items.map((item: any) => [
        safeStr(item.name || item.productId || 'Refunded item'),
        String(safe(item.quantity)),
        ksh(item.amount),
      ])
    : [['Refunded sale items', '-', ksh(r.amount)]];

  y = table(doc, ['Refunded Item', 'Qty', 'Amount'], [104, 28, 50], rows, y);
  y = kvRow(doc, 'Cash Deducted From Drawer', ksh(r.cashAmount), y, red);
  y = bigTotal(doc, 'Refund Total', ksh(r.amount), y + 2, red);

  footer(doc);
  return doc.output('blob');
}

type CloseReportRow = {
  label: string;
  value?: number | string | null;
  kind?: 'section' | 'normal' | 'total' | 'highlight' | 'note';
  format?: 'money' | 'deduct' | 'plain';
};

function parseList(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function drawCloseReportInfoGrid(doc: jsPDF, y: number, cells: Array<[string, string]>): number {
  const cellW = W / cells.length;
  const headerH = 7;
  const valueH = 8;

  cells.forEach(([label, value], i) => {
    const x = M + i * cellW;
    sf(doc, [248, 250, 252] as RGB);
    doc.rect(x, y, cellW, headerH, 'F');
    sd(doc, slate100);
    doc.rect(x, y, cellW, headerH + valueH);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    st(doc, slate900);
    doc.text(fitLine(doc, label, cellW - 4), x + cellW / 2, y + 4.8, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    st(doc, slate600);
    doc.text(fitLine(doc, value, cellW - 4), x + cellW / 2, y + headerH + 5.2, { align: 'center' });
  });

  return y + headerH + valueH + 9;
}

function drawCloseReportStatement(doc: jsPDF, y: number, title: string, rows: CloseReportRow[]): number {
  const sectionBlue: RGB = [78, 132, 186];
  const totalBlue: RGB = [222, 234, 246];
  const highlightBlue: RGB = [157, 188, 224];
  const lineBlue: RGB = [203, 213, 225];
  const labelW = 124;
  const valueW = W - labelW;

  const formatValue = (value: CloseReportRow['value'], format: CloseReportRow['format']) => {
    if (format === 'plain') return textValue(value, '0');
    const numeric = safe(value);
    if (format === 'deduct') return numeric > 0 ? `-${kshAccounting(numeric)}` : kshAccounting(numeric);
    return kshAccounting(numeric);
  };

  const drawTitle = () => {
    sf(doc, sectionBlue);
    doc.rect(M, y, W, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    st(doc, white);
    doc.text(title, M + 2, y + 6.3);
    y += 9;
  };

  const drawHeader = () => {
    sf(doc, sectionBlue);
    doc.rect(M, y, W, 8, 'F');
    sd(doc, lineBlue);
    doc.rect(M, y, labelW, 8);
    doc.rect(M + labelW, y, valueW, 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    st(doc, white);
    doc.text('Line Item', M + 2, y + 5.4);
    doc.text('Amount', M + W - 2, y + 5.4, { align: 'right' });
    y += 8;
  };

  const ensureRoom = (height: number) => {
    if (y + height <= pageBottom(doc)) return;
    footer(doc);
    doc.addPage();
    y = 18;
    drawHeader();
  };

  drawTitle();
  drawHeader();

  rows.forEach((row, index) => {
    const rowH = row.kind === 'section' ? 7 : row.kind === 'highlight' ? 8 : 7;
    ensureRoom(rowH);

    if (row.kind === 'section') {
      sf(doc, sectionBlue);
    } else if (row.kind === 'highlight') {
      sf(doc, highlightBlue);
    } else if (row.kind === 'total') {
      sf(doc, totalBlue);
    } else if (index % 2 === 0) {
      sf(doc, [250, 252, 255] as RGB);
    } else {
      sf(doc, white);
    }
    doc.rect(M, y, W, rowH, 'F');

    sd(doc, lineBlue);
    doc.setLineWidth(row.kind === 'total' || row.kind === 'highlight' ? 0.22 : 0.12);
    doc.rect(M, y, labelW, rowH);
    doc.rect(M + labelW, y, valueW, rowH);

    doc.setFont('helvetica', row.kind === 'normal' || !row.kind || row.kind === 'note' ? 'normal' : 'bold');
    doc.setFontSize(row.kind === 'section' ? 8 : 7.6);
    st(doc, row.kind === 'section' ? white : slate900);
    doc.text(fitLine(doc, row.label, labelW - 4), M + 2, y + rowH - 2.2);

    if (row.value !== undefined && row.value !== null) {
      const numeric = typeof row.value === 'number' ? row.value : safe(row.value);
      st(doc, numeric < 0 ? red : row.kind === 'section' ? white : slate900);
      doc.text(
        fitLine(doc, formatValue(row.value, row.format || 'money'), valueW - 4),
        M + W - 2,
        y + rowH - 2.2,
        { align: 'right' }
      );
    }

    y += rowH;
  });

  return y + 8;
}

function shiftLabel(report: any, index: number): string {
  const cashier = safeStr(report?.cashierName, '').trim();
  if (cashier) return cashier;
  const id = safeStr(report?.shiftId || report?.id, '').split('-')[0].slice(0, 10).toUpperCase();
  return id || `Shift ${index + 1}`;
}

function drawCloseDayShiftSummary(doc: jsPDF, y: number, shiftReports: any[]): number {
  const sectionBlue: RGB = [78, 132, 186];
  const totalBlue: RGB = [222, 234, 246];
  const highlightBlue: RGB = [157, 188, 224];
  const lineBlue: RGB = [203, 213, 225];
  const rows: Array<{ label: string; key: string; highlight?: boolean; total?: boolean; deduct?: boolean }> = [
    { label: 'Cash Sale', key: 'cashSales' },
    { label: 'M-Pesa Sales', key: 'mpesaSales' },
    { label: 'PDQ Sales', key: 'pdqSales' },
    { label: 'Refunds', key: 'totalRefunds', deduct: true },
    { label: 'Remittance', key: 'remittanceTotal', deduct: true },
    { label: 'Cash Picked', key: 'totalPicks' },
    { label: 'Cashier Variance', key: 'difference', highlight: true },
    { label: 'Gross Sales', key: 'grossSales', total: true },
    { label: 'VAT', key: 'taxTotal', total: true },
  ];
  const chunks: any[][] = [];
  for (let i = 0; i < shiftReports.length; i += 4) chunks.push(shiftReports.slice(i, i + 4));

  const valueFor = (report: any, key: string) => {
    if (key === 'remittanceTotal') {
      return Math.min(
        safe(report.cashSales),
        safe(report.remittanceTotal ?? (safe(report.supplierPaymentsTotal) + safe(report.totalExpenses)))
      );
    }
    return safe(report?.[key]);
  };

  chunks.forEach((chunk, chunkIndex) => {
    const hasTotal = chunkIndex === chunks.length - 1;
    const colCount = chunk.length + (hasTotal ? 1 : 0);
    const labelW = 54;
    const valueW = (W - labelW) / Math.max(1, colCount);

    const ensureRoom = (height: number) => {
      if (y + height <= pageBottom(doc)) return;
      footer(doc);
      doc.addPage();
      y = 18;
    };

    ensureRoom(17 + rows.length * 8);
    sf(doc, sectionBlue);
    doc.rect(M, y, W, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    st(doc, white);
    doc.text(chunkIndex === 0 ? 'Daily Close Report - Closed Shift Summary' : 'Closed Shift Summary Continued', M + 2, y + 6.3);
    y += 9;

    sf(doc, sectionBlue);
    doc.rect(M, y, W, 8, 'F');
    sd(doc, lineBlue);
    doc.rect(M, y, labelW, 8);
    doc.setFontSize(7.5);
    doc.text('Line Item', M + 2, y + 5.4);
    chunk.forEach((report, index) => {
      const x = M + labelW + index * valueW;
      doc.rect(x, y, valueW, 8);
      doc.text(fitLine(doc, shiftLabel(report, chunkIndex * 4 + index), valueW - 4), x + valueW - 2, y + 5.4, { align: 'right' });
    });
    if (hasTotal) {
      const x = M + labelW + chunk.length * valueW;
      doc.rect(x, y, valueW, 8);
      doc.text('Total', x + valueW - 2, y + 5.4, { align: 'right' });
    }
    y += 8;

    rows.forEach((row, rowIndex) => {
      const rowH = row.highlight ? 8 : 7;
      ensureRoom(rowH);
      if (row.highlight) sf(doc, highlightBlue);
      else if (row.total) sf(doc, totalBlue);
      else if (rowIndex % 2 === 0) sf(doc, [250, 252, 255] as RGB);
      else sf(doc, white);
      doc.rect(M, y, W, rowH, 'F');

      sd(doc, lineBlue);
      doc.rect(M, y, labelW, rowH);
      chunk.forEach((_, index) => doc.rect(M + labelW + index * valueW, y, valueW, rowH));
      if (hasTotal) doc.rect(M + labelW + chunk.length * valueW, y, valueW, rowH);

      doc.setFont('helvetica', row.highlight || row.total ? 'bold' : 'normal');
      doc.setFontSize(7.4);
      st(doc, slate900);
      doc.text(fitLine(doc, row.label, labelW - 4), M + 2, y + rowH - 2.2);

      chunk.forEach((report, index) => {
        const value = valueFor(report, row.key);
        const x = M + labelW + index * valueW;
        st(doc, value < 0 || row.deduct ? red : slate900);
        const formatted = row.deduct && value > 0 ? `-${kshAccounting(value)}` : kshAccounting(value);
        doc.text(fitLine(doc, formatted, valueW - 4), x + valueW - 2, y + rowH - 2.2, { align: 'right' });
      });

      if (hasTotal) {
        const total = shiftReports.reduce((sum, report) => sum + valueFor(report, row.key), 0);
        const x = M + labelW + chunk.length * valueW;
        st(doc, total < 0 || row.deduct ? red : slate900);
        const formatted = row.deduct && total > 0 ? `-${kshAccounting(total)}` : kshAccounting(total);
        doc.text(fitLine(doc, formatted, valueW - 4), x + valueW - 2, y + rowH - 2.2, { align: 'right' });
      }

      y += rowH;
    });
    y += 8;
  });

  return y;
}

function buildReport(r: any, bizName = 'MTAANI POS', location = 'Nairobi, Kenya'): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const isDaily = r.recordType === 'DAILY_SUMMARY';
  const ref = safeStr((r.id || '').split('-')[0], 'RPT').toUpperCase();
  const reportDate = new Date(safe(r.date || r.timestamp || Date.now()));
  const issuedDate = new Date(r.timestamp || Date.now());
  const shiftIds = parseList(r.shiftIds);
  const grossSales = safe(r.grossSales ?? r.totalSales);
  const totalSales = safe(r.totalSales ?? grossSales);
  const cashSales = safe(r.cashSales ?? Math.max(0, totalSales - safe(r.mpesaSales)));
  const mpesaSales = safe(r.mpesaSales);
  const pdqSales = safe(r.pdqSales);
  const expenses = safe(r.totalExpenses);
  const supplierPaymentsTotal = safe(r.supplierPaymentsTotal);
  const remittanceTotal = Math.min(cashSales, safe(r.remittanceTotal ?? (supplierPaymentsTotal + expenses)));
  const banked = safe(r.totalPicks);
  const refunds = safe(r.totalRefunds);
  const taxTotal = safe(r.taxTotal);
  const expected = safe(r.expectedCash);
  const reported = safe(r.reportedCash || expected);
  const diff = safe(r.difference ?? r.totalVariance);
  const shiftReports = parseList(r.shiftReports);
  const reportTitle = isDaily ? 'Daily Close Report' : 'Shift Report';
  let y = banner(
    doc,
    reportTitle,
    ref,
    issuedDate.toLocaleDateString('en-KE'),
    bizName,
    location
  );

  y = drawCloseReportInfoGrid(doc, y, [
    ['Date Created', issuedDate.toLocaleDateString('en-KE')],
    ['Date Issued', issuedDate.toLocaleDateString('en-KE')],
    [isDaily ? 'Business Day' : 'Shift ID', isDaily ? reportDate.toLocaleDateString('en-KE') : safeStr(r.shiftId, 'N/A')],
    ['Report Type', isDaily ? 'Daily Close' : 'Shift Close'],
  ]);

  if (isDaily && shiftReports.length) {
    y = drawCloseDayShiftSummary(doc, y, shiftReports);
    const finalVariance = shiftReports.reduce((sum, report) => sum + safe(report.difference), 0);
    y = bigTotal(doc, 'DAILY CLOSE TOTAL SALES', ksh(totalSales), y, brandBlue);
    y = bigTotal(doc, 'TOTAL CASHIER VARIANCE', ksh(finalVariance), y, Math.abs(finalVariance) < 0.01 ? green : red);
    footer(doc);
    return doc.output('blob');
  }

  const rows: CloseReportRow[] = isDaily
    ? [
        { label: 'Total Sales', value: totalSales, kind: 'highlight' },
        { label: 'Refunds', value: refunds, format: 'deduct' },
        { label: 'Remittance (Supplier payments + Expenses)', value: expenses, format: 'deduct' },
        { label: 'Cash Picked', value: banked },
        { label: 'Cashier Variance', value: diff, kind: 'highlight' },
        { label: 'Shifts Included', value: String(shiftIds.length || 0), format: 'plain', kind: 'note' },
        { label: 'Gross Sales', value: grossSales, kind: 'total' },
        { label: 'VAT', value: taxTotal, kind: 'total' },
      ]
    : [
        { label: 'Cash Sale', value: cashSales },
        { label: 'M-Pesa Sales', value: mpesaSales },
        { label: 'PDQ Sales', value: pdqSales },
        { label: 'Refunds', value: refunds, format: 'deduct' },
        { label: 'Remittance (Supplier payments + Expenses)', value: remittanceTotal, format: 'deduct' },
        { label: 'Cash Picked', value: banked },
        { label: 'Cashier Variance', value: diff, kind: 'highlight' },
        { label: 'Gross Sales', value: grossSales, kind: 'total' },
        { label: 'VAT', value: taxTotal, kind: 'total' },
      ];

  y = drawCloseReportStatement(doc, y, reportTitle, rows);
  const ok = Math.abs(diff) < 0.01;
  y = bigTotal(doc, ok ? 'STATUS: BALANCED' : 'STATUS: VARIANCE FOUND', ok ? ksh(totalSales) : ksh(Math.abs(diff)), y, ok ? brandBlue : red);
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
    ...(invoices || []).map(i => ({ date: i.orderDate, type: 'INVOICE', ref: i.invoiceNumber || i.id.split('-')[0], amt: i.totalAmount, bal: 'DR', affectsBalance: true })),
    ...(payments || []).map(p => ({ date: p.timestamp, type: 'PAYMENT', ref: p.reference || 'PAY', amt: p.amount, bal: 'CR', affectsBalance: true })),
    ...(creditNotes || []).map(c => {
      const isAllocated = c.status === 'ALLOCATED';
      return {
        date: c.timestamp,
        type: isAllocated ? 'CREDIT NOTE' : 'PENDING CREDIT',
        ref: c.reference || 'CRN',
        amt: c.amount,
        bal: 'CR',
        affectsBalance: isAllocated,
      };
    })
  ].sort((a, b) => a.date - b.date);

  let running = 0;
  const rows = allTx.map(tx => {
    if (tx.bal === 'DR') running += tx.amt;
    else if (tx.affectsBalance) running -= tx.amt;
    
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
function buildSalesInvoicePDF(invoice: any, bizName = 'MTAANI POS', location = 'Nairobi, Kenya'): Blob {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = banner(
    doc,
    invoice?.status === 'PAID' ? 'Paid Invoice' : 'Sales Invoice',
    safeStr(invoice?.invoiceNumber || invoice?.id, 'INV'),
    new Date(invoice?.issueDate || Date.now()).toLocaleDateString(),
    bizName
  );

  y = kvRow(doc, 'Customer', safeStr(invoice?.customerName), y);
  y = kvRow(doc, 'Phone', safeStr(invoice?.customerPhone, '-'), y);
  if (invoice?.customerEmail) y = kvRow(doc, 'Email', safeStr(invoice.customerEmail), y);
  y = kvRow(doc, 'Business Location', location, y);
  y = kvRow(doc, 'Due Date', invoice?.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'No due date', y);
  y = kvRow(doc, 'Status', safeStr(invoice?.status), y, invoice?.status === 'PAID' ? green : invoice?.status === 'PARTIAL' ? orange : red);
  y = hLine(doc, y + 2);

  const itemRows = (Array.isArray(invoice?.items) ? invoice.items : []).map((item: any) => {
    const qty = safe(item.quantity);
    const price = safe(item.unitPrice);
    const amount = qty * price;
    const vat = item.taxCategory === 'A' ? amount * 0.16 : 0;
    return [
      safeStr(item.name),
      safeStr(item.itemType || 'ITEM'),
      String(qty),
      ksh(price),
      ksh(vat),
      ksh(amount + vat),
    ];
  });

  y = table(doc, ['Item', 'Type', 'Qty', 'Price', 'VAT', 'Total'], [58, 22, 16, 28, 25, 31], itemRows, y);
  y = kvRow(doc, 'Subtotal', ksh(invoice?.subtotal), y);
  y = kvRow(doc, 'VAT', ksh(invoice?.tax), y);
  y = kvRow(doc, 'Paid', ksh(invoice?.paidAmount), y, green);
  y = kvRow(doc, 'Balance', ksh(invoice?.balance), y, safe(invoice?.balance) > 0 ? red : green);
  y = bigTotal(doc, 'Invoice Total', ksh(invoice?.total), y + 3, brandBlue);

  if (invoice?.notes) {
    y = hLine(doc, y + 2);
    kvRow(doc, 'Notes', safeStr(invoice.notes), y);
  }

  footer(doc);
  return doc.output('blob');
}

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
    case 'REFUND':           return buildRefundPDF(record, bizName, location);
    case 'EXPENSE':          return buildReceipt(record, bizName, location); // fallback or buildExpense with location
    case 'SALES_INVOICE':    return buildSalesInvoicePDF(record, bizName, location);
    case 'PURCHASE_ORDER':   return buildPO(record, supplier, bizName);
    case 'SUPPLIER_PAYMENT': return buildRemittance(record, supplier?.company || supplier, bizName);
    case 'CREDIT_NOTE':      return buildCreditNotePDF(record, supplier, bizName, location);
    case 'CLOSE_DAY_REPORT':
    case 'DAILY_SUMMARY':    return buildReport(record, bizName, location);
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
export async function generateAndDownloadSalesInvoice(invoice: any, bizName?: string, location?: string) {
  const blob = buildSalesInvoicePDF(invoice, bizName, location);
  const ref = safeStr(invoice?.invoiceNumber || invoice?.id || 'Invoice').replace(/\s+/g, '-');
  download(blob, `Invoice-${ref}`);
}

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
    if (sale.recordType === 'SALES_INVOICE') return safe(sale.total);
    if (sale.paymentMethod === 'CREDIT') return safe(sale.total);
    if (sale.paymentMethod === 'SPLIT' && sale.splitPayments?.secondaryMethod === 'CREDIT') return safe(sale.splitPayments.secondaryAmount);
    return 0;
  };
  const rows = [
    ...(sales || []).map(sale => [
      new Date(sale.recordType === 'SALES_INVOICE' ? sale.issueDate : sale.timestamp).toLocaleDateString(),
      sale.recordType === 'SALES_INVOICE' ? 'INVOICE' : 'SALE',
      sale.recordType === 'SALES_INVOICE' ? safeStr(sale.invoiceNumber) : safeStr(sale.id, '').split('-')[0].toUpperCase(),
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

type ProfitLossReportPeriod = {
  label: string;
  totalRevenue: number;
  grossSales: number;
  discounts: number;
  cogs: number;
  grossProfit?: number;
  grossProfitWithVat?: number;
  grossProfitWithoutVat?: number;
  expenses: number;
  netProfit?: number;
  netProfitWithVat?: number;
  netProfitWithoutVat?: number;
  tax: number;
  creditSales: number;
  orderCount: number;
  expenseBreakdown: { name: string; value: number }[];
};

type ProfitLossReportInput = {
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
  periods?: ProfitLossReportPeriod[];
  reportMode?: 'INDIVIDUAL' | 'COMPARISON';
  businessName?: string;
  location?: string;
};

function normalizeProfitLossPeriod(period: ProfitLossReportPeriod): ProfitLossReportPeriod {
  const grossProfitWithVat = safe(period.grossProfitWithVat ?? (period.totalRevenue - period.cogs));
  const grossProfitWithoutVat = safe(period.grossProfitWithoutVat ?? (grossProfitWithVat - period.tax));
  const netProfitWithVat = safe(period.netProfitWithVat ?? (grossProfitWithVat - period.expenses));
  const netProfitWithoutVat = safe(period.netProfitWithoutVat ?? (grossProfitWithoutVat - period.expenses));
  return {
    ...period,
    grossProfitWithVat,
    grossProfitWithoutVat,
    netProfitWithVat,
    netProfitWithoutVat,
    grossProfit: safe(period.grossProfit ?? grossProfitWithoutVat),
    netProfit: safe(period.netProfit ?? netProfitWithoutVat),
    expenseBreakdown: period.expenseBreakdown || [],
  };
}

function profitLossPeriods(report: ProfitLossReportInput): ProfitLossReportPeriod[] {
  const periods = report.periods?.length
    ? report.periods
    : [{
        label: report.periodLabel,
        totalRevenue: report.totalRevenue,
        grossSales: report.grossSales,
        discounts: report.discounts,
        cogs: report.cogs,
        grossProfit: report.grossProfit,
        expenses: report.expenses,
        netProfit: report.netProfit,
        tax: report.tax,
        creditSales: report.creditSales,
        orderCount: report.orderCount,
        expenseBreakdown: report.expenseBreakdown,
      }];

  return periods.map(normalizeProfitLossPeriod);
}

function kshAccounting(value: any): string {
  const amount = safe(value);
  const text = `Ksh ${Math.abs(amount).toLocaleString()}`;
  return amount < 0 ? `(${text})` : text;
}

type ProfitLossRow = {
  label: string;
  values?: Array<number | string | null | undefined>;
  kind?: 'section' | 'normal' | 'total' | 'highlight' | 'note';
  format?: 'money' | 'deduct' | 'plain';
};

function drawProfitLossInfoGrid(doc: jsPDF, y: number, report: ProfitLossReportInput, periods: ProfitLossReportPeriod[]): number {
  const cols = [
    ['Date Created', new Date().toLocaleDateString()],
    ['Date Issued', new Date().toLocaleDateString()],
    ['Period', report.periodLabel],
    ['Mode', periods.length > 1 ? 'Comparison' : 'Individual'],
  ];
  const cellW = W / cols.length;
  const headerH = 7;
  const valueH = 8;

  cols.forEach(([label], i) => {
    const x = M + i * cellW;
    sf(doc, [248, 250, 252] as RGB);
    doc.rect(x, y, cellW, headerH, 'F');
    sd(doc, slate100);
    doc.rect(x, y, cellW, headerH + valueH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    st(doc, slate900);
    doc.text(fitLine(doc, label, cellW - 4), x + cellW / 2, y + 4.8, { align: 'center' });
  });

  cols.forEach(([, value], i) => {
    const x = M + i * cellW;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    st(doc, slate600);
    doc.text(fitLine(doc, value, cellW - 4), x + cellW / 2, y + headerH + 5.2, { align: 'center' });
  });

  return y + headerH + valueH + 9;
}

function drawProfitLossTable(doc: jsPDF, y: number, periods: ProfitLossReportPeriod[]): number {
  const sectionBlue: RGB = [78, 132, 186];
  const totalBlue: RGB = [222, 234, 246];
  const highlightBlue: RGB = [157, 188, 224];
  const lineBlue: RGB = [203, 213, 225];
  const colCount = Math.max(1, periods.length);
  const labelW = colCount > 1 ? 82 : 118;
  const valueW = (W - labelW) / colCount;

  const expenseNames = Array.from(new Set(
    periods.flatMap(period => (period.expenseBreakdown || []).map(row => row.name))
  ));
  const expenseRows: ProfitLossRow[] = expenseNames.map(name => ({
    label: name,
    values: periods.map(period => period.expenseBreakdown.find(row => row.name === name)?.value || 0),
    format: 'deduct',
  }));

  const rows: ProfitLossRow[] = [
    { label: 'Revenue', kind: 'section' },
    { label: 'Gross sales', values: periods.map(period => period.grossSales) },
    { label: 'Less: Discounts and allowances', values: periods.map(period => period.discounts), format: 'deduct' },
    { label: 'Net sales', values: periods.map(period => period.totalRevenue), kind: 'total' },
    { label: 'Cost of Goods Sold', kind: 'section' },
    { label: 'Cost of goods sold', values: periods.map(period => period.cogs), format: 'deduct' },
    { label: 'Gross profit before VAT', values: periods.map(period => period.grossProfitWithVat), kind: 'total' },
    { label: 'Operating Expenses', kind: 'section' },
    ...(expenseRows.length ? expenseRows : [{ label: 'No operating expenses recorded', values: periods.map(() => 0), format: 'deduct' as const }]),
    { label: 'Total operating expenses', values: periods.map(period => period.expenses), format: 'deduct', kind: 'total' },
    { label: 'Operating profit (loss)', values: periods.map(period => period.netProfitWithVat), kind: 'highlight' },
    { label: 'VAT Summary', kind: 'section' },
    { label: 'VAT collected', values: periods.map(period => period.tax) },
    { label: 'Profit with VAT', values: periods.map(period => period.netProfitWithVat), kind: 'highlight' },
    { label: 'Profit without VAT', values: periods.map(period => period.netProfitWithoutVat), kind: 'highlight' },
    { label: 'Credit sales included', values: periods.map(period => period.creditSales) },
    { label: 'Sales documents', values: periods.map(period => period.orderCount), format: 'plain', kind: 'note' },
  ];

  const drawTitle = () => {
    sf(doc, sectionBlue);
    doc.rect(M, y, W, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    st(doc, white);
    doc.text('Profit and Loss Report', M + 2, y + 6.3);
    y += 9;
  };

  const drawHeader = () => {
    sf(doc, sectionBlue);
    doc.rect(M, y, W, 8, 'F');
    sd(doc, lineBlue);
    doc.rect(M, y, labelW, 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    st(doc, white);
    doc.text('Line Item', M + 2, y + 5.4);
    periods.forEach((period, i) => {
      const x = M + labelW + i * valueW;
      doc.rect(x, y, valueW, 8);
      doc.text(fitLine(doc, period.label, valueW - 4), x + valueW - 2, y + 5.4, { align: 'right' });
    });
    y += 8;
  };

  const ensureRoom = (height: number) => {
    if (y + height <= pageBottom(doc)) return;
    footer(doc);
    doc.addPage();
    y = 18;
    drawHeader();
  };

  const formatValue = (value: number | string | null | undefined, format: ProfitLossRow['format']) => {
    if (format === 'plain') return textValue(value, '0');
    const numeric = safe(value);
    if (format === 'deduct') return numeric > 0 ? `-${kshAccounting(numeric)}` : kshAccounting(numeric);
    return kshAccounting(numeric);
  };

  drawTitle();
  drawHeader();

  rows.forEach((row, index) => {
    const rowH = row.kind === 'section' ? 7 : row.kind === 'highlight' ? 8 : 7;
    ensureRoom(rowH);

    if (row.kind === 'section') {
      sf(doc, sectionBlue);
    } else if (row.kind === 'highlight') {
      sf(doc, highlightBlue);
    } else if (row.kind === 'total') {
      sf(doc, totalBlue);
    } else if (index % 2 === 0) {
      sf(doc, [250, 252, 255] as RGB);
    } else {
      sf(doc, white);
    }
    doc.rect(M, y, W, rowH, 'F');

    sd(doc, lineBlue);
    doc.setLineWidth(row.kind === 'total' || row.kind === 'highlight' ? 0.22 : 0.12);
    doc.rect(M, y, labelW, rowH);
    periods.forEach((_, i) => {
      doc.rect(M + labelW + i * valueW, y, valueW, rowH);
    });

    doc.setFont('helvetica', row.kind === 'normal' || !row.kind || row.kind === 'note' ? 'normal' : 'bold');
    doc.setFontSize(row.kind === 'section' ? 8 : 7.6);
    st(doc, row.kind === 'section' ? white : slate900);
    doc.text(fitLine(doc, row.label, labelW - 4), M + 2, y + rowH - 2.2);

    if (row.values) {
      row.values.forEach((value, i) => {
        const numeric = typeof value === 'number' ? value : safe(value);
        const x = M + labelW + i * valueW;
        st(doc, row.kind === 'section' ? white : numeric < 0 ? red : slate900);
        doc.text(
          fitLine(doc, formatValue(value, row.format || 'money'), valueW - 4),
          x + valueW - 2,
          y + rowH - 2.2,
          { align: 'right' }
        );
      });
    }

    y += rowH;
  });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.2);
  st(doc, slate600);
  const note = 'VAT is shown at the bottom so profit can be read with VAT included or after VAT is removed.';
  const noteLines = splitToFit(doc, note, W, 2);
  ensureRoom(noteLines.length * 4 + 4);
  doc.text(noteLines, M, y + 5);
  return y + noteLines.length * 4 + 9;
}

export async function generateAndDownloadProfitLossReport(report: ProfitLossReportInput) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const periods = profitLossPeriods(report);
  let y = banner(
    doc,
    periods.length > 1 ? 'Profit and Loss Comparison' : 'Profit and Loss Report',
    report.title,
    new Date().toLocaleDateString(),
    report.businessName || 'MTAANI POS',
    report.location || 'Nairobi, Kenya'
  );
  y = drawProfitLossInfoGrid(doc, y, report, periods);
  y = drawProfitLossTable(doc, y, periods);
  const finalPeriod = periods[periods.length - 1];
  const finalProfit = safe(finalPeriod.netProfitWithoutVat);
  bigTotal(doc, finalProfit >= 0 ? 'Profit Without VAT' : 'Loss Without VAT', ksh(finalProfit), y, finalProfit >= 0 ? brandBlue : red);
  footer(doc);
  download(doc.output('blob'), `Profit-Loss-${report.title.replace(/\s+/g, '-')}`);
}

export type ProductPerformanceExportRow = {
  name: string;
  group: string;
  source: string;
  qty: number;
  revenue: number;
  tax: number;
  cogs: number;
  profit: number;
  margin: number;
  stock: number | null;
  share: number;
};

export type ProductPerformanceExportInput = {
  title: string;
  periodLabel: string;
  businessName?: string;
  location?: string;
  productScope?: string;
  groupScope?: string;
  rows: ProductPerformanceExportRow[];
  summary: {
    qty: number;
    revenue: number;
    tax: number;
    cogs: number;
    profit: number;
    margin: number;
    stock: number;
    activeItems: number;
    rowCount: number;
  };
};

export async function generateAndDownloadProductPerformanceReport(report: ProductPerformanceExportInput) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const reportW = contentWidth(doc);
  let y = banner(
    doc,
    'Product Performance Report',
    report.title,
    new Date().toLocaleDateString(),
    report.businessName || 'MTAANI POS',
    report.location || 'Nairobi, Kenya'
  );

  autoTable(doc, {
    startY: y,
    body: [[
      `Period\n${safeStr(report.periodLabel, 'All time')}`,
      `Items\n${safeStr(report.productScope, 'All items')}`,
      `Groups\n${safeStr(report.groupScope, 'All groups')}`,
    ]],
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 7,
      cellPadding: 2,
      lineColor: [203, 213, 225],
      lineWidth: 0.1,
      textColor: slate900,
      overflow: 'linebreak',
      valign: 'middle',
    },
    bodyStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: reportW / 3 },
      1: { cellWidth: reportW / 3 },
      2: { cellWidth: reportW / 3 },
    },
    margin: { left: M, right: M },
  });

  const summaryY = ((doc as any).lastAutoTable?.finalY || y) + 5;
  autoTable(doc, {
    startY: summaryY,
    head: [['Rows', 'Sold Items', 'Qty Sold', 'Sales', 'VAT', 'Cost', 'Profit', 'Margin', 'Stock']],
    body: [[
      report.summary.rowCount.toLocaleString(),
      report.summary.activeItems.toLocaleString(),
      report.summary.qty.toLocaleString(undefined, { maximumFractionDigits: 2 }),
      ksh(report.summary.revenue),
      ksh(report.summary.tax),
      ksh(report.summary.cogs),
      ksh(report.summary.profit),
      `${safe(report.summary.margin).toFixed(1)}%`,
      report.summary.stock.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    ]],
    theme: 'grid',
    tableWidth: reportW,
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 2, lineColor: [203, 213, 225], lineWidth: 0.1, halign: 'right', valign: 'middle' },
    headStyles: { fillColor: brandBlue, textColor: white, fontStyle: 'bold', halign: 'right' },
    bodyStyles: { textColor: slate900, halign: 'right' },
    margin: { left: M, right: M },
  });

  const finalSummaryY = ((doc as any).lastAutoTable?.finalY || y) + 7;
  autoTable(doc, {
    startY: finalSummaryY,
    head: [['#', 'Product', 'Group', 'Qty sold', 'Sales', 'VAT', 'Cost', 'Profit', 'Margin', 'Stock', 'Share']],
    body: report.rows.map((row, index) => [
      String(index + 1),
      safeStr(row.name),
      safeStr(row.group),
      safe(row.qty).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      ksh(row.revenue),
      ksh(row.tax),
      ksh(row.cogs),
      ksh(row.profit),
      `${safe(row.margin).toFixed(1)}%`,
      row.stock === null ? '-' : safe(row.stock).toLocaleString(undefined, { maximumFractionDigits: 2 }),
      `${safe(row.share).toFixed(1)}%`,
    ]),
    theme: 'grid',
    showHead: 'everyPage',
    tableWidth: reportW,
    styles: { font: 'helvetica', fontSize: 6.4, cellPadding: 1.6, lineColor: [203, 213, 225], lineWidth: 0.08, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: brandBlue, textColor: white, fontStyle: 'bold', valign: 'middle' },
    alternateRowStyles: { fillColor: slate100 },
    columnStyles: {
      0: { cellWidth: 9, halign: 'right' },
      1: { cellWidth: 58, halign: 'left' },
      2: { cellWidth: 36, halign: 'left' },
      3: { cellWidth: 19, halign: 'right' },
      4: { cellWidth: 26, halign: 'right' },
      5: { cellWidth: 21, halign: 'right' },
      6: { cellWidth: 23, halign: 'right' },
      7: { cellWidth: 25, halign: 'right' },
      8: { cellWidth: 16, halign: 'right' },
      9: { cellWidth: 19, halign: 'right' },
      10: { cellWidth: 17, halign: 'right' },
    },
    margin: { left: M, right: M },
  });

  footer(doc);
  const cleanTitle = report.title.replace(/\s+/g, '-');
  const filename = cleanTitle.startsWith('Product-Performance') ? cleanTitle : `Product-Performance-${cleanTitle}`;
  download(doc.output('blob'), filename);
}
