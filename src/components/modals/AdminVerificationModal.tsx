import React, { useState } from 'react';
import { ShieldAlert, KeyRound, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';

interface AdminVerificationModalProps {
  actionDescription: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function AdminVerificationModal({ actionDescription, onSuccess, onCancel }: AdminVerificationModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const allUsers = useLiveQuery(
    () => activeBusinessId ? db.users.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );

  const handleVerify = () => {
    const adminUser = allUsers?.find(u => u.role === 'ADMIN' && u.pin === pin);
    if (!adminUser) {
      setError("Invalid Admin PIN");
      setPin("");
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="bg-white w-full max-w-xs rounded-xl shadow-elevated relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
         <div className="p-6 border-b border-red-100 bg-red-50/50 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mb-3">
               <ShieldAlert size={28} />
            </div>
            <h2 className="text-lg font-black text-slate-900">Admin Override</h2>
            <p className="text-xs font-bold text-red-600 mt-1  tracking-tight">{actionDescription}</p>
         </div>
         <div className="p-6">
            {error && (
              <p className="text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg mb-4 text-center border border-red-100">{error}</p>
            )}
            <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-slate-400   mb-2 ml-1">Supervisor PIN</label>
                  <div className="relative">
                     <KeyRound size={18} className="absolute left-4 top-3.5 text-slate-400" />
                     <input 
                        type="password" 
                        maxLength={6} 
                        pattern="[0-9]*" 
                        autoFocus
                        className={`w-full bg-slate-50 border rounded-xl pl-11 pr-4 py-3.5 text-sm font-bold text-slate-900 focus:outline-none tracking-[0.4em] font-mono transition-all shadow-sm ${error ? 'border-red-500 focus:ring-2 focus:ring-red-500/20' : 'border-slate-200 focus:border-red-500 focus:ring-2 focus:ring-red-500/20'}`} 
                        placeholder="••••" 
                        value={pin} 
                        onChange={e => {
                          setError("");
                          setPin(e.target.value.replace(/\D/g, ''));
                        }} 
                        onKeyDown={e => {
                          if (e.key === 'Enter' && pin.length >= 4) {
                            handleVerify();
                          }
                        }}
                     />
                  </div>
                </div>
            </div>
         </div>
         <div className="p-4 grid grid-cols-2 gap-2 bg-slate-50 border-t border-slate-100">
            <button onClick={onCancel} className="py-3.5 bg-white border border-slate-200 text-slate-700 font-black text-xs   rounded-xl transition-colors active:bg-slate-100 flex items-center justify-center gap-1">
               <X size={14} /> Cancel
            </button>
            <button 
              onClick={handleVerify} 
              disabled={pin.length < 4}
              className="py-3.5 bg-red-600 text-white font-black text-xs   rounded-xl disabled:opacity-50 transition-colors active:scale-95 shadow-lg shadow-red-600/20"
            >
               Authorize
            </button>
         </div>
      </div>
    </div>
  );
}

