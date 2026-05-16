import { isTrustedBrowserOrigin, rejectUntrustedBrowserOrigin } from './authUtils';

type Env = Record<string, unknown>;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;
  const blocked = rejectUntrustedBrowserOrigin(request);
  if (blocked) return blocked;
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 2_500_000) {
    return new Response(JSON.stringify({ error: 'Request too large.' }), {
      status: 413,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const response = await context.next();
  const headers = new Headers(response.headers);
  const origin = request.headers.get('Origin');

  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  if (origin && isTrustedBrowserOrigin(request)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.append('Vary', 'Origin');
  }

  headers.set('X-Content-Type-Options', headers.get('X-Content-Type-Options') || 'nosniff');
  headers.set('Referrer-Policy', headers.get('Referrer-Policy') || 'no-referrer');
  headers.set('X-Frame-Options', headers.get('X-Frame-Options') || 'DENY');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
