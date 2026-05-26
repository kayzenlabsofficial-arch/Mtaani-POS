export type SalesTill = {
  id: string;
  name: string;
  isActive: boolean;
};

export const DEFAULT_SALES_TILLS: SalesTill[] = [
  { id: 'till-1', name: 'Till 1', isActive: true },
];

function cleanTillName(value: unknown, fallback: string) {
  const text = String(value ?? '').trim();
  return text.slice(0, 60) || fallback;
}

function parseRawTills(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseSalesTills(settings: any): SalesTill[] {
  const rows = parseRawTills(settings?.salesTills)
    .map((row, index) => {
      const id = String(row?.id || `till-${index + 1}`).trim().slice(0, 80);
      if (!id) return null;
      return {
        id,
        name: cleanTillName(row?.name, `Till ${index + 1}`),
        isActive: row?.isActive === undefined ? true : row.isActive !== false && row.isActive !== 0 && row.isActive !== '0',
      };
    })
    .filter(Boolean) as SalesTill[];

  const activeRows = rows.filter(row => row.isActive);
  return activeRows.length ? activeRows : DEFAULT_SALES_TILLS;
}

export function parseSalesTillRows(rows: any[] | null | undefined): SalesTill[] {
  const tills = (rows || [])
    .map((row, index) => {
      const id = String(row?.id || `till-${index + 1}`).trim().slice(0, 80);
      if (!id) return null;
      return {
        id,
        name: cleanTillName(row?.name, `Till ${index + 1}`),
        isActive: row?.isActive === undefined ? true : row.isActive !== false && row.isActive !== 0 && row.isActive !== '0',
      };
    })
    .filter(Boolean) as SalesTill[];
  const active = tills.filter(till => till.isActive);
  return active.length ? active.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : [];
}

export function normalizeTillCount(count: unknown, existing: SalesTill[] = DEFAULT_SALES_TILLS): SalesTill[] {
  const target = Math.min(12, Math.max(1, Math.floor(Number(count) || 1)));
  return Array.from({ length: target }, (_, index) => {
    const current = existing[index];
    return {
      id: current?.id || `till-${index + 1}`,
      name: cleanTillName(current?.name, `Till ${index + 1}`),
      isActive: true,
    };
  });
}

export function scopeSalesTillIds(tills: SalesTill[], businessId: string): SalesTill[] {
  const businessKey = String(businessId || 'business').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 42) || 'business';
  const seen = new Set<string>();
  return tills.map((till, index) => {
    const fallbackId = `${businessKey}-till-${index + 1}`;
    const rawId = String(till.id || '').trim();
    const needsScopedId = !rawId || /^till-\d+$/i.test(rawId);
    const baseId = (needsScopedId ? fallbackId : rawId).slice(0, 80) || fallbackId;
    let id = baseId;
    let suffix = 2;
    while (seen.has(id)) {
      id = `${baseId.slice(0, 76)}-${suffix}`.slice(0, 80);
      suffix += 1;
    }
    seen.add(id);
    return { ...till, id };
  });
}

export function serializeSalesTills(tills: SalesTill[]): string {
  return JSON.stringify(tills.map((till, index) => ({
    id: String(till.id || `till-${index + 1}`).trim() || `till-${index + 1}`,
    name: cleanTillName(till.name, `Till ${index + 1}`),
    isActive: till.isActive !== false,
  })));
}

export function getDefaultOpeningFloat(settings: any): number {
  const value = Number(settings?.defaultOpeningFloat);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function tillNameForShift(shift: any, tills: SalesTill[] = DEFAULT_SALES_TILLS): string {
  const direct = cleanTillName(shift?.tillName, '');
  if (direct) return direct;
  const till = tills.find(item => item.id === shift?.tillId);
  return till?.name || 'Till';
}
