export function getCurrentShiftId(activeShift: any, branchId?: string | null, userId?: string | null): string | undefined {
  if (activeShift?.id) return String(activeShift.id);
  if (!branchId || !userId) return undefined;
  return `shift_${branchId}_${new Date().toISOString().slice(0, 10)}_${userId}`;
}

export function getCurrentShiftStart(activeShift: any, fallback = Date.now()): number {
  return Number(activeShift?.startTime || fallback);
}
