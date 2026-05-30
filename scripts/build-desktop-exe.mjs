import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const finalCommand = isWindows ? 'cmd.exe' : command;
    const finalArgs = isWindows ? ['/c', command, ...args] : args;
    const child = spawn(finalCommand, finalArgs, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
    child.on('error', reject);
  });
}

await run('npm', ['run', 'desktop:build']);
await run('npx', ['electron-builder', '--win', 'portable', '--x64', '--publish', 'never'], {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
});
