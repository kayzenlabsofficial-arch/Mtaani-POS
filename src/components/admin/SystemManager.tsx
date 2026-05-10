import React, { useState } from 'react';
import { db, type Business } from '../../db';
import { useLiveQuery } from '../../clouddb';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { hashPassword, resetAttempts } from '../../security';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export function ManageBusinessModal({ business, onClose }: { business: Business, onClose: () => void }) {
  const users = useLiveQuery(() => db.users.where('businessId').equals(business.id).toArray(), [business.id], []);
  const lockout = useLiveQuery(() => db.loginAttempts.get(business.code.toUpperCase()), [business.code], null);
  const { success, error } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleResetPassword = async (userId: string, userName: string) => {
     if (!confirm(`Reset password for ${userName} to '123'?`)) return;
     setIsProcessing(true);
     try {
        const newHash = await hashPassword('123');
        await db.users.update(userId, { password: newHash, updated_at: Date.now() });
        success(`Password for ${userName} reset to '123'`);
     } catch (err) {
        error("Reset failed");
     } finally {
        setIsProcessing(false);
     }
  };

  const handleClearLockout = async () => {
     if (!confirm(`Break security lockout for ${business.name}?`)) return;
     setIsProcessing(true);
     try {
        await resetAttempts(business.code);
        success("Security lockout cleared");
     } catch (err) {
        error("Failed to clear lockout");
     } finally {
        setIsProcessing(false);
     }
  };

  return (
     <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl animate-in fade-in" onClick={onClose} />
        <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
           <div className="p-10 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <div className="flex items-center gap-5">
                 <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                    <MaterialIcon name="admin_panel_settings" className="text-3xl" />
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-white">{business.name}</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Tenant Control Center • {business.code}</p>
                 </div>
              </div>
              <button onClick={onClose} className="w-12 h-12 bg-slate-800 text-slate-400 hover:text-white rounded-full flex items-center justify-center transition-all">
                 <MaterialIcon name="close" />
              </button>
           </div>

           <div className="p-10 space-y-10 overflow-y-auto no-scrollbar max-h-[70vh]">
              <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 flex items-center justify-between">
                 <div>
                    <h4 className="text-sm font-bold text-white mb-1 uppercase tracking-tight">Brute-Force Status</h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                       {lockout?.lockedUntil && Date.now() < lockout.lockedUntil 
                         ? `NODE LOCKED until ${new Date(lockout.lockedUntil).toLocaleTimeString()}`
                         : lockout?.count ? `${lockout.count} failed attempts detected` : "Security status optimal. No locks active."}
                    </p>
                 </div>
                 {(lockout?.count || (lockout?.lockedUntil && Date.now() < lockout.lockedUntil)) && (
                    <button 
                      onClick={handleClearLockout}
                      className="px-6 py-3 bg-error/10 text-error border border-error/20 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-error hover:text-white transition-all"
                    >
                       Break Lockout
                    </button>
                 )}
              </div>

              <div className="space-y-4">
                 <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Authorized Users</h4>
                 <div className="grid grid-cols-1 gap-3">
                    {users?.map(u => (
                       <div key={u.id} className="p-5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-secondary font-black text-xs">
                                {u.name.charAt(0).toUpperCase()}
                             </div>
                             <div>
                                <p className="text-sm font-bold text-white">{u.name}</p>
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">{u.role}</p>
                             </div>
                          </div>
                          <button 
                            onClick={() => handleResetPassword(u.id, u.name)}
                            className="p-2 text-slate-500 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                            title="Reset Password"
                          >
                             <MaterialIcon name="key_reset" />
                          </button>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>
     </div>
  );
}

export default function SystemManagerDashboard({ onLogout }: { onLogout: () => void }) {
  const businesses = useLiveQuery(() => db.businesses.toArray(), []);
  const [form, setForm] = useState({ name: '', code: '' });
  const { setActiveBusinessId } = useStore();
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code) return;
    const trimmedCode = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(trimmedCode)) {
      alert('Business Code must be 3-20 alphanumeric characters (A-Z, 0-9)');
      return;
    }
    const prevBusinessId = useStore.getState().activeBusinessId;
    try {
      const newBusinessId = crypto.randomUUID();
      const defaultPasswordHash = await hashPassword('123');

      await db.businesses.add({
        id: newBusinessId,
        name: form.name,
        code: trimmedCode,
        isActive: 1,
        updated_at: Date.now()
      } as any);

      setActiveBusinessId(newBusinessId);
      await new Promise(r => setTimeout(r, 50));

      await db.users.add({
        id: crypto.randomUUID(),
        name: 'admin',
        password: defaultPasswordHash,
        role: 'ADMIN',
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      await db.branches.add({
        id: crypto.randomUUID(),
        name: 'Main Branch',
        location: 'Default',
        isActive: true,
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      setForm({ name: '', code: '' });
      alert(`✅ Business created!\nDefault login:\n  Username: admin\n  Password: 123`);
    } catch(err: any) {
      console.error(err);
      alert(`Failed to create business: ${err.message || 'Unknown error'}`);
    } finally {
      setActiveBusinessId(prevBusinessId);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 animate-in fade-in font-hanken">
       <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-12">
             <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
                   <MaterialIcon name="shield_person" className="text-white text-3xl" />
                </div>
                 <div>
                    <h1 className="text-2xl font-black tracking-tight">System Admin</h1>
                    <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-1">Management Dashboard</p>
                 </div>
             </div>
             <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-900 border border-slate-800 rounded-full">
                   <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                   <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Connected</span>
                </div>
                <button onClick={onLogout} className="px-6 py-2 bg-error/10 text-error border border-error/20 rounded-xl font-bold text-xs hover:bg-error hover:text-white transition-all">Sign Out</button>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             <div className="lg:col-span-1 space-y-8">
                <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-xl">
                   <h3 className="text-lg font-black mb-6 flex items-center gap-3">
                      <MaterialIcon name="add_business" className="text-primary" />
                      Add Business
                   </h3>
                   <form onSubmit={handleCreate} className="space-y-6">
                      <div className="space-y-2">
                         <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Business Name</label>
                         <input type="text" placeholder="e.g. Mtaani Mart" className="w-full bg-slate-950 border border-slate-800 focus:border-primary rounded-xl px-5 py-3 outline-none text-sm font-bold transition-all" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                         <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Login Code</label>
                         <input type="text" placeholder="e.g. MTAANI1" className="w-full bg-slate-950 border border-slate-800 focus:border-primary rounded-xl px-5 py-3 outline-none text-sm font-bold transition-all" value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} />
                      </div>
                      <button type="submit" className="w-full py-4 bg-primary hover:bg-primary-container rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all active:scale-[0.98]">Save Business</button>
                   </form>
                </div>

                <div className="bg-gradient-to-br from-slate-900 to-slate-950 p-8 rounded-[2.5rem] border border-slate-800">
                   <div className="flex items-center gap-4 mb-4 text-primary">
                      <MaterialIcon name="info" />
                      <h4 className="text-xs font-bold uppercase tracking-wider">Note</h4>
                   </div>
                   <p className="text-[11px] text-slate-500 leading-relaxed font-medium">
                      As a system admin, you have full control. Changes made here will update the system immediately.
                   </p>
                </div>
             </div>

             <div className="lg:col-span-2">
                <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-xl h-full flex flex-col">
                   <div className="flex items-center justify-between mb-8">
                      <h3 className="text-xl font-black flex items-center gap-3">
                         <MaterialIcon name="hub" className="text-secondary" />
                         Entity Registry
                      </h3>
                      <div className="px-4 py-1.5 bg-slate-950 rounded-full border border-slate-800 text-[10px] font-bold text-slate-500">
                         {businesses?.length || 0} Registered Tenants
                      </div>
                   </div>

                   <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-2">
                      {businesses?.map(b => (
                         <div key={b.id} className="p-6 bg-slate-950 rounded-3xl border border-slate-800 flex justify-between items-center group hover:border-primary/50 transition-all">
                            <div className="flex items-center gap-5">
                               <div className="w-12 h-12 rounded-xl bg-slate-900 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                                  <MaterialIcon name="storefront" />
                               </div>
                               <div>
                                  <p className="text-base font-black">{b.name}</p>
                                  <p className="text-[10px] text-slate-500 font-mono tracking-widest mt-1 uppercase">Code: {b.code}</p>
                               </div>
                            </div>
                            <button 
                              onClick={() => setSelectedBiz(b)}
                              className="px-5 py-2 bg-slate-900 hover:bg-primary text-primary hover:text-white border border-primary/20 rounded-lg font-bold text-[10px] uppercase tracking-widest transition-all"
                            >
                               Manage
                            </button>
                         </div>
                      ))}
                      {(!businesses || businesses.length === 0) && (
                        <div className="h-64 flex flex-col items-center justify-center text-slate-700">
                           <MaterialIcon name="cloud_off" className="text-4xl mb-2" />
                           <p className="text-sm font-bold uppercase tracking-tighter">No entities provisioned</p>
                        </div>
                      )}
                   </div>
                </div>
             </div>
          </div>
       </div>

       {selectedBiz && (
         <ManageBusinessModal 
           business={selectedBiz} 
           onClose={() => setSelectedBiz(null)} 
         />
       )}
    </div>
  );
}
