// ─────────────────────────────────────────────────────────────────────────────
// MTAANI POS - Security Utilities
// ─────────────────────────────────────────────────────────────────────────────

// Stronger salt for backward compatibility
const LEGACY_SALT = 'mtaani-pos-v2-secure-2026';

/**
 * Hash a plaintext password using bcrypt (preferred) or SHA-256 with salt as fallback.
 * For new implementations, bcrypt is recommended.
 */
export async function hashPassword(password: string): Promise<string> {
  // Try to use bcrypt if available (in Node.js environment)
  if (typeof window === 'undefined') {
    try {
      // Server-side bcrypt implementation
      const bcrypt = await import('bcryptjs');
      return await bcrypt.hash(password, 12);
    } catch (e) {
      // Fallback to SHA-256 if bcrypt is not available
      return hashPasswordSHA256(password);
    }
  } else {
    // Client-side fallback to SHA-256
    return hashPasswordSHA256(password);
  }
}

/**
 * Hash a plaintext password using SHA-256 with a fixed app salt.
 * Uses the Web Crypto API — works in all modern browsers and Cloudflare Workers.
 */
async function hashPasswordSHA256(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + LEGACY_SALT);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a plaintext password against a stored hash.
 * Handles legacy plain-text passwords and SHA-256 hashes gracefully during migration.
 * Also supports bcrypt hashes.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  // If stored password looks like a bcrypt hash, use bcrypt verification
  if (stored.startsWith('$2b$') || stored.startsWith('$2a$') || stored.startsWith('$2y$')) {
    if (typeof window === 'undefined') {
      try {
        const bcrypt = await import('bcryptjs');
        return await bcrypt.compare(plain, stored);
      } catch (e) {
        // Fallback to SHA-256 if bcrypt fails
        return await verifyPasswordSHA256(plain, stored);
      }
    } else {
      // Client-side cannot verify bcrypt, fallback to SHA-256
      return await verifyPasswordSHA256(plain, stored);
    }
  }
  // If stored password looks like a SHA-256 hash (64 hex chars), compare hashes
  if (/^[a-f0-9]{64}$/.test(stored)) {
    return await verifyPasswordSHA256(plain, stored);
  }
  // Legacy: plain-text comparison (for accounts not yet migrated)
  return plain === stored;
}

/**
 * Verify a plaintext password against a SHA-256 hash.
 */
async function verifyPasswordSHA256(plain: string, stored: string): Promise<boolean> {
  const hashed = await hashPasswordSHA256(plain);
  return hashed === stored;
}

// ─────────────────────────────────────────────────────────────────────────────
// Brute-Force Protection
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes

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
