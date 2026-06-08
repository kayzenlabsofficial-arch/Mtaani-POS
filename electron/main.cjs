const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { createLocalSqliteStore } = require('./local-sqlite.cjs');
const { startDesktopServer } = require('./local-server.cjs');
const packageJson = require('../package.json');

let mainWindow = null;
let localStore = null;
let localServer = null;

const allowedLocalDbMethods = new Set([
  'cacheTableRows',
  'readCachedTableRows',
  'enqueueOutbox',
  'markOutboxAttempt',
  'markOutboxError',
  'markOutboxAcked',
  'markOutboxBatchAcked',
  'getPendingOutbox',
  'getOutboxStats',
  'upsertSyncState',
  'readSyncState',
  'getStatus',
]);

function getApiBaseUrl() {
  const configured = process.env.SMART_API_BASE_URL || process.env.VITE_API_BASE_URL || readDesktopConfigApiBaseUrl();
  const fallback = packageJson.desktop?.defaultApiBaseUrl || 'https://smartpos.pages.dev';
  return normalizeApiBaseUrl(configured || fallback);
}

function normalizeApiBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function readDesktopConfigApiBaseUrl() {
  const candidates = [
    path.join(path.dirname(process.execPath), 'desktop-config.json'),
    path.join(app.getPath('userData'), 'desktop-config.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const value = config?.apiBaseUrl || config?.SMART_API_BASE_URL;
      if (value) return String(value);
    } catch (err) {
      console.warn(`[Desktop] Could not read ${filePath}:`, err?.message || err);
    }
  }

  return '';
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await mainWindow.loadURL(devServerUrl);
  } else {
    if (!localServer) {
      localServer = await startDesktopServer({
        distDir: path.join(__dirname, '..', 'dist'),
        apiBaseUrl: getApiBaseUrl(),
      });
    }
    await mainWindow.loadURL(localServer.url);
  }
}

app.whenReady().then(async () => {
  localStore = createLocalSqliteStore(app);

  ipcMain.handle('smart:desktop-info', () => ({
    apiBaseUrl: getApiBaseUrl(),
    sqlitePath: localStore.getStatus().path,
    platform: process.platform,
  }));

  ipcMain.handle('smart:local-db', (_event, method, payload = {}) => {
    if (!allowedLocalDbMethods.has(method)) {
      throw new Error(`Unsupported local database method: ${method}`);
    }
    return localStore[method](payload);
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (localStore) {
    localStore.close();
    localStore = null;
  }
  if (localServer) {
    void localServer.close();
    localServer = null;
  }
});
