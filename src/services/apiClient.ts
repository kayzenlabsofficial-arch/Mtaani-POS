import { getApiKey } from '../runtimeConfig';
import { useStore } from '../store';

export class ApiError extends Error {
  status: number;
  data: any;

  constructor(message: string, status = 0, data: any = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown;
  headers?: Record<string, string>;
  businessId?: string | null;
  branchId?: string | null;
  requireOnline?: boolean;
};

function isBodyInit(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  );
}

async function parseResponse(res: Response) {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  if (options.requireOnline !== false && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('Offline: this action requires internet connection.');
  }

  const state = useStore.getState();
  const apiKey = await getApiKey();
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  if (apiKey) headers['X-API-Key'] = apiKey;
  const businessId = options.businessId ?? state.activeBusinessId;
  const branchId = options.branchId ?? state.activeBranchId;
  if (businessId) headers['X-Business-ID'] = businessId;
  if (branchId) headers['X-Branch-ID'] = branchId;

  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (isBodyInit(options.body)) {
      body = options.body;
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(options.body);
    }
  }

  const res = await fetch(path, {
    ...options,
    body,
    headers,
    credentials: options.credentials || 'same-origin',
    cache: options.cache || 'no-store',
  });
  const data = await parseResponse(res);

  if (!res.ok) {
    const message = typeof data === 'object' && data?.error
      ? data.error
      : typeof data === 'string' && data
        ? data.slice(0, 180)
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status, data);
  }

  return data as T;
}

