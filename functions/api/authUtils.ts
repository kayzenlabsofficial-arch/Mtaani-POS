export type Role = 'ROOT' | 'ADMIN' | 'MANAGER' | 'CASHIER';

export type Principal = {
  userId: string;
  userName: string;
  role: Role;
  businessId?: string;
  branchId?: string;
  exp: number;
};

export type AuthResult =
  | { ok: true; principal: Principal; service: boolean; response?: never }
  | { ok: false; response: Response; principal?: never; service?: never };

const TOKEN_VERSION = 'v3';
const LEGACY_SALT = 'mtaani-pos-v2-secure-2026';
const SESSION_COOKIE = 'mtaani_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_VERSION = 'pbkdf2';
const PASSWORD_ITERATIONS = 120_000;

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders,
    },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string, principal: Omit<Principal, 'exp'> & { exp?: number }): Promise<string> {
  const payload: Principal = {
    ...principal,
    exp: principal.exp || Date.now() + SESSION_TTL_MS,
  };
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(secret, `${TOKEN_VERSION}.${body}`);
  return `${TOKEN_VERSION}.${body}.${signature}`;
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join('=') || '');
  }
  return cookies;
}

function cookieSecureSuffix(request: Request): string {
  try {
    return new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  } catch {
    return '; Secure';
  }
}

export function createSessionCookie(request: Request, token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Strict${cookieSecureSuffix(request)}`;
}

export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${cookieSecureSuffix(request)}`;
}

export function isTrustedBrowserOrigin(request: Request): boolean {
  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite === 'cross-site') return false;

  const origin = request.headers.get('Origin');
  if (!origin) return true;

  try {
    const requestOrigin = new URL(request.url).origin;
    const originUrl = new URL(origin);
    if (origin === requestOrigin) return true;
    return originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1' || originUrl.hostname === '::1' || originUrl.hostname === '[::1]';
  } catch {
    return false;
  }
}

export function rejectUntrustedBrowserOrigin(request: Request): Response | null {
  return isTrustedBrowserOrigin(request)
    ? null
    : json({ error: 'Cross-site request blocked.' }, 403);
}

export async function verifySessionToken(secret: string, token: string): Promise<Principal | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [version, body, signature] = parts;
  const expected = await hmac(secret, `${version}.${body}`);
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as Principal;
    if (!payload?.userId || !payload?.role || !payload?.exp) return null;
    if (Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function authorizeRequest(request: Request, env: { API_SECRET?: string }): Promise<AuthResult> {
  const secret = env.API_SECRET;
  if (!secret) return { ok: false, response: json({ error: 'Server is not configured.' }, 500) };
  const originBlocked = rejectUntrustedBrowserOrigin(request);
  if (originBlocked) return { ok: false, response: originBlocked };

  const rawApiKey = request.headers.get('X-API-Key') || '';
  if (rawApiKey && rawApiKey === secret) {
    return {
      ok: true,
      service: true,
      principal: {
        userId: 'service',
        userName: 'Service',
        role: 'ROOT',
        exp: Date.now() + 60_000,
      },
    };
  }

  const authorization = request.headers.get('Authorization') || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const cookieToken = parseCookies(request.headers.get('Cookie') || '')[SESSION_COOKIE] || '';
  const token = bearer || rawApiKey || cookieToken;
  if (!token) return { ok: false, response: json({ error: 'Sign in required.' }, 401) };
  const principal = await verifySessionToken(secret, token);
  if (!principal) return { ok: false, response: json({ error: 'Session expired. Please sign in again.' }, 401) };
  return { ok: true, service: false, principal };
}

export function canAccessBusiness(principal: Principal, businessId?: string | null): boolean {
  if (principal.role === 'ROOT') return true;
  return !!businessId && !!principal.businessId && principal.businessId === businessId;
}

export function canAccessBranch(principal: Principal, branchId?: string | null): boolean {
  if (principal.role === 'ROOT' || !principal.branchId) return true;
  return !!branchId && principal.branchId === branchId;
}

export async function sha256Hex(value: string): Promise<string> {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Hash(plain: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(plain),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return base64UrlEncode(new Uint8Array(bits));
}

export function isPasswordHashCurrent(stored: string): boolean {
  const [version, algorithm, iterations, salt, hash] = String(stored || '').split('$');
  return version === PASSWORD_VERSION
    && algorithm === 'sha256'
    && Number(iterations) >= PASSWORD_ITERATIONS
    && !!salt
    && !!hash;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith(`${PASSWORD_VERSION}$`)) {
    const [version, algorithm, iterationsRaw, saltRaw, hash] = stored.split('$');
    if (version !== PASSWORD_VERSION || algorithm !== 'sha256' || !saltRaw || !hash) return false;
    const iterations = Number(iterationsRaw);
    if (!Number.isFinite(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
    const derived = await pbkdf2Hash(plain, base64UrlDecode(saltRaw), iterations);
    return timingSafeEqual(derived, hash);
  }
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    return (await sha256Hex(`${plain}${LEGACY_SALT}`)) === stored.toLowerCase();
  }
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    return false;
  }
  return plain === stored;
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2Hash(plain, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_VERSION}$sha256$${PASSWORD_ITERATIONS}$${base64UrlEncode(salt)}$${hash}`;
}
