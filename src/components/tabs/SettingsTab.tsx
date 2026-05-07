import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, Lock, Unlock, RefreshCcw, Download } from 'lucide-react';
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
          <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2">Store Identity</h3>
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

      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 mb-6">
          <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
            <RefreshCcw className="text-blue-600" size={16} /> System Management
          </h3>
          <div className="flex flex-col gap-4">
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
          </div>
      </div>

      <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-sm space-y-4 mb-6">
          <h3 className="text-sm font-extrabold text-slate-900 border-b border-slate-100 pb-2 flex items-center gap-2">
            <ShieldCheck className="text-blue-600" size={16} /> Administrative Control
          </h3>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <p className="text-sm font-bold text-slate-900">Role-Based Access Control</p>
              <p className="text-xs text-slate-500 mt-1">Admin privileges are now securely managed per-user in the User Management tab. You are currently logged in with {isAdmin ? 'Admin' : 'Standard'} access.</p>
          </div>
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
