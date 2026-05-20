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
  requestTimeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

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

  const {
    body: requestBody,
    headers: optionHeaders,
    businessId: optionBusinessId,
    branchId: optionBranchId,
    requireOnline: _requireOnline,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    ...requestOptions
  } = options;
  const state = useStore.getState();
  const apiKey = await getApiKey();
  const headers: Record<string, string> = {
    ...(optionHeaders || {}),
  };

  if (apiKey) headers['X-API-Key'] = apiKey;
  const businessId = optionBusinessId ?? state.activeBusinessId;
  const branchId = optionBranchId ?? state.activeBranchId;
  if (businessId) headers['X-Business-ID'] = businessId;
  if (branchId) headers['X-Branch-ID'] = branchId;

  let body: BodyInit | undefined;
  if (requestBody !== undefined) {
    if (isBodyInit(requestBody)) {
      body = requestBody;
    } else {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      body = JSON.stringify(requestBody);
    }
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      ...requestOptions,
      body,
      headers,
      credentials: requestOptions.credentials || 'same-origin',
      cache: requestOptions.cache || 'no-store',
      signal: requestOptions.signal || controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('Request timed out. Please check the connection and try again.', 408);
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timeout);
  }
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
