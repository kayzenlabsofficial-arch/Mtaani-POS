import { spawnSync } from 'node:child_process';

const env = {
  ...process.env,
  MTAANI_CAPACITOR_BUILD: 'true',
};

function run(command) {
  const result = spawnSync(command, {
    env,
    stdio: 'inherit',
    shell: true,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

run('vite build');
run('cap sync android');
