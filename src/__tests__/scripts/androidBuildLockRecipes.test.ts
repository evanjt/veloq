/**
 * Scenario: another session's Android build holds the build lock while this
 * one runs an npm recipe that writes the bundle, the native library or the APK.
 *
 * Expected behaviour: no artifact writer starts until the holder releases the
 * lock, each then runs once, the recipe keeps its exit status, and the debug
 * recipe, which bundles inside its own lock, does not wait on itself.
 */
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Fixture {
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: string;
  lock: string;
}

/**
 * A working directory whose `node`, `npx`, `npm` and `gradlew` are spies that
 * log their arguments. `npm run bundle:android` re-enters the real recipe, so
 * the nested lock path is the one under test. The spy for the exporter exits
 * with a sentinel status.
 */
function fixture(): Fixture {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-recipe-'));
  const bin = path.join(cwd, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(cwd, 'android'));
  fs.symlinkSync(path.join(projectRoot, 'scripts'), path.join(cwd, 'scripts'));
  const log = path.join(cwd, 'writers.log');
  const spy = (name: string, body: string) => {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };
  spy(
    'node',
    `case "$*" in *check-native-tree*) exit 0;; esac\necho "node $*" >> "${log}"\ncase "$*" in *bundle-android*) exit 23;; esac`
  );
  spy('npx', `echo "npx $*" >> "${log}"`);
  spy(
    'npm',
    `if [ "$2" = "bundle:android" ]; then exec sh -c '${packageJson.scripts['bundle:android']}'; fi\nexit 0`
  );
  fs.writeFileSync(
    path.join(cwd, 'android/gradlew'),
    `#!/bin/sh\necho "gradlew $*" >> "${log}"\n`,
    {
      mode: 0o755,
    }
  );
  const lock = path.join(cwd, 'build.lock');
  return {
    cwd,
    log,
    lock,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, VELOQ_ANDROID_BUILD_LOCK: lock },
  };
}

function hold(lock: string): ChildProcess {
  return spawn('flock', [lock, 'sh', '-c', 'echo held; cat'], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

async function held(lock: string): Promise<ChildProcess> {
  const holder = hold(lock);
  await new Promise<void>((resolve) => holder.stdout!.once('data', () => resolve()));
  return holder;
}

function writers(log: string): string[] {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
}

async function runWhileHeld(script: string) {
  const f = fixture();
  const holder = await held(f.lock);
  const recipe = spawn('sh', ['-c', packageJson.scripts[script]], {
    cwd: f.cwd,
    env: f.env,
    stdio: 'ignore',
  });
  const done = new Promise<number | null>((resolve) => recipe.on('close', resolve));
  await sleep(700);
  const whileHeld = writers(f.log);
  holder.stdin!.end();
  const status = await Promise.race([
    done,
    sleep(15000).then(() => {
      recipe.kill();
      return 'deadlock' as const;
    }),
  ]);
  return { whileHeld, afterRelease: writers(f.log), status };
}

describe('Android artifact recipes wait for the build lock', () => {
  it.each([
    ['android', 0, ['node scripts/check-toolchain.mjs', 'npx expo run:android']],
    [
      'android:prod',
      0,
      [
        'node scripts/build-record.js snapshot android release',
        'npx expo run:android --variant release',
        'node scripts/build-record.js write release',
      ],
    ],
    ['bundle:android', 23, ['node scripts/bundle-android.mjs']],
    ['android:debug', 23, ['node scripts/bundle-android.mjs']],
  ])(
    '%s starts no writer while the lock is held',
    async (script, status, expected) => {
      const run = await runWhileHeld(script);
      expect(run.whileHeld).toEqual([]);
      expect(run.afterRelease).toEqual(expected);
      expect(run.status).toBe(status);
    },
    30000
  );
});
