import React from 'react';
import {
  Building2,
  Check,
  Download,
  CreditCard,
  Loader2,
  KeyRound,
  Printer,
  RefreshCcw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Store,
  Usb,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_CASH_DRAWER_LIMIT } from '../../utils/ownerMode';
import { getBusinessSettings, settingsIdForBusiness } from '../../utils/settings';
import {
  assignBrowserPrinter,
  assignKeyboardScanner,
  clearHardwareAssignment,
  getHardwareSupport,
  listGrantedHardwareDevices,
  loadHardwareAssignments,
  openAssignedCashDrawer,
  requestBluetoothHardwareDevice,
  requestCameraScanner,
  requestHidHardwareDevice,
  requestSerialHardwareDevice,
  requestUsbHardwareDevice,
  saveHardwareAssignment,
  testAssignedReceiptPrinter,
  type HardwareDeviceRole,
  type HardwareDeviceSummary,
  type HardwareSupport,
} from '../../utils/hardware';
import { normalizeTillCount, parseSalesTillRows, parseSalesTills, scopeSalesTillIds, serializeSalesTills, type SalesTill } from '../../utils/tills';
import { BusinessSettingsService } from '../../services/businessSettings';
import { getShopMpesaSettings, saveShopMpesaSettings, testShopMpesaSettings, type MpesaSettingsStatus } from '../../services/mpesaSettings';

type SettingsTabMobileProps = {
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
  needRefresh: boolean;
};

type SectionId = 'business' | 'tills' | 'owner' | 'mpesa' | 'hardware' | 'system';

const sections: Array<{ id: SectionId; label: string; detail: string; Icon: LucideIcon }> = [
  { id: 'business', label: 'Business', detail: 'Receipt identity', Icon: Building2 },
  { id: 'tills', label: 'Tills', detail: 'Counters and float', Icon: Store },
  { id: 'owner', label: 'Owner mode', detail: 'Approvals and limits', Icon: ShieldCheck },
  { id: 'mpesa', label: 'Payments', detail: 'Push API and PesaPal', Icon: CreditCard },
  { id: 'hardware', label: 'Hardware', detail: 'Printer and scanner', Icon: Usb },
  { id: 'system', label: 'System', detail: 'Updates and access', Icon: Download },
];

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;
const present = (value: unknown, fallback = 'Not set') => String(value ?? '').trim() || fallback;

function Pill({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      {children}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">{children}</label>;
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${props.className || ''}`}
    />
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-12 w-full rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-bold text-slate-950 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${props.className || ''}`}
    />
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
}) {
  const styles = variant === 'primary'
    ? 'border-blue-700 bg-blue-700 text-white active:bg-blue-800'
    : variant === 'danger'
      ? 'border-red-200 bg-red-50 text-red-700 active:bg-red-100'
      : 'border-slate-300 bg-white text-slate-700 active:bg-slate-100';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-12 min-w-0 items-center justify-center gap-2 rounded-lg border-2 px-3 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border-2 border-slate-200 bg-white p-4 text-left active:bg-slate-50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-black text-slate-950">{label}</span>
        <span className="mt-1 block text-xs font-bold leading-relaxed text-slate-500">{detail}</span>
      </span>
      <span className={`flex h-7 w-12 shrink-0 items-center rounded-full border-2 p-0.5 transition ${checked ? 'border-blue-700 bg-blue-700' : 'border-slate-300 bg-slate-200'}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex items-start gap-3 py-3">
      {Icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700">
          <Icon size={17} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
        <div className="mt-1 break-words text-sm font-black text-slate-950">{value}</div>
      </div>
    </div>
  );
}

function MobileDrawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="mobile-vv-overlay fixed inset-0 z-[140] flex items-end bg-slate-950/45 backdrop-blur-sm">
      <section className="mobile-vv-panel flex max-h-[94dvh] w-full flex-col rounded-t-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b-2 border-slate-200 px-4 py-4">
          <h3 className="min-w-0 truncate text-lg font-black text-slate-950">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-600"
            aria-label="Close settings"
          >
            <X size={18} />
          </button>
        </header>
        <div className="modal-scroll-padding min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {children}
        </div>
        <footer className="mobile-popup-footer border-t-2 border-slate-200 bg-slate-50 p-4">
          {footer}
        </footer>
      </section>
    </div>
  );
}

export default function SettingsTabMobile({ updateServiceWorker, needRefresh }: SettingsTabMobileProps) {
  const isAdmin = useStore((state) => state.isAdmin);
  const currentUser = useStore((state) => state.currentUser);
  const activeBusinessId = useStore((state) => state.activeBusinessId);
  const { success, warning, error } = useToast();

  const savedSettings = useLiveQuery(
    async () => activeBusinessId ? (await getBusinessSettings(activeBusinessId)) || null : null,
    [activeBusinessId]
  );
  const savedTillRows = useLiveQuery(
    () => activeBusinessId
      ? db.salesTills.where('businessId').equals(activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId]
  );

  const savedDrafts = React.useMemo(() => {
    const tableTills = parseSalesTillRows(savedTillRows);
    const tills = tableTills.length ? tableTills : parseSalesTills(savedSettings);
    return {
      store: {
        storeName: savedSettings?.storeName || 'Smart Shop',
        kraPin: savedSettings?.kraPin || '',
        tillNumber: savedSettings?.tillNumber || '',
        receiptFooter: savedSettings?.receiptFooter || 'Thank you for shopping!',
        location: savedSettings?.location || 'Nairobi, Kenya',
      },
      owner: {
        ownerModeEnabled: savedSettings?.ownerModeEnabled === 1,
        autoApproveOwnerActions: savedSettings?.autoApproveOwnerActions !== 0,
        cashSweepEnabled: savedSettings?.cashSweepEnabled !== 0,
        cashDrawerLimit: String(savedSettings?.cashDrawerLimit ?? DEFAULT_CASH_DRAWER_LIMIT),
      },
      tills: {
        count: String(tills.length || 1),
        openingFloat: String(savedSettings?.defaultOpeningFloat ?? 0),
        tills,
      },
    };
  }, [savedSettings, savedTillRows]);

  const [storeSettings, setStoreSettings] = React.useState(savedDrafts.store);
  const [ownerSettings, setOwnerSettings] = React.useState(savedDrafts.owner);
  const [tillSettings, setTillSettings] = React.useState<{ count: string; openingFloat: string; tills: SalesTill[] }>(savedDrafts.tills);
  const [editingSection, setEditingSection] = React.useState<SectionId | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isUpdating, setIsUpdating] = React.useState(false);
  const [hardwareAssignments, setHardwareAssignments] = React.useState(loadHardwareAssignments());
  const [hardwareSupport, setHardwareSupport] = React.useState<HardwareSupport>(() => getHardwareSupport());
  const [isHardwareBusy, setIsHardwareBusy] = React.useState(false);
  const [hardwareMessage, setHardwareMessage] = React.useState('');
  const [mpesaStatus, setMpesaStatus] = React.useState<MpesaSettingsStatus | null>(null);
  const [isMpesaBusy, setIsMpesaBusy] = React.useState(false);
  const [mpesaDraft, setMpesaDraft] = React.useState({
    provider: 'MPESA' as 'MPESA' | 'PESAPAL',
    env: 'sandbox' as 'sandbox' | 'production',
    type: 'paybill' as 'paybill' | 'buygoods',
    product: 'M-PESA EXPRESS',
    shortcode: '',
    storeNumber: '',
    consumerKey: '',
    consumerSecret: '',
    passkey: '',
    pesapalEnv: 'sandbox' as 'sandbox' | 'production',
    pesapalCurrency: 'KES',
    pesapalIpnId: '',
    pesapalConsumerKey: '',
    pesapalConsumerSecret: '',
    adminPassword: '',
  });

  React.useEffect(() => {
    setStoreSettings(savedDrafts.store);
    setOwnerSettings(savedDrafts.owner);
    setTillSettings(savedDrafts.tills);
  }, [savedDrafts]);

  const refreshHardwareDevices = React.useCallback(async (quiet = false) => {
    setIsHardwareBusy(true);
    try {
      setHardwareSupport(getHardwareSupport());
      const devices = await listGrantedHardwareDevices();
      setHardwareAssignments(loadHardwareAssignments());
      if (!quiet) success(`Found ${devices.length} browser hardware item${devices.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      error(err?.message || 'Could not scan hardware devices.');
    } finally {
      setIsHardwareBusy(false);
    }
  }, [error, success]);

  React.useEffect(() => {
    void refreshHardwareDevices(true);
  }, [refreshHardwareDevices]);

  const loadMpesaStatus = React.useCallback(async () => {
    if (!activeBusinessId || (!isAdmin && currentUser?.role !== 'ROOT')) {
      setMpesaStatus(null);
      return;
    }
    const result = await getShopMpesaSettings(activeBusinessId);
    if (result.status) setMpesaStatus(result.status);
  }, [activeBusinessId, currentUser?.role, isAdmin]);

  React.useEffect(() => {
    void loadMpesaStatus();
  }, [loadMpesaStatus]);

  const resetMpesaDraft = React.useCallback(() => {
    setMpesaDraft({
      provider: mpesaStatus?.paymentProvider || 'MPESA',
      env: mpesaStatus?.mpesaEnv || 'sandbox',
      type: mpesaStatus?.mpesaType || 'paybill',
      product: mpesaStatus?.mpesaProduct || 'M-PESA EXPRESS',
      shortcode: storeSettings.tillNumber || '',
      storeNumber: '',
      consumerKey: '',
      consumerSecret: '',
      passkey: '',
      pesapalEnv: mpesaStatus?.pesapalEnv || 'sandbox',
      pesapalCurrency: mpesaStatus?.pesapalCurrency || 'KES',
      pesapalIpnId: '',
      pesapalConsumerKey: '',
      pesapalConsumerSecret: '',
      adminPassword: '',
    });
  }, [mpesaStatus, storeSettings.tillNumber]);

  const settingsLoading = savedSettings === undefined || !savedTillRows;

  if (settingsLoading) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4">
        <Loader2 size={30} className="animate-spin text-blue-700" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading settings...</p>
      </div>
    );
  }

  const openSection = (section: SectionId) => {
    if (section === 'mpesa') resetMpesaDraft();
    setEditingSection(section);
  };

  const handleSaveSettings = async () => {
    if (!activeBusinessId) return error('Please log in again.');
    setIsSaving(true);
    try {
      const normalizedTills = scopeSalesTillIds(
        normalizeTillCount(tillSettings.count, tillSettings.tills),
        activeBusinessId,
      );
      const result = await BusinessSettingsService.save({
        businessId: activeBusinessId,
        settings: {
          ...(savedSettings || {}),
          id: settingsIdForBusiness(activeBusinessId),
          storeName: storeSettings.storeName,
          tillNumber: storeSettings.tillNumber,
          kraPin: storeSettings.kraPin,
          receiptFooter: storeSettings.receiptFooter,
          location: storeSettings.location,
          ownerModeEnabled: ownerSettings.ownerModeEnabled ? 1 : 0,
          autoApproveOwnerActions: ownerSettings.autoApproveOwnerActions ? 1 : 0,
          cashSweepEnabled: ownerSettings.cashSweepEnabled ? 1 : 0,
          cashDrawerLimit: Number(ownerSettings.cashDrawerLimit) || DEFAULT_CASH_DRAWER_LIMIT,
          salesTills: serializeSalesTills(normalizedTills),
          defaultOpeningFloat: Math.max(0, Number(tillSettings.openingFloat) || 0),
          businessId: activeBusinessId,
        },
      });
      if (result.settings) await db.settings.cacheLocal(result.settings);
      await Promise.all([db.settings.reload(), db.salesTills.reload()]);
      setEditingSection(null);
      success('Settings saved.');
    } catch (err: any) {
      error(err?.message || 'Could not save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveMpesaSettings = async () => {
    if (!activeBusinessId || !currentUser?.id) return error('Please log in again.');
    setIsMpesaBusy(true);
    try {
      const result = await saveShopMpesaSettings({
        businessId: activeBusinessId,
        userId: currentUser.id,
        adminPassword: mpesaDraft.adminPassword,
        credentials: {
          provider: mpesaDraft.provider,
          env: mpesaDraft.env,
          type: mpesaDraft.type,
          product: mpesaDraft.product,
          shortcode: mpesaDraft.shortcode,
          storeNumber: mpesaDraft.storeNumber,
          consumerKey: mpesaDraft.consumerKey,
          consumerSecret: mpesaDraft.consumerSecret,
          passkey: mpesaDraft.passkey,
          pesapalEnv: mpesaDraft.pesapalEnv,
          pesapalCurrency: mpesaDraft.pesapalCurrency,
          pesapalIpnId: mpesaDraft.pesapalIpnId,
          pesapalConsumerKey: mpesaDraft.pesapalConsumerKey,
          pesapalConsumerSecret: mpesaDraft.pesapalConsumerSecret,
        },
      });
      if (result.error) return error(result.error);
      if (result.status) setMpesaStatus(result.status);
      setMpesaDraft(prev => ({ ...prev, consumerKey: '', consumerSecret: '', passkey: '', pesapalConsumerKey: '', pesapalConsumerSecret: '', adminPassword: '' }));
      setEditingSection(null);
      success('Payment API settings saved.');
    } finally {
      setIsMpesaBusy(false);
    }
  };

  const handleTestMpesaSettings = async () => {
    if (!activeBusinessId || !currentUser?.id) return error('Please log in again.');
    setIsMpesaBusy(true);
    try {
      const result = await testShopMpesaSettings({
        businessId: activeBusinessId,
        userId: currentUser.id,
        adminPassword: mpesaDraft.adminPassword,
      });
      if (result.error) return error(result.error);
      success(result.message || 'Payment API connection test passed.');
      await loadMpesaStatus();
    } finally {
      setIsMpesaBusy(false);
    }
  };

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      if (needRefresh) {
        await updateServiceWorker(true);
      } else {
        await new Promise(resolve => setTimeout(resolve, 900));
        success('System is fully up to date.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const connectHardware = async (
    transport: 'BROWSER_PRINT' | 'USB' | 'SERIAL' | 'HID' | 'BLUETOOTH' | 'CAMERA' | 'KEYBOARD',
    role: HardwareDeviceRole,
  ) => {
    setIsHardwareBusy(true);
    setHardwareMessage('');
    try {
      let device: HardwareDeviceSummary | null = null;
      if (transport === 'BROWSER_PRINT') {
        assignBrowserPrinter();
        device = { key: 'browser-print:chrome-destinations', transport: 'BROWSER_PRINT', name: 'Chrome printer', granted: true, assignedRole: 'RECEIPT_PRINTER' };
        setHardwareMessage('Chrome printer will use the browser print dialog.');
      }
      if (transport === 'USB') device = await requestUsbHardwareDevice(role);
      if (transport === 'SERIAL') device = await requestSerialHardwareDevice(role);
      if (transport === 'HID') device = await requestHidHardwareDevice(role);
      if (transport === 'BLUETOOTH') device = await requestBluetoothHardwareDevice(role);
      if (transport === 'CAMERA') device = await requestCameraScanner();
      if (transport === 'KEYBOARD') {
        assignKeyboardScanner();
        device = { key: 'keyboard:focused-input', transport: 'KEYBOARD', name: 'USB keyboard scanner', granted: true, assignedRole: 'BARCODE_SCANNER' };
      }
      setHardwareAssignments(loadHardwareAssignments());
      await refreshHardwareDevices(true);
      success(`${device?.name || 'Device'} assigned.`);
    } catch (err: any) {
      error(err?.message || 'Hardware connection was cancelled or blocked.');
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const linkDrawerToPrinter = () => {
    const printer = hardwareAssignments.find(item => item.role === 'RECEIPT_PRINTER');
    if (!printer || printer.transport === 'BROWSER_PRINT') return warning('Assign a direct receipt printer first.');
    setHardwareAssignments(saveHardwareAssignment({
      key: printer.deviceKey,
      transport: printer.transport,
      name: printer.deviceName,
      vendorId: printer.vendorId,
      productId: printer.productId,
      granted: true,
    }, 'CASH_DRAWER'));
    success('Cash drawer linked to the receipt printer.');
  };

  const handleTestPrint = async () => {
    setIsHardwareBusy(true);
    try {
      const result = await testAssignedReceiptPrinter(storeSettings.storeName, storeSettings.location);
      result.ok ? success(result.message) : warning(result.message);
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const handleOpenDrawer = async () => {
    setIsHardwareBusy(true);
    try {
      const result = await openAssignedCashDrawer();
      result.ok ? success(result.message) : warning(result.message);
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const updateTillName = (index: number, name: string) => {
    setTillSettings(prev => {
      const next = normalizeTillCount(prev.count, prev.tills);
      next[index] = { ...next[index], name };
      return { ...prev, tills: next };
    });
  };

  const assignedPrinter = hardwareAssignments.find(item => item.role === 'RECEIPT_PRINTER');
  const assignedScanner = hardwareAssignments.find(item => item.role === 'BARCODE_SCANNER');
  const assignedDrawer = hardwareAssignments.find(item => item.role === 'CASH_DRAWER');
  const directPrinterReady = !!assignedPrinter && assignedPrinter.transport !== 'BROWSER_PRINT';
  const activeTills = normalizeTillCount(tillSettings.count, tillSettings.tills);
  const selectedSection = sections.find(section => section.id === editingSection);

  const saveFooter = (label = 'Save') => (
    <div className="grid grid-cols-2 gap-2">
      <ActionButton variant="secondary" onClick={() => setEditingSection(null)} disabled={isSaving}>Cancel</ActionButton>
      <ActionButton onClick={handleSaveSettings} disabled={isSaving}>
        {isSaving ? <RefreshCcw size={15} className="animate-spin" /> : <Check size={15} />}
        {label}
      </ActionButton>
    </div>
  );

  const renderBusinessEditor = () => (
    <div className="space-y-4">
      <div>
        <FieldLabel>Store name</FieldLabel>
        <TextInput value={storeSettings.storeName} maxLength={160} onChange={event => setStoreSettings(prev => ({ ...prev, storeName: event.target.value }))} />
      </div>
      <div>
        <FieldLabel>Location</FieldLabel>
        <TextInput value={storeSettings.location} maxLength={160} onChange={event => setStoreSettings(prev => ({ ...prev, location: event.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>M-Pesa till</FieldLabel>
          <TextInput value={storeSettings.tillNumber} maxLength={80} onChange={event => setStoreSettings(prev => ({ ...prev, tillNumber: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>KRA PIN</FieldLabel>
          <TextInput value={storeSettings.kraPin} maxLength={80} onChange={event => setStoreSettings(prev => ({ ...prev, kraPin: event.target.value }))} />
        </div>
      </div>
      <div>
        <FieldLabel>Receipt footer</FieldLabel>
        <TextInput value={storeSettings.receiptFooter} maxLength={500} onChange={event => setStoreSettings(prev => ({ ...prev, receiptFooter: event.target.value }))} />
      </div>
    </div>
  );

  const renderTillsEditor = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Till count</FieldLabel>
          <TextInput
            type="number"
            min={1}
            max={12}
            value={tillSettings.count}
            onChange={event => {
              const value = event.target.value;
              setTillSettings(prev => ({ ...prev, count: value, tills: normalizeTillCount(value, prev.tills) }));
            }}
          />
        </div>
        <div>
          <FieldLabel>Opening float</FieldLabel>
          <TextInput type="number" min={0} value={tillSettings.openingFloat} onChange={event => setTillSettings(prev => ({ ...prev, openingFloat: event.target.value }))} />
        </div>
      </div>
      <div className="space-y-3">
        {activeTills.map((till, index) => (
          <div key={`${till.id}-${index}`}>
            <FieldLabel>{`Till ${index + 1}`}</FieldLabel>
            <TextInput value={till.name} maxLength={60} onChange={event => updateTillName(index, event.target.value)} />
          </div>
        ))}
      </div>
    </div>
  );

  const renderOwnerEditor = () => (
    <div className="space-y-3">
      <ToggleRow
        label="Owner mode"
        detail="Enable owner shortcut behavior for a single-owner shop."
        checked={ownerSettings.ownerModeEnabled}
        onChange={checked => setOwnerSettings(prev => ({ ...prev, ownerModeEnabled: checked }))}
      />
      <ToggleRow
        label="Auto approve owner actions"
        detail="Owner actions can complete without a second approval."
        checked={ownerSettings.autoApproveOwnerActions}
        onChange={checked => setOwnerSettings(prev => ({ ...prev, autoApproveOwnerActions: checked }))}
      />
      <ToggleRow
        label="Cash sweep"
        detail="Show the cash sweep action for moving excess till cash."
        checked={ownerSettings.cashSweepEnabled}
        onChange={checked => setOwnerSettings(prev => ({ ...prev, cashSweepEnabled: checked }))}
      />
      <div>
        <FieldLabel>Drawer limit</FieldLabel>
        <TextInput type="number" min={0} value={ownerSettings.cashDrawerLimit} onChange={event => setOwnerSettings(prev => ({ ...prev, cashDrawerLimit: event.target.value }))} />
      </div>
    </div>
  );

  const renderMpesaEditor = () => (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</p>
            <p className="mt-1 text-sm font-black text-slate-950">{mpesaStatus?.activeProviderConfigured ? `${mpesaStatus.paymentProvider === 'PESAPAL' ? 'PesaPal' : 'M-Pesa API'} configured` : 'Not configured'}</p>
          </div>
          <Pill active={!!mpesaStatus?.credentialsEncrypted}>{mpesaStatus?.credentialsEncrypted ? 'Encrypted' : 'Not saved'}</Pill>
        </div>
      </div>

      <div>
        <FieldLabel>Online payment option</FieldLabel>
        <SelectInput value={mpesaDraft.provider} onChange={event => setMpesaDraft(prev => ({ ...prev, provider: event.target.value as 'MPESA' | 'PESAPAL' }))}>
          <option value="PESAPAL">PesaPal checkout</option>
          <option value="MPESA">M-Pesa API</option>
        </SelectInput>
      </div>

      {mpesaDraft.provider === 'PESAPAL' ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Environment</FieldLabel>
              <SelectInput value={mpesaDraft.pesapalEnv} onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalEnv: event.target.value as 'sandbox' | 'production' }))}>
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Currency</FieldLabel>
              <TextInput value={mpesaDraft.pesapalCurrency} maxLength={3} onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalCurrency: event.target.value.toUpperCase() }))} />
            </div>
          </div>
          <div>
            <FieldLabel>IPN ID</FieldLabel>
            <TextInput value={mpesaDraft.pesapalIpnId} onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalIpnId: event.target.value }))} placeholder={mpesaStatus?.pesapalIpnIdSet ? 'Saved if blank' : 'Optional'} />
          </div>
          <div>
            <FieldLabel>PesaPal consumer key</FieldLabel>
            <TextInput value={mpesaDraft.pesapalConsumerKey} autoComplete="off" onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalConsumerKey: event.target.value }))} placeholder={mpesaStatus?.pesapalConsumerKeySet ? 'Saved secret preserved if blank' : ''} />
          </div>
          <div>
            <FieldLabel>PesaPal consumer secret</FieldLabel>
            <TextInput type="password" value={mpesaDraft.pesapalConsumerSecret} autoComplete="off" onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalConsumerSecret: event.target.value }))} placeholder={mpesaStatus?.pesapalConsumerSecretSet ? 'Saved secret preserved if blank' : ''} />
          </div>
        </>
      ) : (
        <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Environment</FieldLabel>
          <SelectInput value={mpesaDraft.env} onChange={event => setMpesaDraft(prev => ({ ...prev, env: event.target.value as 'sandbox' | 'production' }))}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Account type</FieldLabel>
          <SelectInput value={mpesaDraft.type} onChange={event => setMpesaDraft(prev => ({ ...prev, type: event.target.value as 'paybill' | 'buygoods' }))}>
            <option value="paybill">Paybill</option>
            <option value="buygoods">Buy goods</option>
          </SelectInput>
        </div>
      </div>
      <div>
        <FieldLabel>Daraja product</FieldLabel>
        <TextInput value={mpesaDraft.product} maxLength={80} onChange={event => setMpesaDraft(prev => ({ ...prev, product: event.target.value }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Short code</FieldLabel>
          <TextInput value={mpesaDraft.shortcode} maxLength={20} onChange={event => setMpesaDraft(prev => ({ ...prev, shortcode: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Store number</FieldLabel>
          <TextInput value={mpesaDraft.storeNumber} maxLength={20} onChange={event => setMpesaDraft(prev => ({ ...prev, storeNumber: event.target.value }))} />
        </div>
      </div>
      <div>
        <FieldLabel>Consumer key</FieldLabel>
        <TextInput value={mpesaDraft.consumerKey} autoComplete="off" onChange={event => setMpesaDraft(prev => ({ ...prev, consumerKey: event.target.value }))} placeholder={mpesaStatus?.mpesaConsumerKeySet ? 'Saved secret preserved if blank' : ''} />
      </div>
      <div>
        <FieldLabel>Consumer secret</FieldLabel>
        <TextInput type="password" value={mpesaDraft.consumerSecret} autoComplete="off" onChange={event => setMpesaDraft(prev => ({ ...prev, consumerSecret: event.target.value }))} placeholder={mpesaStatus?.mpesaConsumerSecretSet ? 'Saved secret preserved if blank' : ''} />
      </div>
      <div>
        <FieldLabel>Passkey</FieldLabel>
        <TextInput type="password" value={mpesaDraft.passkey} autoComplete="off" onChange={event => setMpesaDraft(prev => ({ ...prev, passkey: event.target.value }))} placeholder={mpesaStatus?.mpesaPasskeySet ? 'Saved secret preserved if blank' : ''} />
      </div>
        </>
      )}
      <div>
        <FieldLabel>Admin password</FieldLabel>
        <TextInput type="password" value={mpesaDraft.adminPassword} autoComplete="current-password" onChange={event => setMpesaDraft(prev => ({ ...prev, adminPassword: event.target.value }))} />
      </div>
    </div>
  );

  const hardwareButton = (label: string, disabled: boolean, onClick: () => void) => (
    <ActionButton variant="secondary" disabled={disabled} onClick={onClick}>{label}</ActionButton>
  );

  const renderHardwareEditor = () => (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
        <InfoRow label="Receipt printer" value={assignedPrinter?.deviceName || 'Not set'} icon={Printer} />
        <div className="grid grid-cols-2 gap-2">
          {hardwareButton('Chrome print', isHardwareBusy, () => connectHardware('BROWSER_PRINT', 'RECEIPT_PRINTER'))}
          {hardwareButton('USB printer', isHardwareBusy || !hardwareSupport.webUsb, () => connectHardware('USB', 'RECEIPT_PRINTER'))}
          {hardwareButton('Serial', isHardwareBusy || !hardwareSupport.webSerial, () => connectHardware('SERIAL', 'RECEIPT_PRINTER'))}
          {hardwareButton('Bluetooth', isHardwareBusy || !hardwareSupport.webBluetooth, () => connectHardware('BLUETOOTH', 'RECEIPT_PRINTER'))}
          {hardwareButton('Test print', isHardwareBusy || !directPrinterReady, handleTestPrint)}
          {hardwareButton('Clear', isHardwareBusy || !assignedPrinter, () => setHardwareAssignments(clearHardwareAssignment('RECEIPT_PRINTER')))}
        </div>
      </div>
      <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
        <InfoRow label="Barcode scanner" value={assignedScanner?.deviceName || 'Not set'} icon={ScanLine} />
        <div className="grid grid-cols-2 gap-2">
          {hardwareButton('Keyboard', isHardwareBusy, () => connectHardware('KEYBOARD', 'BARCODE_SCANNER'))}
          {hardwareButton('Camera', isHardwareBusy || !hardwareSupport.camera, () => connectHardware('CAMERA', 'BARCODE_SCANNER'))}
          {hardwareButton('Serial', isHardwareBusy || !hardwareSupport.webSerial, () => connectHardware('SERIAL', 'BARCODE_SCANNER'))}
          {hardwareButton('HID', isHardwareBusy || !hardwareSupport.webHid, () => connectHardware('HID', 'BARCODE_SCANNER'))}
          {hardwareButton('Clear', isHardwareBusy || !assignedScanner, () => setHardwareAssignments(clearHardwareAssignment('BARCODE_SCANNER')))}
        </div>
      </div>
      <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
        <InfoRow label="Cash drawer" value={assignedDrawer?.deviceName || (directPrinterReady ? 'Through receipt printer' : 'Not set')} icon={Usb} />
        <div className="grid grid-cols-2 gap-2">
          {hardwareButton('Printer pulse', isHardwareBusy || !directPrinterReady, linkDrawerToPrinter)}
          {hardwareButton('USB drawer', isHardwareBusy || !hardwareSupport.webUsb, () => connectHardware('USB', 'CASH_DRAWER'))}
          {hardwareButton('Serial', isHardwareBusy || !hardwareSupport.webSerial, () => connectHardware('SERIAL', 'CASH_DRAWER'))}
          {hardwareButton('Open', isHardwareBusy || (!assignedDrawer && !directPrinterReady), handleOpenDrawer)}
          {hardwareButton('Clear', isHardwareBusy || !assignedDrawer, () => setHardwareAssignments(clearHardwareAssignment('CASH_DRAWER')))}
        </div>
      </div>
      {hardwareMessage && <div className="rounded-lg border-2 border-blue-100 bg-blue-50 p-3 text-xs font-bold leading-relaxed text-blue-800">{hardwareMessage}</div>}
      <ActionButton variant="secondary" disabled={isHardwareBusy} onClick={() => refreshHardwareDevices(false)}>
        <RefreshCcw size={15} />
        Scan devices
      </ActionButton>
    </div>
  );

  const renderSystemEditor = () => (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Software updates</p>
        <p className="mt-1 text-lg font-black text-slate-950">{needRefresh ? 'Update ready' : 'App is up to date'}</p>
        <ActionButton onClick={handleUpdate} disabled={isUpdating}>
          {isUpdating ? <RefreshCcw size={15} className="animate-spin" /> : <Download size={15} />}
          {needRefresh ? 'Update now' : 'Check updates'}
        </ActionButton>
      </div>
      <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
        <InfoRow label="Current access" value={isAdmin ? 'Administrator' : 'Standard user'} icon={ShieldCheck} />
      </div>
    </div>
  );

  const drawerFooter = editingSection === 'mpesa' ? (
    <div className="grid grid-cols-2 gap-2">
      <ActionButton variant="secondary" onClick={handleTestMpesaSettings} disabled={isMpesaBusy}>
        {isMpesaBusy ? <RefreshCcw size={15} className="animate-spin" /> : <Smartphone size={15} />}
        Test
      </ActionButton>
      <ActionButton onClick={handleSaveMpesaSettings} disabled={isMpesaBusy}>
        {isMpesaBusy ? <RefreshCcw size={15} className="animate-spin" /> : <KeyRound size={15} />}
        Save
      </ActionButton>
    </div>
  ) : editingSection === 'hardware' || editingSection === 'system' ? (
    <ActionButton onClick={() => setEditingSection(null)}>Done</ActionButton>
  ) : editingSection === 'tills' ? saveFooter('Save tills') : editingSection === 'owner' ? saveFooter('Save owner') : saveFooter('Save');

  return (
    <div className="w-full animate-in fade-in pb-28">
      <header className="mb-4 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Business controls</p>
            <h2 className="mt-1 text-2xl font-black text-slate-950">Settings</h2>
          </div>
          <Pill active={!!activeBusinessId}>{activeBusinessId ? 'Connected' : 'Login'}</Pill>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        {sections.map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => openSection(id)}
            className="min-h-[116px] rounded-lg border-2 border-slate-200 bg-white p-4 text-left shadow-sm active:border-blue-300 active:bg-blue-50"
          >
            <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border-2 border-blue-100 bg-blue-50 text-blue-700">
              <Icon size={19} />
            </span>
            <span className="block text-sm font-black text-slate-950">{label}</span>
            <span className="mt-1 block text-xs font-bold leading-snug text-slate-500">{detail}</span>
          </button>
        ))}
      </div>

      <section className="mt-4 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm">
        <div className="divide-y divide-slate-200">
          <InfoRow label="Store" value={present(storeSettings.storeName)} icon={Building2} />
          <InfoRow label="Tills" value={`${activeTills.length} active, ${money(tillSettings.openingFloat)} opening float`} icon={Store} />
          <InfoRow
            label="Payments"
            value={mpesaStatus?.activeProviderConfigured ? `${mpesaStatus.paymentProvider === 'PESAPAL' ? 'PesaPal' : 'M-Pesa API'} ${mpesaStatus.paymentProvider === 'PESAPAL' ? mpesaStatus.pesapalEnv : mpesaStatus.mpesaEnv}` : 'Not configured'}
            icon={CreditCard}
          />
          <InfoRow label="Hardware" value={`${assignedPrinter ? 'Printer ready' : 'No printer'}, ${assignedScanner ? 'scanner ready' : 'no scanner'}`} icon={Usb} />
        </div>
      </section>

      {editingSection && selectedSection && (
        <MobileDrawer title={selectedSection.label} onClose={() => setEditingSection(null)} footer={drawerFooter}>
          {editingSection === 'business' && renderBusinessEditor()}
          {editingSection === 'tills' && renderTillsEditor()}
          {editingSection === 'owner' && renderOwnerEditor()}
          {editingSection === 'mpesa' && renderMpesaEditor()}
          {editingSection === 'hardware' && renderHardwareEditor()}
          {editingSection === 'system' && renderSystemEditor()}
        </MobileDrawer>
      )}
    </div>
  );
}
