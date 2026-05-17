import { db, type AuditLog } from '../db';
import { useStore } from '../store';

export type AuditSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export interface AuditEvent {
  id: string;
  ts: number;
  userId?: string;
  userName?: string;
  action: string;
  entity?: string;
  entityId?: string;
  severity: AuditSeverity;
  details?: string;
}

export function recordAuditEvent(event: Omit<AuditEvent, 'id' | 'ts'>): void {
  if (typeof window === 'undefined') return;
  
  const state = useStore.getState();
  if (!state.activeBusinessId) return;

  const row: AuditLog = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    ...event,
    businessId: state.activeBusinessId,
    branchId: state.activeBranchId || undefined,
    updated_at: Date.now(),
  };

  db.auditLogs.add(row).catch(err => {
    console.warn('[Audit] failed to persist event to CloudDB', err);
  });
}

// Keep a stub for components that might synchronously read it,
// though they should now use useLiveQuery(db.auditLogs.toArray)
export function getAuditEvents(): AuditEvent[] {
  return [];
}

