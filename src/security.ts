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

// NOTE: Client-side lockout checking was removed.
// The server enforces brute-force lockout in /api/auth (auth.ts).
// Attempting to read loginAttempts before authentication creates a
// chicken-and-egg problem and the check was never reachable.
// The functions below are kept as no-ops for backward compatibility.

export async function getAttemptRecord(_businessCode: string) {
  return { id: '', count: 0, lockedUntil: null };
}

export async function isLockedOut(_businessCode: string): Promise<{ locked: boolean; secondsLeft: number }> {
  return { locked: false, secondsLeft: 0 };
}

export async function recordFailedAttempt(_businessCode: string): Promise<void> {
  // no-op: server handles lockout
}

export async function resetAttempts(_businessCode: string): Promise<void> {
  // no-op: server handles lockout
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
