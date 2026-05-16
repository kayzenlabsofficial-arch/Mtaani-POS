import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, RefreshCcw, Download, ChevronDown, ScanLine, Printer, Usb, SlidersHorizontal, Building2, Terminal, ShieldAlert, Cpu, Check, Activity, X, Bot } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_CASH_DRAWER_LIMIT, DEFAULT_CASH_FLOAT_TARGET } from '../../utils/ownerMode';
import { getBusinessSettings, settingsIdForBusiness } from '../../utils/settings';


export default function SettingsTab({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const isAdmin = useStore((state) => state.isAdmin);
  const activeBusinessId = useStore((state) => state.activeBusinessId);
  const { success } = useToast();
  
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
  const [aiSettings, setAiSettings] = useState({
    aiAssistantEnabled: true,
    aiDailyRequestLimit: '20',
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
        setOwnerSettings({
          ownerModeEnabled: savedSettings.ownerModeEnabled === 1,
          autoApproveOwnerActions: savedSettings.autoApproveOwnerActions !== 0,
          cashSweepEnabled: savedSettings.cashSweepEnabled !== 0,
          cashDrawerLimit: String(savedSettings.cashDrawerLimit ?? DEFAULT_CASH_DRAWER_LIMIT),
          cashFloatTarget: String(savedSettings.cashFloatTarget ?? DEFAULT_CASH_FLOAT_TARGET),
        });
        setAiSettings({
          aiAssistantEnabled: savedSettings.aiAssistantEnabled !== 0,
          aiDailyRequestLimit: String(savedSettings.aiDailyRequestLimit ?? 20),
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
            aiAssistantEnabled: aiSettings.aiAssistantEnabled ? 1 : 0,
            aiDailyRequestLimit: Math.min(200, Math.max(1, Number(aiSettings.aiDailyRequestLimit) || 20)),
            businessId: activeBusinessId!,
        });
        success("Business configuration saved successfully!");
      } catch (err) {
        console.error(err);
      } finally {
        setIsUpdating(false);
      }
  };

  const saveHardware = () => {
    localStorage.setItem('mtaani_hardware_profile_v1', JSON.stringify(hardwareProfile));
    success('Hardware profile saved for this Windows terminal.');
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h2 className="text-xl font-black text-slate-900">System Settings</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">Business Identity</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">Hardware Profile</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Enterprise Runtime</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         
         {/* Left: Business Identity */}
         <div className="space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <Building2 className="text-indigo-600" /> Business Info
               </h3>
               <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Business Name</label>
                    <input type="text" value={storeSettings.storeName} onChange={e => setStoreSettings({...storeSettings, storeName: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">KRA PIN / Tax ID</label>
                       <input type="text" value={storeSettings.krapin} onChange={e => setStoreSettings({...storeSettings, krapin: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                     </div>
                     <div>
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Location</label>
                       <input type="text" value={storeSettings.location} onChange={e => setStoreSettings({...storeSettings, location: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                     </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Receipt Footer</label>
                    <input type="text" value={storeSettings.receiptFooter} onChange={e => setStoreSettings({...storeSettings, receiptFooter: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                  </div>
                  
                  <button 
                    onClick={handleSaveSettings} 
                    disabled={isUpdating}
                    className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl press flex items-center justify-center gap-3 disabled:opacity-50 mt-4"
                  >
                     {isUpdating ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
                     Save Settings
                  </button>
               </div>
            </div>

            {/* System Update Node */}
            <div className="bg-slate-900 p-8 rounded-[2.5rem] border-2 border-slate-800 text-white relative overflow-hidden group">
               <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div>
                      <h4 className="text-base font-bold leading-tight">Software Updates</h4>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                        Status: {needRefresh ? 'Critical Update Pending' : 'Enterprise v2.4 Certified'}
                      </p>
                  </div>
                  <button 
                    onClick={handleUpdate}
                    disabled={isUpdating}
                    className={`flex items-center gap-3 px-6 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all press shadow-lg ${needRefresh ? 'bg-indigo-600 text-white shadow-indigo' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}
                  >
                    {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Download size={16} />}
                    {needRefresh ? 'Update Now' : 'Check for Updates'}
                  </button>
               </div>
               <RefreshCcw className="absolute -right-8 -bottom-8 w-40 h-40 text-slate-800 opacity-20 group-hover:rotate-45 transition-transform duration-1000" />
            </div>
         </div>

         {/* Right: Hardware & Security */}
         <div className="space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <Terminal className="text-indigo-600" /> Hardware Settings
               </h3>
               
               <div className="flex bg-slate-50 p-2 rounded-2xl border-2 border-slate-100 mb-6">
                  {[
                    { id: 'SCANNER', label: 'Scanner', icon: ScanLine },
                    { id: 'PRINTER', label: 'Printer', icon: Printer },
                    { id: 'DRAWER', label: 'Drawer', icon: Usb }
                  ].map(tab => (
                    <button 
                      key={tab.id}
                      onClick={() => setOpenHardwareSub(tab.id as any)}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${openHardwareSub === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                    >
                      <tab.icon size={14} /> {tab.label}
                    </button>
                  ))}
               </div>

               <div className="space-y-6 min-h-[300px]">
                  {openHardwareSub === 'SCANNER' && (
                    <div className="animate-in slide-in-from-bottom-2">
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Scanner Mode</label>
                       <select value={hardwareProfile.scannerMode} onChange={e => setHardwareProfile({ ...hardwareProfile, scannerMode: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm mb-6">
                         <option value="KEYBOARD_WEDGE">Standard Scanner (USB)</option>
                         <option value="CAMERA">Use Camera</option>
                       </select>
                       
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Scanner Speed (ms)</label>
                       <input type="number" value={hardwareProfile.scannerDebounceMs} onChange={e => setHardwareProfile({ ...hardwareProfile, scannerDebounceMs: Number(e.target.value) || 120 })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" />
                    </div>
                  )}

                  {openHardwareSub === 'PRINTER' && (
                    <div className="animate-in slide-in-from-bottom-2">
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Printer Name</label>
                       <input type="text" value={hardwareProfile.windowsDriverName} onChange={e => setHardwareProfile({ ...hardwareProfile, windowsDriverName: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm mb-6" placeholder="e.g. EPSON TM-T20X" />
                       
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Paper Size</label>
                       <select value={hardwareProfile.printerType} onChange={e => setHardwareProfile({ ...hardwareProfile, printerType: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm">
                         <option value="THERMAL_80">Standard Thermal 80mm</option>
                         <option value="A4">A4 Office / Laser</option>
                       </select>
                    </div>
                  )}

                  {openHardwareSub === 'DRAWER' && (
                    <div className="animate-in slide-in-from-bottom-2">
                       <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Cash Drawer</label>
                       <select value={hardwareProfile.cashDrawerTrigger} onChange={e => setHardwareProfile({ ...hardwareProfile, cashDrawerTrigger: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm">
                         <option value="RECEIPT_PRINT">Open on Sale</option>
                         <option value="MANUAL_ONLY">Admin Only</option>
                       </select>
                    </div>
                  )}
               </div>

               <button
                 onClick={saveHardware}
                 className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-indigo press flex items-center justify-center gap-3 mt-8"
               >
                 <Usb size={18} /> Save Hardware Settings
               </button>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <ShieldCheck className="text-emerald-600" /> Owner Mode
               </h3>

               <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setOwnerSettings(prev => ({ ...prev, ownerModeEnabled: !prev.ownerModeEnabled }))}
                    className={`w-full flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-all ${ownerSettings.ownerModeEnabled ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-100 text-slate-600'}`}
                  >
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-widest">Solo Operator</p>
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
                        <p className="text-[9px] font-black uppercase tracking-widest">Auto Approve</p>
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
                        <p className="text-[9px] font-black uppercase tracking-widest">Cash Sweep</p>
                      </div>
                      <p className="text-xs font-bold leading-snug">Dashboard banking shortcut</p>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Drawer Limit</label>
                      <input
                        type="number"
                        value={ownerSettings.cashDrawerLimit}
                        onChange={e => setOwnerSettings(prev => ({ ...prev, cashDrawerLimit: e.target.value }))}
                        className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none shadow-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Keep Float</label>
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
                    Save Owner Mode
                  </button>
               </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-bold text-slate-900 mb-6 flex items-center gap-2">
                  <Bot className="text-blue-600" /> AI Assistant
               </h3>

               <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setAiSettings(prev => ({ ...prev, aiAssistantEnabled: !prev.aiAssistantEnabled }))}
                    className={`w-full flex items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-all ${aiSettings.aiAssistantEnabled ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-slate-50 border-slate-100 text-slate-600'}`}
                  >
                    <div className="text-left">
                      <p className="text-[10px] font-black uppercase tracking-widest">POS AI Access</p>
                      <p className="text-xs font-bold mt-1">{aiSettings.aiAssistantEnabled ? 'Floating assistant enabled' : 'Assistant disabled for staff'}</p>
                    </div>
                    <div className={`w-12 h-7 rounded-full p-1 flex transition-all ${aiSettings.aiAssistantEnabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'}`}>
                      <span className="w-5 h-5 rounded-full bg-white shadow-sm" />
                    </div>
                  </button>

                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-2">Daily Requests Per User</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={aiSettings.aiDailyRequestLimit}
                      onChange={e => setAiSettings(prev => ({ ...prev, aiDailyRequestLimit: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none shadow-sm"
                    />
                  </div>

                  <button
                    onClick={handleSaveSettings}
                    disabled={isUpdating}
                    className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-blue press flex items-center justify-center gap-3 disabled:opacity-50"
                  >
                    {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
                    Save AI Limit
                  </button>
               </div>
            </div>

            <div className="bg-rose-50 p-8 rounded-[2.5rem] border-2 border-rose-100 flex items-center gap-6">
               <div className="w-16 h-16 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-rose shrink-0">
                  <ShieldAlert size={32} />
               </div>
               <div>
                  <h4 className="text-base font-black text-rose-900 leading-tight">Hardened Policy Node</h4>
                  <p className="text-[10px] font-bold text-rose-600/60 uppercase tracking-widest mt-1">
                    Environment: {isAdmin ? 'Root Administrator' : 'Standard User'} Access
                  </p>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}
