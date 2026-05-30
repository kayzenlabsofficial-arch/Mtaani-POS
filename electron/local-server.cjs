const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function copyRequestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('X-Mtaani-Desktop', '1');
  return headers;
}

async function proxyApi(req, res, apiBaseUrl) {
  if (!apiBaseUrl) {
    sendJson(res, 503, {
      error: 'Desktop API base URL is not configured. Set MTAANI_API_BASE_URL before starting the desktop app.',
    });
    return;
  }

  const target = new URL(req.url || '/', apiBaseUrl.replace(/\/+$/, ''));
  const method = req.method || 'GET';
  const init = {
    method,
    headers: copyRequestHeaders(req),
    redirect: 'manual',
  };
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = req;
    init.duplex = 'half';
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    sendJson(res, 502, { error: err instanceof Error ? err.message : 'Cloud API request failed.' });
    return;
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (['connection', 'content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) return;
    responseHeaders[key] = value;
  });
  res.writeHead(upstream.status, responseHeaders);
  if (upstream.body) {
    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      res.destroy(err);
    }
  } else {
    res.end();
  }
}

function serveStatic(req, res, distDir) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const rootDir = path.resolve(distDir);
  let filePath = path.resolve(distDir, relativePath);

  if (filePath !== rootDir && !filePath.startsWith(rootDir + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  };
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function startDesktopServer({ distDir, apiBaseUrl }) {
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
    if (requestUrl.pathname.startsWith('/api/')) {
      void proxyApi(req, res, apiBaseUrl);
      return;
    }
    serveStatic(req, res, distDir);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not start desktop server.'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise(closeResolve => server.close(() => closeResolve())),
      });
    });
  });
}

module.exports = { startDesktopServer };
