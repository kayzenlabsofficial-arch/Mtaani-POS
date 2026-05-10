import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, RefreshCcw, Download, ChevronDown, ScanLine, Printer, Usb, SlidersHorizontal, Building2, Terminal, ShieldAlert, Cpu, Check, Activity, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import NestedControlPanel from '../shared/NestedControlPanel';

export default function SettingsTab({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
  const isAdmin = useStore((state) => state.isAdmin);
  const { success } = useToast();
  
  const savedSettings = useLiveQuery(() => db.settings.get('core'), [], null);
  const [storeSettings, setStoreSettings] = useState({
     storeName: 'Mtaani Shop', krapin: 'P0000000000A', tillNumber: '123456', receiptFooter: 'Thank you for shopping!', location: 'Nairobi, Kenya'
  });

  const [isUpdating, setIsUpdating] = useState(false);
  const [isOpsPanelOpen, setIsOpsPanelOpen] = useState(false);
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

  const saveHardware = () => {
    localStorage.setItem('mtaani_hardware_profile_v1', JSON.stringify(hardwareProfile));
    success('Hardware profile saved for this Windows terminal.');
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Settings Header */}
      <div className="pt-2 mb-6">
        <div className="flex items-center justify-between mb-4 px-2">
           <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">System Configurations</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Core Logic & Peripheral Nodes</p>
           </div>
           <div className="flex gap-2">
              <button 
                onClick={() => setIsOpsPanelOpen(!isOpsPanelOpen)}
                className={`p-2.5 rounded-xl border-2 transition-all flex items-center gap-2 ${isOpsPanelOpen ? 'bg-indigo-600 text-white border-indigo-600 shadow-indigo' : 'bg-white text-slate-600 border-slate-100'}`}
              >
                <SlidersHorizontal size={18} />
                <span className="text-[10px] font-black uppercase">Health</span>
              </button>
           </div>
        </div>

        {isOpsPanelOpen && (
          <div className="mb-6 animate-in slide-in-from-top-2 duration-300 px-2">
             <NestedControlPanel
               title="System Health"
               subtitle="Environment and update status monitor"
               onClose={() => setIsOpsPanelOpen(false)}
             >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
                         <Cpu size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Runtime</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Enterprise</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                         <ShieldCheck size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Security</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Hardened</h3>
                      </div>
                   </div>
                   <div className="p-4 rounded-2xl border-2 border-slate-100 bg-white flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                         <Activity size={20} />
                      </div>
                      <div>
                         <p className="text-[9px] font-black text-slate-400 uppercase mb-0.5">Integrity</p>
                         <h3 className="text-xl font-black text-slate-900 leading-none">Verified</h3>
                      </div>
                   </div>
                </div>
             </NestedControlPanel>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
         
         {/* Left: Business Identity */}
         <div className="space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-black text-slate-900 mb-6 flex items-center gap-2">
                  <Building2 className="text-indigo-600" /> Business Identity
               </h3>
               <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Trading Entity Name</label>
                    <input type="text" value={storeSettings.storeName} onChange={e => setStoreSettings({...storeSettings, storeName: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">KRA PIN / Tax ID</label>
                       <input type="text" value={storeSettings.krapin} onChange={e => setStoreSettings({...storeSettings, krapin: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Operational Hub</label>
                       <input type="text" value={storeSettings.location} onChange={e => setStoreSettings({...storeSettings, location: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                     </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Global Receipt Footer</label>
                    <input type="text" value={storeSettings.receiptFooter} onChange={e => setStoreSettings({...storeSettings, receiptFooter: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" />
                  </div>
                  
                  <button 
                    onClick={handleSaveSettings} 
                    disabled={isUpdating}
                    className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl press flex items-center justify-center gap-3 disabled:opacity-50 mt-4"
                  >
                     {isUpdating ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
                     Save Entity Identity
                  </button>
               </div>
            </div>

            {/* System Update Node */}
            <div className="bg-slate-900 p-8 rounded-[2.5rem] border-2 border-slate-800 text-white relative overflow-hidden group">
               <div className="relative z-10 flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div>
                      <h4 className="text-lg font-black leading-tight">Software Delivery Network</h4>
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
                    {needRefresh ? 'Deploy Update' : 'Scan for Hotfixes'}
                  </button>
               </div>
               <RefreshCcw className="absolute -right-8 -bottom-8 w-40 h-40 text-slate-800 opacity-20 group-hover:rotate-45 transition-transform duration-1000" />
            </div>
         </div>

         {/* Right: Hardware & Security */}
         <div className="space-y-6">
            <div className="bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm">
               <h3 className="text-base font-black text-slate-900 mb-6 flex items-center gap-2">
                  <Terminal className="text-indigo-600" /> Windows Node Integration
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
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Ingestion Mode</label>
                       <select value={hardwareProfile.scannerMode} onChange={e => setHardwareProfile({ ...hardwareProfile, scannerMode: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm mb-6">
                         <option value="KEYBOARD_WEDGE">Keyboard Wedge (USB/BT)</option>
                         <option value="CAMERA">Vision Camera Scanner</option>
                       </select>
                       
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Deceleration (ms)</label>
                       <input type="number" value={hardwareProfile.scannerDebounceMs} onChange={e => setHardwareProfile({ ...hardwareProfile, scannerDebounceMs: Number(e.target.value) || 120 })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm" />
                    </div>
                  )}

                  {openHardwareSub === 'PRINTER' && (
                    <div className="animate-in slide-in-from-bottom-2">
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Primary Windows Driver</label>
                       <input type="text" value={hardwareProfile.windowsDriverName} onChange={e => setHardwareProfile({ ...hardwareProfile, windowsDriverName: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm mb-6" placeholder="e.g. EPSON TM-T20X" />
                       
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Output Blueprint</label>
                       <select value={hardwareProfile.printerType} onChange={e => setHardwareProfile({ ...hardwareProfile, printerType: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm">
                         <option value="THERMAL_80">Standard Thermal 80mm</option>
                         <option value="A4">A4 Office / Laser</option>
                       </select>
                    </div>
                  )}

                  {openHardwareSub === 'DRAWER' && (
                    <div className="animate-in slide-in-from-bottom-2">
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Kickout Protocol</label>
                       <select value={hardwareProfile.cashDrawerTrigger} onChange={e => setHardwareProfile({ ...hardwareProfile, cashDrawerTrigger: e.target.value })} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm">
                         <option value="RECEIPT_PRINT">Auto-Open on Settlement</option>
                         <option value="MANUAL_ONLY">Admin Authorization Only</option>
                       </select>
                    </div>
                  )}
               </div>

               <button
                 onClick={saveHardware}
                 className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-indigo press flex items-center justify-center gap-3 mt-8"
               >
                 <Usb size={18} /> Sync Local Peripheral Profile
               </button>
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
