const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000;

export function mpesaSettingsAttemptId(businessId: string, userId: string) {
  return `MPESA_SETTINGS:${String(businessId || '').trim()}:${String(userId || '').trim()}`;
}

export async function ensureMpesaSettingsAttemptTable(db: D1Database) {
  await db.prepare('CREATE TABLE IF NOT EXISTS loginAttempts (id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, lockedUntil INTEGER, updated_at INTEGER)').run();
}

export async function getMpesaSettingsLockMinutes(db: D1Database, id: string) {
  const row = await db.prepare('SELECT count, lockedUntil FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  if (row?.lockedUntil && Date.now() < Number(row.lockedUntil)) {
    return Math.ceil((Number(row.lockedUntil) - Date.now()) / 60000);
  }
  return 0;
}

export async function recordFailedMpesaSettingsAttempt(db: D1Database, id: string) {
  const row = await db.prepare('SELECT count, lockedUntil FROM loginAttempts WHERE id = ?').bind(id).first<any>();
  const count = Number(row?.count || 0) + 1;
  const lockedUntil = count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : null;
  await db.prepare('INSERT OR REPLACE INTO loginAttempts (id, count, lockedUntil, updated_at) VALUES (?, ?, ?, ?)')
    .bind(id, count, lockedUntil, Date.now())
    .run();
}

export async function clearMpesaSettingsAttempts(db: D1Database, id: string) {
  await db.prepare('DELETE FROM loginAttempts WHERE id = ?').bind(id).run();
}
