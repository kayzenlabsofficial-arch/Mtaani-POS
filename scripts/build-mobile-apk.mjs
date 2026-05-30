import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(rootDir, 'android');
const env = { ...process.env };

function firstExisting(paths) {
  return paths.find(candidate => candidate && existsSync(candidate));
}

if (!env.JAVA_HOME) {
  const javaHome = firstExisting([
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/Applications/Android Studio.app/Contents/jre/Contents/Home',
  ]);
  if (javaHome) env.JAVA_HOME = javaHome;
}

if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT) {
  const sdkHome = firstExisting([
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    env.HOME ? path.join(env.HOME, 'Library', 'Android', 'sdk') : '',
    env.HOME ? path.join(env.HOME, 'Android', 'Sdk') : '',
  ]);
  if (sdkHome) {
    env.ANDROID_HOME = sdkHome;
    env.ANDROID_SDK_ROOT = sdkHome;
  }
}

function run(command, options = {}) {
  const result = spawnSync(command, {
    cwd: options.cwd || rootDir,
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

run('npm run mobile:sync');
run(process.platform === 'win32' ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug', { cwd: androidDir });

console.log('\nDebug APK: android/app/build/outputs/apk/debug/app-debug.apk');
