import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarCheck,
  CheckSquare,
  Clock3,
  Edit3,
  ExternalLink,
  FileText,
  FolderOpen,
  IdCard,
  Mail,
  Phone,
  Plus,
  Save,
  Search,
  Square,
  Trash2,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import {
  db,
  type HRAttendance,
  type HRAttendanceStatus,
  type HRPayCycle,
  type HRPayrollAdjustment,
  type HRPayrollStatus,
  type HRPayrollType,
  type HRStaff,
  type HRStaffDocument,
  type HRStaffStatus,
} from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';

type StaffForm = {
  fullName: string;
  phone: string;
  email: string;
  roleTitle: string;
  department: string;
  nationalId: string;
  kraPin: string;
  nhifNumber: string;
  nssfNumber: string;
  hireDate: string;
  status: HRStaffStatus;
  baseSalary: string;
  payCycle: HRPayCycle;
  emergencyContact: string;
  notes: string;
};

type DocumentForm = {
  name: string;
  documentType: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  fileName: string;
  fileUrl: string;
  notes: string;
};

type AttendanceForm = {
  date: string;
  checkIn: string;
  checkOut: string;
  status: HRAttendanceStatus;
  hoursWorked: string;
  notes: string;
};

type PayrollForm = {
  type: HRPayrollType;
  label: string;
  amount: string;
  effectiveDate: string;
  recurring: boolean;
  status: HRPayrollStatus;
  notes: string;
};

type HRSection = 'PROFILE' | 'DOCUMENTS' | 'ATTENDANCE' | 'PAY';

type PayrollSummary = {
  daysInMonth: number;
  recordedDays: number;
  unrecordedDays: number;
  attendedDays: number;
  paidDays: number;
  offDays: number;
  leaveDays: number;
  absentDays: number;
  halfDays: number;
  dailyRate: number;
  baseEarned: number;
  additions: number;
  deductions: number;
  netPay: number;
};

const staffStatusOptions: Array<{ value: HRStaffStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_LEAVE', label: 'On leave' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'EXITED', label: 'Exited' },
];

const attendanceStatusOptions: Array<{ value: HRAttendanceStatus; label: string }> = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'LATE', label: 'Late' },
  { value: 'HALF_DAY', label: 'Half day' },
  { value: 'ON_LEAVE', label: 'On leave' },
  { value: 'OFF_DAY', label: 'Off day' },
  { value: 'ABSENT', label: 'Absent' },
];

const payrollTypeOptions: Array<{ value: HRPayrollType; label: string }> = [
  { value: 'SALARY', label: 'Salary' },
  { value: 'BONUS', label: 'Bonus' },
  { value: 'DEDUCTION', label: 'Deduction' },
  { value: 'PENALTY', label: 'Penalty' },
];

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-800 outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10';
const labelClass = 'text-[10px] font-black uppercase tracking-widest text-slate-400';

const localDateInput = (value?: number | Date) => {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const currentMonthInput = () => localDateInput().slice(0, 7);

const parseDateInput = (value: string) => {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
};

const parseMonthInput = (value: string) => {
  const [year, month] = value.split('-').map(part => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    const now = new Date();
    return {
      year: now.getFullYear(),
      month: now.getMonth(),
      start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    };
  }
  const monthIndex = month - 1;
  return {
    year,
    month: monthIndex,
    start: new Date(year, monthIndex, 1).getTime(),
    end: new Date(year, monthIndex + 1, 1).getTime(),
    daysInMonth: new Date(year, monthIndex + 1, 0).getDate(),
  };
};

const formatDate = (value?: number) => {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

const money = (value: number) => `Ksh ${(Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const emptyStaffForm = (): StaffForm => ({
  fullName: '',
  phone: '',
  email: '',
  roleTitle: '',
  department: '',
  nationalId: '',
  kraPin: '',
  nhifNumber: '',
  nssfNumber: '',
  hireDate: localDateInput(),
  status: 'ACTIVE',
  baseSalary: '',
  payCycle: 'MONTHLY',
  emergencyContact: '',
  notes: '',
});

const emptyDocumentForm = (): DocumentForm => ({
  name: '',
  documentType: 'National ID',
  documentNumber: '',
  issueDate: '',
  expiryDate: '',
  fileName: '',
  fileUrl: '',
  notes: '',
});

const emptyAttendanceForm = (): AttendanceForm => ({
  date: localDateInput(),
  checkIn: '08:00',
  checkOut: '17:00',
  status: 'PRESENT',
  hoursWorked: '8',
  notes: '',
});

const emptyPayrollForm = (): PayrollForm => ({
  type: 'DEDUCTION',
  label: '',
  amount: '',
  effectiveDate: localDateInput(),
  recurring: false,
  status: 'ACTIVE',
  notes: '',
});

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(part => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function calculateHours(checkIn: string, checkOut: string, status: HRAttendanceStatus) {
  if (status === 'ABSENT' || status === 'OFF_DAY' || status === 'ON_LEAVE') return 0;
  if (status === 'HALF_DAY') return 4;
  const start = minutesFromTime(checkIn);
  const end = minutesFromTime(checkOut);
  if (start === null || end === null || end <= start) return 0;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function attendanceDayValue(status: HRAttendanceStatus) {
  if (status === 'HALF_DAY') return 0.5;
  if (status === 'PRESENT' || status === 'LATE' || status === 'ON_LEAVE' || status === 'OFF_DAY') return 1;
  return 0;
}

function dailyRateFor(staff: HRStaff | null, daysInMonth: number) {
  if (!staff) return 0;
  const baseSalary = Number(staff.baseSalary || 0);
  if (staff.payCycle === 'DAILY') return baseSalary;
  if (staff.payCycle === 'WEEKLY') return baseSalary / 7;
  return daysInMonth > 0 ? baseSalary / daysInMonth : 0;
}

function statusBadgeClass(status: HRStaffStatus) {
  if (status === 'ACTIVE') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (status === 'ON_LEAVE') return 'border-amber-100 bg-amber-50 text-amber-700';
  if (status === 'SUSPENDED') return 'border-rose-100 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-100 text-slate-600';
}

function attendanceBadgeClass(status: HRAttendanceStatus) {
  if (status === 'PRESENT') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (status === 'LATE' || status === 'HALF_DAY') return 'border-amber-100 bg-amber-50 text-amber-700';
  if (status === 'ABSENT') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (status === 'OFF_DAY') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-blue-100 bg-blue-50 text-blue-700';
}

function payrollBadgeClass(type: HRPayrollType) {
  if (type === 'SALARY' || type === 'BONUS') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (type === 'PENALTY') return 'border-rose-100 bg-rose-50 text-rose-700';
  return 'border-orange-100 bg-orange-50 text-orange-700';
}

function buildPayrollSummary(staff: HRStaff | null, attendanceRows: HRAttendance[], payrollRows: HRPayrollAdjustment[], monthInput: string): PayrollSummary {
  const month = parseMonthInput(monthInput);
  const attendanceByDate = new Map<string, HRAttendance>();
  attendanceRows
    .filter(row => row.date >= month.start && row.date < month.end)
    .sort((a, b) => (a.updated_at || 0) - (b.updated_at || 0))
    .forEach(row => attendanceByDate.set(localDateInput(row.date), row));

  const monthAttendance = Array.from(attendanceByDate.values());
  const presentDays = monthAttendance.filter(row => row.status === 'PRESENT' || row.status === 'LATE').length;
  const halfDays = monthAttendance.filter(row => row.status === 'HALF_DAY').length;
  const offDays = monthAttendance.filter(row => row.status === 'OFF_DAY').length;
  const leaveDays = monthAttendance.filter(row => row.status === 'ON_LEAVE').length;
  const absentDays = monthAttendance.filter(row => row.status === 'ABSENT').length;
  const paidDays = monthAttendance.reduce((sum, row) => sum + attendanceDayValue(row.status), 0);
  const dailyRate = dailyRateFor(staff, month.daysInMonth);
  const baseEarned = dailyRate * paidDays;
  const activeAdjustments = payrollRows
    .filter(row => row.status !== 'CANCELLED')
    .filter(row => Boolean(row.recurring) || (row.effectiveDate >= month.start && row.effectiveDate < month.end));
  const additions = activeAdjustments
    .filter(row => row.type === 'SALARY' || row.type === 'BONUS')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const deductions = activeAdjustments
    .filter(row => row.type === 'DEDUCTION' || row.type === 'PENALTY')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return {
    daysInMonth: month.daysInMonth,
    recordedDays: monthAttendance.length,
    unrecordedDays: Math.max(0, month.daysInMonth - monthAttendance.length),
    attendedDays: presentDays + halfDays * 0.5,
    paidDays,
    offDays,
    leaveDays,
    absentDays,
    halfDays,
    dailyRate,
    baseEarned,
    additions,
    deductions,
    netPay: baseEarned + additions - deductions,
  };
}

function MetricTile({ icon: Icon, label, value, tone }: { icon: React.ElementType; label: string; value: string; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p>
          <p className="mt-2 text-lg font-black text-slate-950 stable-title">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={20} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="border-b border-slate-100 pb-3">
      <p className={labelClass}>{label}</p>
      <p className="mt-1 text-sm font-black text-slate-900 stable-title">{value || 'Not set'}</p>
    </div>
  );
}

export default function HRTab() {
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const currentUser = useStore(state => state.currentUser);
  const { success, error } = useToast();
  const canManageHR = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';

  const [staffSearch, setStaffSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | HRStaffStatus>('ALL');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<HRSection>('PROFILE');
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<HRStaff | null>(null);
  const [staffForm, setStaffForm] = useState<StaffForm>(() => emptyStaffForm());
  const [documentForm, setDocumentForm] = useState<DocumentForm>(() => emptyDocumentForm());
  const [attendanceForm, setAttendanceForm] = useState<AttendanceForm>(() => emptyAttendanceForm());
  const [bulkAttendanceForm, setBulkAttendanceForm] = useState<AttendanceForm>(() => emptyAttendanceForm());
  const [bulkSelectedStaffIds, setBulkSelectedStaffIds] = useState<string[]>([]);
  const [payrollForm, setPayrollForm] = useState<PayrollForm>(() => emptyPayrollForm());
  const [payMonth, setPayMonth] = useState(currentMonthInput());
  const [isSaving, setIsSaving] = useState(false);

  const staffRows = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.hrStaff.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  ) || [];

  const documentRows = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.hrStaffDocuments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  ) || [];

  const attendanceRows = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.hrAttendance.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  ) || [];

  const payrollRows = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.hrPayrollAdjustments.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    [],
  ) || [];

  const filteredStaff = useMemo(() => {
    const query = staffSearch.trim().toLowerCase();
    return [...staffRows]
      .filter(staff => {
        if (statusFilter !== 'ALL' && staff.status !== statusFilter) return false;
        if (!query) return true;
        return [
          staff.fullName,
          staff.roleTitle,
          staff.department,
          staff.phone,
          staff.email,
          staff.nationalId,
        ].some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => {
        if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
        if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
        return String(a.fullName || '').localeCompare(String(b.fullName || ''));
      });
  }, [staffRows, staffSearch, statusFilter]);

  const activeStaff = useMemo(() => staffRows.filter(staff => staff.status === 'ACTIVE'), [staffRows]);
  const selectedStaff = selectedStaffId ? staffRows.find(staff => staff.id === selectedStaffId) || null : null;

  React.useEffect(() => {
    setBulkSelectedStaffIds(prev => {
      const valid = new Set(staffRows.map(staff => staff.id));
      return prev.filter(id => valid.has(id));
    });
    if (selectedStaffId && !staffRows.some(staff => staff.id === selectedStaffId)) setSelectedStaffId(null);
  }, [staffRows, selectedStaffId]);

  const selectedDocuments = useMemo(
    () => selectedStaff ? documentRows.filter(doc => doc.staffId === selectedStaff.id).sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)) : [],
    [documentRows, selectedStaff],
  );

  const selectedAttendance = useMemo(
    () => selectedStaff ? attendanceRows.filter(row => row.staffId === selectedStaff.id).sort((a, b) => (b.date || 0) - (a.date || 0)) : [],
    [attendanceRows, selectedStaff],
  );

  const selectedPayroll = useMemo(
    () => selectedStaff ? payrollRows.filter(row => row.staffId === selectedStaff.id).sort((a, b) => (b.effectiveDate || 0) - (a.effectiveDate || 0)) : [],
    [payrollRows, selectedStaff],
  );

  const todayKey = localDateInput();
  const todayAttendanceCount = attendanceRows.filter(row => localDateInput(row.date) === todayKey && ['PRESENT', 'LATE', 'HALF_DAY'].includes(row.status)).length;
  const payrollTotal = activeStaff.reduce((sum, staff) => sum + Number(staff.baseSalary || 0), 0);
  const currentMonth = parseMonthInput(currentMonthInput());
  const monthlyDeductions = payrollRows
    .filter(row => row.status !== 'CANCELLED' && (row.type === 'DEDUCTION' || row.type === 'PENALTY'))
    .filter(row => Boolean(row.recurring) || (row.effectiveDate >= currentMonth.start && row.effectiveDate < currentMonth.end))
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);

  const payrollSummary = useMemo(
    () => buildPayrollSummary(selectedStaff, selectedAttendance, selectedPayroll, payMonth),
    [selectedStaff, selectedAttendance, selectedPayroll, payMonth],
  );

  const openStaffModal = (staff?: HRStaff) => {
    setEditingStaff(staff || null);
    setStaffForm(staff ? {
      fullName: staff.fullName || '',
      phone: staff.phone || '',
      email: staff.email || '',
      roleTitle: staff.roleTitle || '',
      department: staff.department || '',
      nationalId: staff.nationalId || '',
      kraPin: staff.kraPin || '',
      nhifNumber: staff.nhifNumber || '',
      nssfNumber: staff.nssfNumber || '',
      hireDate: staff.hireDate ? localDateInput(staff.hireDate) : localDateInput(),
      status: staff.status || 'ACTIVE',
      baseSalary: String(staff.baseSalary || ''),
      payCycle: staff.payCycle || 'MONTHLY',
      emergencyContact: staff.emergencyContact || '',
      notes: staff.notes || '',
    } : emptyStaffForm());
    setIsStaffModalOpen(true);
  };

  const openWorkerPage = (staffId: string) => {
    setSelectedStaffId(staffId);
    setActiveSection('PROFILE');
    setDocumentForm(emptyDocumentForm());
    setAttendanceForm(emptyAttendanceForm());
    setPayrollForm(emptyPayrollForm());
  };

  const handleSaveStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    if (!staffForm.fullName.trim()) return error('Staff name is required.');
    if (!staffForm.roleTitle.trim()) return error('Job title is required.');

    setIsSaving(true);
    try {
      const record: HRStaff = {
        id: editingStaff?.id || crypto.randomUUID(),
        fullName: staffForm.fullName.trim(),
        phone: staffForm.phone.trim(),
        email: staffForm.email.trim(),
        roleTitle: staffForm.roleTitle.trim(),
        department: staffForm.department.trim(),
        nationalId: staffForm.nationalId.trim(),
        kraPin: staffForm.kraPin.trim(),
        nhifNumber: staffForm.nhifNumber.trim(),
        nssfNumber: staffForm.nssfNumber.trim(),
        hireDate: parseDateInput(staffForm.hireDate),
        status: staffForm.status,
        baseSalary: Number(staffForm.baseSalary) || 0,
        payCycle: staffForm.payCycle,
        emergencyContact: staffForm.emergencyContact.trim(),
        notes: staffForm.notes.trim(),
        shopId: activeShopId,
        businessId: activeBusinessId,
        updated_at: Date.now(),
      };
      await db.hrStaff.put(record);
      setSelectedStaffId(record.id);
      setIsStaffModalOpen(false);
      setEditingStaff(null);
      success(editingStaff ? 'Staff profile updated.' : 'Staff registered.');
    } catch (err: any) {
      error(`Failed to save staff: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteStaff = async (staff: HRStaff) => {
    if (isSaving) return;
    if (!confirm(`Delete ${staff.fullName} and related HR records?`)) return;
    setIsSaving(true);
    try {
      const docs = documentRows.filter(row => row.staffId === staff.id);
      const attendance = attendanceRows.filter(row => row.staffId === staff.id);
      const payroll = payrollRows.filter(row => row.staffId === staff.id);
      await Promise.all([
        ...docs.map(row => db.hrStaffDocuments.delete(row.id)),
        ...attendance.map(row => db.hrAttendance.delete(row.id)),
        ...payroll.map(row => db.hrPayrollAdjustments.delete(row.id)),
      ]);
      await db.hrStaff.delete(staff.id);
      setSelectedStaffId(null);
      success('Staff record deleted.');
    } catch (err: any) {
      error(`Failed to delete staff: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || !selectedStaff) return;
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    if (!documentForm.name.trim()) return error('Document name is required.');

    setIsSaving(true);
    try {
      const record: HRStaffDocument = {
        id: crypto.randomUUID(),
        staffId: selectedStaff.id,
        name: documentForm.name.trim(),
        documentType: documentForm.documentType.trim() || 'Document',
        documentNumber: documentForm.documentNumber.trim(),
        issueDate: parseDateInput(documentForm.issueDate),
        expiryDate: parseDateInput(documentForm.expiryDate),
        fileName: documentForm.fileName.trim(),
        fileUrl: documentForm.fileUrl.trim(),
        notes: documentForm.notes.trim(),
        shopId: activeShopId,
        businessId: activeBusinessId,
        updated_at: Date.now(),
      };
      await db.hrStaffDocuments.add(record);
      setDocumentForm(emptyDocumentForm());
      success('Document saved.');
    } catch (err: any) {
      error(`Failed to save document: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const attendancePayload = (staffId: string, form: AttendanceForm, existing?: HRAttendance): HRAttendance | null => {
    const date = parseDateInput(form.date);
    if (!date || !activeBusinessId || !activeShopId) return null;
    const status = form.status;
    const hours = Number(form.hoursWorked) || calculateHours(form.checkIn, form.checkOut, status);
    return {
      id: existing?.id || crypto.randomUUID(),
      staffId,
      date,
      checkIn: status === 'ABSENT' || status === 'OFF_DAY' || status === 'ON_LEAVE' ? '' : form.checkIn,
      checkOut: status === 'ABSENT' || status === 'OFF_DAY' || status === 'ON_LEAVE' ? '' : form.checkOut,
      status,
      hoursWorked: hours,
      notes: form.notes.trim(),
      shopId: activeShopId,
      businessId: activeBusinessId,
      updated_at: Date.now(),
    };
  };

  const handleSaveAttendance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || !selectedStaff) return;
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    if (!parseDateInput(attendanceForm.date)) return error('Attendance date is required.');

    setIsSaving(true);
    try {
      const existing = selectedAttendance.find(row => localDateInput(row.date) === attendanceForm.date);
      const record = attendancePayload(selectedStaff.id, attendanceForm, existing);
      if (!record) return error('Attendance date is required.');
      await db.hrAttendance.put(record);
      setAttendanceForm(emptyAttendanceForm());
      success(existing ? 'Attendance updated.' : 'Attendance recorded.');
    } catch (err: any) {
      error(`Failed to save attendance: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkAttendance = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    if (!parseDateInput(bulkAttendanceForm.date)) return error('Attendance date is required.');
    if (bulkSelectedStaffIds.length === 0) return error('Select at least one worker.');

    setIsSaving(true);
    try {
      const records = bulkSelectedStaffIds
        .map(staffId => {
          const existing = attendanceRows.find(row => row.staffId === staffId && localDateInput(row.date) === bulkAttendanceForm.date);
          return attendancePayload(staffId, bulkAttendanceForm, existing);
        })
        .filter((record): record is HRAttendance => Boolean(record));

      await db.hrAttendance.bulkPut(records);
      success(`Attendance saved for ${records.length} worker${records.length === 1 ? '' : 's'}.`);
    } catch (err: any) {
      error(`Failed to save attendance: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddPayroll = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving || !selectedStaff) return;
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    const amount = Number(payrollForm.amount);
    const effectiveDate = parseDateInput(payrollForm.effectiveDate);
    if (!payrollForm.label.trim()) return error('Payroll label is required.');
    if (!amount || amount <= 0) return error('Enter a valid payroll amount.');
    if (!effectiveDate) return error('Effective date is required.');

    setIsSaving(true);
    try {
      const record: HRPayrollAdjustment = {
        id: crypto.randomUUID(),
        staffId: selectedStaff.id,
        type: payrollForm.type,
        label: payrollForm.label.trim(),
        amount,
        effectiveDate,
        recurring: payrollForm.recurring ? 1 : 0,
        status: payrollForm.status,
        notes: payrollForm.notes.trim(),
        shopId: activeShopId,
        businessId: activeBusinessId,
        updated_at: Date.now(),
      };
      await db.hrPayrollAdjustments.add(record);
      setPayrollForm(emptyPayrollForm());
      success('Payroll entry saved.');
    } catch (err: any) {
      error(`Failed to save payroll entry: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRecord = async (table: 'document' | 'attendance' | 'payroll', id: string) => {
    if (isSaving) return;
    if (!confirm('Delete this record?')) return;
    setIsSaving(true);
    try {
      if (table === 'document') await db.hrStaffDocuments.delete(id);
      if (table === 'attendance') await db.hrAttendance.delete(id);
      if (table === 'payroll') await db.hrPayrollAdjustments.delete(id);
      success('Record deleted.');
    } catch (err: any) {
      error(`Failed to delete record: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleBulkWorker = (staffId: string) => {
    setBulkSelectedStaffIds(prev => prev.includes(staffId) ? prev.filter(id => id !== staffId) : [...prev, staffId]);
  };

  const selectAllActive = () => setBulkSelectedStaffIds(activeStaff.map(staff => staff.id));
  const clearBulkSelection = () => setBulkSelectedStaffIds([]);

  if (!canManageHR) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
          <AlertTriangle size={26} />
        </div>
        <p className="text-sm font-black text-slate-900">Only admins and managers can open HR.</p>
      </div>
    );
  }

  if (!activeBusinessId || !activeShopId) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          <FolderOpen size={26} />
        </div>
        <p className="text-sm font-black text-slate-900">The shop is still loading.</p>
      </div>
    );
  }

  const sections: Array<{ id: HRSection; label: string; icon: React.ElementType }> = [
    { id: 'PROFILE', label: 'Profile', icon: IdCard },
    { id: 'DOCUMENTS', label: 'Documents', icon: FileText },
    { id: 'ATTENDANCE', label: 'Attendance', icon: CalendarCheck },
    { id: 'PAY', label: 'Pay', icon: WalletCards },
  ];

  const renderStaffModal = () => isStaffModalOpen && (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <p className={labelClass}>{editingStaff ? 'Edit staff' : 'Register staff'}</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">{editingStaff ? editingStaff.fullName : 'Staff profile'}</h3>
          </div>
          <button type="button" onClick={() => setIsStaffModalOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSaveStaff} className="max-h-[calc(92vh-76px)] overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelClass}>Full name</label>
              <input value={staffForm.fullName} onChange={event => setStaffForm({ ...staffForm, fullName: event.target.value })} className={`${inputClass} mt-1`} autoFocus />
            </div>
            <div>
              <label className={labelClass}>Job title</label>
              <input value={staffForm.roleTitle} onChange={event => setStaffForm({ ...staffForm, roleTitle: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>Department</label>
              <input value={staffForm.department} onChange={event => setStaffForm({ ...staffForm, department: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>Phone</label>
              <input value={staffForm.phone} onChange={event => setStaffForm({ ...staffForm, phone: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" value={staffForm.email} onChange={event => setStaffForm({ ...staffForm, email: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>Hire date</label>
              <input type="date" value={staffForm.hireDate} onChange={event => setStaffForm({ ...staffForm, hireDate: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select value={staffForm.status} onChange={event => setStaffForm({ ...staffForm, status: event.target.value as HRStaffStatus })} className={`${inputClass} mt-1`}>
                {staffStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Base salary</label>
              <input type="number" min="0" step="0.01" value={staffForm.baseSalary} onChange={event => setStaffForm({ ...staffForm, baseSalary: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>Pay cycle</label>
              <select value={staffForm.payCycle} onChange={event => setStaffForm({ ...staffForm, payCycle: event.target.value as HRPayCycle })} className={`${inputClass} mt-1`}>
                <option value="MONTHLY">Monthly</option>
                <option value="WEEKLY">Weekly</option>
                <option value="DAILY">Daily</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>National ID</label>
              <input value={staffForm.nationalId} onChange={event => setStaffForm({ ...staffForm, nationalId: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>KRA PIN</label>
              <input value={staffForm.kraPin} onChange={event => setStaffForm({ ...staffForm, kraPin: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>NHIF</label>
              <input value={staffForm.nhifNumber} onChange={event => setStaffForm({ ...staffForm, nhifNumber: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div>
              <label className={labelClass}>NSSF</label>
              <input value={staffForm.nssfNumber} onChange={event => setStaffForm({ ...staffForm, nssfNumber: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div className="md:col-span-2">
              <label className={labelClass}>Emergency contact</label>
              <input value={staffForm.emergencyContact} onChange={event => setStaffForm({ ...staffForm, emergencyContact: event.target.value })} className={`${inputClass} mt-1`} />
            </div>
            <div className="md:col-span-2 lg:col-span-3">
              <label className={labelClass}>Notes</label>
              <textarea value={staffForm.notes} onChange={event => setStaffForm({ ...staffForm, notes: event.target.value })} className={`${inputClass} mt-1 min-h-24 resize-none`} />
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => setIsStaffModalOpen(false)} className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-primary/20 transition hover:bg-blue-700 disabled:opacity-60">
              <Save size={17} />
              Save staff
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (selectedStaff) {
    return (
      <div className="w-full animate-in fade-in pb-24">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              onClick={() => setSelectedStaffId(null)}
              className="mt-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-primary/30 hover:text-primary"
              title="Back to workers"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-black text-slate-950 stable-title">{selectedStaff.fullName}</h2>
                <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${statusBadgeClass(selectedStaff.status)}`}>
                  {selectedStaff.status.replace('_', ' ')}
                </span>
              </div>
              <p className="mt-1 text-sm font-bold text-slate-500">{selectedStaff.roleTitle} {selectedStaff.department ? `/ ${selectedStaff.department}` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-bold text-slate-500">
                {selectedStaff.phone && <span className="inline-flex items-center gap-1"><Phone size={13} /> {selectedStaff.phone}</span>}
                {selectedStaff.email && <span className="inline-flex items-center gap-1"><Mail size={13} /> {selectedStaff.email}</span>}
                <span className="inline-flex items-center gap-1"><Banknote size={13} /> {money(Number(selectedStaff.baseSalary || 0))} / {selectedStaff.payCycle.toLowerCase()}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => openStaffModal(selectedStaff)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 transition hover:border-primary/30 hover:text-primary"
            >
              <Edit3 size={15} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => handleDeleteStaff(selectedStaff)}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-black text-rose-600 transition hover:bg-rose-600 hover:text-white"
            >
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {sections.map(section => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-black transition ${
                  isActive ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                <Icon size={15} />
                {section.label}
              </button>
            );
          })}
        </div>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          {activeSection === 'PROFILE' && (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <InfoRow label="Full name" value={selectedStaff.fullName} />
                <InfoRow label="Job title" value={selectedStaff.roleTitle} />
                <InfoRow label="Department" value={selectedStaff.department} />
                <InfoRow label="Hire date" value={formatDate(selectedStaff.hireDate)} />
                <InfoRow label="Phone" value={selectedStaff.phone} />
                <InfoRow label="Email" value={selectedStaff.email} />
                <InfoRow label="National ID" value={selectedStaff.nationalId} />
                <InfoRow label="KRA PIN" value={selectedStaff.kraPin} />
                <InfoRow label="NHIF" value={selectedStaff.nhifNumber} />
                <InfoRow label="NSSF" value={selectedStaff.nssfNumber} />
                <InfoRow label="Emergency contact" value={selectedStaff.emergencyContact} />
                <InfoRow label="Pay cycle" value={selectedStaff.payCycle} />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className={labelClass}>Notes</p>
                <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-600">
                  {selectedStaff.notes || 'No notes recorded.'}
                </p>
              </div>
            </div>
          )}

          {activeSection === 'DOCUMENTS' && (
            <div className="space-y-5">
              <form onSubmit={handleAddDocument} className="grid grid-cols-1 gap-3 lg:grid-cols-6">
                <div className="lg:col-span-2">
                  <label className={labelClass}>Name</label>
                  <input value={documentForm.name} onChange={event => setDocumentForm({ ...documentForm, name: event.target.value })} className={`${inputClass} mt-1`} placeholder="Contract, ID, certificate" />
                </div>
                <div>
                  <label className={labelClass}>Type</label>
                  <input value={documentForm.documentType} onChange={event => setDocumentForm({ ...documentForm, documentType: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Number</label>
                  <input value={documentForm.documentNumber} onChange={event => setDocumentForm({ ...documentForm, documentNumber: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Expires</label>
                  <input type="date" value={documentForm.expiryDate} onChange={event => setDocumentForm({ ...documentForm, expiryDate: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>File/link</label>
                  <input value={documentForm.fileUrl} onChange={event => setDocumentForm({ ...documentForm, fileUrl: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div className="lg:col-span-5">
                  <label className={labelClass}>Notes</label>
                  <input value={documentForm.notes} onChange={event => setDocumentForm({ ...documentForm, notes: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
                    <Save size={16} />
                    Save
                  </button>
                </div>
              </form>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Document</th>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Expiry</th>
                      <th className="px-4 py-3">File</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {selectedDocuments.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm font-bold text-slate-400">No documents saved.</td></tr>
                    ) : selectedDocuments.map(doc => (
                      <tr key={doc.id}>
                        <td className="px-4 py-3">
                          <p className="font-black text-slate-900">{doc.name}</p>
                          <p className="text-[11px] font-bold text-slate-400">{doc.documentType}</p>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-600">{doc.documentNumber || '-'}</td>
                        <td className="px-4 py-3 font-bold text-slate-600">{formatDate(doc.expiryDate)}</td>
                        <td className="px-4 py-3">
                          {doc.fileUrl ? (
                            <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-black text-primary">
                              Open <ExternalLink size={13} />
                            </a>
                          ) : <span className="text-xs font-bold text-slate-400">{doc.fileName || '-'}</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" title="Delete document" onClick={() => deleteRecord('document', doc.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSection === 'ATTENDANCE' && (
            <div className="space-y-5">
              <form onSubmit={handleSaveAttendance} className="grid grid-cols-1 gap-3 lg:grid-cols-7">
                <div>
                  <label className={labelClass}>Date</label>
                  <input type="date" value={attendanceForm.date} onChange={event => setAttendanceForm({ ...attendanceForm, date: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select value={attendanceForm.status} onChange={event => setAttendanceForm({ ...attendanceForm, status: event.target.value as HRAttendanceStatus })} className={`${inputClass} mt-1`}>
                    {attendanceStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>In</label>
                  <input type="time" value={attendanceForm.checkIn} onChange={event => setAttendanceForm({ ...attendanceForm, checkIn: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Out</label>
                  <input type="time" value={attendanceForm.checkOut} onChange={event => setAttendanceForm({ ...attendanceForm, checkOut: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Hours</label>
                  <input type="number" min="0" step="0.25" value={attendanceForm.hoursWorked} onChange={event => setAttendanceForm({ ...attendanceForm, hoursWorked: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Notes</label>
                  <input value={attendanceForm.notes} onChange={event => setAttendanceForm({ ...attendanceForm, notes: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
                    <Clock3 size={16} />
                    Record
                  </button>
                </div>
              </form>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Hours</th>
                      <th className="px-4 py-3">Notes</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {selectedAttendance.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm font-bold text-slate-400">No attendance records.</td></tr>
                    ) : selectedAttendance.map(row => (
                      <tr key={row.id}>
                        <td className="px-4 py-3 font-black text-slate-900">{formatDate(row.date)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${attendanceBadgeClass(row.status)}`}>
                            {row.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-600">{row.checkIn || '-'} - {row.checkOut || '-'}</td>
                        <td className="px-4 py-3 font-bold text-slate-600">{Number(row.hoursWorked || 0).toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold text-slate-500">{row.notes || '-'}</td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" title="Delete attendance" onClick={() => deleteRecord('attendance', row.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSection === 'PAY' && (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className={labelClass}>Payroll month</p>
                  <input type="month" value={payMonth} onChange={event => setPayMonth(event.target.value)} className={`${inputClass} mt-1 w-56`} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Attended</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{payrollSummary.attendedDays}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Off days</p>
                    <p className="mt-1 text-sm font-black text-slate-900">{payrollSummary.offDays}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Absences</p>
                    <p className="mt-1 text-sm font-black text-rose-600">{payrollSummary.absentDays}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 px-3 py-2 text-center">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Unrecorded</p>
                    <p className="mt-1 text-sm font-black text-amber-600">{payrollSummary.unrecordedDays}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <MetricTile icon={Banknote} label="Gross base" value={money(payrollSummary.baseEarned)} tone="bg-indigo-50 text-indigo-700" />
                <MetricTile icon={Plus} label="Additions" value={money(payrollSummary.additions)} tone="bg-emerald-50 text-emerald-700" />
                <MetricTile icon={AlertTriangle} label="Deductions" value={money(payrollSummary.deductions)} tone="bg-rose-50 text-rose-700" />
                <MetricTile icon={WalletCards} label="Net pay" value={money(payrollSummary.netPay)} tone="bg-slate-100 text-slate-800" />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
                  <InfoRow label="Rate per day" value={money(payrollSummary.dailyRate)} />
                  <InfoRow label="Paid days" value={`${payrollSummary.paidDays} / ${payrollSummary.daysInMonth}`} />
                  <InfoRow label="Leave days" value={payrollSummary.leaveDays} />
                  <InfoRow label="Half days" value={payrollSummary.halfDays} />
                  <InfoRow label="Base formula" value={`${money(payrollSummary.dailyRate)} x ${payrollSummary.paidDays}`} />
                </div>
              </div>

              <form onSubmit={handleAddPayroll} className="grid grid-cols-1 gap-3 lg:grid-cols-7">
                <div>
                  <label className={labelClass}>Type</label>
                  <select value={payrollForm.type} onChange={event => setPayrollForm({ ...payrollForm, type: event.target.value as HRPayrollType })} className={`${inputClass} mt-1`}>
                    {payrollTypeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className={labelClass}>Label</label>
                  <input value={payrollForm.label} onChange={event => setPayrollForm({ ...payrollForm, label: event.target.value })} className={`${inputClass} mt-1`} placeholder="Advance, lateness, allowance" />
                </div>
                <div>
                  <label className={labelClass}>Amount</label>
                  <input type="number" min="0" step="0.01" value={payrollForm.amount} onChange={event => setPayrollForm({ ...payrollForm, amount: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Date</label>
                  <input type="date" value={payrollForm.effectiveDate} onChange={event => setPayrollForm({ ...payrollForm, effectiveDate: event.target.value })} className={`${inputClass} mt-1`} />
                </div>
                <div>
                  <label className={labelClass}>Status</label>
                  <select value={payrollForm.status} onChange={event => setPayrollForm({ ...payrollForm, status: event.target.value as HRPayrollStatus })} className={`${inputClass} mt-1`}>
                    <option value="ACTIVE">Active</option>
                    <option value="PAID">Paid</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60">
                    <Save size={16} />
                    Save
                  </button>
                </div>
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 lg:col-span-2">
                  <input type="checkbox" checked={payrollForm.recurring} onChange={event => setPayrollForm({ ...payrollForm, recurring: event.target.checked })} className="h-4 w-4 accent-primary" />
                  Repeat monthly
                </label>
                <div className="lg:col-span-5">
                  <input value={payrollForm.notes} onChange={event => setPayrollForm({ ...payrollForm, notes: event.target.value })} className={inputClass} placeholder="Notes" />
                </div>
              </form>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Entry</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {selectedPayroll.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm font-bold text-slate-400">No payroll records.</td></tr>
                    ) : selectedPayroll.map(row => (
                      <tr key={row.id}>
                        <td className="px-4 py-3">
                          <p className="font-black text-slate-900">{row.label}</p>
                          <span className={`mt-1 inline-flex rounded-lg border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${payrollBadgeClass(row.type)}`}>
                            {row.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-600">{formatDate(row.effectiveDate)}</td>
                        <td className="px-4 py-3 font-black text-slate-900">{money(Number(row.amount || 0))}</td>
                        <td className="px-4 py-3 font-bold text-slate-600">{row.status}{row.recurring ? ' / Monthly' : ''}</td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" title="Delete payroll entry" onClick={() => deleteRecord('payroll', row.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {renderStaffModal()}
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in pb-24">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-950">HR</h2>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Workers, attendance, documents and payroll
          </p>
        </div>
        <button
          type="button"
          onClick={() => openStaffModal()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-primary/20 transition hover:bg-blue-700 active:scale-[0.98]"
        >
          <Plus size={18} />
          Register worker
        </button>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={UserRound} label="Active workers" value={String(activeStaff.length)} tone="bg-blue-50 text-blue-700" />
        <MetricTile icon={CalendarCheck} label="Present today" value={String(todayAttendanceCount)} tone="bg-emerald-50 text-emerald-700" />
        <MetricTile icon={Banknote} label="Base payroll" value={money(payrollTotal)} tone="bg-indigo-50 text-indigo-700" />
        <MetricTile icon={AlertTriangle} label="Deductions" value={money(monthlyDeductions)} tone="bg-rose-50 text-rose-700" />
      </div>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-950">Bulk attendance</h3>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{bulkSelectedStaffIds.length} selected</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={selectAllActive} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:border-primary/30 hover:text-primary">
              Select active
            </button>
            <button type="button" onClick={clearBulkSelection} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
              Clear
            </button>
          </div>
        </div>

        <form onSubmit={handleBulkAttendance} className="grid grid-cols-1 gap-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]">
          <div>
            <label className={labelClass}>Date</label>
            <input type="date" value={bulkAttendanceForm.date} onChange={event => setBulkAttendanceForm({ ...bulkAttendanceForm, date: event.target.value })} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select value={bulkAttendanceForm.status} onChange={event => setBulkAttendanceForm({ ...bulkAttendanceForm, status: event.target.value as HRAttendanceStatus })} className={`${inputClass} mt-1`}>
              {attendanceStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>In</label>
            <input type="time" value={bulkAttendanceForm.checkIn} onChange={event => setBulkAttendanceForm({ ...bulkAttendanceForm, checkIn: event.target.value })} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>Out</label>
            <input type="time" value={bulkAttendanceForm.checkOut} onChange={event => setBulkAttendanceForm({ ...bulkAttendanceForm, checkOut: event.target.value })} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>Hours</label>
            <input type="number" min="0" step="0.25" value={bulkAttendanceForm.hoursWorked} onChange={event => setBulkAttendanceForm({ ...bulkAttendanceForm, hoursWorked: event.target.value })} className={`${inputClass} mt-1`} />
          </div>
          <div>
            <label className={labelClass}>Notes</label>
            <input value={bulkAttendanceForm.notes} onChange={event => setBulkAttendanceForm({ ...bulkAttendanceForm, notes: event.target.value })} className={`${inputClass} mt-1`} />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={isSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-60 xl:w-auto">
              <CalendarCheck size={16} />
              Save
            </button>
          </div>
        </form>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {activeStaff.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-sm font-bold text-slate-400">No active workers.</div>
          ) : activeStaff.map(staff => {
            const checked = bulkSelectedStaffIds.includes(staff.id);
            const Icon = checked ? CheckSquare : Square;
            return (
              <button
                key={staff.id}
                type="button"
                onClick={() => toggleBulkWorker(staff.id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  checked ? 'border-primary/40 bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={18} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black stable-title">{staff.fullName}</span>
                  <span className="block truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{staff.roleTitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={staffSearch}
                onChange={event => setStaffSearch(event.target.value)}
                placeholder="Search workers..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-bold text-slate-800 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <select
              value={statusFilter}
              onChange={event => setStatusFilter(event.target.value as 'ALL' | HRStaffStatus)}
              className={inputClass}
            >
              <option value="ALL">All status</option>
              {staffStatusOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-4 py-3">Worker</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Contacts</th>
                <th className="px-4 py-3">Pay</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm font-bold text-slate-400">No workers found.</td>
                </tr>
              ) : filteredStaff.map(staff => (
                <tr key={staff.id} className="transition hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => openWorkerPage(staff.id)} className="flex min-w-0 items-center gap-3 text-left">
                      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950 text-xs font-black text-white">
                        {staff.fullName.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-black text-slate-950 stable-title">{staff.fullName}</span>
                        <span className="block truncate text-[11px] font-bold text-slate-400">{staff.nationalId || 'No national ID'}</span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-black text-slate-800">{staff.roleTitle}</p>
                    <p className="text-[11px] font-bold text-slate-400">{staff.department || '-'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-600">{staff.phone || '-'}</p>
                    <p className="text-[11px] font-bold text-slate-400">{staff.email || '-'}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-black text-slate-900">{money(Number(staff.baseSalary || 0))}</p>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{staff.payCycle}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${statusBadgeClass(staff.status)}`}>
                      {staff.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={() => openWorkerPage(staff.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:border-primary/30 hover:text-primary">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {renderStaffModal()}
    </div>
  );
}
