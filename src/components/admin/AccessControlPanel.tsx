import React from 'react';
import { Eye, EyeOff, LockKeyhole, Pencil, ShieldCheck, X } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import { BusinessSettingsService } from '../../services/businessSettings';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import { settingsIdForBusiness, getBusinessSettings } from '../../utils/settings';
import {
  ACCESS_CONTROL_GROUPS,
  type AccessFeatureId,
  type AccessMode,
  type ManagedRole,
  getDefaultAccessControl,
  normalizeAccessControl,
} from '../../utils/accessControl';

const roleOptions: Array<{ id: ManagedRole; label: string; description: string }> = [
  { id: 'CASHIER', label: 'Cashier', description: 'People selling at the counter.' },
  { id: 'MANAGER', label: 'Manager', description: 'Supervisors with extra controls.' },
];

function modeLabel(mode: AccessMode) {
  if (mode === 'OPEN') return 'Open';
  if (mode === 'BLURRED') return 'Blur';
  return 'Lock';
}

function modeIcon(mode: AccessMode) {
  if (mode === 'OPEN') return Eye;
  if (mode === 'BLURRED') return EyeOff;
  return LockKeyhole;
}

function modeClass(active: boolean, mode: AccessMode) {
  if (!active) return 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:text-blue-700';
  if (mode === 'OPEN') return 'border-blue-700 bg-blue-700 text-white';
  if (mode === 'BLURRED') return 'border-slate-700 bg-slate-700 text-white';
  return 'border-rose-600 bg-rose-600 text-white';
}

function AccessDrawer({
  onClose,
  children,
  footer,
}: {
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const isPhoneUi = usePhoneUi();

  return (
    <div className={`${isPhoneUi ? 'mobile-vv-overlay ' : ''}fixed inset-0 z-[120] flex justify-end bg-slate-950/45 backdrop-blur-sm`}>
      <section className={`${isPhoneUi ? 'mobile-vv-panel ' : ''}flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-2xl sm:border-l-2 sm:border-slate-200`}>
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-slate-950">Edit access controls</h3>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">Choose what cashier and manager accounts can open, see blurred, or cannot access.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
            aria-label="Close access editor"
          >
            <X size={18} />
          </button>
        </header>
        <div className={`${isPhoneUi ? 'modal-scroll-padding ' : ''}min-h-0 flex-1 overflow-y-auto p-4 sm:p-5`}>
          {children}
        </div>
        <footer className={`${isPhoneUi ? 'mobile-popup-footer ' : ''}border-t-2 border-slate-200 bg-slate-50 p-4 sm:p-5`}>
          {footer}
        </footer>
      </section>
    </div>
  );
}

function CountText({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'blue' | 'slate' | 'rose' }) {
  const toneClass = tone === 'blue' ? 'text-blue-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-700';
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={`text-lg font-black tabular-nums ${toneClass}`}>{value}</span>
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
    </span>
  );
}

const featureLabels = new Map(
  ACCESS_CONTROL_GROUPS.flatMap(group => group.features.map(feature => [feature.id, feature.label] as const)),
);

function modeSummaryLabels(config: Record<AccessFeatureId, AccessMode>, mode: AccessMode) {
  return Object.entries(config)
    .filter(([, value]) => value === mode)
    .map(([feature]) => featureLabels.get(feature as AccessFeatureId) || feature)
    .slice(0, 8);
}

export default function AccessControlPanel() {
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const [activeRole, setActiveRole] = React.useState<ManagedRole>('CASHIER');
  const [draft, setDraft] = React.useState(getDefaultAccessControl());
  const [isSaving, setIsSaving] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const { success, error } = useToast();

  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const savedAccessControl = React.useMemo(() => normalizeAccessControl(businessSettings), [businessSettings]);

  React.useEffect(() => {
    setDraft(savedAccessControl);
  }, [savedAccessControl]);

  const setFeatureMode = (featureId: AccessFeatureId, mode: AccessMode) => {
    setDraft(current => ({
      ...current,
      [activeRole]: {
        ...current[activeRole],
        [featureId]: mode,
      },
    }));
  };

  const resetRole = () => {
    const defaults = getDefaultAccessControl();
    setDraft(current => ({ ...current, [activeRole]: defaults[activeRole] }));
  };

  const saveAccessControls = async () => {
    if (!activeBusinessId || isSaving) return;
    setIsSaving(true);
    try {
      const result = await BusinessSettingsService.save({
        businessId: activeBusinessId,
        settings: {
          ...(businessSettings || {}),
          id: businessSettings?.id || settingsIdForBusiness(activeBusinessId),
          storeName: businessSettings?.storeName || 'Smart Shop',
          location: businessSettings?.location || 'Nairobi, Kenya',
          tillNumber: businessSettings?.tillNumber || '',
          kraPin: businessSettings?.kraPin || '',
          receiptFooter: businessSettings?.receiptFooter || 'Thank you for shopping!',
          accessControl: draft,
          businessId: activeBusinessId,
        },
      });
      if (result.settings) await db.settings.cacheLocal(result.settings);
      await db.settings.reload().catch(() => {});
      setIsEditing(false);
      success('Access controls saved.');
    } catch (err: any) {
      error(err?.message || 'Could not save access controls.');
    } finally {
      setIsSaving(false);
    }
  };

  const openEditor = () => {
    setDraft(savedAccessControl);
    setIsEditing(true);
  };

  const closeEditor = () => {
    setDraft(savedAccessControl);
    setIsEditing(false);
  };

  const roleSummaries = roleOptions.map(role => {
    const values = Object.values(savedAccessControl[role.id] || {});
    return {
      ...role,
      open: values.filter(mode => mode === 'OPEN').length,
      blurred: values.filter(mode => mode === 'BLURRED').length,
      locked: values.filter(mode => mode === 'LOCKED').length,
      openLabels: modeSummaryLabels(savedAccessControl[role.id], 'OPEN'),
      blurredLabels: modeSummaryLabels(savedAccessControl[role.id], 'BLURRED'),
      lockedLabels: modeSummaryLabels(savedAccessControl[role.id], 'LOCKED'),
    };
  });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-blue-700">
              <ShieldCheck size={18} />
              <p className="text-[10px] font-black uppercase tracking-widest">Access controls</p>
            </div>
            <h3 className="mt-2 text-lg font-black text-slate-950">Lock or blur staff features</h3>
            <p className="mt-1 max-w-2xl text-sm font-semibold text-slate-500">
              Admin accounts always keep full access. These controls apply to cashier and manager accounts.
            </p>
          </div>
          <button
            type="button"
            onClick={openEditor}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800"
          >
            <Pencil size={15} />
            Edit access
          </button>
        </div>
      </section>

      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="border-b border-slate-200 pb-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Permission report</p>
          <h4 className="mt-2 text-xl font-black text-slate-950">Staff role access</h4>
          <p className="mt-1 text-xs font-bold text-slate-500">Owner preview of what each role can open, see masked, or cannot use.</p>
        </div>
        <div className="divide-y divide-slate-200">
        {roleSummaries.map(role => (
          <div key={role.id} className="py-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div className="min-w-0">
                <h4 className="text-base font-black text-slate-950">{role.label}</h4>
                <p className="mt-1 text-xs font-bold text-slate-500">{role.description}</p>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <CountText label="Open" value={role.open} tone="blue" />
                <CountText label="Blurred" value={role.blurred} />
                <CountText label="Locked" value={role.locked} tone="rose" />
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Can open</p>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
                  {role.openLabels.length ? role.openLabels.join(', ') : 'Nothing selected'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Masked</p>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
                  {role.blurredLabels.length ? role.blurredLabels.join(', ') : 'No masked values'}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Blocked</p>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-700">
                  {role.lockedLabels.length ? role.lockedLabels.join(', ') : 'Nothing blocked'}
                </p>
              </div>
            </div>
          </div>
        ))}
        </div>
      </section>

      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="border-b border-slate-200 pb-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Control groups</p>
          <h4 className="mt-2 text-base font-black text-slate-950">Feature groups</h4>
        </div>
        <div className="divide-y divide-slate-200">
          {ACCESS_CONTROL_GROUPS.map(group => (
            <div key={group.id} className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <p className="text-sm font-black text-slate-900">{group.title}</p>
              <p className="text-xs font-bold text-slate-500">{group.features.length} controls</p>
            </div>
          ))}
        </div>
      </section>

      {isEditing && (
        <AccessDrawer
          onClose={closeEditor}
          footer={(
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={closeEditor}
                className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={resetRole}
                className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
              >
                Reset role
              </button>
              <button
                type="button"
                onClick={saveAccessControls}
                disabled={isSaving}
                className="h-12 flex-[2] rounded-lg border-2 border-blue-700 bg-blue-700 px-5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save controls'}
              </button>
            </div>
          )}
        >
          <div className="space-y-5">
            <section className="rounded-lg border-2 border-slate-200 bg-white p-2">
              <div className="grid grid-cols-2 gap-2">
                {roleOptions.map(role => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setActiveRole(role.id)}
                    className={`rounded-lg border-2 px-4 py-3 text-left transition ${
                      activeRole === role.id
                        ? 'border-blue-700 bg-blue-700 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200'
                    }`}
                  >
                    <span className="block text-sm font-black">{role.label}</span>
                    <span className={`mt-1 block text-[10px] font-bold ${activeRole === role.id ? 'text-blue-100' : 'text-slate-400'}`}>
                      {role.description}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {ACCESS_CONTROL_GROUPS.map(group => (
              <section key={group.id} className="rounded-lg border-2 border-slate-200 bg-white p-4">
                <div className="mb-4">
                  <h4 className="text-base font-black text-slate-950">{group.title}</h4>
                  <p className="mt-1 text-xs font-bold text-slate-400">{group.description}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {group.features.map(feature => {
                    const currentMode = draft[activeRole][feature.id] || 'LOCKED';
                    const modes: AccessMode[] = feature.allowBlur ? ['OPEN', 'BLURRED', 'LOCKED'] : ['OPEN', 'LOCKED'];
                    return (
                      <div key={feature.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900">{feature.label}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{feature.description}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                          {modes.map(mode => {
                            const Icon = modeIcon(mode);
                            const active = currentMode === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => setFeatureMode(feature.id, mode)}
                                className={`flex h-10 items-center justify-center gap-2 rounded-lg border-2 px-3 text-[10px] font-black uppercase tracking-widest transition ${modeClass(active, mode)}`}
                              >
                                <Icon size={14} />
                                {modeLabel(mode)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </AccessDrawer>
      )}
    </div>
  );
}
