import React, { useState } from 'react';
import { MapPin, Plus, Pencil, Power, Phone, Hash, Building2, CheckCircle2, XCircle, Trash2, Smartphone, SlidersHorizontal, ChevronRight, X, ShieldCheck, Globe, Activity, Landmark } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Branch } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { SearchableSelect } from '../shared/SearchableSelect';
import NestedControlPanel from '../shared/NestedControlPanel';

export default function BranchManagementTab() {
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const branches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const isAdmin = useStore(state => state.isAdmin);
  const { success, error, warning } = useToast();

  const BLANK: Omit<Branch, 'id' | 'updated_at'> = {
    name: '', location: '', phone: '', tillNumber: '', kraPin: '', isActive: true,
    mpesaConsumerKey: '', mpesaConsumerSecret: '', mpesaPasskey: '', mpesaEnv: 'sandbox',
    mpesaType: 'paybill', mpesaStoreNumber: ''
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setForm(BLANK);
    setEditingId(null);
    setIsFormOpen(true);
  };

  const openEdit = (b: Branch) => {
    setForm({ 
        name: b.name, 
        location: b.location, 
        phone: b.phone || '', 
        tillNumber: b.tillNumber || '', 
        kraPin: b.kraPin || '', 
        isActive: b.isActive,
        mpesaConsumerKey: b.mpesaConsumerKey || '',
        mpesaConsumerSecret: b.mpesaConsumerSecret || '',
        mpesaPasskey: b.mpesaPasskey || '',
        mpesaEnv: b.mpesaEnv || 'sandbox',
        mpesaType: b.mpesaType || 'paybill',
        mpesaStoreNumber: b.mpesaStoreNumber || ''
    });
    setEditingId(b.id);
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.location.trim() || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await db.branches.update(editingId, {
          name: form.name.trim(),
          location: form.location.trim(),
          phone: form.phone.trim() || undefined,
          tillNumber: form.tillNumber.trim() || undefined,
          kraPin: form.kraPin.trim() || undefined,
          isActive: form.isActive,
          mpesaConsumerKey: form.mpesaConsumerKey?.trim() || undefined,
          mpesaConsumerSecret: form.mpesaConsumerSecret?.trim() || undefined,
          mpesaPasskey: form.mpesaPasskey?.trim() || undefined,
          mpesaEnv: form.mpesaEnv as any,
          mpesaType: form.mpesaType as any,
          mpesaStoreNumber: form.mpesaStoreNumber?.trim() || undefined
        });
        success("Branch updated.");
      } else {
        await db.branches.add({
          id: 'branch_' + crypto.randomUUID().split('-')[0],
          name: form.name.trim(),
          location: form.location.trim(),
          phone: form.phone.trim() || undefined,
          tillNumber: form.tillNumber.trim() || undefined,
          kraPin: form.kraPin.trim() || undefined,
          isActive: true,
          businessId: activeBusinessId!,
          mpesaConsumerKey: form.mpesaConsumerKey?.trim() || undefined,
          mpesaConsumerSecret: form.mpesaConsumerSecret?.trim() || undefined,
          mpesaPasskey: form.mpesaPasskey?.trim() || undefined,
          mpesaEnv: form.mpesaEnv as any,
          mpesaType: form.mpesaType as any,
          mpesaStoreNumber: form.mpesaStoreNumber?.trim() || undefined
        });
        success("Branch created.");
      }
      setIsFormOpen(false);
      setEditingId(null);
      setForm(BLANK);
    } catch (err) {
      error("Failed to save branch.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (b: Branch) => {
    if (saving) return;
    setSaving(true);
    try {
      if (!b.isActive) {
        await db.branches.update(b.id, { isActive: true });
      } else {
        const activeBranches = (branches || []).filter(br => br.isActive);
        if (activeBranches.length <= 1) {
          warning('At least one branch must remain active.');
          return;
        }
        await db.branches.update(b.id, { isActive: false });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (b: Branch) => {
    if (saving) return;
    const activeBranches = (branches || []).length;
    if (activeBranches <= 1) {
      warning('Cannot delete the only remaining branch.');
      return;
    }

    if (confirm(`CRITICAL: Deleting branch "${b.name}" will permanently erase its specific records. Are you absolutely sure?`)) {
      setSaving(true);
      try {
        await db.branches.delete(b.id);
        success("Branch permanently removed.");
      } catch (err) {
        error("Deletion failed. Branch may have associated data.");
      } finally {
        setSaving(false);
      }
    }
  };

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Distribution Network</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{branches?.length} Nodes</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">{(branches || []).filter(b => b.isActive).length} Active</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Real-time Sync</span>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
        >
          <Plus size={18} /> Deploy New Node
        </button>
      </div>

      {/* Branch Node Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(branches || []).map(branch => (
          <div
            key={branch.id}
            className={`group bg-white p-6 rounded-[2.5rem] border-2 transition-all flex flex-col gap-5 hover:shadow-xl hover:-translate-y-1 relative overflow-hidden ${branch.isActive ? 'border-slate-100 hover:border-indigo-300' : 'border-slate-50 opacity-60'}`}
          >
            <div className="flex items-start justify-between relative z-10">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-transform ${branch.isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                   <Building2 size={28} />
                </div>
                <div className="min-w-0">
                  <h4 className="text-base font-black text-slate-900 truncate leading-tight">{branch.name}</h4>
                  <div className="flex items-center gap-1.5 mt-1">
                    <MapPin size={12} className="text-slate-300" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">{branch.location}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex flex-col gap-1.5">
                 <button onClick={() => openEdit(branch)} className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                    <Pencil size={18} />
                 </button>
                 <button onClick={() => toggleActive(branch)} className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${branch.isActive ? 'bg-emerald-50 text-emerald-600 hover:bg-rose-50 hover:text-rose-600' : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}>
                    <Power size={18} />
                 </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 relative z-10">
              {branch.isActive ? (
                <span className="flex items-center gap-1.5 text-[9px] font-black bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full border border-emerald-100 uppercase tracking-tighter">
                  <CheckCircle2 size={10} /> Operational
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[9px] font-black bg-slate-100 text-slate-500 px-3 py-1.5 rounded-full uppercase tracking-tighter">
                  <XCircle size={10} /> Suspended
                </span>
              )}
              {branch.tillNumber && (
                <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100 uppercase tracking-widest">
                  <Hash size={10} /> {branch.tillNumber}
                </span>
              )}
              {branch.kraPin && (
                <span className="flex items-center gap-1.5 text-[9px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 uppercase tracking-widest">
                  KRA Verified
                </span>
              )}
            </div>

            <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-slate-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        ))}

        {(branches || []).length === 0 && (
          <div className="col-span-full py-32 text-center flex flex-col items-center">
             <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner text-slate-200">
               <Globe size={44} />
             </div>
             <p className="text-slate-500 font-black text-lg">No branch nodes deployed</p>
             <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Initiate deployment to expand your network</p>
          </div>
        )}
      </div>

      {/* Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center p-4">
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-md animate-in fade-in duration-300" onClick={() => setIsFormOpen(false)} />
          <div className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl p-10 animate-in slide-in-from-bottom-10 duration-500 z-10 max-h-[90vh] overflow-y-auto no-scrollbar">
            
            <div className="flex justify-between items-start mb-8">
               <div className="flex items-center gap-5">
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-[1.5rem] flex items-center justify-center shadow-sm">
                    <Building2 size={32} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900">
                      {editingId ? 'Node Configuration' : 'Node Deployment'}
                    </h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                      {editingId ? 'Syncing Station Parameters' : 'Provisioning New Fleet Member'}
                    </p>
                  </div>
               </div>
               <button onClick={() => setIsFormOpen(false)} className="p-3 bg-slate-50 text-slate-400 hover:text-slate-600 rounded-2xl transition-all"><X size={20}/></button>
            </div>

            <div className="space-y-8">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Node Identity *</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="e.g. Waterfront Branch"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Physical Location *</label>
                    <input
                      type="text"
                      value={form.location}
                      onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="e.g. Karen, Nairobi"
                    />
                  </div>
               </div>

               <div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Secure Link Phone</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="07..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">M-Pesa Till #</label>
                    <input
                      type="text"
                      value={form.tillNumber}
                      onChange={e => setForm(f => ({ ...f, tillNumber: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="123456"
                    />
                  </div>
                  <div className="col-span-2 lg:col-span-1">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">KRA Tax PIN</label>
                    <input
                      type="text"
                      value={form.kraPin}
                      onChange={e => setForm(f => ({ ...f, kraPin: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="P00..."
                    />
                  </div>
               </div>

               <div className="p-8 bg-indigo-50/50 rounded-[2.5rem] border-2 border-indigo-100">
                  <h4 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Smartphone size={14} /> Daraja API Settlement Protocol
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Environment</label>
                       <SearchableSelect
                         value={form.mpesaEnv}
                         onChange={(v) => setForm(f => ({ ...f, mpesaEnv: v as any }))}
                         options={[
                           { value: 'sandbox', label: 'Sandbox (Staging)', keywords: 'sandbox test testing' },
                           { value: 'production', label: 'Production (Live)', keywords: 'production live' },
                         ]}
                         buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                       />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Channel Type</label>
                       <SearchableSelect
                         value={form.mpesaType}
                         onChange={(v) => setForm(f => ({ ...f, mpesaType: v as any }))}
                         options={[
                           { value: 'paybill', label: 'Paybill Hub', keywords: 'paybill' },
                           { value: 'buygoods', label: 'Buy Goods (Till)', keywords: 'buy goods till' },
                         ]}
                         buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                       />
                     </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">App Consumer Key</label>
                       <input
                         type="text"
                         value={form.mpesaConsumerKey}
                         onChange={e => setForm(f => ({ ...f, mpesaConsumerKey: e.target.value }))}
                         className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm"
                         placeholder="Consumer Key"
                       />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">App Consumer Secret</label>
                       <input
                         type="password"
                         value={form.mpesaConsumerSecret}
                         onChange={e => setForm(f => ({ ...f, mpesaConsumerSecret: e.target.value }))}
                         className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm"
                         placeholder="Consumer Secret"
                       />
                     </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Store Number</label>
                       <input
                         type="text"
                         value={form.mpesaStoreNumber}
                         onChange={e => setForm(f => ({ ...f, mpesaStoreNumber: e.target.value }))}
                         className={`w-full border-2 rounded-2xl px-6 py-4.5 text-sm font-black transition-all outline-none ${form.mpesaType === 'buygoods' ? 'bg-white border-transparent focus:border-indigo-500 text-slate-900' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                         placeholder="Required for Till"
                         disabled={form.mpesaType !== 'buygoods'}
                       />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">LNM Online Passkey</label>
                       <input
                         type="password"
                         value={form.mpesaPasskey}
                         onChange={e => setForm(f => ({ ...f, mpesaPasskey: e.target.value }))}
                         className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm"
                         placeholder="STK Passkey"
                       />
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex gap-4 mt-12">
               <button
                 onClick={() => { setIsFormOpen(false); setEditingId(null); setForm(BLANK); }}
                 className="flex-1 py-5 bg-white text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-2xl border-2 border-slate-100 press"
               >
                 Abort Changes
               </button>
               <button
                 onClick={handleSave}
                 disabled={!form.name.trim() || !form.location.trim() || saving}
                 className="flex-[2] grad-blue text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-blue press disabled:opacity-50"
               >
                 {saving ? 'Syncing...' : editingId ? 'Update Node Fleet' : 'Initiate Deployment'}
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
