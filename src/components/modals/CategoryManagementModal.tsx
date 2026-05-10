import React, { useState } from 'react';
import { Plus, Tag as TagIcon, Trash2, Save, X, Utensils, GlassWater, ShoppingBag, Lightbulb, Package, Palette, Check } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Category } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';

interface CategoryManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ICON_OPTIONS = [
  { name: 'Utensils', icon: Utensils },
  { name: 'GlassWater', icon: GlassWater },
  { name: 'ShoppingBag', icon: ShoppingBag },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Package', icon: Package },
  { name: 'Tag', icon: TagIcon },
];

const COLOR_OPTIONS = [
  { name: 'orange', bg: 'bg-orange-500', text: 'text-orange-700', light: 'bg-orange-50' },
  { name: 'blue',   bg: 'bg-blue-500',   text: 'text-blue-700',   light: 'bg-blue-50'   },
  { name: 'purple', bg: 'bg-purple-500', text: 'text-purple-700', light: 'bg-purple-50' },
  { name: 'yellow', bg: 'bg-yellow-500', text: 'text-yellow-700', light: 'bg-yellow-50' },
  { name: 'slate',  bg: 'bg-slate-600',  text: 'text-slate-700',  light: 'bg-slate-50'  },
  { name: 'green',  bg: 'bg-green-500',  text: 'text-green-700',  light: 'bg-green-50'  },
  { name: 'red',    bg: 'bg-red-500',    text: 'text-red-700',    light: 'bg-red-50'    },
];

export default function CategoryManagementModal({ isOpen, onClose }: CategoryManagementModalProps) {
  const { success, error, warning } = useToast();
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const categories = useLiveQuery(
    () => activeBusinessId ? db.categories.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', iconName: 'Package', color: 'slate' });

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!form.name.trim()) {
      warning("Please enter a category name.");
      return;
    }

    try {
      if (editingId) {
        await db.categories.update(editingId, { ...form, updated_at: Date.now() });
        success("Category updated successfully.");
      } else {
        await db.categories.add({
          id: crypto.randomUUID(),
          ...form,
          updated_at: Date.now(),
          businessId: activeBusinessId!
        });
        success("New category created.");
      }
      resetForm();
      db.syncAll(); // Proactive sync
    } catch (err) {
      error("Failed to save category.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"? Products in this category will need to be reassigned.`)) {
      await db.categories.delete(id);
      success("Category removed.");
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setForm({ name: cat.name, iconName: cat.iconName, color: cat.color });
    setIsAdding(true);
  };

  const resetForm = () => {
    setForm({ name: '', iconName: 'Package', color: 'slate' });
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
            <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center text-white shadow-blue">
              <TagIcon size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Manage Categories</h2>
              <p className="text-slate-400 text-xs font-bold  ">Organize your inventory</p>
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
                <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Category name</label>
                <input 
                  type="text" 
                  value={form.name} 
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-5 py-4 text-sm font-black text-slate-900 focus:outline-none focus:border-blue-500 transition-all"
                  placeholder="e.g. Snacks, Electronics..."
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Choose icon</label>
                <div className="grid grid-cols-6 gap-3">
                  {ICON_OPTIONS.map(opt => (
                    <button
                      key={opt.name}
                      onClick={() => setForm({...form, iconName: opt.name})}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all border ${form.iconName === opt.name ? 'bg-blue-600 text-white border-blue-600 shadow-md' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-200'}`}
                    >
                      <opt.icon size={20} />
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black text-slate-400   mb-3 ml-1">Theme color</label>
                <div className="grid grid-cols-7 gap-3">
                  {COLOR_OPTIONS.map(opt => (
                    <button
                      key={opt.name}
                      onClick={() => setForm({...form, color: opt.name})}
                      className={`w-10 h-10 rounded-full ${opt.bg} flex items-center justify-center transition-all border-4 ${form.color === opt.name ? 'border-white ring-2 ring-slate-900 shadow-lg scale-110' : 'border-transparent opacity-80 hover:opacity-100'}`}
                    >
                      {form.color === opt.name && <Check size={16} className="text-white" />}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button onClick={resetForm} className="flex-1 px-6 py-4 bg-slate-100 text-slate-600 font-black text-xs   rounded-2xl transition-all press">
                  Cancel
                </button>
                <button onClick={handleSave} className="flex-[2] grad-blue text-white px-6 py-4 font-black text-xs   rounded-2xl transition-all shadow-blue press flex items-center justify-center gap-2">
                  <Save size={18} /> {editingId ? 'Update' : 'Create'} Category
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button onClick={() => setIsAdding(true)} className="w-full p-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-all flex items-center justify-center gap-2 group">
                <Plus size={20} className="group-hover:scale-110 transition-transform" />
                <span className="font-black text-xs  ">Add new category</span>
              </button>

              {categories?.map(cat => {
                const colorOpt = COLOR_OPTIONS.find(c => c.name === cat.color) || COLOR_OPTIONS[4];
                const IconComp = ICON_OPTIONS.find(i => i.name === cat.iconName)?.icon || Package;

                return (
                  <div key={cat.id} className="group bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between hover:border-blue-200 transition-all">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl ${colorOpt.light} flex items-center justify-center ${colorOpt.text} border border-slate-50 shadow-sm`}>
                        <IconComp size={22} />
                      </div>
                      <h4 className="text-[15px] font-black text-slate-900">{cat.name}</h4>
                    </div>
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(cat)} className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                        <Palette size={18} />
                      </button>
                      <button onClick={() => handleDelete(cat.id, cat.name)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {categories?.length === 0 && (
                <div className="py-12 text-center text-slate-400">
                  <p className="text-xs font-bold  ">No categories defined</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

