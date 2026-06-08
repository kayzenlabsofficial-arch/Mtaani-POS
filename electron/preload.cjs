const { contextBridge, ipcRenderer } = require('electron');

function localDbInvoke(method, payload) {
  return ipcRenderer.invoke('smart:local-db', method, payload || {});
}

contextBridge.exposeInMainWorld('smartDesktop', {
  isDesktop: true,
  apiBaseUrl: '',
  platform: process.platform,
  getInfo: () => ipcRenderer.invoke('smart:desktop-info'),
  localDb: {
    cacheTableRows: (args) => localDbInvoke('cacheTableRows', args),
    readCachedTableRows: (args) => localDbInvoke('readCachedTableRows', args),
    enqueueOutbox: (args) => localDbInvoke('enqueueOutbox', args),
    markOutboxAttempt: (args) => localDbInvoke('markOutboxAttempt', args),
    markOutboxError: (args) => localDbInvoke('markOutboxError', args),
    markOutboxAcked: (args) => localDbInvoke('markOutboxAcked', args),
    markOutboxBatchAcked: (args) => localDbInvoke('markOutboxBatchAcked', args),
    getPendingOutbox: (args) => localDbInvoke('getPendingOutbox', args),
    getOutboxStats: (args) => localDbInvoke('getOutboxStats', args),
    upsertSyncState: (args) => localDbInvoke('upsertSyncState', args),
    readSyncState: (args) => localDbInvoke('readSyncState', args),
    getStatus: () => localDbInvoke('getStatus'),
  },
});
