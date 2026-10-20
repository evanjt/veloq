/**
 * Scenario: a store capture taken on a dev build carries its "Open debugger
 * to view warnings" toast across the bottom of the listing shots.
 *
 * Expected behaviour: the capture's build check refuses a debuggable Android
 * package and an iOS simulator app with no embedded JavaScript bundle, refuses
 * an app that is not installed, and passes a release build of either.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const check = path.join(projectRoot, 'scripts/store-capture-build-check.sh');
const flow = fs.readFileSync(path.join(projectRoot, '.maestro/store-capture.yaml'), 'utf8');
const APP = /^appId:\s*(\S+)/m.exec(flow)![1];

const UDID = '00000000-AAAA-BBBB-CCCC-333333333333';

function dumpsys(flags: string): string {
  return [
    'Packages:',
    `  Package [${APP}] (5d1c2e7):`,
    `    versionName=0.4.0`,
    `    flags=[ ${flags} ]`,
    `    pkgFlags=[ ${flags} ]`,
    '',
  ].join('\n');
}

/** Stub `adb` and `xcrun` on PATH, answering from the files given. */
function stubTools(options: { dumpsys?: string; container?: string | null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-capture-check-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(root, 'dumpsys.txt'), options.dumpsys ?? '');
  fs.writeFileSync(
    path.join(bin, 'adb'),
    `#!/bin/sh\n[ "$*" = "shell dumpsys package ${APP}" ] || exit 9\ncat '${root}/dumpsys.txt'\n`,
    { mode: 0o755 }
  );
  const container = options.container;
  fs.writeFileSync(
    path.join(bin, 'xcrun'),
    container == null
      ? `#!/bin/sh\necho "No such file or directory" >&2\nexit 2\n`
      : `#!/bin/sh\n[ "$*" = "simctl get_app_container ${UDID} ${APP} app" ] || exit 9\necho '${container}'\n`,
    { mode: 0o755 }
  );
  // The capture scripts call the check under the lock they already hold.
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    VELOQ_DEVICE_LOCK_HELD: '1',
    VELOQ_SIM_LOCK_HELD: UDID,
  };
  return { root, env };
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  return spawnSync(check, args, { encoding: 'utf8', env });
}

/** A simulator `.app` directory, with or without its embedded bundle. */
function simulatorApp(root: string, bundled: boolean): string {
  const app = path.join(root, 'VeloqDev.app');
  fs.mkdirSync(app);
  if (bundled) fs.writeFileSync(path.join(app, 'main.jsbundle'), '// bundle');
  return app;
}

describe('the store capture build check', () => {
  it('reads the app the capture flow launches', () => {
    expect(APP).toMatch(/^com\.veloq\.app/);
  });

  it('refuses a debuggable Android package', () => {
    const { env } = stubTools({
      dumpsys: dumpsys('DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP'),
    });
    const result = run(['android'], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('debuggable');
  });

  it('passes a release Android package', () => {
    const { env } = stubTools({ dumpsys: dumpsys('HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP') });
    const result = run(['android'], env);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('refuses an Android app that is not installed', () => {
    const { env } = stubTools({ dumpsys: 'Unable to find package: ' + APP + '\n' });
    const result = run(['android'], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not installed');
  });

  it('refuses a simulator app with no embedded bundle', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-capture-app-'));
    const { env } = stubTools({ container: simulatorApp(root, false) });
    const result = run(['ios', UDID], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('main.jsbundle');
  });

  it('passes a simulator app with its bundle embedded', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-capture-app-'));
    const { env } = stubTools({ container: simulatorApp(root, true) });
    const result = run(['ios', UDID], env);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('refuses a simulator without the app installed', () => {
    const { env } = stubTools({ container: null });
    const result = run(['ios', UDID], env);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('not installed');
  });
});
