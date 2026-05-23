export function getCurrentShiftId(activeShift: any, shopId?: string | null, userId?: string | null): string | undefined {
  if (activeShift?.id) return String(activeShift.id);
  if (!shopId || !userId) return undefined;
  return undefined;
}

export function getCurrentShiftStart(activeShift: any, fallback = Date.now()): number {
  return Number(activeShift?.startTime || fallback);
}
