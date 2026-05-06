import React, { useState } from 'react';
import { MapPin, Plus, Pencil, Power, Phone, Hash, Building2, CheckCircle2, XCircle, Trash2, Smartphone } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Branch } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';

export default function BranchManagementTab() {
  const branches = useLiveQuery(() => db.branches.toArray(), [], []);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBusinessId = useStore(state => state.activeBusinessId);
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
    if (!form.name.trim() || !form.location.trim()) return;
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
  };

  const handleDelete = async (b: Branch) => {
    const activeBranches = (branches || []).length;
    if (activeBranches <= 1) {
      warning('Cannot delete the only remaining branch.');
      return;
    }

    if (confirm(`CRITICAL: Deleting branch "${b.name}" will permanently erase its specific records. Are you absolutely sure?`)) {
      try {
        await db.branches.delete(b.id);
        success("Branch permanently removed.");
      } catch (err) {
        error("Deletion failed. Branch may have associated data.");
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Branch Locations</h3>
          <p className="text-xs text-slate-500 mt-0.5">Manage store locations sharing this POS.</p>
        </div>
        <button
          onClick={openNew}
          className="bg-blue-600 text-white font-bold text-xs flex items-center gap-2 px-4 py-2.5 rounded-xl transition-transform active:scale-95 shadow-lg shadow-blue-600/20"
        >
          <Plus size={14} /> Add Branch
        </button>
      </div>

      {/* Branch cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(branches || []).map(branch => (
          <div
            key={branch.id}
            className={`bg-white rounded-2xl border p-4 flex flex-col gap-3 transition-all ${branch.isActive ? 'border-slate-200' : 'border-slate-100 opacity-60'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${branch.isActive ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                   <Building2 size={20} />
                </div>
                <div>
                  <p className="font-black text-sm text-slate-900 leading-tight">{branch.name}</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <MapPin size={10} className="text-slate-400" />
                    <span className="text-xs text-slate-500 font-medium">{branch.location}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => openEdit(branch)}
                  className="w-8 h-8 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center hover:bg-blue-50 hover:text-blue-600 transition-all"
                  title="Edit branch"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => toggleActive(branch)}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${branch.isActive ? 'bg-green-50 text-green-600 hover:bg-red-50 hover:text-red-600' : 'bg-slate-100 text-slate-400 hover:bg-green-50 hover:text-green-600'}`}
                  title={branch.isActive ? 'Deactivate branch' : 'Activate branch'}
                >
                  <Power size={14} />
                </button>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(branch)}
                    className="w-8 h-8 rounded-xl bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-600 hover:text-white transition-all"
                    title="Delete branch"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Branch metadata pills */}
            <div className="flex flex-wrap gap-1.5">
              {branch.isActive ? (
                <span className="flex items-center gap-1 text-[9px] font-black bg-green-50 text-green-700 px-2 py-1 rounded-full border border-green-100">
                  <CheckCircle2 size={9} /> Active
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-1 rounded-full">
                  <XCircle size={9} /> Inactive
                </span>
              )}
              {branch.phone && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                  <Phone size={9} /> {branch.phone}
                </span>
              )}
              {branch.tillNumber && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                  <Hash size={9} /> Till: {branch.tillNumber}
                </span>
              )}
              {branch.kraPin && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-slate-600 bg-slate-50 px-2 py-1 rounded-full border border-slate-100">
                  KRA: {branch.kraPin}
                </span>
              )}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {(branches || []).length === 0 && (
          <div className="col-span-full bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center">
            <div className="w-14 h-14 bg-blue-50 text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <Building2 size={28} />
            </div>
            <p className="text-sm font-bold text-slate-600">No branches yet</p>
            <p className="text-xs text-slate-400 mt-1">Add your first location to get started.</p>
          </div>
        )}
      </div>

      {/* Add / Edit Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsFormOpen(false)} />
          <div className="relative w-full max-w-xl bg-white rounded-[2.5rem] shadow-2xl p-8 animate-in slide-in-from-bottom sm:zoom-in-95 duration-300 z-10 max-h-[90vh] overflow-y-auto no-scrollbar">
            
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-5">
              <Building2 size={24} />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-1">
              {editingId ? 'Edit Branch' : 'New Branch'}
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              {editingId ? 'Update branch details below.' : 'Add a new store location to your network.'}
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Branch Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="e.g. Westlands Branch"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Location / Area *</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="e.g. Westlands, Nairobi"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="0700..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Till No.</label>
                  <input
                    type="text"
                    value={form.tillNumber}
                    onChange={e => setForm(f => ({ ...f, tillNumber: e.target.value }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                    placeholder="123456"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">KRA PIN (optional)</label>
                <input
                  type="text"
                  value={form.kraPin}
                  onChange={e => setForm(f => ({ ...f, kraPin: e.target.value }))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                  placeholder="P0012345678X"
                />
              </div>

              <div className="pt-4 border-t border-slate-100">
                 <h4 className="text-[10px] font-black text-blue-600   mb-4 flex items-center gap-2">
                   <Smartphone size={12} /> Daraja API Integration (M-Pesa)
                 </h4>
                 <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">M-Pesa Env</label>
                      <select 
                        value={form.mpesaEnv} 
                        onChange={e => setForm(f => ({ ...f, mpesaEnv: e.target.value as any }))}
                        className="w-full bg-blue-50/50 border border-blue-100 rounded-xl px-4 py-3 text-sm font-black text-blue-900 focus:outline-none focus:border-blue-500"
                      >
                        <option value="sandbox">Sandbox (Testing)</option>
                        <option value="production">Production (Live)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">M-Pesa Type</label>
                      <select 
                        value={form.mpesaType} 
                        onChange={e => setForm(f => ({ ...f, mpesaType: e.target.value as any }))}
                        className="w-full bg-blue-50/50 border border-blue-100 rounded-xl px-4 py-3 text-sm font-black text-blue-900 focus:outline-none focus:border-blue-500"
                      >
                        <option value="paybill">Paybill</option>
                        <option value="buygoods">Buy Goods (Till)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Consumer Key</label>
                      <input
                        type="text"
                        value={form.mpesaConsumerKey}
                        onChange={e => setForm(f => ({ ...f, mpesaConsumerKey: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="App Key"
                      />
                    </div>
                 </div>
                 <div className="grid grid-cols-2 gap-3 mb-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Store Number</label>
                      <input
                        type="text"
                        value={form.mpesaStoreNumber}
                        onChange={e => setForm(f => ({ ...f, mpesaStoreNumber: e.target.value }))}
                        className={`w-full border rounded-xl px-4 py-3 text-sm font-bold transition-colors focus:outline-none ${form.mpesaType === 'buygoods' ? 'bg-blue-50 border-blue-200 text-slate-900 focus:border-blue-500' : 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'}`}
                        placeholder="Required for Till"
                        disabled={form.mpesaType !== 'buygoods'}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">LNM Passkey</label>
                      <input
                        type="password"
                        value={form.mpesaPasskey}
                        onChange={e => setForm(f => ({ ...f, mpesaPasskey: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="Online Passkey"
                      />
                    </div>
                 </div>
                 <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400   mb-1.5 ml-1">Consumer Secret</label>
                      <input
                        type="password"
                        value={form.mpesaConsumerSecret}
                        onChange={e => setForm(f => ({ ...f, mpesaConsumerSecret: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-colors"
                        placeholder="App Secret"
                      />
                    </div>
                 </div>
              </div>
            </div>

            <div className="flex gap-3 mt-7">
              <button
                onClick={() => { setIsFormOpen(false); setEditingId(null); setForm(BLANK); }}
                className="flex-1 py-4 bg-slate-100 text-slate-700 font-bold text-[10px]   rounded-2xl hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.location.trim() || saving}
                className="flex-[2] py-4 bg-blue-600 text-white font-bold text-[10px]   rounded-2xl disabled:opacity-50 shadow-lg shadow-blue-600/20 active:scale-95 transition-all"
              >
                {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Branch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
