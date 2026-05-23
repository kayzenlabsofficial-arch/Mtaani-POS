import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, RefreshCcw, Download, ScanLine, Printer, Usb, Building2, Check, X, Store } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_CASH_DRAWER_LIMIT } from '../../utils/ownerMode';
import { getBusinessSettings, settingsIdForBusiness } from '../../utils/settings';
import {
  assignBrowserPrinter,
  assignKeyboardScanner,
  clearHardwareAssignment,
  getHardwareSupport,
  listGrantedHardwareDevices,
  loadHardwareAssignments,
  openAssignedCashDrawer,
  requestBluetoothHardwareDevice,
  requestCameraScanner,
  requestHidHardwareDevice,
  requestSerialHardwareDevice,
  requestUsbHardwareDevice,
  saveHardwareAssignment,
  testAssignedReceiptPrinter,
  type HardwareDeviceRole,
  type HardwareDeviceSummary,
  type HardwareSupport,
} from '../../utils/hardware';
import { BusinessSettingsService } from '../../services/businessSettings';
import { normalizeTillCount, parseSalesTillRows, parseSalesTills, serializeSalesTills, type SalesTill } from '../../utils/tills';


export default function SettingsTab({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const isAdmin = useStore((state) => state.isAdmin);
  const activeBusinessId = useStore((state) => state.activeBusinessId);
  const { success, warning, error } = useToast();
  
  const savedSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId], null);
  const savedTillRows = useLiveQuery(
    () => activeBusinessId
      ? db.salesTills.where('businessId').equals(activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const savedTillSignature = React.useMemo(
    () => JSON.stringify(parseSalesTillRows(savedTillRows)),
    [savedTillRows]
  );
  const [storeSettings, setStoreSettings] = useState({
     storeName: 'Mtaani Shop', krapin: 'P0000000000A', tillNumber: '123456', receiptFooter: 'Thank you for shopping!', location: 'Nairobi, Kenya'
  });
  const [ownerSettings, setOwnerSettings] = useState({
    ownerModeEnabled: false,
    autoApproveOwnerActions: true,
    cashSweepEnabled: true,
    cashDrawerLimit: String(DEFAULT_CASH_DRAWER_LIMIT),
  });
  const [tillSettings, setTillSettings] = useState<{
    count: string;
    openingFloat: string;
    tills: SalesTill[];
  }>({
    count: '1',
    openingFloat: '0',
    tills: parseSalesTills(null),
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [hardwareAssignments, setHardwareAssignments] = useState(loadHardwareAssignments());
  const [hardwareSupport, setHardwareSupport] = useState<HardwareSupport>(() => getHardwareSupport());
  const [isHardwareBusy, setIsHardwareBusy] = useState(false);
  const [hardwareMessage, setHardwareMessage] = useState('');

  useEffect(() => {
     const tableTills = parseSalesTillRows(savedTillRows);
     const savedTills = tableTills.length ? tableTills : parseSalesTills(savedSettings);
     if (savedSettings) {
        setStoreSettings({
           storeName: savedSettings.storeName,
           krapin: savedSettings.kraPin,
           tillNumber: savedSettings.tillNumber,
           receiptFooter: savedSettings.receiptFooter,
           location: savedSettings.location || 'Nairobi, Kenya'
        });
        setOwnerSettings({
          ownerModeEnabled: savedSettings.ownerModeEnabled === 1,
          autoApproveOwnerActions: savedSettings.autoApproveOwnerActions !== 0,
          cashSweepEnabled: savedSettings.cashSweepEnabled !== 0,
          cashDrawerLimit: String(savedSettings.cashDrawerLimit ?? DEFAULT_CASH_DRAWER_LIMIT),
        });
     }
     setTillSettings({
       count: String(savedTills.length || 1),
       openingFloat: String(savedSettings?.defaultOpeningFloat ?? 0),
       tills: savedTills,
     });
  }, [savedSettings, savedTillSignature]);

  const refreshHardwareDevices = async (quiet = false) => {
    setIsHardwareBusy(true);
    try {
      setHardwareSupport(getHardwareSupport());
      const devices = await listGrantedHardwareDevices();
      setHardwareAssignments(loadHardwareAssignments());
      if (!quiet) success(`Found ${devices.length} browser-accessible hardware item${devices.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      error(err?.message || 'Could not scan hardware devices.');
    } finally {
      setIsHardwareBusy(false);
    }
  };

  useEffect(() => {
    void refreshHardwareDevices(true);
  }, []);

  const connectHardware = async (
    transport: 'BROWSER_PRINT' | 'USB' | 'SERIAL' | 'HID' | 'BLUETOOTH' | 'CAMERA' | 'KEYBOARD',
    role: HardwareDeviceRole,
  ) => {
    setIsHardwareBusy(true);
    setHardwareMessage('');
    try {
      let device: HardwareDeviceSummary | null = null;
      if (transport === 'BROWSER_PRINT') {
        assignBrowserPrinter();
        device = {
          key: 'browser-print:chrome-destinations',
          transport: 'BROWSER_PRINT',
          name: 'Chrome printer',
          granted: true,
          assignedRole: 'RECEIPT_PRINTER',
        };
        setHardwareMessage('Receipts will open Chrome printer destinations like your HP, Kyocera, PDF, and network printers.');
      }
      if (transport === 'USB') device = await requestUsbHardwareDevice(role);
      if (transport === 'SERIAL') device = await requestSerialHardwareDevice(role);
      if (transport === 'HID') device = await requestHidHardwareDevice(role);
      if (transport === 'BLUETOOTH') device = await requestBluetoothHardwareDevice(role);
      if (transport === 'CAMERA') device = await requestCameraScanner();
      if (transport === 'KEYBOARD') {
        assignKeyboardScanner();
        device = {
          key: 'keyboard:focused-input',
          transport: 'KEYBOARD',
          name: 'USB keyboard scanner',
          granted: true,
          assignedRole: 'BARCODE_SCANNER',
        };
      }

      setHardwareAssignments(loadHardwareAssignments());
      await refreshHardwareDevices(true);
      success(`${device?.name || 'Device'} assigned to ${role.replace('_', ' ').toLowerCase()}.`);
      if (transport === 'BLUETOOTH') {
        setHardwareMessage('Bluetooth discovery uses the browser BLE API. Classic Bluetooth printers/scanners still need their vendor driver or keyboard mode.');
      }
    } catch (err: any) {
      error(err?.message || 'Hardware connection was cancelled or blocked.');
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const clearDeviceRole = (role: HardwareDeviceRole) => {
    setHardwareAssignments(clearHardwareAssignment(role));
    success('Hardware assignment cleared.');
  };

  const handleTestPrint = async () => {
    setIsHardwareBusy(true);
    try {
      const result = await testAssignedReceiptPrinter(storeSettings.storeName, storeSettings.location);
      result.ok ? success(result.message) : warning(result.message);
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const handleOpenDrawer = async () => {
    setIsHardwareBusy(true);
    try {
      const result = await openAssignedCashDrawer();
      result.ok ? success(result.message) : warning(result.message);
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      if (needRefresh) {
        await updateServiceWorker(true);
      } else {
        await new Promise(r => setTimeout(r, 1200));
        success("System is fully up to date!");
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveSettings = async () => {
      setIsUpdating(true);
      try {
        if (!activeBusinessId) return error('Please log in again.');
        await BusinessSettingsService.save({
          businessId: activeBusinessId,
          settings: {
            ...(savedSettings || {}),
            id: settingsIdForBusiness(activeBusinessId),
            storeName: storeSettings.storeName,
            tillNumber: storeSettings.tillNumber,
            kraPin: storeSettings.krapin,
            receiptFooter: storeSettings.receiptFooter,
            location: storeSettings.location,
            ownerModeEnabled: ownerSettings.ownerModeEnabled ? 1 : 0,
            autoApproveOwnerActions: ownerSettings.autoApproveOwnerActions ? 1 : 0,
            cashSweepEnabled: ownerSettings.cashSweepEnabled ? 1 : 0,
            cashDrawerLimit: Number(ownerSettings.cashDrawerLimit) || DEFAULT_CASH_DRAWER_LIMIT,
            salesTills: serializeSalesTills(tillSettings.tills),
            defaultOpeningFloat: Math.max(0, Number(tillSettings.openingFloat) || 0),
            businessId: activeBusinessId,
          },
        });
        const normalizedTills = normalizeTillCount(tillSettings.count, tillSettings.tills);
        const existingTillRows = await db.salesTills.where('businessId').equals(activeBusinessId).toArray();
        const activeTillIds = new Set(normalizedTills.map(till => till.id));
        const now = Date.now();
        const rowsToPersist = [
          ...normalizedTills.map((till, index) => ({
            id: till.id || `till-${index + 1}`,
            name: till.name || `Till ${index + 1}`,
            isActive: 1,
            businessId: activeBusinessId,
            updated_at: now,
          })),
          ...existingTillRows
            .filter(row => !activeTillIds.has(row.id))
            .map(row => ({
              ...row,
              isActive: 0,
              businessId: activeBusinessId,
              updated_at: now,
            })),
        ];
        await db.salesTills.bulkPut(rowsToPersist);
        await Promise.all([db.settings.reload(), db.salesTills.reload()]);
        success("Business settings saved.");
      } catch (err: any) {
        console.error(err);
        error(err?.message || 'Could not save business settings.');
      } finally {
        setIsUpdating(false);
      }
  };

  const assignedScanner = hardwareAssignments.find(item => item.role === 'BARCODE_SCANNER');
  const assignedPrinter = hardwareAssignments.find(item => item.role === 'RECEIPT_PRINTER');
  const assignedDrawer = hardwareAssignments.find(item => item.role === 'CASH_DRAWER');
  const isChromePrinter = assignedPrinter?.transport === 'BROWSER_PRINT';
  const directPrinterReady = !!assignedPrinter && !isChromePrinter;

  const updateTillCount = (value: string) => {
    setTillSettings(prev => {
      const tills = normalizeTillCount(value, prev.tills);
      return { ...prev, count: String(tills.length), tills };
    });
  };

  const updateTillName = (index: number, name: string) => {
    setTillSettings(prev => ({
      ...prev,
      tills: prev.tills.map((till, i) => i === index ? { ...till, name } : till),
    }));
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="mb-4 flex flex-col justify-between gap-3 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:p-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Business controls</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Settings</h2>
          {false && (
            <>
            <span className="text-[10px] font-bold text-slate-500">Business info</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">Hardware profile</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-slate-500">App version</span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={handleSaveSettings}
          disabled={isUpdating}
          className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
        >
          {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
          Save changes
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
         
         {/* Left: Business Info */}
         <div className="space-y-4">
            <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
               <h3 className="mb-5 flex items-center gap-2 text-base font-black text-slate-950">
                  <Building2 className="text-blue-700" /> Business details
               </h3>
               <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Business name</label>
                    <input type="text" value={storeSettings.storeName} onChange={e => setStoreSettings({...storeSettings, storeName: e.target.value})} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                     <div>
                       <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">M-Pesa till</label>
                       <input type="text" value={storeSettings.tillNumber} onChange={e => setStoreSettings({...storeSettings, tillNumber: e.target.value})} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                     </div>
                     <div>
                       <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">KRA PIN</label>
                       <input type="text" value={storeSettings.krapin} onChange={e => setStoreSettings({...storeSettings, krapin: e.target.value})} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                     </div>
                     <div>
                       <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Location</label>
                       <input type="text" value={storeSettings.location} onChange={e => setStoreSettings({...storeSettings, location: e.target.value})} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                     </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Receipt footer</label>
                    <input type="text" value={storeSettings.receiptFooter} onChange={e => setStoreSettings({...storeSettings, receiptFooter: e.target.value})} className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100" />
                  </div>
                  
                  <button 
                    onClick={handleSaveSettings} 
                    disabled={isUpdating}
                    className="mt-2 flex w-full items-center justify-center gap-3 rounded-lg border-2 border-blue-700 bg-blue-700 py-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
                  >
                     {isUpdating ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
                     Save settings
                  </button>
               </div>
            </div>

            <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="mb-5 flex items-center gap-2 text-base font-black text-slate-900">
                <Store className="text-blue-700" /> Tills
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Number of tills</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={tillSettings.count}
                    onChange={event => updateTillCount(event.target.value)}
                    className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Default opening cash</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={tillSettings.openingFloat}
                    onChange={event => setTillSettings(prev => ({ ...prev, openingFloat: event.target.value }))}
                    className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {tillSettings.tills.map((till, index) => (
                  <div key={till.id} className="grid gap-2 rounded-lg border border-slate-300 bg-slate-50/70 p-3 sm:grid-cols-[84px_1fr] sm:items-center">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Till {index + 1}</span>
                    <input
                      type="text"
                      value={till.name}
                      onChange={event => updateTillName(index, event.target.value)}
                      className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={isUpdating}
                className="mt-5 flex w-full items-center justify-center gap-3 rounded-lg border-2 border-blue-700 bg-blue-700 py-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
              >
                {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
                Save tills
              </button>
            </div>

            {/* System Updates */}
            <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
               <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                      <h4 className="text-base font-black leading-tight text-slate-950">Software updates</h4>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Status: {needRefresh ? 'Update ready' : 'App is up to date'}
                      </p>
                  </div>
                  <button 
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className={`flex h-11 items-center justify-center gap-2 rounded-lg border-2 px-4 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${needRefresh ? 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}
                  >
                    {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Download size={16} />}
                    {needRefresh ? 'Update now' : 'Check for updates'}
                  </button>
               </div>
            </div>
         </div>

         {/* Right: Hardware & Security */}
         <div className="space-y-4">
            <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
               <h3 className="mb-5 flex items-center gap-2 text-base font-black text-slate-950">
                  <Usb className="text-blue-700" /> Hardware
               </h3>
               <div className="space-y-4">
                 <div className="rounded-lg border border-slate-300 bg-slate-50/70 p-4">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex min-w-0 items-center gap-3">
                       <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700">
                         <Printer size={20} />
                       </div>
                       <div className="min-w-0">
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Receipt printer</p>
                         <p className="truncate text-sm font-bold text-slate-950">{assignedPrinter?.deviceName || 'Not connected'}</p>
                       </div>
                     </div>
                     {assignedPrinter && (
                       <button type="button" onClick={() => clearDeviceRole('RECEIPT_PRINTER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
                         Clear
                       </button>
                     )}
                   </div>
                   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                     <button type="button" disabled={isHardwareBusy} onClick={() => connectHardware('BROWSER_PRINT', 'RECEIPT_PRINTER')} className="rounded-lg border-2 border-blue-700 bg-blue-700 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                       Chrome printer
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webUsb} onClick={() => connectHardware('USB', 'RECEIPT_PRINTER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       USB thermal
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webSerial} onClick={() => connectHardware('SERIAL', 'RECEIPT_PRINTER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Serial
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webBluetooth} onClick={() => connectHardware('BLUETOOTH', 'RECEIPT_PRINTER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Bluetooth
                     </button>
                     <button type="button" disabled={isHardwareBusy || !directPrinterReady} onClick={handleTestPrint} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Test
                     </button>
                   </div>
                 </div>

                 <div className="rounded-lg border border-slate-300 bg-slate-50/70 p-4">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex min-w-0 items-center gap-3">
                       <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700">
                         <ScanLine size={20} />
                       </div>
                       <div className="min-w-0">
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Scanner</p>
                         <p className="truncate text-sm font-bold text-slate-950">{assignedScanner?.deviceName || 'Not connected'}</p>
                       </div>
                     </div>
                     {assignedScanner && (
                       <button type="button" onClick={() => clearDeviceRole('BARCODE_SCANNER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
                         Clear
                       </button>
                     )}
                   </div>
                   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                     <button type="button" disabled={isHardwareBusy} onClick={() => connectHardware('KEYBOARD', 'BARCODE_SCANNER')} className="rounded-lg border-2 border-blue-700 bg-blue-700 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                       USB scanner
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.camera} onClick={() => connectHardware('CAMERA', 'BARCODE_SCANNER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Camera
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webSerial} onClick={() => connectHardware('SERIAL', 'BARCODE_SCANNER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Serial
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webHid} onClick={() => connectHardware('HID', 'BARCODE_SCANNER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       HID
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webBluetooth} onClick={() => connectHardware('BLUETOOTH', 'BARCODE_SCANNER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Bluetooth
                     </button>
                   </div>
                 </div>

                 <div className="rounded-lg border border-slate-300 bg-slate-50/70 p-4">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex min-w-0 items-center gap-3">
                       <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700">
                         <Usb size={20} />
                       </div>
                       <div className="min-w-0">
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cash drawer</p>
                         <p className="truncate text-sm font-bold text-slate-950">{assignedDrawer?.deviceName || (directPrinterReady ? 'Through receipt printer' : 'Not connected')}</p>
                       </div>
                     </div>
                     {assignedDrawer && (
                       <button type="button" onClick={() => clearDeviceRole('CASH_DRAWER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
                         Clear
                       </button>
                     )}
                   </div>
                   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                     <button
                       type="button"
                       disabled={isHardwareBusy || !directPrinterReady}
                       onClick={() => {
                         if (!assignedPrinter || isChromePrinter) return;
                         setHardwareAssignments(saveHardwareAssignment({
                           key: assignedPrinter.deviceKey,
                           transport: assignedPrinter.transport,
                           name: assignedPrinter.deviceName,
                           vendorId: assignedPrinter.vendorId,
                           productId: assignedPrinter.productId,
                           granted: true,
                         }, 'CASH_DRAWER'));
                         success('Cash drawer linked to receipt printer.');
                       }}
                       className="rounded-lg border-2 border-blue-700 bg-blue-700 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                     >
                       Printer pulse
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webUsb} onClick={() => connectHardware('USB', 'CASH_DRAWER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       USB
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webSerial} onClick={() => connectHardware('SERIAL', 'CASH_DRAWER')} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Serial
                     </button>
                     <button type="button" disabled={isHardwareBusy || (!assignedDrawer && !directPrinterReady)} onClick={handleOpenDrawer} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Open
                     </button>
                   </div>
                 </div>

                 {hardwareMessage && (
                   <div className="rounded-lg border border-slate-300 bg-slate-50 p-3 text-[11px] font-bold leading-relaxed text-slate-700">
                     {hardwareMessage}
                   </div>
                 )}
               </div>
            </div>

            <div className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
               <h3 className="mb-5 flex items-center gap-2 text-base font-black text-slate-950">
                  <ShieldCheck className="text-blue-700" /> Owner mode
               </h3>

               <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setOwnerSettings(prev => ({ ...prev, ownerModeEnabled: !prev.ownerModeEnabled }))}
                    className={`flex w-full items-center justify-between gap-4 rounded-lg border-2 p-4 transition-colors ${ownerSettings.ownerModeEnabled ? 'border-blue-700 bg-blue-50 text-slate-950' : 'border-slate-300 bg-slate-50 text-slate-700'}`}
                  >
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-widest">Solo operator</p>
                      <p className="text-xs font-bold mt-1">{ownerSettings.ownerModeEnabled ? 'Owner flow active' : 'Standard staff flow'}</p>
                    </div>
                    <div className={`flex h-7 w-12 rounded-full p-1 transition-all ${ownerSettings.ownerModeEnabled ? 'justify-end bg-blue-700' : 'justify-start bg-slate-300'}`}>
                      <span className="w-5 h-5 rounded-full bg-white shadow-sm" />
                    </div>
                  </button>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setOwnerSettings(prev => ({ ...prev, autoApproveOwnerActions: !prev.autoApproveOwnerActions }))}
                      disabled={!ownerSettings.ownerModeEnabled}
                      className={`rounded-lg border-2 p-4 text-left transition-colors disabled:opacity-40 ${ownerSettings.autoApproveOwnerActions ? 'border-blue-700 bg-blue-50 text-slate-950' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {ownerSettings.autoApproveOwnerActions ? <Check size={16} /> : <X size={16} />}
                        <p className="text-[9px] font-black uppercase tracking-widest">Auto approve</p>
                      </div>
                      <p className="text-xs font-bold leading-snug">Owner expenses, returns, and orders</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setOwnerSettings(prev => ({ ...prev, cashSweepEnabled: !prev.cashSweepEnabled }))}
                      disabled={!ownerSettings.ownerModeEnabled}
                      className={`rounded-lg border-2 p-4 text-left transition-colors disabled:opacity-40 ${ownerSettings.cashSweepEnabled ? 'border-blue-700 bg-blue-50 text-slate-950' : 'border-slate-200 bg-white text-slate-600'}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {ownerSettings.cashSweepEnabled ? <Check size={16} /> : <X size={16} />}
                        <p className="text-[9px] font-black uppercase tracking-widest">Cash sweep</p>
                      </div>
                      <p className="text-xs font-bold leading-snug">Dashboard banking shortcut</p>
                    </button>
                  </div>

                  <div className="pt-1">
                    <div>
                      <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Drawer limit</label>
                      <input
                        type="number"
                        value={ownerSettings.cashDrawerLimit}
                        onChange={e => setOwnerSettings(prev => ({ ...prev, cashDrawerLimit: e.target.value }))}
                        className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isUpdating}
                    className="flex w-full items-center justify-center gap-3 rounded-lg border-2 border-blue-700 bg-blue-700 py-4 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-blue-800 disabled:opacity-50"
                  >
                    {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
                    Save owner mode
                  </button>
               </div>
            </div>

            <div className="flex items-center gap-4 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
               <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
                  <ShieldCheck size={20} />
               </div>
               <div>
                  <h4 className="text-base font-black leading-tight text-slate-950">Access</h4>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {isAdmin ? 'Administrator' : 'Standard user'}
                  </p>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}
