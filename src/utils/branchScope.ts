export function belongsToActiveBranch(row: { branchId?: string | null }, activeBranchId?: string | null): boolean {
  return !row.branchId || row.branchId === activeBranchId;
}
