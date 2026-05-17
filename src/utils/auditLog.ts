import { useStore } from '../store';
import { apiRequest } from '../services/apiClient';

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

  apiRequest('/api/audit/log', {
    method: 'POST',
    body: {
      ...event,
      businessId: state.activeBusinessId,
      branchId: state.activeBranchId || undefined,
    },
    businessId: state.activeBusinessId,
    branchId: state.activeBranchId,
  }).catch(err => {
    console.warn('[Audit] failed to persist event', err);
  });
}

// Keep a stub for components that might synchronously read it,
// though they should now use useLiveQuery(db.auditLogs.toArray)
export function getAuditEvents(): AuditEvent[] {
  return [];
}
