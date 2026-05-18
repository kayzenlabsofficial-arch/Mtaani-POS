export type ExpiryStatus = 'NONE' | 'OK' | 'SOON' | 'TODAY' | 'EXPIRED';

export type ExpiryInfo = {
  tracking: boolean;
  status: ExpiryStatus;
  label: string;
  dateLabel: string;
  daysUntilExpiry: number | null;
  timestamp: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WARNING_DAYS = 30;

function isTruthy(value: unknown) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function normaliseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function dateInputToExpiryMs(value: string): number | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function expiryMsToDateInput(value: unknown): string {
  const timestamp = normaliseTimestamp(value);
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatExpiryDate(value: unknown) {
  const timestamp = normaliseTimestamp(value);
  if (!timestamp) return 'Date not set';
  return new Date(timestamp).toLocaleDateString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function getExpiryInfo(product: { expiryTracking?: unknown; expiryDate?: unknown } | null | undefined, warningDays = DEFAULT_WARNING_DAYS, nowMs = Date.now()): ExpiryInfo {
  const timestamp = normaliseTimestamp(product?.expiryDate);
  const tracking = isTruthy(product?.expiryTracking) || Boolean(timestamp);

  if (!tracking) {
    return {
      tracking: false,
      status: 'NONE',
      label: 'Not tracked',
      dateLabel: 'Not tracked',
      daysUntilExpiry: null,
      timestamp: null,
    };
  }

  if (!timestamp) {
    return {
      tracking: true,
      status: 'NONE',
      label: 'Date not set',
      dateLabel: 'Date not set',
      daysUntilExpiry: null,
      timestamp: null,
    };
  }

  const daysUntilExpiry = Math.ceil((startOfLocalDay(timestamp) - startOfLocalDay(nowMs)) / DAY_MS);
  const dateLabel = formatExpiryDate(timestamp);

  if (daysUntilExpiry < 0) {
    return {
      tracking: true,
      status: 'EXPIRED',
      label: `Expired ${Math.abs(daysUntilExpiry)}d ago`,
      dateLabel,
      daysUntilExpiry,
      timestamp,
    };
  }

  if (daysUntilExpiry === 0) {
    return {
      tracking: true,
      status: 'TODAY',
      label: 'Expires today',
      dateLabel,
      daysUntilExpiry,
      timestamp,
    };
  }

  if (daysUntilExpiry <= warningDays) {
    return {
      tracking: true,
      status: 'SOON',
      label: `${daysUntilExpiry}d left`,
      dateLabel,
      daysUntilExpiry,
      timestamp,
    };
  }

  return {
    tracking: true,
    status: 'OK',
    label: dateLabel,
    dateLabel,
    daysUntilExpiry,
    timestamp,
  };
}

export function expiryBadgeClass(status: ExpiryStatus) {
  if (status === 'EXPIRED') return 'bg-rose-50 text-rose-700 border-rose-100';
  if (status === 'TODAY') return 'bg-orange-50 text-orange-700 border-orange-100';
  if (status === 'SOON') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (status === 'OK') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  return 'bg-slate-50 text-slate-500 border-slate-100';
}
