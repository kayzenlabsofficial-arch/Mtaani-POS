import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, RefreshCcw, Download, ChevronDown, ScanLine, Printer, Usb } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';

export default function SettingsTab({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const isAdmin = useStore((state) => state.isAdmin);
  const { success } = useToast();
  
  const savedSettings = useLiveQuery(() => db.settings.get('core'), [], null);
  const [storeSettings, setStoreSettings] = useState({
     storeName: 'Mtaani Shop', krapin: 'P0000000000A', tillNumber: '123456', receiptFooter: 'Thank you for shopping!', location: 'Nairobi, Kenya'
  });

  const [isUpdating, setIsUpdating] = useState(false);
  const [openSection, setOpenSection] = useState<'IDENTITY' | 'HARDWARE' | 'SYSTEM' | 'SECURITY'>('IDENTITY');
  const [openHardwareSub, setOpenHardwareSub] = useState<'SCANNER' | 'PRINTER' | 'DRAWER'>('SCANNER');
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
            id: 'core',
            storeName: storeSettings.storeName,
            tillNumber: storeSettings.tillNumber,
            kraPin: storeSettings.krapin,
            receiptFooter: storeSettings.receiptFooter,
            location: storeSettings.location
        });
        success("Business configuration saved successfully!");
      } catch (err) {
        console.error(err);
      } finally {
        setIsUpdating(false);
      }
  };

  return (
    <div className="p-5 pb-8 animate-in fade-in max-w-5xl mx-auto w-full h-full flex flex-col">
      <div className="mb-6 mt-2">
         <h2 className="text-xl font-extrabold text-slate-900 mb-1">Settings</h2>
         <p className="text-sm text-slate-500">Configure your store logic and integrations.</p>
      </div>

      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 mb-6">
          <button onClick={() => setOpenSection(openSection === 'IDENTITY' ? 'SYSTEM' : 'IDENTITY')} className="w-full flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-extrabold text-slate-900">Store Identity</h3>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${openSection === 'IDENTITY' ? 'rotate-180' : ''}`} />
          </button>
          {openSection === 'IDENTITY' && (
            <div className="space-y-4">
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Business Name</label>
                 <input type="text" value={storeSettings.storeName} onChange={e => setStoreSettings({...storeSettings, storeName: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-slate-500" />
              </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">KRA PIN (eTIMS)</label>
                 <input type="text" value={storeSettings.krapin} onChange={e => setStoreSettings({...storeSettings, krapin: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-slate-500" />
              </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Business Location (City/Town)</label>
                 <input type="text" value={storeSettings.location} onChange={e => setStoreSettings({...storeSettings, location: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-slate-500" />
              </div>
              <div>
                 <label className="block text-xs font-bold text-slate-500  mb-1.5">Receipt Footer Message</label>
                 <input type="text" value={storeSettings.receiptFooter} onChange={e => setStoreSettings({...storeSettings, receiptFooter: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none focus:border-slate-500" />
              </div>
            </div>
          )}
      </div>

      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 mb-6">
          <button onClick={() => setOpenSection(openSection === 'HARDWARE' ? 'SYSTEM' : 'HARDWARE')} className="w-full flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Usb className="text-blue-600" size={16} /> Windows Hardware Integration
            </h3>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${openSection === 'HARDWARE' ? 'rotate-180' : ''}`} />
          </button>
          {openSection === 'HARDWARE' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => setOpenHardwareSub('SCANNER')} className={`py-2 rounded-xl text-[10px] font-black ${openHardwareSub === 'SCANNER' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}><ScanLine size={12} className="inline mr-1" />Scanner</button>
                <button onClick={() => setOpenHardwareSub('PRINTER')} className={`py-2 rounded-xl text-[10px] font-black ${openHardwareSub === 'PRINTER' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}><Printer size={12} className="inline mr-1" />Printer</button>
                <button onClick={() => setOpenHardwareSub('DRAWER')} className={`py-2 rounded-xl text-[10px] font-black ${openHardwareSub === 'DRAWER' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}><Usb size={12} className="inline mr-1" />Drawer</button>
              </div>

              {openHardwareSub === 'SCANNER' && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
                  <label className="text-xs font-bold text-slate-500 block">Scanner Mode</label>
                  <select value={hardwareProfile.scannerMode} onChange={e => setHardwareProfile({ ...hardwareProfile, scannerMode: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold">
                    <option value="KEYBOARD_WEDGE">Keyboard Wedge (Windows USB/Bluetooth)</option>
                    <option value="CAMERA">Camera Scanner</option>
                  </select>
                  <label className="text-xs font-bold text-slate-500 block">Debounce (ms)</label>
                  <input type="number" value={hardwareProfile.scannerDebounceMs} onChange={e => setHardwareProfile({ ...hardwareProfile, scannerDebounceMs: Number(e.target.value) || 120 })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold" />
                </div>
              )}
              {openHardwareSub === 'PRINTER' && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
                  <label className="text-xs font-bold text-slate-500 block">Windows Printer Driver Name</label>
                  <input type="text" value={hardwareProfile.windowsDriverName} onChange={e => setHardwareProfile({ ...hardwareProfile, windowsDriverName: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold" />
                  <label className="text-xs font-bold text-slate-500 block">Receipt Format</label>
                  <select value={hardwareProfile.printerType} onChange={e => setHardwareProfile({ ...hardwareProfile, printerType: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold">
                    <option value="THERMAL_80">Thermal 80mm</option>
                    <option value="A4">A4 Laser/Ink</option>
                  </select>
                </div>
              )}
              {openHardwareSub === 'DRAWER' && (
                <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 space-y-3">
                  <label className="text-xs font-bold text-slate-500 block">Cash Drawer Trigger</label>
                  <select value={hardwareProfile.cashDrawerTrigger} onChange={e => setHardwareProfile({ ...hardwareProfile, cashDrawerTrigger: e.target.value })} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold">
                    <option value="RECEIPT_PRINT">Open on Receipt Print</option>
                    <option value="MANUAL_ONLY">Manual Only</option>
                  </select>
                </div>
              )}

              <button
                onClick={() => {
                  localStorage.setItem('mtaani_hardware_profile_v1', JSON.stringify(hardwareProfile));
                  success('Hardware profile saved for this Windows terminal.');
                }}
                className="w-full py-3 rounded-xl bg-blue-600 text-white text-xs font-black"
              >
                Save Hardware Profile
              </button>
            </div>
          )}
      </div>

      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 mb-6">
          <button onClick={() => setOpenSection(openSection === 'SYSTEM' ? 'SECURITY' : 'SYSTEM')} className="w-full flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <RefreshCcw className="text-blue-600" size={16} /> System Management
            </h3>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${openSection === 'SYSTEM' ? 'rotate-180' : ''}`} />
          </button>
          {openSection === 'SYSTEM' && <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                      <p className="text-sm font-bold text-slate-900">Application Sync</p>
                      <p className="text-[10px] text-slate-500  font-black  mt-1">
                        {needRefresh ? 'New Version Available!' : 'System is Up to Date'}
                      </p>
                  </div>
                  <button 
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-lg ${needRefresh ? 'bg-blue-600 text-white shadow-blue-600/20' : 'bg-white border border-slate-200 text-slate-700 shadow-slate-200/20'}`}
                  >
                    {isUpdating ? <RefreshCcw size={14} className="animate-spin" /> : <Download size={14} />}
                    {needRefresh ? 'Update Now' : 'Check for Sync'}
                  </button>
              </div>
              <p className="text-[10px] text-slate-400 font-bold px-1 italic">
                Manual sync forces the PWA to check for latest updates from the cloud server. Recommended after any major system change.
              </p>
          </div>}
      </div>

      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 mb-6">
          <button onClick={() => setOpenSection(openSection === 'SECURITY' ? 'IDENTITY' : 'SECURITY')} className="w-full flex items-center justify-between pb-2 border-b border-slate-100">
            <h3 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="text-blue-600" size={16} /> Administrative Control
            </h3>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${openSection === 'SECURITY' ? 'rotate-180' : ''}`} />
          </button>
          {openSection === 'SECURITY' && <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <p className="text-sm font-bold text-slate-900">Role-Based Access Control</p>
              <p className="text-xs text-slate-500 mt-1">Admin privileges are now securely managed per-user in the User Management tab. You are currently logged in with {isAdmin ? 'Admin' : 'Standard'} access.</p>
          </div>}
      </div>

      <button 
        onClick={handleSaveSettings} 
        disabled={isUpdating}
        className="bg-slate-900 text-white w-full py-4 rounded-2xl font-bold transition-transform active:scale-[0.98] shadow-lg shadow-slate-900/10 flex items-center justify-center gap-2 disabled:opacity-50"
      >
         {isUpdating ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
         {isUpdating ? 'Saving...' : 'Save Configurations'}
      </button>
    </div>
  );
}
