// ─────────────────────────────────────────────────────────────────────────────
// MTAANI POS - Security Utilities
// ─────────────────────────────────────────────────────────────────────────────

const SALT = 'mtaani-pos-v2-secure-2026';

/**
 * Hash a plaintext password using SHA-256 with a fixed app salt.
 * Uses the Web Crypto API — works in all modern browsers and Cloudflare Workers.
 */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a plaintext password against a stored hash.
 * Handles legacy plain-text passwords gracefully during migration.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  // If stored password looks like a SHA-256 hash (64 hex chars), compare hashes
  if (/^[a-f0-9]{64}$/.test(stored)) {
    const hashed = await hashPassword(plain);
    return hashed === stored;
  }
  // Legacy: plain-text comparison (for accounts not yet migrated)
  return plain === stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brute-Force Protection
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

interface AttemptRecord {
  count: number;
  lockedUntil: number | null;
}

function getKey(businessCode: string) {
  return `mtaani_login_attempts_${businessCode.toUpperCase()}`;
}

export function getAttemptRecord(businessCode: string): AttemptRecord {
  try {
    const raw = localStorage.getItem(getKey(businessCode));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { count: 0, lockedUntil: null };
}

export function isLockedOut(businessCode: string): { locked: boolean; secondsLeft: number } {
  const rec = getAttemptRecord(businessCode);
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) {
    return { locked: true, secondsLeft: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, secondsLeft: 0 };
}

export function recordFailedAttempt(businessCode: string): void {
  const rec = getAttemptRecord(businessCode);
  // Reset if previous lockout has expired
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    rec.count = 0;
    rec.lockedUntil = null;
  }
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  localStorage.setItem(getKey(businessCode), JSON.stringify(rec));
}

export function resetAttempts(businessCode: string): void {
  localStorage.removeItem(getKey(businessCode));
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
