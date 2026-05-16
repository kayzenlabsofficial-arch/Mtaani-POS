// ─────────────────────────────────────────────────────────────────────────────
// MTAANI POS - Security Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hash a plaintext password using SHA-256 with a fixed app salt.
 * Uses the Web Crypto API — works in all modern browsers and Cloudflare Workers.
 */
/**
 * Verify a plaintext password against a stored hash.
 * Handles legacy plain-text passwords and SHA-256 hashes gracefully during migration.
 * Also supports bcrypt hashes.
 */
// ─────────────────────────────────────────────────────────────────────────────
// Brute-Force Protection
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

interface AttemptRecord {
  count: number;
  lockedUntil: number | null;
}

import { db, type LoginAttempt } from './db';

export async function getAttemptRecord(businessCode: string): Promise<LoginAttempt> {
  try {
    const rec = await db.loginAttempts.get(businessCode.toUpperCase());
    if (rec) return rec;
  } catch {}
  return { id: businessCode.toUpperCase(), count: 0, lockedUntil: null };
}

export async function isLockedOut(businessCode: string): Promise<{ locked: boolean; secondsLeft: number }> {
  const rec = await getAttemptRecord(businessCode);
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { locked: true, secondsLeft: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, secondsLeft: 0 };
}

export async function recordFailedAttempt(businessCode: string): Promise<void> {
  const rec = await getAttemptRecord(businessCode);
  // Reset if previous lockout has expired
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    rec.count = 0;
    rec.lockedUntil = null;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  await db.loginAttempts.put({ ...rec, id: businessCode.toUpperCase(), updated_at: Date.now() });
}

export async function resetAttempts(businessCode: string): Promise<void> {
  await db.loginAttempts.delete(businessCode.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Sanitization
// ─────────────────────────────────────────────────────────────────────────────

/** Strip any HTML/script tags and trim whitespace */
export function sanitizeString(input: string, maxLength = 255): string {
  return input
    .trim()
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[<>"'`]/g, '') // strip dangerous chars
    .slice(0, maxLength);
}

/** Validate business code: alphanumeric, 3–20 chars */
export function isValidBusinessCode(code: string): boolean {
  return /^[A-Z0-9]{3,20}$/.test(code.toUpperCase());
}

/** Validate UUID format */
export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
