import React, { useState } from 'react';
import { Plus, Trash2, Save, X, BookOpen } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type ExpenseAccount } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';

interface ExpenseAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExpenseAccountModal({ isOpen, onClose }: ExpenseAccountModalProps) {
  const { success, error, warning } = useToast();
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const accounts = useLiveQuery(
    () => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!form.name.trim()) {
      warning("Please enter an account name.");
      return;
    }

    try {
      if (editingId) {
        await db.expenseAccounts.update(editingId, {
          name: form.name.trim(),
          description: form.description.trim(),
          businessId: activeBusinessId!,
          updated_at: Date.now()
        });
        success("Expense account updated.");
      } else {
        await db.expenseAccounts.add({
          id: crypto.randomUUID(),
          name: form.name.trim(),
          description: form.description.trim(),
          updated_at: Date.now(),
          businessId: activeBusinessId!
        });
        success("New expense account created.");
      }
      resetForm();
    } catch (err) {
      error("Failed to save expense account.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      await db.expenseAccounts.delete(id);
      success("Expense account removed.");
    }
  };

  const startEdit = (acc: ExpenseAccount) => {
    setEditingId(acc.id);
    setForm({ name: acc.name, description: acc.description || '' });
    setIsAdding(true);
  };

  const resetForm = () => {
    setForm({ name: '', description: '' });
    setIsAdding(false);
    setEditingId(null);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-elevated relative z-10 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-orange-100 rounded-2xl flex items-center justify-center text-orange-600 shadow-sm">
              <BookOpen size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Expense accounts</h2>
              <p className="text-slate-400 text-xs font-bold  ">Define expense categories</p>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-2xl bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {isAdding ? (
            <div className="space-y-6 animate-in slide-in-from-top-4">
              <div>
                <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Account name</label>
                <input 
                  type="text" 
                  value={form.name} 
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-orange-500 transition-all"
                  placeholder="e.g. Rent, Electricity, Internet..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Description (optional)</label>
                <textarea 
                  value={form.description} 
                  onChange={e => setForm({...form, description: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-orange-500 transition-all h-24 resize-none"
                  placeholder="Additional details..."
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={resetForm} className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-black text-xs   rounded-2xl transition-all press">
                  Cancel
                </button>
                <button onClick={handleSave} className="flex-[2] bg-orange-600 text-white px-6 py-4 font-black text-xs   rounded-2xl transition-all shadow-lg shadow-orange-600/20 press flex items-center justify-center gap-2">
                  <Save size={18} /> {editingId ? 'Update' : 'Create'} account
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button onClick={() => setIsAdding(true)} className="w-full p-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 hover:border-orange-400 hover:text-orange-500 transition-all flex items-center justify-center gap-2 group">
                <Plus size={20} className="group-hover:scale-110 transition-transform" />
                <span className="font-black text-xs  ">Add new account</span>
              </button>

              {accounts?.map(acc => (
                <div key={acc.id} className="group bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between hover:border-orange-200 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600 border border-orange-50 shadow-sm">
                      <BookOpen size={22} />
                    </div>
                    <div>
                      <h4 className="text-[15px] font-black text-slate-900">{acc.name}</h4>
                      {acc.description && <p className="text-[10px] text-slate-400 font-medium">{acc.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => startEdit(acc)} className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                      <Plus size={18} className="rotate-45" /> {/* Just to use an icon for edit */}
                      <Save size={18} className="hidden" />
                      {/* Using Trash and Pen like icons */}
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-pencil"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                    </button>
                    <button onClick={() => handleDelete(acc.id, acc.name)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}

              {accounts?.length === 0 && (
                <div className="py-12 text-center text-slate-400">
                  <p className="text-xs font-bold  ">No expense accounts defined</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

