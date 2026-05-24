import React, { useState } from 'react';
import { Check, GlassWater, Lightbulb, Package, Pencil, Plus, Save, ShoppingBag, Tag as TagIcon, Trash2, Utensils, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Category } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import { CategoryService } from '../../services/catalog';
import { belongsToActiveShop } from '../../utils/shopScope';

export interface CategoryManagementModalViewProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile?: boolean;
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
  { name: 'blue', bg: 'bg-blue-500', text: 'text-blue-700', light: 'bg-blue-50' },
  { name: 'purple', bg: 'bg-purple-500', text: 'text-purple-700', light: 'bg-purple-50' },
  { name: 'yellow', bg: 'bg-yellow-500', text: 'text-yellow-700', light: 'bg-yellow-50' },
  { name: 'slate', bg: 'bg-slate-600', text: 'text-slate-700', light: 'bg-slate-50' },
  { name: 'green', bg: 'bg-green-500', text: 'text-green-700', light: 'bg-green-50' },
  { name: 'red', bg: 'bg-red-500', text: 'text-red-700', light: 'bg-red-50' },
];

const blankForm = { name: '', iconName: 'Package', color: 'slate' };

export default function CategoryManagementModalView({ isOpen, onClose, isMobile = false }: CategoryManagementModalViewProps) {
  const { success, error, warning } = useToast();
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const categories = useLiveQuery(
    () => activeBusinessId
      ? db.categories.where('businessId').equals(activeBusinessId).filter(category => belongsToActiveShop(category, activeShopId)).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(blankForm);
  const [isSaving, setIsSaving] = useState(false);

  const sortedCategories = [...(categories || [])].sort((a, b) => a.name.localeCompare(b.name));

  if (!isOpen) return null;

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setForm(blankForm);
  };

  const handleClose = () => {
    closeForm();
    onClose();
  };

  const startCreate = () => {
    setEditingId(null);
    setForm(blankForm);
    setIsFormOpen(true);
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setForm({
      name: cat.name,
      iconName: cat.iconName || 'Package',
      color: cat.color || 'slate',
    });
    setIsFormOpen(true);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      warning('Please enter a category name.');
      return;
    }
    if (isSaving) return;

    try {
      if (!activeBusinessId) return error('Please log in again.');
      setIsSaving(true);
      await CategoryService.save({
        category: {
          id: editingId || undefined,
          name,
          iconName: form.iconName || 'Package',
          color: form.color || 'slate',
        },
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await db.categories.reload();
      success(editingId ? 'Category updated successfully.' : 'New category created.');
      closeForm();
    } catch (err: any) {
      error(err?.message || 'Failed to save category.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"? Products in this category will need to be reassigned.`)) return;

    try {
      if (!activeBusinessId) return error('Please log in again.');
      await CategoryService.delete({ categoryId: id, businessId: activeBusinessId, shopId: activeShopId });
      await db.categories.reload();
      if (editingId === id) closeForm();
      success('Category removed.');
    } catch (err: any) {
      error(err?.message || 'Failed to remove category.');
    }
  };

  return (
    <>
      <div className={`${isMobile ? 'mobile-vv-overlay ' : ''}fixed inset-0 z-[120] flex items-center justify-center p-4`}>
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={handleClose} />

        <div className={`${isMobile ? 'mobile-vv-panel ' : ''}relative z-10 flex max-h-[90vh] w-full max-w-lg animate-in flex-col rounded-2xl bg-white shadow-elevated duration-200 zoom-in-95`}>
          <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-6 sm:p-8">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-blue grad-blue">
                <TagIcon size={24} />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black tracking-tight text-slate-900">Manage categories</h2>
                <p className="text-xs font-bold text-slate-400">Registered inventory categories</p>
              </div>
            </div>
            <button onClick={handleClose} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 transition-colors hover:text-slate-600" aria-label="Close categories">
              <X size={20} />
            </button>
          </div>

          <div className={`${isMobile ? 'modal-scroll-padding ' : ''}flex-1 overflow-y-auto p-6 custom-scrollbar sm:p-8`}>
            <div className="space-y-3">
              <button onClick={startCreate} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 p-4 text-slate-500 transition-all hover:border-blue-400 hover:text-blue-600">
                <Plus size={20} />
                <span className="text-xs font-black">Add new category</span>
              </button>

              {sortedCategories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-slate-400">
                  <p className="text-xs font-bold">No categories defined</p>
                </div>
              ) : sortedCategories.map(cat => {
                const colorOpt = COLOR_OPTIONS.find(color => color.name === cat.color) || COLOR_OPTIONS[4];
                const IconComp = ICON_OPTIONS.find(icon => icon.name === cat.iconName)?.icon || Package;

                return (
                  <div key={cat.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all hover:border-blue-200">
                    <div className="flex min-w-0 items-center gap-4">
                      <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-slate-50 ${colorOpt.light} ${colorOpt.text} shadow-sm`}>
                        <IconComp size={22} />
                      </div>
                      <h4 className="min-w-0 truncate text-[15px] font-black text-slate-900">{cat.name}</h4>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button onClick={() => startEdit(cat)} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 transition-colors hover:border-blue-200 hover:text-blue-700" title="Edit category">
                        <Pencil size={16} />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                      <button onClick={() => handleDelete(cat.id, cat.name)} className="flex h-10 items-center gap-2 rounded-xl border border-rose-100 bg-white px-3 text-xs font-black text-rose-600 transition-colors hover:bg-rose-50" title="Delete category">
                        <Trash2 size={16} />
                        <span className="hidden sm:inline">Delete</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {isFormOpen && (
        <div className={`${isMobile ? 'mobile-vv-overlay ' : ''}fixed inset-0 z-[130] flex items-center justify-center p-4`}>
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={closeForm} />

          <div className={`${isMobile ? 'mobile-vv-panel ' : ''}relative z-10 flex max-h-[90vh] w-full max-w-md animate-in flex-col rounded-2xl bg-white shadow-elevated duration-200 zoom-in-95`}>
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-6">
              <div>
                <h3 className="text-lg font-black text-slate-900">{editingId ? 'Edit category' : 'Add new category'}</h3>
                <p className="text-xs font-bold text-slate-400">Name, icon, and category color</p>
              </div>
              <button onClick={closeForm} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 hover:text-slate-600" aria-label="Close category form">
                <X size={20} />
              </button>
            </div>

            <div className={`${isMobile ? 'modal-scroll-padding ' : ''}flex-1 overflow-y-auto p-6 custom-scrollbar`}>
              <div className="space-y-6">
                <div>
                  <label className="mb-3 ml-1 block text-[11px] font-black text-slate-400">Category name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={event => setForm({ ...form, name: event.target.value })}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-black text-slate-900 transition-all focus:border-blue-500 focus:outline-none"
                    placeholder="e.g. Snacks, Electronics..."
                    autoFocus
                  />
                </div>

                <div>
                  <label className="mb-3 ml-1 block text-[11px] font-black text-slate-400">Choose icon</label>
                  <div className="grid grid-cols-6 gap-3">
                    {ICON_OPTIONS.map(opt => (
                      <button
                        key={opt.name}
                        onClick={() => setForm({ ...form, iconName: opt.name })}
                        className={`flex h-12 w-12 items-center justify-center rounded-xl border transition-all ${form.iconName === opt.name ? 'border-blue-600 bg-blue-600 text-white shadow-md' : 'border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200'}`}
                        aria-label={`Use ${opt.name} icon`}
                      >
                        <opt.icon size={20} />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-3 ml-1 block text-[11px] font-black text-slate-400">Theme color</label>
                  <div className="grid grid-cols-7 gap-3">
                    {COLOR_OPTIONS.map(opt => (
                      <button
                        key={opt.name}
                        onClick={() => setForm({ ...form, color: opt.name })}
                        className={`flex h-10 w-10 items-center justify-center rounded-full border-4 ${opt.bg} transition-all ${form.color === opt.name ? 'scale-110 border-white shadow-lg ring-2 ring-slate-900' : 'border-transparent opacity-80 hover:opacity-100'}`}
                        aria-label={`Use ${opt.name} color`}
                      >
                        {form.color === opt.name && <Check size={16} className="text-white" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 gap-4 border-t border-slate-100 p-6">
              <button onClick={closeForm} disabled={isSaving} className="flex-1 rounded-2xl bg-slate-100 px-6 py-4 text-xs font-black text-slate-600 transition-all disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isSaving || !form.name.trim()} className="flex-[2] flex items-center justify-center gap-2 rounded-2xl px-6 py-4 text-xs font-black text-white shadow-blue transition-all disabled:opacity-50 grad-blue">
                <Save size={18} /> {isSaving ? 'Saving...' : editingId ? 'Update category' : 'Create category'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
