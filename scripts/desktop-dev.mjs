import { spawn } from 'node:child_process';

const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3000';
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';
const electronCmd = isWindows ? 'electron.cmd' : 'electron';

function spawnChild(command, args, env = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

async function waitForServer(url, timeoutMs = 45_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok || res.status < 500) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for Vite at ${url}`);
}

const vite = spawnChild(npmCmd, ['run', 'dev']);

let electron = null;
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (electron && !electron.killed) electron.kill();
  if (!vite.killed) vite.kill();
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

vite.on('exit', (code) => {
  if (!shuttingDown) shutdown(code || 0);
});

try {
  await waitForServer(devUrl);
  electron = spawnChild(electronCmd, ['.'], {
    VITE_DEV_SERVER_URL: devUrl,
  });
  electron.on('exit', (code) => shutdown(code || 0));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  shutdown(1);
}
