export type HardwareDeviceRole = 'RECEIPT_PRINTER' | 'BARCODE_SCANNER' | 'CASH_DRAWER';

export type HardwareTransport =
  | 'BROWSER_PRINT'
  | 'KEYBOARD'
  | 'CAMERA'
  | 'WEBUSB'
  | 'WEBSERIAL'
  | 'WEBHID'
  | 'WEBBLUETOOTH';

export interface HardwareDeviceSummary {
  key: string;
  transport: HardwareTransport;
  name: string;
  vendorId?: number;
  productId?: number;
  serialNumber?: string;
  manufacturerName?: string;
  productName?: string;
  deviceId?: string;
  assignedRole?: HardwareDeviceRole;
  connected?: boolean;
  granted: boolean;
}

export interface HardwareAssignment {
  role: HardwareDeviceRole;
  transport: HardwareTransport;
  deviceKey: string;
  deviceName: string;
  vendorId?: number;
  productId?: number;
  baudRate?: number;
  assignedAt: number;
}

export interface HardwareProfile {
  scannerMode: string;
  scannerDebounceMs: number;
  scannerSuffix: string;
  printerType: string;
  printerConnection: string;
  autoPrintReceipt: boolean;
  cashDrawerTrigger: string;
  windowsDriverName: string;
}

export interface HardwareSupport {
  secureContext: boolean;
  webUsb: boolean;
  webSerial: boolean;
  webHid: boolean;
  webBluetooth: boolean;
  camera: boolean;
}

export interface HardwareResult {
  ok: boolean;
  message: string;
}

type Cleanup = () => void | Promise<void>;

const ASSIGNMENTS_KEY = 'mtaani_hardware_assignments_v1';
const PROFILE_KEY = 'mtaani_hardware_profile_v1';
const DEFAULT_BAUD_RATE = 9600;
const RECEIPT_COLUMNS = 42;

const DEFAULT_PROFILE: HardwareProfile = {
  scannerMode: 'KEYBOARD_WEDGE',
  scannerDebounceMs: 80,
  scannerSuffix: 'ENTER',
  printerType: 'THERMAL_80',
  printerConnection: 'USB',
  autoPrintReceipt: true,
  cashDrawerTrigger: 'RECEIPT_PRINT',
  windowsDriverName: 'EPSON TM-T20X',
};

const roleLabels: Record<HardwareDeviceRole, string> = {
  RECEIPT_PRINTER: 'receipt printer',
  BARCODE_SCANNER: 'barcode scanner',
  CASH_DRAWER: 'cash drawer',
};

function navAny(): any {
  if (typeof navigator === 'undefined') return {};
  return navigator as any;
}

function safeStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function hex(value?: number) {
  if (value === undefined || value === null) return undefined;
  return `0x${Number(value).toString(16).padStart(4, '0').toUpperCase()}`;
}

function cleanText(value: any) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function money(value: any) {
  return `Ksh ${(Number(value) || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

function leftRight(left: string, right: string, width = RECEIPT_COLUMNS) {
  const cleanLeft = cleanText(left);
  const cleanRight = cleanText(right);
  const room = Math.max(1, width - cleanRight.length - 1);
  const clipped = cleanLeft.length > room ? cleanLeft.slice(0, room - 1) : cleanLeft;
  return `${clipped}${' '.repeat(Math.max(1, width - clipped.length - cleanRight.length))}${cleanRight}`;
}

function center(text: string, width = RECEIPT_COLUMNS) {
  const clean = cleanText(text).slice(0, width);
  const pad = Math.max(0, Math.floor((width - clean.length) / 2));
  return `${' '.repeat(pad)}${clean}`;
}

function line(char = '-') {
  return char.repeat(RECEIPT_COLUMNS);
}

function usbKey(device: any) {
  return [
    'usb',
    device.vendorId ?? 'unknown',
    device.productId ?? 'unknown',
    device.serialNumber || device.productName || device.manufacturerName || 'device',
  ].join(':');
}

function serialInfo(port: any) {
  try {
    return port?.getInfo?.() || {};
  } catch {
    return {};
  }
}

function serialKeyFromInfo(info: any) {
  return [
    'serial',
    info.usbVendorId ?? 'unknown',
    info.usbProductId ?? info.bluetoothServiceClassId ?? 'port',
  ].join(':');
}

function hidKey(device: any) {
  return [
    'hid',
    device.vendorId ?? 'unknown',
    device.productId ?? 'unknown',
    device.productName || 'device',
  ].join(':');
}

function bluetoothKey(device: any) {
  return ['bluetooth', device.id || device.name || 'device'].join(':');
}

function cameraKey(device: MediaDeviceInfo) {
  return ['camera', device.deviceId || device.label || 'device'].join(':');
}

function withAssignment(device: HardwareDeviceSummary, assignments = loadHardwareAssignments()): HardwareDeviceSummary {
  const assigned = assignments.find((item) => item.transport === device.transport && item.deviceKey === device.key);
  return { ...device, assignedRole: assigned?.role };
}

function summarizeUsbDevice(device: any): HardwareDeviceSummary {
  const name = cleanText([device.manufacturerName, device.productName].filter(Boolean).join(' ')) || `USB device ${hex(device.vendorId) || ''}`;
  return {
    key: usbKey(device),
    transport: 'WEBUSB',
    name,
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber,
    manufacturerName: device.manufacturerName,
    productName: device.productName,
    granted: true,
    connected: device.opened,
  };
}

function summarizeSerialPort(port: any): HardwareDeviceSummary {
  const info = serialInfo(port);
  const vendor = info.usbVendorId;
  const product = info.usbProductId;
  const name = vendor || product
    ? `Serial device ${hex(vendor) || 'USB'}:${hex(product) || 'port'}`
    : info.bluetoothServiceClassId
      ? 'Bluetooth serial port'
      : 'Serial port';
  return {
    key: serialKeyFromInfo(info),
    transport: 'WEBSERIAL',
    name,
    vendorId: vendor,
    productId: product,
    granted: true,
  };
}

function summarizeHidDevice(device: any): HardwareDeviceSummary {
  return {
    key: hidKey(device),
    transport: 'WEBHID',
    name: cleanText(device.productName) || `HID device ${hex(device.vendorId) || ''}`,
    vendorId: device.vendorId,
    productId: device.productId,
    productName: device.productName,
    granted: true,
    connected: device.opened,
  };
}

function summarizeBluetoothDevice(device: any): HardwareDeviceSummary {
  return {
    key: bluetoothKey(device),
    transport: 'WEBBLUETOOTH',
    name: cleanText(device.name) || 'Bluetooth LE device',
    granted: true,
    connected: !!device.gatt?.connected,
    deviceId: device.id,
  };
}

function summarizeCamera(device: MediaDeviceInfo): HardwareDeviceSummary {
  return {
    key: cameraKey(device),
    transport: 'CAMERA',
    name: cleanText(device.label) || 'Camera',
    granted: true,
    deviceId: device.deviceId,
  };
}

export function getHardwareSupport(): HardwareSupport {
  const nav = navAny();
  return {
    secureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
    webUsb: !!nav.usb,
    webSerial: !!nav.serial,
    webHid: !!nav.hid,
    webBluetooth: !!nav.bluetooth,
    camera: !!nav.mediaDevices?.getUserMedia,
  };
}

export function getHardwareProfile(): HardwareProfile {
  const storage = safeStorage();
  if (!storage) return DEFAULT_PROFILE;
  try {
    const parsed = JSON.parse(storage.getItem(PROFILE_KEY) || '{}');
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function loadHardwareAssignments(): HardwareAssignment[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(ASSIGNMENTS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getAssignedHardware(role: HardwareDeviceRole) {
  return loadHardwareAssignments().find((item) => item.role === role);
}

export function saveHardwareAssignment(device: HardwareDeviceSummary, role: HardwareDeviceRole) {
  const storage = safeStorage();
  if (!storage) return [];

  const current = loadHardwareAssignments()
    .filter((item) => item.role !== role)
    .filter((item) => !(item.transport === device.transport && item.deviceKey === device.key));

  const next: HardwareAssignment[] = [
    ...current,
    {
      role,
      transport: device.transport,
      deviceKey: device.key,
      deviceName: device.name,
      vendorId: device.vendorId,
      productId: device.productId,
      baudRate: device.transport === 'WEBSERIAL' ? DEFAULT_BAUD_RATE : undefined,
      assignedAt: Date.now(),
    },
  ];
  storage.setItem(ASSIGNMENTS_KEY, JSON.stringify(next));
  return next;
}

export function clearHardwareAssignment(role: HardwareDeviceRole) {
  const storage = safeStorage();
  if (!storage) return [];
  const next = loadHardwareAssignments().filter((item) => item.role !== role);
  storage.setItem(ASSIGNMENTS_KEY, JSON.stringify(next));
  return next;
}

export function assignKeyboardScanner() {
  return saveHardwareAssignment({
    key: 'keyboard:focused-input',
    transport: 'KEYBOARD',
    name: 'USB keyboard scanner',
    granted: true,
  }, 'BARCODE_SCANNER');
}

export function assignBrowserPrinter() {
  return saveHardwareAssignment({
    key: 'browser-print:chrome-destinations',
    transport: 'BROWSER_PRINT',
    name: 'Chrome printer',
    granted: true,
  }, 'RECEIPT_PRINTER');
}

export function isBrowserPrintAssignment(assignment?: HardwareAssignment | null) {
  return assignment?.transport === 'BROWSER_PRINT';
}

export async function listGrantedHardwareDevices(): Promise<HardwareDeviceSummary[]> {
  const nav = navAny();
  const assignments = loadHardwareAssignments();
  const devices: HardwareDeviceSummary[] = [
    {
      key: 'browser-print:chrome-destinations',
      transport: 'BROWSER_PRINT',
      name: 'Chrome printer',
      granted: true,
    },
    {
      key: 'keyboard:focused-input',
      transport: 'KEYBOARD',
      name: 'USB keyboard scanner',
      granted: true,
    },
  ];

  if (nav.usb?.getDevices) {
    try {
      const usbDevices = await nav.usb.getDevices();
      devices.push(...usbDevices.map(summarizeUsbDevice));
    } catch (err) {
      console.warn('[Hardware] WebUSB list failed', err);
    }
  }

  if (nav.serial?.getPorts) {
    try {
      const ports = await nav.serial.getPorts();
      devices.push(...ports.map(summarizeSerialPort));
    } catch (err) {
      console.warn('[Hardware] Web Serial list failed', err);
    }
  }

  if (nav.hid?.getDevices) {
    try {
      const hidDevices = await nav.hid.getDevices();
      devices.push(...hidDevices.map(summarizeHidDevice));
    } catch (err) {
      console.warn('[Hardware] WebHID list failed', err);
    }
  }

  if (nav.bluetooth?.getDevices) {
    try {
      const bluetoothDevices = await nav.bluetooth.getDevices();
      devices.push(...bluetoothDevices.map(summarizeBluetoothDevice));
    } catch (err) {
      console.warn('[Hardware] Web Bluetooth list failed', err);
    }
  }

  if (nav.mediaDevices?.enumerateDevices) {
    try {
      const media = await nav.mediaDevices.enumerateDevices();
      devices.push(...media.filter((device: MediaDeviceInfo) => device.kind === 'videoinput').map(summarizeCamera));
    } catch (err) {
      console.warn('[Hardware] camera list failed', err);
    }
  }

  const byKey = new Map<string, HardwareDeviceSummary>();
  for (const device of devices) {
    byKey.set(`${device.transport}:${device.key}`, withAssignment(device, assignments));
  }
  return Array.from(byKey.values());
}

export async function requestUsbHardwareDevice(role: HardwareDeviceRole) {
  const nav = navAny();
  if (!nav.usb?.requestDevice) throw new Error('WebUSB is not available in this browser.');
  const device = await nav.usb.requestDevice({ filters: [] });
  const summary = summarizeUsbDevice(device);
  saveHardwareAssignment(summary, role);
  return withAssignment(summary);
}

export async function requestSerialHardwareDevice(role: HardwareDeviceRole, baudRate = DEFAULT_BAUD_RATE) {
  const nav = navAny();
  if (!nav.serial?.requestPort) throw new Error('Web Serial is not available in this browser.');
  const port = await nav.serial.requestPort({});
  const summary = summarizeSerialPort(port);
  const assignments = saveHardwareAssignment(summary, role).map((item) => (
    item.role === role ? { ...item, baudRate } : item
  ));
  safeStorage()?.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
  return withAssignment(summary, assignments);
}

export async function requestHidHardwareDevice(role: HardwareDeviceRole) {
  const nav = navAny();
  if (!nav.hid?.requestDevice) throw new Error('WebHID is not available in this browser.');
  const devices = await nav.hid.requestDevice({ filters: [] });
  if (!devices?.length) throw new Error('No HID device selected.');
  const summary = summarizeHidDevice(devices[0]);
  saveHardwareAssignment(summary, role);
  return withAssignment(summary);
}

export async function requestBluetoothHardwareDevice(role: HardwareDeviceRole) {
  const nav = navAny();
  if (!nav.bluetooth?.requestDevice) throw new Error('Web Bluetooth is not available in this browser.');
  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: ['battery_service', 'device_information'],
  });
  const summary = summarizeBluetoothDevice(device);
  saveHardwareAssignment(summary, role);
  return withAssignment(summary);
}

export async function requestCameraScanner() {
  const nav = navAny();
  if (!nav.mediaDevices?.getUserMedia) throw new Error('Camera access is not available in this browser.');
  const stream = await nav.mediaDevices.getUserMedia({ video: true });
  stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
  const devices = await nav.mediaDevices.enumerateDevices();
  const camera = devices.find((device: MediaDeviceInfo) => device.kind === 'videoinput');
  if (!camera) throw new Error('Camera permission was granted, but no camera was found.');
  const summary = summarizeCamera(camera);
  saveHardwareAssignment(summary, 'BARCODE_SCANNER');
  return withAssignment(summary);
}

async function findAssignedUsbDevice(assignment: HardwareAssignment) {
  const nav = navAny();
  const devices = await nav.usb.getDevices();
  return devices.find((device: any) => usbKey(device) === assignment.deviceKey);
}

async function findAssignedSerialPort(assignment: HardwareAssignment) {
  const nav = navAny();
  const ports = await nav.serial.getPorts();
  return ports.find((port: any) => serialKeyFromInfo(serialInfo(port)) === assignment.deviceKey);
}

async function findAssignedHidDevice(assignment: HardwareAssignment) {
  const nav = navAny();
  const devices = await nav.hid.getDevices();
  return devices.find((device: any) => hidKey(device) === assignment.deviceKey);
}

async function sendSerialBytes(assignment: HardwareAssignment, bytes: Uint8Array) {
  const port = await findAssignedSerialPort(assignment);
  if (!port) throw new Error(`Allow access to the assigned ${roleLabels[assignment.role]} serial port again.`);

  let openedHere = false;
  try {
    await port.open({ baudRate: assignment.baudRate || DEFAULT_BAUD_RATE });
    openedHere = true;
  } catch (err: any) {
    if (err?.name !== 'InvalidStateError') throw err;
  }

  const writer = port.writable?.getWriter?.();
  if (!writer) throw new Error('The assigned serial device is not writable.');
  try {
    await writer.write(bytes);
  } finally {
    writer.releaseLock();
    if (openedHere) {
      await port.close().catch(() => {});
    }
  }
}

async function sendUsbBytes(assignment: HardwareAssignment, bytes: Uint8Array) {
  const device = await findAssignedUsbDevice(assignment);
  if (!device) throw new Error(`Allow access to the assigned ${roleLabels[assignment.role]} USB device again.`);

  let claimedInterface: number | null = null;
  try {
    await device.open();
    if (!device.configuration) await device.selectConfiguration(1);

    const interfaces = device.configuration?.interfaces || [];
    let endpointNumber: number | null = null;
    let alternateSetting = 0;

    for (const iface of interfaces) {
      for (const alternate of iface.alternates || []) {
        const endpoint = (alternate.endpoints || []).find((item: any) => item.direction === 'out');
        if (endpoint) {
          claimedInterface = iface.interfaceNumber;
          endpointNumber = endpoint.endpointNumber;
          alternateSetting = alternate.alternateSetting || 0;
          break;
        }
      }
      if (endpointNumber !== null) break;
    }

    if (claimedInterface === null || endpointNumber === null) {
      throw new Error('No writable USB endpoint was found on the selected device.');
    }

    await device.claimInterface(claimedInterface);
    if (alternateSetting) await device.selectAlternateInterface(claimedInterface, alternateSetting);
    await device.transferOut(endpointNumber, bytes);
  } finally {
    if (claimedInterface !== null) {
      await device.releaseInterface(claimedInterface).catch(() => {});
    }
    await device.close().catch(() => {});
  }
}

async function sendBytes(assignment: HardwareAssignment, bytes: Uint8Array) {
  if (assignment.transport === 'WEBSERIAL') return sendSerialBytes(assignment, bytes);
  if (assignment.transport === 'WEBUSB') return sendUsbBytes(assignment, bytes);
  if (assignment.transport === 'BROWSER_PRINT') throw new Error('Use the Print receipt button to open Chrome printer destinations.');
  throw new Error(`${assignment.deviceName} is assigned through ${assignment.transport}, but direct ESC/POS output needs WebUSB or Web Serial.`);
}

async function sendBytesToRole(role: HardwareDeviceRole, bytes: Uint8Array) {
  const assignments = loadHardwareAssignments();
  const assignment = assignments.find((item) => item.role === role)
    || (role === 'CASH_DRAWER' ? assignments.find((item) => item.role === 'RECEIPT_PRINTER') : undefined);
  if (!assignment) throw new Error(`No ${roleLabels[role]} is assigned.`);
  await sendBytes({ ...assignment, role }, bytes);
}

function escposBytes(text: string, options: { cut?: boolean; drawerPulse?: boolean } = {}) {
  const encoder = new TextEncoder();
  const chunks: number[] = [0x1B, 0x40];
  if (options.drawerPulse) chunks.push(0x1B, 0x70, 0x00, 0x19, 0xFA);
  chunks.push(...Array.from(encoder.encode(text)));
  chunks.push(0x0A, 0x0A, 0x0A);
  if (options.cut) chunks.push(0x1D, 0x56, 0x00);
  return new Uint8Array(chunks);
}

export function buildEscPosReceipt(record: any, storeName = 'Mtaani POS', location = 'Nairobi, Kenya') {
  const items = Array.isArray(record?.items) ? record.items : [];
  const ref = cleanText(record?.invoiceNumber || String(record?.id || '').split('-')[0]).toUpperCase() || 'SALE';
  const rows: string[] = [
    center(storeName.toUpperCase()),
    center(location),
    center(`Branch: ${record?.branchName || 'Main'}`),
    center(`Cashier: ${record?.cashierName || record?.preparedBy || 'Staff'}`),
    line(),
    leftRight('SALES RECEIPT', ref),
    leftRight('Date', new Date(record?.timestamp || Date.now()).toLocaleString('en-KE')),
    leftRight('Payment', record?.paymentMethod || 'CASH'),
    line(),
  ];

  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.snapshotPrice) || 0;
    const total = qty * price;
    rows.push(cleanText(item.name || 'Item').slice(0, RECEIPT_COLUMNS));
    rows.push(leftRight(`${qty} x ${money(price)}`, money(total)));
  }

  rows.push(line());
  rows.push(leftRight('Subtotal', money(record?.subtotal ?? record?.total)));
  if ((Number(record?.discountAmount) || 0) > 0) rows.push(leftRight('Discount', `-${money(record.discountAmount)}`));
  if ((Number(record?.tax) || 0) > 0) rows.push(leftRight('VAT', money(record.tax)));
  rows.push(leftRight('TOTAL', money(record?.total)));

  if (record?.paymentMethod === 'SPLIT' && record?.splitPayments) {
    rows.push(leftRight('Cash', money(record.splitPayments.cashAmount)));
    rows.push(leftRight(record.splitPayments.secondaryMethod || 'Other', money(record.splitPayments.secondaryAmount)));
    if (record.splitPayments.secondaryReference) rows.push(leftRight('Ref', record.splitPayments.secondaryReference));
  } else if (record?.amountTendered) {
    rows.push(leftRight('Paid', money(record.amountTendered)));
    const change = Number(record.changeGiven ?? (Number(record.amountTendered) - Number(record.total))) || 0;
    if (change > 0) rows.push(leftRight('Change', money(change)));
  }

  const mpesaRef = record?.mpesaCode || record?.mpesaReference;
  if (mpesaRef) rows.push(leftRight('M-Pesa', mpesaRef));
  rows.push(line());
  rows.push(center('Thank you for shopping'));
  rows.push(center('Keep this receipt for returns'));
  return `${rows.join('\n')}\n`;
}

export async function testAssignedReceiptPrinter(storeName = 'Mtaani POS', location = 'Nairobi, Kenya'): Promise<HardwareResult> {
  try {
    const text = [
      center(storeName.toUpperCase()),
      center(location),
      line(),
      center('HARDWARE TEST PRINT'),
      leftRight('Time', new Date().toLocaleString('en-KE')),
      leftRight('Status', 'OK'),
      line(),
      '\n',
    ].join('\n');
    await sendBytesToRole('RECEIPT_PRINTER', escposBytes(text, { cut: true }));
    return { ok: true, message: 'Test print sent to the receipt printer.' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Could not print to the assigned receipt printer.' };
  }
}

export async function openAssignedCashDrawer(): Promise<HardwareResult> {
  try {
    await sendBytesToRole('CASH_DRAWER', new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]));
    return { ok: true, message: 'Cash drawer pulse sent.' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Could not open the assigned cash drawer.' };
  }
}

export async function printReceiptViaAssignedPrinter(
  record: any,
  options: { storeName?: string; location?: string; openDrawer?: boolean } = {},
): Promise<HardwareResult> {
  try {
    const text = buildEscPosReceipt(record, options.storeName, options.location);
    await sendBytesToRole('RECEIPT_PRINTER', escposBytes(text, { cut: true, drawerPulse: options.openDrawer }));
    return { ok: true, message: 'Receipt sent to the assigned printer.' };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Could not print receipt.' };
  }
}

function parseScannerBuffer(buffer: string, onBarcode: (barcode: string) => void) {
  const code = cleanText(buffer).replace(/\s/g, '');
  if (code.length >= 4) onBarcode(code);
}

export async function startAssignedSerialBarcodeScanner(onBarcode: (barcode: string) => void): Promise<Cleanup | null> {
  const assignment = getAssignedHardware('BARCODE_SCANNER');
  if (!assignment || assignment.transport !== 'WEBSERIAL') return null;
  const port = await findAssignedSerialPort(assignment);
  if (!port) throw new Error('Allow access to the assigned serial barcode scanner again.');

  await port.open({ baudRate: assignment.baudRate || DEFAULT_BAUD_RATE });
  const decoder = new TextDecoder();
  let reader: any = null;
  let buffer = '';
  let stopped = false;

  const readLoop = async () => {
    while (!stopped && port.readable) {
      reader = port.readable.getReader();
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n|\t/);
          buffer = parts.pop() || '';
          parts.forEach((part) => parseScannerBuffer(part, onBarcode));
        }
      } finally {
        reader.releaseLock();
        reader = null;
      }
    }
  };
  void readLoop();

  return async () => {
    stopped = true;
    await reader?.cancel?.().catch(() => {});
    await port.close().catch(() => {});
  };
}

const hidKeyMap: Record<number, { normal: string; shifted?: string }> = {
  4: { normal: 'a', shifted: 'A' },
  5: { normal: 'b', shifted: 'B' },
  6: { normal: 'c', shifted: 'C' },
  7: { normal: 'd', shifted: 'D' },
  8: { normal: 'e', shifted: 'E' },
  9: { normal: 'f', shifted: 'F' },
  10: { normal: 'g', shifted: 'G' },
  11: { normal: 'h', shifted: 'H' },
  12: { normal: 'i', shifted: 'I' },
  13: { normal: 'j', shifted: 'J' },
  14: { normal: 'k', shifted: 'K' },
  15: { normal: 'l', shifted: 'L' },
  16: { normal: 'm', shifted: 'M' },
  17: { normal: 'n', shifted: 'N' },
  18: { normal: 'o', shifted: 'O' },
  19: { normal: 'p', shifted: 'P' },
  20: { normal: 'q', shifted: 'Q' },
  21: { normal: 'r', shifted: 'R' },
  22: { normal: 's', shifted: 'S' },
  23: { normal: 't', shifted: 'T' },
  24: { normal: 'u', shifted: 'U' },
  25: { normal: 'v', shifted: 'V' },
  26: { normal: 'w', shifted: 'W' },
  27: { normal: 'x', shifted: 'X' },
  28: { normal: 'y', shifted: 'Y' },
  29: { normal: 'z', shifted: 'Z' },
  30: { normal: '1', shifted: '!' },
  31: { normal: '2', shifted: '@' },
  32: { normal: '3', shifted: '#' },
  33: { normal: '4', shifted: '$' },
  34: { normal: '5', shifted: '%' },
  35: { normal: '6', shifted: '^' },
  36: { normal: '7', shifted: '&' },
  37: { normal: '8', shifted: '*' },
  38: { normal: '9', shifted: '(' },
  39: { normal: '0', shifted: ')' },
  45: { normal: '-', shifted: '_' },
  46: { normal: '=', shifted: '+' },
  47: { normal: '[', shifted: '{' },
  48: { normal: ']', shifted: '}' },
  49: { normal: '\\', shifted: '|' },
  51: { normal: ';', shifted: ':' },
  52: { normal: "'", shifted: '"' },
  53: { normal: '`', shifted: '~' },
  54: { normal: ',', shifted: '<' },
  55: { normal: '.', shifted: '>' },
  56: { normal: '/', shifted: '?' },
};

export async function startAssignedHidBarcodeScanner(onBarcode: (barcode: string) => void): Promise<Cleanup | null> {
  const assignment = getAssignedHardware('BARCODE_SCANNER');
  if (!assignment || assignment.transport !== 'WEBHID') return null;
  const device = await findAssignedHidDevice(assignment);
  if (!device) throw new Error('Allow access to the assigned HID barcode scanner again.');
  if (!device.opened) await device.open();

  let buffer = '';
  let lastKeys = new Set<number>();
  const onReport = (event: any) => {
    const data: DataView = event.data;
    const bytes = Array.from({ length: data.byteLength }, (_, index) => data.getUint8(index));
    const modifier = bytes[0] || 0;
    const shift = !!(modifier & 0x22);
    const keys = bytes.slice(2).filter(Boolean);
    const current = new Set(keys);

    for (const key of keys) {
      if (lastKeys.has(key)) continue;
      if (key === 40 || key === 43) {
        parseScannerBuffer(buffer, onBarcode);
        buffer = '';
        continue;
      }
      const mapped = hidKeyMap[key];
      if (mapped) buffer += shift && mapped.shifted ? mapped.shifted : mapped.normal;
    }
    lastKeys = current;
  };

  device.addEventListener('inputreport', onReport);
  return async () => {
    device.removeEventListener('inputreport', onReport);
    await device.close().catch(() => {});
  };
}

export function startKeyboardBarcodeScanner(onBarcode: (barcode: string) => void): Cleanup | null {
  const profile = getHardwareProfile();
  const assignment = getAssignedHardware('BARCODE_SCANNER');
  const enabled = profile.scannerMode === 'KEYBOARD_WEDGE' || assignment?.transport === 'KEYBOARD';
  if (!enabled || typeof window === 'undefined') return null;

  const maxGap = Math.max(20, Math.min(Number(profile.scannerDebounceMs) || 80, 160));
  const suffix = profile.scannerSuffix || 'ENTER';
  let buffer = '';
  let lastAt = 0;

  const handler = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const now = Date.now();
    if (lastAt && now - lastAt > maxGap) buffer = '';
    lastAt = now;

    const isSuffix = (suffix === 'ENTER' && event.key === 'Enter') || (suffix === 'TAB' && event.key === 'Tab');
    if (isSuffix) {
      if (buffer.length >= 4) {
        event.preventDefault();
        event.stopPropagation();
        parseScannerBuffer(buffer, onBarcode);
      }
      buffer = '';
      return;
    }

    if (event.key.length === 1) buffer += event.key;
    window.clearTimeout((handler as any).timer);
    (handler as any).timer = window.setTimeout(() => {
      buffer = '';
    }, maxGap + 30);
  };

  window.addEventListener('keydown', handler, true);
  return () => {
    window.removeEventListener('keydown', handler, true);
    window.clearTimeout((handler as any).timer);
  };
}
