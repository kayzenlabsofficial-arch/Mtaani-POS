import { describe, expect, it } from 'vitest';
import {
  clearMpesaSettingsAttempts,
  getMpesaSettingsLockMinutes,
  mpesaSettingsAttemptId,
  recordFailedMpesaSettingsAttempt,
} from './settingsLockout';

function createLoginAttemptDb() {
  const rows = new Map<string, { count: number; lockedUntil: number | null; updated_at: number }>();
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => rows.get(String(args[0])) || null,
        run: async () => {
          if (sql.startsWith('INSERT OR REPLACE')) {
            rows.set(String(args[0]), {
              count: Number(args[1] || 0),
              lockedUntil: args[2] === null || args[2] === undefined ? null : Number(args[2]),
              updated_at: Number(args[3] || 0),
            });
          }
          if (sql.startsWith('DELETE')) rows.delete(String(args[0]));
          return { success: true };
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, rows };
}

describe('M-Pesa settings lockout', () => {
  it('uses one attempt id for save and test password checks', () => {
    expect(mpesaSettingsAttemptId('biz-1', 'admin-1')).toBe('MPESA_SETTINGS:biz-1:admin-1');
  });

  it('locks after repeated failures and clears after a successful password check', async () => {
    const { db, rows } = createLoginAttemptDb();
    const attemptId = mpesaSettingsAttemptId('biz-1', 'admin-1');

    for (let index = 0; index < 5; index += 1) {
      await recordFailedMpesaSettingsAttempt(db, attemptId);
    }

    expect(rows.get(attemptId)?.count).toBe(5);
    await expect(getMpesaSettingsLockMinutes(db, attemptId)).resolves.toBeGreaterThan(0);

    await clearMpesaSettingsAttempts(db, attemptId);
    await expect(getMpesaSettingsLockMinutes(db, attemptId)).resolves.toBe(0);
  });
});
