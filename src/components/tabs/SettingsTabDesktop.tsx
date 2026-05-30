import React, { useState, useEffect } from 'react';
import { Save, ShieldCheck, RefreshCcw, Download, ScanLine, Printer, Usb, Building2, Check, X, Store, Pencil, Smartphone, KeyRound, Loader2, CreditCard, type LucideIcon } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { usePhoneUi } from '../../hooks/usePhoneUi';
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
import { BusinessSettingsService } from '../../services/businessSettings';
import { getShopMpesaSettings, saveShopMpesaSettings, testShopMpesaSettings, type MpesaSettingsStatus } from '../../services/mpesaSettings';
import { normalizeTillCount, parseSalesTillRows, parseSalesTills, scopeSalesTillIds, serializeSalesTills, type SalesTill } from '../../utils/tills';

type SettingsSectionId = 'business' | 'tills' | 'mpesa' | 'hardware' | 'owner' | 'system';

const settingsSections: Array<{ id: SettingsSectionId; label: string; Icon: LucideIcon }> = [
  { id: 'business', label: 'Business', Icon: Building2 },
  { id: 'tills', label: 'Tills', Icon: Store },
  { id: 'mpesa', label: 'Payments', Icon: CreditCard },
  { id: 'hardware', label: 'Hardware', Icon: Usb },
  { id: 'owner', label: 'Owner mode', Icon: ShieldCheck },
  { id: 'system', label: 'System', Icon: Download },
];

const money = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;
const valueOrEmpty = (value: unknown) => {
  const text = String(value ?? '').trim();
  return text || 'Not set';
};

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${active ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
      {label}
    </span>
  );
}

function ProfileDetail({ label, value, className = '' }: { label: string; value: React.ReactNode; className?: string }) {
  const isEmptyString = typeof value === 'string' && value.trim() === 'Not set';
  return (
    <div className={`py-3 ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
      <div className={`mt-1 text-base font-black leading-snug ${isEmptyString ? 'text-slate-400' : 'text-slate-950'}`}>
        {value}
      </div>
    </div>
  );
}

function ProfileRow({
  label,
  value,
  status,
  Icon,
}: {
  key?: React.Key;
  label: string;
  value: React.ReactNode;
  status?: React.ReactNode;
  Icon?: LucideIcon;
}) {
  const isEmptyString = typeof value === 'string' && value.trim() === 'Not set';
  return (
    <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-blue-700">
            <Icon size={17} />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</p>
          <div className={`mt-1 truncate text-base font-black leading-snug ${isEmptyString ? 'text-slate-400' : 'text-slate-950'}`}>
            {value}
          </div>
        </div>
      </div>
      {status && <div className="shrink-0">{status}</div>}
    </div>
  );
}

function SummaryPanel({
  title,
  description,
  Icon,
  actionLabel = 'Edit',
  onEdit,
  children,
}: {
  title: string;
  description: string;
  Icon: LucideIcon;
  actionLabel?: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 border-blue-100 bg-blue-50 text-blue-700">
            <Icon size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-black text-slate-950">{title}</h3>
            <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex h-10 items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
        >
          <Pencil size={14} />
          {actionLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function SettingsDrawer({
  title,
  description,
  onClose,
  children,
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const isPhoneUi = usePhoneUi();

  return (
    <div className={`${isPhoneUi ? 'mobile-vv-overlay ' : ''}fixed inset-0 z-[120] flex justify-end bg-slate-950/45 backdrop-blur-sm`}>
      <section className={`${isPhoneUi ? 'mobile-vv-panel ' : ''}flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-xl sm:border-l-2 sm:border-slate-200`}>
        <header className="flex items-start justify-between gap-4 border-b-2 border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-slate-950">{title}</h3>
            {description && <p className="mt-1 text-xs font-bold leading-relaxed text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
            aria-label="Close settings editor"
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">{children}</label>;
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${props.className || ''}`}
    />
  );
}

export default function SettingsTabDesktop({ updateServiceWorker, needRefresh }: { updateServiceWorker: (reloadPage?: boolean) => Promise<void>, needRefresh: boolean }) {
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
    const savedTills = tableTills.length ? tableTills : parseSalesTills(savedSettings);
    return {
      store: {
        storeName: savedSettings?.storeName || 'Smart Shop',
        krapin: savedSettings?.kraPin || '',
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
        count: String(savedTills.length || 1),
        openingFloat: String(savedSettings?.defaultOpeningFloat ?? 0),
        tills: savedTills,
      },
    };
  }, [savedSettings, savedTillRows]);

  const [storeSettings, setStoreSettings] = useState(savedDrafts.store);
  const [ownerSettings, setOwnerSettings] = useState(savedDrafts.owner);
  const [tillSettings, setTillSettings] = useState<{
    count: string;
    openingFloat: string;
    tills: SalesTill[];
  }>(savedDrafts.tills);
  const [isUpdating, setIsUpdating] = useState(false);
  const [hardwareAssignments, setHardwareAssignments] = useState(loadHardwareAssignments());
  const [hardwareSupport, setHardwareSupport] = useState<HardwareSupport>(() => getHardwareSupport());
  const [isHardwareBusy, setIsHardwareBusy] = useState(false);
  const [hardwareMessage, setHardwareMessage] = useState('');
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>('business');
  const [editingSection, setEditingSection] = useState<SettingsSectionId | null>(null);
  const [mpesaStatus, setMpesaStatus] = useState<MpesaSettingsStatus | null>(null);
  const [isMpesaBusy, setIsMpesaBusy] = useState(false);
  const [mpesaDraft, setMpesaDraft] = useState({
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

  const resetDraftsFromSaved = React.useCallback(() => {
    setStoreSettings(savedDrafts.store);
    setOwnerSettings(savedDrafts.owner);
    setTillSettings(savedDrafts.tills);
  }, [savedDrafts]);

  useEffect(() => {
    resetDraftsFromSaved();
  }, [resetDraftsFromSaved]);

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

  const loadMpesaStatus = React.useCallback(async () => {
    if (!activeBusinessId || (!isAdmin && currentUser?.role !== 'ROOT')) {
      setMpesaStatus(null);
      return;
    }
    const result = await getShopMpesaSettings(activeBusinessId);
    if (result.status) setMpesaStatus(result.status);
  }, [activeBusinessId, currentUser?.role, isAdmin]);

  useEffect(() => {
    void loadMpesaStatus();
  }, [loadMpesaStatus]);

  const refreshHardwareDevices = async (quiet = false) => {
    setIsHardwareBusy(true);
    try {
      setHardwareSupport(getHardwareSupport());
      const devices = await listGrantedHardwareDevices();
      setHardwareAssignments(loadHardwareAssignments());
      if (!quiet) success(`Found ${devices.length} browser-accessible hardware item${devices.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      error(err?.message || 'Could not scan hardware devices.');
    } finally {
      setIsHardwareBusy(false);
    }
  };

  useEffect(() => {
    void refreshHardwareDevices(true);
  }, []);

  const settingsLoading = savedSettings === undefined || !savedTillRows;

  if (settingsLoading) {
    return (
      <div className="flex min-h-[55vh] flex-col items-center justify-center gap-4">
        <Loader2 size={30} className="animate-spin text-blue-700" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading settings...</p>
      </div>
    );
  }

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
        device = {
          key: 'browser-print:chrome-destinations',
          transport: 'BROWSER_PRINT',
          name: 'Chrome printer',
          granted: true,
          assignedRole: 'RECEIPT_PRINTER',
        };
        setHardwareMessage('Chrome printer uses the browser print dialog. For automatic silent receipt printing, connect a USB thermal or Serial printer.');
      }
      if (transport === 'USB') device = await requestUsbHardwareDevice(role);
      if (transport === 'SERIAL') device = await requestSerialHardwareDevice(role);
      if (transport === 'HID') device = await requestHidHardwareDevice(role);
      if (transport === 'BLUETOOTH') device = await requestBluetoothHardwareDevice(role);
      if (transport === 'CAMERA') device = await requestCameraScanner();
      if (transport === 'KEYBOARD') {
        assignKeyboardScanner();
        device = {
          key: 'keyboard:focused-input',
          transport: 'KEYBOARD',
          name: 'USB keyboard scanner',
          granted: true,
          assignedRole: 'BARCODE_SCANNER',
        };
      }

      setHardwareAssignments(loadHardwareAssignments());
      await refreshHardwareDevices(true);
      success(`${device?.name || 'Device'} assigned to ${role.replace('_', ' ').toLowerCase()}.`);
      if (transport === 'BLUETOOTH') {
        setHardwareMessage('Bluetooth discovery uses the browser BLE API. Classic Bluetooth printers/scanners still need their vendor driver or keyboard mode.');
      }
    } catch (err: any) {
      error(err?.message || 'Hardware connection was cancelled or blocked.');
    } finally {
      setIsHardwareBusy(false);
    }
  };

  const clearDeviceRole = (role: HardwareDeviceRole) => {
    setHardwareAssignments(clearHardwareAssignment(role));
    success('Hardware assignment cleared.');
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

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      if (needRefresh) {
        await updateServiceWorker(true);
      } else {
        await new Promise(r => setTimeout(r, 1200));
        success('System is fully up to date!');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveSettings = async () => {
      setIsUpdating(true);
      try {
        if (!activeBusinessId) return error('Please log in again.');
        const normalizedTills = scopeSalesTillIds(
          normalizeTillCount(tillSettings.count, tillSettings.tills),
          activeBusinessId,
        );
        await BusinessSettingsService.save({
          businessId: activeBusinessId,
          settings: {
            ...(savedSettings || {}),
            id: settingsIdForBusiness(activeBusinessId),
            storeName: storeSettings.storeName,
            tillNumber: storeSettings.tillNumber,
            kraPin: storeSettings.krapin,
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
        await Promise.all([db.settings.reload(), db.salesTills.reload()]);
        setEditingSection(null);
        success('Business settings saved.');
      } catch (err: any) {
        console.error(err);
        error(err?.message || 'Could not save business settings.');
      } finally {
        setIsUpdating(false);
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
      setMpesaDraft(prev => ({
        ...prev,
        consumerKey: '',
        consumerSecret: '',
        passkey: '',
        pesapalConsumerKey: '',
        pesapalConsumerSecret: '',
        adminPassword: '',
      }));
      setEditingSection(null);
      success('Payment API settings saved securely.');
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
      success(result.message || 'Payment API credentials connected successfully.');
      await loadMpesaStatus();
    } finally {
      setIsMpesaBusy(false);
    }
  };

  const assignedScanner = hardwareAssignments.find(item => item.role === 'BARCODE_SCANNER');
  const assignedPrinter = hardwareAssignments.find(item => item.role === 'RECEIPT_PRINTER');
  const assignedDrawer = hardwareAssignments.find(item => item.role === 'CASH_DRAWER');
  const isChromePrinter = assignedPrinter?.transport === 'BROWSER_PRINT';
  const directPrinterReady = !!assignedPrinter && (assignedPrinter.transport === 'WEBUSB' || assignedPrinter.transport === 'WEBSERIAL');

  const updateTillCount = (value: string) => {
    setTillSettings(prev => {
      const tills = normalizeTillCount(value, prev.tills);
      return { ...prev, count: String(tills.length), tills };
    });
  };

  const updateTillName = (index: number, name: string) => {
    setTillSettings(prev => ({
      ...prev,
      tills: prev.tills.map((till, i) => i === index ? { ...till, name } : till),
    }));
  };

  const openEdit = (section: SettingsSectionId) => {
    resetDraftsFromSaved();
    if (section === 'mpesa') resetMpesaDraft();
    setHardwareMessage('');
    setEditingSection(section);
  };

  const closeEdit = () => {
    resetDraftsFromSaved();
    resetMpesaDraft();
    setHardwareMessage('');
    setEditingSection(null);
  };

  const settingsFooter = (label: string) => (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={closeEdit}
        className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleSaveSettings}
        disabled={isUpdating}
        className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800 disabled:opacity-50"
      >
        {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
        {label}
      </button>
    </div>
  );

  const mpesaFooter = (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        onClick={closeEdit}
        className="h-12 flex-1 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={handleTestMpesaSettings}
        disabled={isMpesaBusy || !mpesaStatus?.mpesaConfigured}
        className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
      >
        {isMpesaBusy ? <RefreshCcw size={16} className="animate-spin" /> : <KeyRound size={16} />}
        Test saved
      </button>
      <button
        type="button"
        onClick={handleSaveMpesaSettings}
        disabled={isMpesaBusy}
        className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800 disabled:opacity-50"
      >
        {isMpesaBusy ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
        Save securely
      </button>
    </div>
  );

  const renderBusinessEditor = () => (
    <div className="space-y-4">
      <div>
        <FieldLabel>Business name</FieldLabel>
        <TextInput type="text" value={storeSettings.storeName} onChange={e => setStoreSettings({ ...storeSettings, storeName: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>M-Pesa till</FieldLabel>
          <TextInput type="text" value={storeSettings.tillNumber} onChange={e => setStoreSettings({ ...storeSettings, tillNumber: e.target.value })} />
        </div>
        <div>
          <FieldLabel>KRA PIN</FieldLabel>
          <TextInput type="text" value={storeSettings.krapin} onChange={e => setStoreSettings({ ...storeSettings, krapin: e.target.value })} />
        </div>
        <div>
          <FieldLabel>Location</FieldLabel>
          <TextInput type="text" value={storeSettings.location} onChange={e => setStoreSettings({ ...storeSettings, location: e.target.value })} />
        </div>
      </div>
      <div>
        <FieldLabel>Receipt footer</FieldLabel>
        <TextInput type="text" value={storeSettings.receiptFooter} onChange={e => setStoreSettings({ ...storeSettings, receiptFooter: e.target.value })} />
      </div>
    </div>
  );

  const renderMpesaEditor = () => (
    <div className="space-y-5">
      <div className="rounded-lg border-2 border-blue-100 bg-blue-50 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Secure entry</p>
        <p className="mt-2 text-sm font-bold leading-relaxed text-slate-700">
          Existing secrets are never shown here. Leave a secret field blank to keep the saved value.
        </p>
      </div>

      <div>
        <FieldLabel>Payment API</FieldLabel>
        <div className="grid grid-cols-2 gap-2 rounded-lg border-2 border-slate-200 bg-slate-50 p-1">
          {([
            ['PESAPAL', 'PesaPal', CreditCard],
            ['MPESA', 'M-Pesa API', Smartphone],
          ] as const).map(([id, label, Icon]) => {
            const active = mpesaDraft.provider === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setMpesaDraft(prev => ({ ...prev, provider: id }))}
                className={`flex h-11 items-center justify-center gap-2 rounded-md px-3 text-[10px] font-black uppercase tracking-widest transition ${
                  active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-950'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {mpesaDraft.provider === 'PESAPAL' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel>PesaPal environment</FieldLabel>
              <select
                value={mpesaDraft.pesapalEnv}
                onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalEnv: event.target.value as 'sandbox' | 'production' }))}
                className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </div>
            <div>
              <FieldLabel>Currency</FieldLabel>
              <TextInput
                type="text"
                value={mpesaDraft.pesapalCurrency}
                maxLength={3}
                onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalCurrency: event.target.value.toUpperCase() }))}
              />
            </div>
          </div>

          <div>
            <FieldLabel>IPN notification ID</FieldLabel>
            <TextInput
              type="text"
              value={mpesaDraft.pesapalIpnId}
              placeholder={mpesaStatus?.pesapalIpnIdSet ? 'Saved - leave blank to keep' : 'Optional; auto-registered if blank'}
              onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalIpnId: event.target.value }))}
            />
          </div>

          <div className="grid gap-4">
            <div>
              <FieldLabel>PesaPal consumer key</FieldLabel>
              <TextInput
                type="password"
                autoComplete="new-password"
                value={mpesaDraft.pesapalConsumerKey}
                placeholder={mpesaStatus?.pesapalConsumerKeySet ? 'Saved securely - leave blank to keep' : 'Enter PesaPal consumer key'}
                onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalConsumerKey: event.target.value }))}
              />
            </div>
            <div>
              <FieldLabel>PesaPal consumer secret</FieldLabel>
              <TextInput
                type="password"
                autoComplete="new-password"
                value={mpesaDraft.pesapalConsumerSecret}
                placeholder={mpesaStatus?.pesapalConsumerSecretSet ? 'Saved securely - leave blank to keep' : 'Enter PesaPal consumer secret'}
                onChange={event => setMpesaDraft(prev => ({ ...prev, pesapalConsumerSecret: event.target.value }))}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Environment</FieldLabel>
          <select
            value={mpesaDraft.env}
            onChange={event => setMpesaDraft(prev => ({ ...prev, env: event.target.value as 'sandbox' | 'production' }))}
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          >
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </div>
        <div>
          <FieldLabel>Account type</FieldLabel>
          <select
            value={mpesaDraft.type}
            onChange={event => setMpesaDraft(prev => ({ ...prev, type: event.target.value as 'paybill' | 'buygoods' }))}
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          >
            <option value="paybill">Paybill</option>
            <option value="buygoods">Buy goods / Till</option>
          </select>
        </div>
      </div>

      <div>
        <FieldLabel>Daraja product</FieldLabel>
        <select
          value={mpesaDraft.product}
          onChange={event => setMpesaDraft(prev => ({ ...prev, product: event.target.value }))}
          className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
        >
          <option value="M-PESA EXPRESS">M-PESA EXPRESS</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Short code</FieldLabel>
          <TextInput
            type="text"
            value={mpesaDraft.shortcode}
            placeholder={mpesaStatus?.mpesaShortcodeMasked || 'e.g. 123456'}
            onChange={event => setMpesaDraft(prev => ({ ...prev, shortcode: event.target.value }))}
          />
        </div>
        <div>
          <FieldLabel>Store number</FieldLabel>
          <TextInput
            type="text"
            value={mpesaDraft.storeNumber}
            placeholder={mpesaStatus?.mpesaStoreNumberMasked || 'Only if required'}
            onChange={event => setMpesaDraft(prev => ({ ...prev, storeNumber: event.target.value }))}
          />
        </div>
      </div>

      <div className="grid gap-4">
        <div>
          <FieldLabel>Consumer key</FieldLabel>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={mpesaDraft.consumerKey}
            placeholder={mpesaStatus?.mpesaConsumerKeySet ? 'Saved securely - leave blank to keep' : 'Enter consumer key'}
            onChange={event => setMpesaDraft(prev => ({ ...prev, consumerKey: event.target.value }))}
          />
        </div>
        <div>
          <FieldLabel>Consumer secret</FieldLabel>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={mpesaDraft.consumerSecret}
            placeholder={mpesaStatus?.mpesaConsumerSecretSet ? 'Saved securely - leave blank to keep' : 'Enter consumer secret'}
            onChange={event => setMpesaDraft(prev => ({ ...prev, consumerSecret: event.target.value }))}
          />
        </div>
        <div>
          <FieldLabel>Passkey</FieldLabel>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={mpesaDraft.passkey}
            placeholder={mpesaStatus?.mpesaPasskeySet ? 'Saved securely - leave blank to keep' : 'Enter passkey'}
            onChange={event => setMpesaDraft(prev => ({ ...prev, passkey: event.target.value }))}
          />
        </div>
      </div>
        </>
      )}

      <div>
        <div>
          <FieldLabel>Admin password</FieldLabel>
          <TextInput
            type="password"
            autoComplete="current-password"
            value={mpesaDraft.adminPassword}
            onChange={event => setMpesaDraft(prev => ({ ...prev, adminPassword: event.target.value }))}
          />
        </div>
      </div>
    </div>
  );

  const renderTillsEditor = () => (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FieldLabel>Number of tills</FieldLabel>
          <TextInput type="number" min="1" max="12" value={tillSettings.count} onChange={event => updateTillCount(event.target.value)} />
        </div>
        <div>
          <FieldLabel>Default opening cash</FieldLabel>
          <TextInput type="number" min="0" step="any" value={tillSettings.openingFloat} onChange={event => setTillSettings(prev => ({ ...prev, openingFloat: event.target.value }))} />
        </div>
      </div>

      <div className="grid gap-2">
        {tillSettings.tills.map((till, index) => (
          <div key={till.id} className="grid gap-2 rounded-lg border-2 border-slate-200 bg-slate-50 p-3 sm:grid-cols-[84px_1fr] sm:items-center">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Till {index + 1}</span>
            <TextInput
              type="text"
              value={till.name}
              onChange={event => updateTillName(index, event.target.value)}
              className="py-2.5"
            />
          </div>
        ))}
      </div>
    </div>
  );

  const renderOwnerEditor = () => (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOwnerSettings(prev => ({ ...prev, ownerModeEnabled: !prev.ownerModeEnabled }))}
        className={`flex w-full items-center justify-between gap-4 rounded-lg border-2 p-4 transition-colors ${ownerSettings.ownerModeEnabled ? 'border-blue-700 bg-blue-50 text-slate-950' : 'border-slate-300 bg-slate-50 text-slate-700'}`}
      >
        <div className="text-left">
          <p className="text-[10px] font-black uppercase tracking-widest">Solo operator</p>
          <p className="mt-1 text-xs font-bold">{ownerSettings.ownerModeEnabled ? 'Owner flow active' : 'Standard staff flow'}</p>
        </div>
        <div className={`flex h-7 w-12 rounded-full p-1 transition-all ${ownerSettings.ownerModeEnabled ? 'justify-end bg-blue-700' : 'justify-start bg-slate-300'}`}>
          <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
        </div>
      </button>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setOwnerSettings(prev => ({ ...prev, autoApproveOwnerActions: !prev.autoApproveOwnerActions }))}
          disabled={!ownerSettings.ownerModeEnabled}
          className={`rounded-lg border-2 p-4 text-left transition-colors disabled:opacity-40 ${ownerSettings.autoApproveOwnerActions ? 'border-blue-700 bg-blue-50 text-slate-950' : 'border-slate-200 bg-white text-slate-600'}`}
        >
          <div className="mb-2 flex items-center gap-2">
            {ownerSettings.autoApproveOwnerActions ? <Check size={16} /> : <X size={16} />}
            <p className="text-[9px] font-black uppercase tracking-widest">Auto approve</p>
          </div>
          <p className="text-xs font-bold leading-snug">Owner expenses, returns, and orders</p>
        </button>

        <button
          type="button"
          onClick={() => setOwnerSettings(prev => ({ ...prev, cashSweepEnabled: !prev.cashSweepEnabled }))}
          disabled={!ownerSettings.ownerModeEnabled}
          className={`rounded-lg border-2 p-4 text-left transition-colors disabled:opacity-40 ${ownerSettings.cashSweepEnabled ? 'border-blue-700 bg-blue-50 text-slate-950' : 'border-slate-200 bg-white text-slate-600'}`}
        >
          <div className="mb-2 flex items-center gap-2">
            {ownerSettings.cashSweepEnabled ? <Check size={16} /> : <X size={16} />}
            <p className="text-[9px] font-black uppercase tracking-widest">Cash sweep</p>
          </div>
          <p className="text-xs font-bold leading-snug">Dashboard banking shortcut</p>
        </button>
      </div>

      <div>
        <FieldLabel>Drawer limit</FieldLabel>
        <TextInput
          type="number"
          value={ownerSettings.cashDrawerLimit}
          onChange={e => setOwnerSettings(prev => ({ ...prev, cashDrawerLimit: e.target.value }))}
        />
      </div>
    </div>
  );

  const hardwareCard = (
    title: string,
    deviceName: string,
    Icon: LucideIcon,
    assignedRole: HardwareDeviceRole,
    controls: React.ReactNode,
    hasAssignment: boolean,
  ) => (
    <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-blue-700">
            <Icon size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
            <p className="truncate text-sm font-bold text-slate-950">{deviceName}</p>
          </div>
        </div>
        {hasAssignment && (
          <button type="button" onClick={() => clearDeviceRole(assignedRole)} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600">
            Clear
          </button>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {controls}
      </div>
    </div>
  );

  const secondaryHardwareButton = (label: string, disabled: boolean, onClick: () => void, primary = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg border-2 px-3 py-3 text-[9px] font-black uppercase tracking-widest disabled:opacity-40 ${primary ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:text-blue-700'}`}
    >
      {label}
    </button>
  );

  const renderHardwareEditor = () => (
    <div className="space-y-4">
      {hardwareCard(
        'Receipt printer',
        assignedPrinter?.deviceName || 'Not connected',
        Printer,
        'RECEIPT_PRINTER',
        <>
          {secondaryHardwareButton('Chrome print dialog', isHardwareBusy, () => connectHardware('BROWSER_PRINT', 'RECEIPT_PRINTER'), true)}
          {secondaryHardwareButton('USB thermal', isHardwareBusy || !hardwareSupport.webUsb, () => connectHardware('USB', 'RECEIPT_PRINTER'))}
          {secondaryHardwareButton('Serial', isHardwareBusy || !hardwareSupport.webSerial, () => connectHardware('SERIAL', 'RECEIPT_PRINTER'))}
          {secondaryHardwareButton('Bluetooth', isHardwareBusy || !hardwareSupport.webBluetooth, () => connectHardware('BLUETOOTH', 'RECEIPT_PRINTER'))}
          {secondaryHardwareButton('Test', isHardwareBusy || !directPrinterReady, handleTestPrint)}
        </>,
        !!assignedPrinter,
      )}

      {hardwareCard(
        'Scanner',
        assignedScanner?.deviceName || 'Not connected',
        ScanLine,
        'BARCODE_SCANNER',
        <>
          {secondaryHardwareButton('USB scanner', isHardwareBusy, () => connectHardware('KEYBOARD', 'BARCODE_SCANNER'), true)}
          {secondaryHardwareButton('Camera', isHardwareBusy || !hardwareSupport.camera, () => connectHardware('CAMERA', 'BARCODE_SCANNER'))}
          {secondaryHardwareButton('Serial', isHardwareBusy || !hardwareSupport.webSerial, () => connectHardware('SERIAL', 'BARCODE_SCANNER'))}
          {secondaryHardwareButton('HID', isHardwareBusy || !hardwareSupport.webHid, () => connectHardware('HID', 'BARCODE_SCANNER'))}
          {secondaryHardwareButton('Bluetooth', isHardwareBusy || !hardwareSupport.webBluetooth, () => connectHardware('BLUETOOTH', 'BARCODE_SCANNER'))}
        </>,
        !!assignedScanner,
      )}

      {hardwareCard(
        'Cash drawer',
        assignedDrawer?.deviceName || (directPrinterReady ? 'Through receipt printer' : 'Not connected'),
        Usb,
        'CASH_DRAWER',
        <>
          {secondaryHardwareButton('Printer pulse', isHardwareBusy || !directPrinterReady, () => {
            if (!assignedPrinter || isChromePrinter) return;
            setHardwareAssignments(saveHardwareAssignment({
              key: assignedPrinter.deviceKey,
              transport: assignedPrinter.transport,
              name: assignedPrinter.deviceName,
              vendorId: assignedPrinter.vendorId,
              productId: assignedPrinter.productId,
              granted: true,
            }, 'CASH_DRAWER'));
            success('Cash drawer linked to receipt printer.');
          }, true)}
          {secondaryHardwareButton('USB', isHardwareBusy || !hardwareSupport.webUsb, () => connectHardware('USB', 'CASH_DRAWER'))}
          {secondaryHardwareButton('Serial', isHardwareBusy || !hardwareSupport.webSerial, () => connectHardware('SERIAL', 'CASH_DRAWER'))}
          {secondaryHardwareButton('Open', isHardwareBusy || (!assignedDrawer && !directPrinterReady), handleOpenDrawer)}
        </>,
        !!assignedDrawer,
      )}

      {hardwareMessage && (
        <div className="rounded-lg border-2 border-slate-200 bg-white p-3 text-[11px] font-bold leading-relaxed text-slate-700">
          {hardwareMessage}
        </div>
      )}
    </div>
  );

  const renderSystemEditor = () => (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Software updates</p>
        <p className="mt-1 text-lg font-black text-slate-950">{needRefresh ? 'Update ready' : 'App is up to date'}</p>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={isUpdating}
          className={`mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 px-4 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${needRefresh ? 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}
        >
          {isUpdating ? <RefreshCcw size={16} className="animate-spin" /> : <Download size={16} />}
          {needRefresh ? 'Update now' : 'Check for updates'}
        </button>
      </div>
      <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current access</p>
        <p className="mt-1 text-lg font-black text-slate-950">{isAdmin ? 'Administrator' : 'Standard user'}</p>
      </div>
    </div>
  );

  const selectedSection = settingsSections.find(section => section.id === activeSettingsSection) || settingsSections[0];

  return (
    <div className="w-full animate-in fade-in pb-24">
      <div className="mb-4 flex flex-col justify-between gap-3 rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:p-5">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Business controls</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">Settings</h2>
        </div>
        <StatusPill active={!!activeBusinessId} label={activeBusinessId ? 'Connected' : 'Login needed'} />
      </div>

      <div className="mb-4 overflow-x-auto rounded-lg border-2 border-slate-200 bg-white p-2 shadow-sm">
        <div role="tablist" aria-label="Settings sections" className="flex min-w-max gap-2">
          {settingsSections.map(({ id, label, Icon }) => {
            const isActive = activeSettingsSection === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveSettingsSection(id)}
                className={`flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border-2 px-4 text-[10px] font-black uppercase tracking-widest transition-colors ${isActive ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50'}`}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="tabpanel">
        {activeSettingsSection === 'business' && (
          <SummaryPanel
            title="Business details"
            description="Receipt and identity details shown across the POS."
            Icon={Building2}
            onEdit={() => openEdit('business')}
          >
            <div className="space-y-6">
              <div className="border-b border-slate-200 pb-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Business profile</p>
                <h4 className={`mt-2 text-3xl font-black leading-tight ${valueOrEmpty(storeSettings.storeName) === 'Not set' ? 'text-slate-400' : 'text-slate-950'}`}>
                  {valueOrEmpty(storeSettings.storeName)}
                </h4>
                <p className={`mt-2 text-sm font-bold ${valueOrEmpty(storeSettings.location) === 'Not set' ? 'text-slate-400' : 'text-slate-500'}`}>
                  {valueOrEmpty(storeSettings.location)}
                </p>
              </div>

              <div className="grid border-b border-slate-200 pb-3 sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
                <ProfileDetail label="M-Pesa till" value={valueOrEmpty(storeSettings.tillNumber)} className="sm:px-4 sm:first:pl-0" />
                <ProfileDetail label="KRA PIN" value={valueOrEmpty(storeSettings.krapin)} className="border-t border-slate-200 sm:border-t-0 sm:px-4" />
                <ProfileDetail label="Location" value={valueOrEmpty(storeSettings.location)} className="border-t border-slate-200 sm:border-t-0 sm:px-4 sm:last:pr-0" />
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Receipt footer</p>
                <blockquote className={`mt-3 border-l-4 border-blue-700 pl-4 text-lg font-black leading-relaxed ${valueOrEmpty(storeSettings.receiptFooter) === 'Not set' ? 'text-slate-400' : 'text-slate-950'}`}>
                  {valueOrEmpty(storeSettings.receiptFooter)}
                </blockquote>
              </div>
            </div>
          </SummaryPanel>
        )}

        {activeSettingsSection === 'tills' && (
          <SummaryPanel
            title="Tills"
            description="Configured sales tills and the default opening float used when shifts start."
            Icon={Store}
            onEdit={() => openEdit('tills')}
          >
            <div className="space-y-5">
              <div className="grid border-b border-slate-200 pb-3 sm:grid-cols-2 sm:divide-x sm:divide-slate-200">
                <ProfileDetail label="Till count" value={tillSettings.tills.length || tillSettings.count} className="sm:pr-4" />
                <ProfileDetail label="Default opening float" value={money(tillSettings.openingFloat)} className="border-t border-slate-200 sm:border-t-0 sm:pl-4" />
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Configured tills</p>
                <div className="mt-2 divide-y divide-slate-200 border-y border-slate-200">
                  {tillSettings.tills.map((till, index) => (
                    <ProfileRow
                      key={till.id || index}
                      label={`Till ${index + 1}`}
                      value={valueOrEmpty(till.name)}
                      status={<StatusPill active={till.isActive !== false} label={till.isActive === false ? 'Off' : 'Active'} />}
                      Icon={Store}
                    />
                  ))}
                </div>
              </div>
            </div>
          </SummaryPanel>
        )}

        {activeSettingsSection === 'mpesa' && (
          <SummaryPanel
            title="Payments"
            description="Choose direct Safaricom M-Pesa API or PesaPal checkout for phone payments."
            Icon={CreditCard}
            actionLabel={mpesaStatus?.activeProviderConfigured ? 'Manage' : 'Set up'}
            onEdit={() => openEdit('mpesa')}
          >
            <div className="space-y-5">
              <div className="grid border-b border-slate-200 pb-3 sm:grid-cols-3 sm:divide-x sm:divide-slate-200">
                <ProfileDetail
                  label="Active API"
                  value={mpesaStatus?.paymentProvider === 'PESAPAL' ? 'PesaPal' : 'M-Pesa API'}
                  className="sm:pr-4"
                />
                <ProfileDetail
                  label="Environment"
                  value={(mpesaStatus?.paymentProvider === 'PESAPAL' ? mpesaStatus?.pesapalEnv : mpesaStatus?.mpesaEnv) === 'production' ? 'Production' : 'Sandbox'}
                  className="border-t border-slate-200 sm:border-t-0 sm:px-4"
                />
                <ProfileDetail
                  label="Connection"
                  value={mpesaStatus?.activeProviderConfigured ? 'Configured' : 'Not configured'}
                  className="border-t border-slate-200 sm:border-t-0 sm:pl-4"
                />
              </div>

              <div className="divide-y divide-slate-200 border-y border-slate-200">
                <ProfileRow
                  label="PesaPal"
                  value={mpesaStatus?.pesapalConfigured ? `${mpesaStatus.pesapalCurrency || 'KES'} ${mpesaStatus.pesapalEnv}` : 'Not configured'}
                  status={<StatusPill active={!!mpesaStatus?.pesapalConfigured} label={mpesaStatus?.paymentProvider === 'PESAPAL' ? 'Active' : 'Saved'} />}
                  Icon={CreditCard}
                />
                <ProfileRow
                  label="M-Pesa API"
                  value={mpesaStatus?.mpesaConfigured ? `${mpesaStatus.mpesaProduct || 'M-PESA EXPRESS'} ${mpesaStatus.mpesaType === 'buygoods' ? 'Buy goods' : 'Paybill'}` : 'Not configured'}
                  status={<StatusPill active={!!mpesaStatus?.mpesaConfigured} label={mpesaStatus?.paymentProvider === 'MPESA' ? 'Active' : 'Saved'} />}
                  Icon={Smartphone}
                />
                <ProfileRow
                  label="Safe storage"
                  value={mpesaStatus?.safeStorageReady ? 'Encryption key is available' : 'Encryption key is missing or weak'}
                  status={<StatusPill active={!!mpesaStatus?.safeStorageReady} label={mpesaStatus?.safeStorageReady ? 'Ready' : 'Blocked'} />}
                  Icon={ShieldCheck}
                />
                <ProfileRow
                  label="Active credential secrets"
                  value={mpesaStatus?.activeProviderConfigured ? 'Required secrets are saved' : 'Credentials still need setup'}
                  status={<StatusPill active={!!mpesaStatus?.credentialsEncrypted} label={mpesaStatus?.credentialsEncrypted ? 'Encrypted' : 'Not saved'} />}
                  Icon={KeyRound}
                />
                <ProfileRow
                  label="Short code"
                  value={mpesaStatus?.mpesaShortcodeMasked || valueOrEmpty(storeSettings.tillNumber)}
                  status={<StatusPill active={!!(mpesaStatus?.mpesaShortcodeSet || storeSettings.tillNumber)} label={mpesaStatus?.mpesaShortcodeSet ? 'Saved' : 'Business till'} />}
                  Icon={Smartphone}
                />
                <ProfileRow
                  label="Last connection test"
                  value={mpesaStatus?.lastTestAt ? new Date(mpesaStatus.lastTestAt).toLocaleString() : 'Not tested'}
                  status={<StatusPill active={mpesaStatus?.lastTestStatus === 'PASSED'} label={mpesaStatus?.lastTestStatus === 'PASSED' ? 'Passed' : 'Not passed'} />}
                />
              </div>
            </div>
          </SummaryPanel>
        )}

        {activeSettingsSection === 'hardware' && (
          <SummaryPanel
            title="Hardware"
            description="Printer, scanner, and cash drawer assignments for this browser."
            Icon={Usb}
            actionLabel="Manage"
            onEdit={() => openEdit('hardware')}
          >
            <div className="space-y-5">
              <div className="divide-y divide-slate-200 border-y border-slate-200">
                <ProfileRow
                  label="Receipt printer"
                  value={assignedPrinter?.deviceName || 'Not set'}
                  status={<StatusPill active={!!assignedPrinter} label={assignedPrinter ? 'Assigned' : 'Not set'} />}
                  Icon={Printer}
                />
                <ProfileRow
                  label="Barcode scanner"
                  value={assignedScanner?.deviceName || 'Not set'}
                  status={<StatusPill active={!!assignedScanner} label={assignedScanner ? 'Assigned' : 'Not set'} />}
                  Icon={ScanLine}
                />
                <ProfileRow
                  label="Cash drawer"
                  value={assignedDrawer?.deviceName || (directPrinterReady ? 'Through receipt printer' : 'Not set')}
                  status={<StatusPill active={!!assignedDrawer || directPrinterReady} label={assignedDrawer || directPrinterReady ? 'Ready' : 'Not set'} />}
                  Icon={Usb}
                />
              </div>

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Browser hardware support</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusPill active={hardwareSupport.webUsb} label="USB support" />
                  <StatusPill active={hardwareSupport.webSerial} label="Serial support" />
                  <StatusPill active={hardwareSupport.webBluetooth} label="Bluetooth support" />
                  <StatusPill active={hardwareSupport.camera} label="Camera support" />
                </div>
              </div>
            </div>
          </SummaryPanel>
        )}

        {activeSettingsSection === 'owner' && (
          <SummaryPanel
            title="Owner mode"
            description="Single-owner shortcuts and approval behavior."
            Icon={ShieldCheck}
            onEdit={() => openEdit('owner')}
          >
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              <ProfileRow
                label="Owner mode"
                value={ownerSettings.ownerModeEnabled ? 'Enabled' : 'Disabled'}
                status={<StatusPill active={ownerSettings.ownerModeEnabled} label={ownerSettings.ownerModeEnabled ? 'Active' : 'Off'} />}
                Icon={ShieldCheck}
              />
              <ProfileRow
                label="Auto approval"
                value={ownerSettings.autoApproveOwnerActions ? 'Owner actions approve automatically' : 'Owner actions need approval'}
                status={<StatusPill active={ownerSettings.autoApproveOwnerActions} label={ownerSettings.autoApproveOwnerActions ? 'Enabled' : 'Off'} />}
              />
              <ProfileRow
                label="Cash sweep"
                value={ownerSettings.cashSweepEnabled ? 'Dashboard banking shortcut is available' : 'Dashboard banking shortcut is hidden'}
                status={<StatusPill active={ownerSettings.cashSweepEnabled} label={ownerSettings.cashSweepEnabled ? 'Enabled' : 'Off'} />}
              />
              <ProfileRow label="Drawer limit" value={money(ownerSettings.cashDrawerLimit)} />
            </div>
          </SummaryPanel>
        )}

        {activeSettingsSection === 'system' && (
          <SummaryPanel
            title="System"
            description="Update status and current account level."
            Icon={Download}
            actionLabel="Manage"
            onEdit={() => openEdit('system')}
          >
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              <ProfileRow
                label="Update status"
                value={needRefresh ? 'Update ready' : 'App is up to date'}
                status={<StatusPill active={needRefresh} label={needRefresh ? 'Action needed' : 'Current'} />}
                Icon={Download}
              />
              <ProfileRow
                label="Current access"
                value={isAdmin ? 'Administrator' : 'Standard user'}
                status={<StatusPill active={isAdmin} label={isAdmin ? 'Admin' : 'Staff'} />}
                Icon={ShieldCheck}
              />
            </div>
          </SummaryPanel>
        )}
      </div>

      {editingSection && (
        <SettingsDrawer
          title={selectedSection.id === editingSection ? selectedSection.label : settingsSections.find(section => section.id === editingSection)?.label || 'Settings'}
          description="Change the details, then save when you are ready."
          onClose={closeEdit}
          footer={
            editingSection === 'hardware' || editingSection === 'system' ? (
              <button
                type="button"
                onClick={closeEdit}
                className="h-12 w-full rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-blue-800"
              >
                Done
              </button>
            ) : editingSection === 'mpesa' ? mpesaFooter : editingSection === 'tills' ? settingsFooter('Save tills') : editingSection === 'owner' ? settingsFooter('Save owner mode') : settingsFooter('Save settings')
          }
        >
          {editingSection === 'business' && renderBusinessEditor()}
          {editingSection === 'tills' && renderTillsEditor()}
          {editingSection === 'mpesa' && renderMpesaEditor()}
          {editingSection === 'hardware' && renderHardwareEditor()}
          {editingSection === 'owner' && renderOwnerEditor()}
          {editingSection === 'system' && renderSystemEditor()}
        </SettingsDrawer>
      )}
    </div>
  );
}
