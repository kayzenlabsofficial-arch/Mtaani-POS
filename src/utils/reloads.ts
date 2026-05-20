type ReloadTask = () => Promise<unknown>;

export async function reloadBestEffort(tasks: ReloadTask[], timeoutMs = 7000): Promise<void> {
  await Promise.allSettled(
    tasks.map(task => new Promise<void>(resolve => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        settled = true;
        resolve();
      }, timeoutMs);

      task()
        .catch(err => console.warn('[reloadBestEffort] Reload failed:', err))
        .finally(() => {
          if (settled) return;
          globalThis.clearTimeout(timer);
          resolve();
        });
    }))
  );
}
