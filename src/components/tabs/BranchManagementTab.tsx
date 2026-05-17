import React, { useState } from 'react';
import { MapPin, Plus, Pencil, Power, Phone, Hash, Building2, CheckCircle2, XCircle, Trash2, Smartphone, SlidersHorizontal, ChevronRight, X, ShieldCheck, Globe, Activity, Landmark } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Branch } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { SearchableSelect } from '../shared/SearchableSelect';
import { saveBranchMpesaSettings } from '../../services/mpesaSettings';
import { BranchService } from '../../services/admin';


export default function BranchManagementTab() {
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const currentUser = useStore(state => state.currentUser);
  const branches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const isAdmin = useStore(state => state.isAdmin);
  const { success, error, warning } = useToast();

  const BLANK: Omit<Branch, 'id' | 'updated_at' | 'businessId'> = {
    name: '', location: '', phone: '', tillNumber: '', kraPin: '', isActive: true,
    mpesaConsumerKey: '', mpesaConsumerSecret: '', mpesaPasskey: '', mpesaEnv: 'sandbox',
    mpesaType: 'paybill', mpesaStoreNumber: ''
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [mpesaGate, setMpesaGate] = useState({ adminPassword: '', confirmationText: '' });
  const [saving, setSaving] = useState(false);
  const isMpesaUnlocked = !!mpesaGate.adminPassword && mpesaGate.confirmationText.trim().toUpperCase() === 'UPDATE MPESA';

  const openNew = () => {
    setForm(BLANK);
    setMpesaGate({ adminPassword: '', confirmationText: '' });
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
        mpesaConsumerKey: '',
        mpesaConsumerSecret: '',
        mpesaPasskey: '',
        mpesaEnv: b.mpesaEnv || 'sandbox',
        mpesaType: b.mpesaType || 'paybill',
        mpesaStoreNumber: b.mpesaStoreNumber && b.mpesaStoreNumber !== 'Saved' ? b.mpesaStoreNumber : ''
    });
    setMpesaGate({ adminPassword: '', confirmationText: '' });
    setEditingId(b.id);
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.location.trim() || saving) return;
    if (!activeBusinessId || !currentUser) return;
    setSaving(true);
    try {
      let savedBranchId = editingId;
      const result = await BranchService.save({
        branch: {
          id: editingId || undefined,
          name: form.name.trim(),
          location: form.location.trim(),
          phone: form.phone.trim() || undefined,
          tillNumber: form.tillNumber.trim() || undefined,
          kraPin: form.kraPin.trim() || undefined,
          isActive: form.isActive,
        },
        businessId: activeBusinessId,
        branchId: editingId || useStore.getState().activeBranchId,
      });
      savedBranchId = result.branch.id;
      await db.branches.reload();

      if (isMpesaUnlocked && savedBranchId) {
        const result = await saveBranchMpesaSettings({
          businessId: activeBusinessId,
          branchId: savedBranchId,
          userId: currentUser.id,
          adminPassword: mpesaGate.adminPassword,
          confirmationText: mpesaGate.confirmationText,
          credentials: {
            consumerKey: form.mpesaConsumerKey.trim() || undefined,
            consumerSecret: form.mpesaConsumerSecret.trim() || undefined,
            passkey: form.mpesaPasskey.trim() || undefined,
            env: form.mpesaEnv as 'sandbox' | 'production',
            type: form.mpesaType as 'paybill' | 'buygoods',
            storeNumber: form.mpesaStoreNumber.trim() || undefined,
          },
        });
        if (result.error) throw new Error(result.error);
        await db.branches.reload();
      }

      success(isMpesaUnlocked ? "Branch and M-Pesa settings saved." : editingId ? "Branch updated." : "Branch created.");
      setIsFormOpen(false);
      setEditingId(null);
      setMpesaGate({ adminPassword: '', confirmationText: '' });
      setForm(BLANK);
    } catch (err: any) {
      error(err?.message || "Failed to save branch.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (b: Branch) => {
    if (saving) return;
    setSaving(true);
    try {
      if (!b.isActive) {
        await BranchService.setActive({ branchId: b.id, isActive: true, businessId: activeBusinessId! });
      } else {
        const activeBranches = (branches || []).filter(br => br.isActive);
        if (activeBranches.length <= 1) {
          warning('At least one branch must remain active.');
          return;
        }
        await BranchService.setActive({ branchId: b.id, isActive: false, businessId: activeBusinessId! });
      }
      await db.branches.reload();
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

    if (confirm(`Delete branch "${b.name}"? Its records will also be removed. This cannot be undone.`)) {
      setSaving(true);
      try {
        await BranchService.delete({ branchId: b.id, businessId: activeBusinessId! });
        await db.branches.reload();
        success("Branch permanently removed.");
      } catch (err) {
        error("Could not delete this branch. It may still have records linked to it.");
      } finally {
        setSaving(false);
      }
    }
  };

  const branchBeingEdited = editingId ? (branches || []).find(branch => branch.id === editingId) : null;

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Branches</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{branches?.length} branches</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-emerald-600">{(branches || []).filter(b => b.isActive).length} Active</span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-indigo-600">Online backup</span>
          </div>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
        >
          <Plus size={18} /> Add branch
        </button>
      </div>

      {/* Branch Rows */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        {(branches || []).length > 0 ? (
          <div className="divide-y divide-slate-100">
            {(branches || []).map(branch => (
              <div key={branch.id} className={`px-3 sm:px-5 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 hover:bg-indigo-50/40 transition-colors group ${branch.isActive ? '' : 'opacity-70'}`}>
                <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${branch.isActive ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                    <Building2 size={18} />
                  </div>
                  <div className="stable-row-copy">
                    <h4 className="text-sm font-black text-slate-900 stable-title leading-tight">{branch.name}</h4>
                    <div className="flex items-center gap-2 mt-1 overflow-hidden">
                      <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 stable-meta"><MapPin size={11} className="text-slate-300" /> {branch.location}</span>
                      {branch.tillNumber && <span className="text-[10px] font-bold text-slate-300 uppercase flex-shrink-0">Till {branch.tillNumber}</span>}
                    </div>
                  </div>
                </div>
                <div className="stable-actions flex items-center gap-1.5">
                  {branch.isActive ? (
                    <span className="hidden sm:flex items-center gap-1 text-[9px] font-black bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full border border-emerald-100 uppercase tracking-tighter">
                      <CheckCircle2 size={10} /> Open
                    </span>
                  ) : (
                    <span className="hidden sm:flex items-center gap-1 text-[9px] font-black bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full uppercase tracking-tighter">
                      <XCircle size={10} /> Closed
                    </span>
                  )}
                  <button onClick={() => openEdit(branch)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                    <Pencil size={15} />
                  </button>
                  <button onClick={() => toggleActive(branch)} className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${branch.isActive ? 'bg-emerald-50 text-emerald-600 hover:bg-rose-50 hover:text-rose-600' : 'bg-slate-100 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}>
                    <Power size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center flex flex-col items-center">
            <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
              <Globe size={36} />
            </div>
            <p className="text-slate-500 font-black text-base">No branches yet</p>
            <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Add a branch to start selling there</p>
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
                      {editingId ? 'Branch details' : 'Add branch'}
                    </h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                      {editingId ? 'Edit this branch' : 'Create a new branch'}
                    </p>
                  </div>
               </div>
               <button onClick={() => setIsFormOpen(false)} className="p-3 bg-slate-50 text-slate-400 hover:text-slate-600 rounded-2xl transition-all"><X size={20}/></button>
            </div>

            <div className="space-y-8">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Branch name *</label>
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
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Physical location *</label>
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
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Branch phone</label>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="07..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">M-Pesa till #</label>
                    <input
                      type="text"
                      value={form.tillNumber}
                      onChange={e => setForm(f => ({ ...f, tillNumber: e.target.value }))}
                      className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                      placeholder="123456"
                    />
                  </div>
                  <div className="col-span-2 lg:col-span-1">
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">KRA tax PIN</label>
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
                    <Smartphone size={14} /> M-Pesa settings
                  </h4>
                  <div className="mb-6 rounded-2xl border border-indigo-100 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Security check</p>
                        <p className="mt-1 text-xs font-bold text-slate-400">
                          {branchBeingEdited?.mpesaConfigured ? 'Credentials are saved and hidden.' : 'No saved credentials shown here.'}
                        </p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${isMpesaUnlocked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {isMpesaUnlocked ? 'Unlocked' : 'Locked'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input
                        type="password"
                        value={mpesaGate.adminPassword}
                        onChange={e => setMpesaGate(g => ({ ...g, adminPassword: e.target.value }))}
                        className="h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500"
                        placeholder="Admin password"
                      />
                      <input
                        value={mpesaGate.confirmationText}
                        onChange={e => setMpesaGate(g => ({ ...g, confirmationText: e.target.value }))}
                        className="h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold uppercase tracking-widest text-slate-900 outline-none focus:border-indigo-500"
                        placeholder="Type update mpesa"
                      />
                    </div>
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Saved app keys and passkeys are never displayed. Leave secret fields blank to keep the saved ones.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Mode</label>
                       <SearchableSelect
                         value={form.mpesaEnv}
                         onChange={(v) => setForm(f => ({ ...f, mpesaEnv: v as any }))}
                         disabled={!isMpesaUnlocked}
                         options={[
                           { value: 'sandbox', label: 'Test mode', keywords: 'sandbox test testing' },
                           { value: 'production', label: 'Live mode', keywords: 'production live' },
                         ]}
                         buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                       />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">M-Pesa type</label>
                       <SearchableSelect
                         value={form.mpesaType}
                         onChange={(v) => setForm(f => ({ ...f, mpesaType: v as any }))}
                         disabled={!isMpesaUnlocked}
                         options={[
                           { value: 'paybill', label: 'Paybill', keywords: 'paybill' },
                           { value: 'buygoods', label: 'Buy goods (till)', keywords: 'buy goods till' },
                         ]}
                         buttonClassName="rounded-2xl px-6 py-4.5 font-black text-slate-900 bg-white border-transparent"
                       />
                     </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">M-Pesa app key</label>
                       <input
                         type="text"
                         value={form.mpesaConsumerKey}
                         onChange={e => setForm(f => ({ ...f, mpesaConsumerKey: e.target.value }))}
                         disabled={!isMpesaUnlocked}
                         className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                         placeholder={branchBeingEdited?.mpesaConsumerKeySet ? 'Saved. Enter new key to replace' : 'Consumer key'}
                       />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">M-Pesa app secret</label>
                       <input
                         type="password"
                         value={form.mpesaConsumerSecret}
                         onChange={e => setForm(f => ({ ...f, mpesaConsumerSecret: e.target.value }))}
                         disabled={!isMpesaUnlocked}
                         className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                         placeholder={branchBeingEdited?.mpesaConsumerSecretSet ? 'Saved. Enter new secret to replace' : 'Consumer secret'}
                       />
                     </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">Store number</label>
                       <input
                         type="text"
                         value={form.mpesaStoreNumber}
                         onChange={e => setForm(f => ({ ...f, mpesaStoreNumber: e.target.value }))}
                         className={`w-full border-2 rounded-2xl px-6 py-4.5 text-sm font-black transition-all outline-none ${form.mpesaType === 'buygoods' && isMpesaUnlocked ? 'bg-white border-transparent focus:border-indigo-500 text-slate-900' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                         placeholder="Required for till"
                         disabled={form.mpesaType !== 'buygoods' || !isMpesaUnlocked}
                       />
                     </div>
                     <div>
                       <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5 ml-2">M-Pesa Passkey</label>
                       <input
                         type="password"
                         value={form.mpesaPasskey}
                         onChange={e => setForm(f => ({ ...f, mpesaPasskey: e.target.value }))}
                         disabled={!isMpesaUnlocked}
                         className="w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none shadow-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                         placeholder={branchBeingEdited?.mpesaPasskeySet ? 'Saved. Enter new passkey to replace' : 'M-Pesa passkey'}
                       />
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex gap-4 mt-12">
               <button
                 onClick={() => { setIsFormOpen(false); setEditingId(null); setMpesaGate({ adminPassword: '', confirmationText: '' }); setForm(BLANK); }}
                 className="flex-1 py-5 bg-white text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-2xl border-2 border-slate-100 press"
               >
                 Cancel
               </button>
               <button
                 onClick={handleSave}
                 disabled={!form.name.trim() || !form.location.trim() || saving}
                 className="flex-[2] grad-blue text-white font-black text-[10px] uppercase tracking-widest rounded-2xl shadow-blue press disabled:opacity-50"
               >
                 {saving ? 'Saving...' : editingId ? 'Save branch' : 'Add branch'}
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
