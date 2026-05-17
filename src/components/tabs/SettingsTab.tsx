import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, RefreshCcw, Download, ChevronDown, ScanLine, Printer, Usb, SlidersHorizontal, Building2, Terminal, ShieldAlert, Cpu, Check, Activity, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_CASH_DRAWER_LIMIT, DEFAULT_CASH_FLOAT_TARGET } from '../../utils/ownerMode';
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


export default function SettingsTab({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const isAdmin = useStore((state) => state.isAdmin);
  const activeBusinessId = useStore((state) => state.activeBusinessId);
  const { success, warning, error } = useToast();
  
  const savedSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId], null);
  const [storeSettings, setStoreSettings] = useState({
     storeName: 'Mtaani Shop', krapin: 'P0000000000A', tillNumber: '123456', receiptFooter: 'Thank you for shopping!', location: 'Nairobi, Kenya'
  });
  const [ownerSettings, setOwnerSettings] = useState({
    ownerModeEnabled: false,
    autoApproveOwnerActions: true,
    cashSweepEnabled: true,
    cashDrawerLimit: String(DEFAULT_CASH_DRAWER_LIMIT),
    cashFloatTarget: String(DEFAULT_CASH_FLOAT_TARGET),
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [openSection, setOpenSection] = useState<'IDENTITY' | 'HARDWARE' | 'SYSTEM' | 'SECURITY'>('IDENTITY');
  const [openHardwareSub, setOpenHardwareSub] = useState<'SCANNER' | 'PRINTER' | 'DRAWER'>('SCANNER');
  const [hardwareDevices, setHardwareDevices] = useState<HardwareDeviceSummary[]>([]);
  const [hardwareAssignments, setHardwareAssignments] = useState(loadHardwareAssignments());
  const [hardwareSupport, setHardwareSupport] = useState<HardwareSupport>(() => getHardwareSupport());
  const [isHardwareBusy, setIsHardwareBusy] = useState(false);
  const [hardwareMessage, setHardwareMessage] = useState('');
  const [hardwareProfile, setHardwareProfile] = useState({
    scannerMode: 'KEYBOARD_WEDGE',
    scannerDebounceMs: 120,
    scannerSuffix: 'ENTER',
    printerType: 'THERMAL_80',
    printerConnection: 'USB',
    autoPrintReceipt: true,
    cashDrawerTrigger: 'RECEIPT_PRINT',
    windowsDriverName: 'EPSON TM-T20X',
  });

  useEffect(() => {
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
          cashFloatTarget: String(savedSettings.cashFloatTarget ?? DEFAULT_CASH_FLOAT_TARGET),
        });
     }
  }, [savedSettings]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('mtaani_hardware_profile_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setHardwareProfile(prev => ({ ...prev, ...parsed }));
    } catch (err) {
      console.warn('Failed to load hardware profile', err);
    }
  }, []);

  const activeHardwareRole: HardwareDeviceRole = openHardwareSub === 'PRINTER'
    ? 'RECEIPT_PRINTER'
    : openHardwareSub === 'DRAWER'
      ? 'CASH_DRAWER'
      : 'BARCODE_SCANNER';

  const refreshHardwareDevices = async (quiet = false) => {
    setIsHardwareBusy(true);
    try {
      setHardwareSupport(getHardwareSupport());
      const devices = await listGrantedHardwareDevices();
      setHardwareDevices(devices);
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
    role: HardwareDeviceRole = activeHardwareRole,
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
        setHardwareProfile(prev => ({ ...prev, printerConnection: 'BROWSER_PRINT', printerType: 'THERMAL_80' }));
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

  const assignDeviceRole = (device: HardwareDeviceSummary, role: HardwareDeviceRole) => {
    setHardwareAssignments(saveHardwareAssignment(device, role));
    setHardwareDevices(prev => prev.map(item => item.key === device.key && item.transport === device.transport ? { ...item, assignedRole: role } : item));
    success(`${device.name} assigned.`);
  };

  const clearDeviceRole = (role: HardwareDeviceRole) => {
    setHardwareAssignments(clearHardwareAssignment(role));
    setHardwareDevices(prev => prev.map(item => item.assignedRole === role ? { ...item, assignedRole: undefined } : item));
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
        await db.settings.put({
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
            cashFloatTarget: Number(ownerSettings.cashFloatTarget) || DEFAULT_CASH_FLOAT_TARGET,
            businessId: activeBusinessId!,
        });
        success("Business settings saved.");
      } catch (err) {
        console.error(err);
      } finally {
        setIsUpdating(false);
      }
  };

  const saveHardware = () => {
    localStorage.setItem('mtaani_hardware_profile_v1', JSON.stringify(hardwareProfile));
    success('Hardware profile saved for this browser terminal.');
  };

  const assignedScanner = hardwareAssignments.find(item => item.role === 'BARCODE_SCANNER');
  const assignedPrinter = hardwareAssignments.find(item => item.role === 'RECEIPT_PRINTER');
  const assignedDrawer = hardwareAssignments.find(item => item.role === 'CASH_DRAWER');
  const isChromePrinter = assignedPrinter?.transport === 'BROWSER_PRINT';
  const directPrinterReady = !!assignedPrinter && !isChromePrinter;
  const activeAssignment = hardwareAssignments.find(item => item.role === activeHardwareRole);
  const roleCopy: Record<HardwareDeviceRole, string> = {
    BARCODE_SCANNER: 'barcode scanner',
    RECEIPT_PRINTER: 'receipt printer',
    CASH_DRAWER: 'cash drawer',
  };
  const supportItems = [
    { label: 'Secure', ok: hardwareSupport.secureContext },
    { label: 'USB', ok: hardwareSupport.webUsb },
    { label: 'Serial', ok: hardwareSupport.webSerial },
    { label: 'HID', ok: hardwareSupport.webHid },
    { label: 'Bluetooth', ok: hardwareSupport.webBluetooth },
    { label: 'Camera', ok: hardwareSupport.camera },
  ];

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-black text-slate-900">System settings</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">Business info</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">Hardware profile</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">App version</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         
         {/* Left: Business Info */}
         <div className="space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <Building2 className="text-indigo-600" /> Business info
               </h3>
               <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Business name</label>
                    <input type="text" value={storeSettings.storeName} onChange={e => setStoreSettings({...storeSettings, storeName: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">KRA PIN / tax ID</label>
                       <input type="text" value={storeSettings.krapin} onChange={e => setStoreSettings({...storeSettings, krapin: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                     </div>
                     <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Location</label>
                       <input type="text" value={storeSettings.location} onChange={e => setStoreSettings({...storeSettings, location: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                     </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Receipt footer</label>
                    <input type="text" value={storeSettings.receiptFooter} onChange={e => setStoreSettings({...storeSettings, receiptFooter: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                  </div>
                  
                  <button 
                    onClick={handleSaveSettings} 
                    disabled={isUpdating}
                    className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl press flex items-center justify-center gap-3 disabled:opacity-50 mt-4"
                  >
                     {isUpdating ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
                     Save settings
                  </button>
               </div>
            </div>

            {/* System Updates */}
            <div className="bg-slate-900 p-8 rounded-[2.5rem] border-2 border-slate-800 text-white relative overflow-hidden group">
               <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div>
                      <h4 className="text-base font-bold leading-tight">Software updates</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        Status: {needRefresh ? 'Update ready' : 'App is up to date'}
                      </p>
                  </div>
                  <button 
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className={`flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all press shadow-lg ${needRefresh ? 'bg-indigo-600 text-white shadow-indigo' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}
                  >
                    {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Download size={16} />}
                    {needRefresh ? 'Update now' : 'Check for updates'}
                  </button>
               </div>
               <RefreshCcw className="absolute -right-8 -bottom-8 w-40 h-40 text-slate-800 opacity-20 group-hover:rotate-45 transition-transform duration-1000" />
            </div>
         </div>

         {/* Right: Hardware & Security */}
         <div className="space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <Terminal className="text-indigo-600" /> Hardware settings
               </h3>
               <div className="space-y-4">
                 <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex min-w-0 items-center gap-3">
                       <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm">
                         <Printer size={20} />
                       </div>
                       <div className="min-w-0">
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Printer</p>
                         <p className="truncate text-sm font-black text-slate-900">{assignedPrinter?.deviceName || 'Not connected'}</p>
                       </div>
                     </div>
                     {assignedPrinter && (
                       <button type="button" onClick={() => clearDeviceRole('RECEIPT_PRINTER')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
                         Clear
                       </button>
                     )}
                   </div>
                   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                     <button type="button" disabled={isHardwareBusy} onClick={() => connectHardware('BROWSER_PRINT', 'RECEIPT_PRINTER')} className="rounded-xl bg-slate-900 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                       Chrome printer
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webUsb} onClick={() => connectHardware('USB', 'RECEIPT_PRINTER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       USB thermal
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webSerial} onClick={() => connectHardware('SERIAL', 'RECEIPT_PRINTER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Serial
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webBluetooth} onClick={() => connectHardware('BLUETOOTH', 'RECEIPT_PRINTER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Bluetooth
                     </button>
                     <button type="button" disabled={isHardwareBusy || !directPrinterReady} onClick={handleTestPrint} className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-indigo-700 disabled:opacity-40">
                       Test
                     </button>
                   </div>
                 </div>

                 <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex min-w-0 items-center gap-3">
                       <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm">
                         <ScanLine size={20} />
                       </div>
                       <div className="min-w-0">
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scanner</p>
                         <p className="truncate text-sm font-black text-slate-900">{assignedScanner?.deviceName || 'Not connected'}</p>
                       </div>
                     </div>
                     {assignedScanner && (
                       <button type="button" onClick={() => clearDeviceRole('BARCODE_SCANNER')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
                         Clear
                       </button>
                     )}
                   </div>
                   <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                     <button type="button" disabled={isHardwareBusy} onClick={() => connectHardware('KEYBOARD', 'BARCODE_SCANNER')} className="rounded-xl bg-slate-900 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-50">
                       USB scanner
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.camera} onClick={() => connectHardware('CAMERA', 'BARCODE_SCANNER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Camera
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webSerial} onClick={() => connectHardware('SERIAL', 'BARCODE_SCANNER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Serial
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webHid} onClick={() => connectHardware('HID', 'BARCODE_SCANNER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       HID
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webBluetooth} onClick={() => connectHardware('BLUETOOTH', 'BARCODE_SCANNER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Bluetooth
                     </button>
                   </div>
                 </div>

                 <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                   <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                     <div className="flex min-w-0 items-center gap-3">
                       <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-amber-600 shadow-sm">
                         <Usb size={20} />
                       </div>
                       <div className="min-w-0">
                         <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Drawer</p>
                         <p className="truncate text-sm font-black text-slate-900">{assignedDrawer?.deviceName || (directPrinterReady ? 'Through receipt printer' : 'Not connected')}</p>
                       </div>
                     </div>
                     {assignedDrawer && (
                       <button type="button" onClick={() => clearDeviceRole('CASH_DRAWER')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500">
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
                       className="rounded-xl bg-slate-900 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-white disabled:opacity-40"
                     >
                       Printer pulse
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webUsb} onClick={() => connectHardware('USB', 'CASH_DRAWER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       USB
                     </button>
                     <button type="button" disabled={isHardwareBusy || !hardwareSupport.webSerial} onClick={() => connectHardware('SERIAL', 'CASH_DRAWER')} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-[9px] font-black uppercase tracking-widest text-slate-700 disabled:opacity-40">
                       Serial
                     </button>
                     <button type="button" disabled={isHardwareBusy || (!assignedDrawer && !directPrinterReady)} onClick={handleOpenDrawer} className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-[9px] font-black uppercase tracking-widest text-emerald-700 disabled:opacity-40">
                       Open
                     </button>
                   </div>
                 </div>

                 {hardwareMessage && (
                   <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-800">
                     {hardwareMessage}
                   </div>
                 )}
               </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <ShieldCheck className="text-emerald-600" /> Owner mode
               </h3>

               <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setOwnerSettings(prev => ({ ...prev, ownerModeEnabled: !prev.ownerModeEnabled }))}
                    className={`w-full flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-all ${ownerSettings.ownerModeEnabled ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-100 text-slate-600'}`}
                  >
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-widest">Solo operator</p>
                      <p className="text-xs font-bold mt-1">{ownerSettings.ownerModeEnabled ? 'Owner flow active' : 'Standard staff flow'}</p>
                    </div>
                    <div className={`w-12 h-7 rounded-full p-1 flex transition-all ${ownerSettings.ownerModeEnabled ? 'bg-emerald-600 justify-end' : 'bg-slate-300 justify-start'}`}>
                      <span className="w-5 h-5 rounded-full bg-white shadow-sm" />
                    </div>
                  </button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setOwnerSettings(prev => ({ ...prev, autoApproveOwnerActions: !prev.autoApproveOwnerActions }))}
                      disabled={!ownerSettings.ownerModeEnabled}
                      className={`p-4 rounded-2xl border-2 text-left transition-all disabled:opacity-40 ${ownerSettings.autoApproveOwnerActions ? 'bg-blue-50 border-blue-100 text-blue-900' : 'bg-white border-slate-100 text-slate-500'}`}
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
                      className={`p-4 rounded-2xl border-2 text-left transition-all disabled:opacity-40 ${ownerSettings.cashSweepEnabled ? 'bg-amber-50 border-amber-100 text-amber-900' : 'bg-white border-slate-100 text-slate-500'}`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {ownerSettings.cashSweepEnabled ? <Check size={16} /> : <X size={16} />}
                        <p className="text-[9px] font-black uppercase tracking-widest">Cash sweep</p>
                      </div>
                      <p className="text-xs font-bold leading-snug">Dashboard banking shortcut</p>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Drawer limit</label>
                      <input
                        type="number"
                        value={ownerSettings.cashDrawerLimit}
                        onChange={e => setOwnerSettings(prev => ({ ...prev, cashDrawerLimit: e.target.value }))}
                        className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Keep float</label>
                      <input
                        type="number"
                        value={ownerSettings.cashFloatTarget}
                        onChange={e => setOwnerSettings(prev => ({ ...prev, cashFloatTarget: e.target.value }))}
                        className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none shadow-sm"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isUpdating}
                    className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-emerald press flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
                    Save owner mode
                  </button>
               </div>
            </div>

            <div className="bg-rose-50 p-8 rounded-[2.5rem] border-2 border-rose-100 flex items-center gap-6">
               <div className="w-16 h-16 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-rose shrink-0">
                  <ShieldAlert size={32} />
               </div>
               <div>
                  <h4 className="text-base font-black text-rose-900 leading-tight">Safety settings</h4>
                  <p className="text-[10px] font-bold text-rose-600/60 uppercase tracking-widest mt-1">
                    Environment: {isAdmin ? 'Root administrator' : 'Standard user'} access
                  </p>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}
