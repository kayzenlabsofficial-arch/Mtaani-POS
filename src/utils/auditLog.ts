type AuditSeverity = 'INFO' | 'WARN' | 'CRITICAL';

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

const STORAGE_KEY = 'mtaani_audit_log_v1';
const MAX_EVENTS = 2000;

export function recordAuditEvent(event: Omit<AuditEvent, 'id' | 'ts'>): void {
  if (typeof window === 'undefined') return;
  const row: AuditEvent = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    ...event,
  };
  try {
    const current = getAuditEvents();
    const next = [row, ...current].slice(0, MAX_EVENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[Audit] failed to persist event', err);
  }
}

export function getAuditEvents(): AuditEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

