/**
 * Scenario: the store capture runs the flow once per store language on a test
 * device, in the light theme. A run that leaves the device in the mode it set
 * changes the next session's screens, and captures filed under the wrong
 * language frame one language's screens under another's captions.
 *
 * Expected behaviour: each language's captures land in its own directory,
 * taken with the app set to that language's code; the device's dark mode, and
 * the simulator's appearance, are set to light for the run and put back as
 * they were afterwards, a failed run included.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { STORE_AVD } from '../../../scripts/store-device';

const projectRoot = path.join(__dirname, '../../..');
const capture = path.join(projectRoot, 'scripts/store-capture.sh');
const captureIos = path.join(projectRoot, 'scripts/store-capture-ios.sh');
const APP = (
  require('../../../scripts/lib/app-identity.js') as { IDENTITIES: { dev: { appId: string } } }
).IDENTITIES.dev.appId;
const UDID = '00000000-AAAA-BBBB-CCCC-444444444444';

function stub(file: string, body: string): void {
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

/** Stub adb, xcrun and the Maestro runner, each logging its arguments. */
function tools(options: {
  avd?: string;
  night?: string;
  appearance?: string;
  device?: string;
  fail?: string;
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-capture-run-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'calls.log');
  const app = path.join(root, 'VeloqDev.app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'main.jsbundle'), '// bundle');
  // The app's data container, holding a marker the app left from an earlier pass.
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'Documents'), { recursive: true });
  fs.writeFileSync(path.join(data, 'Documents', 'marker'), '');
  stub(
    path.join(bin, 'adb'),
    [
      `echo "adb $*" >> '${log}'`,
      `case "$*" in`,
      `  "shell dumpsys package ${APP}") printf 'Package [${APP}] (1):\\n    flags=[ HAS_CODE ]\\n' ;;`,
      `  "emu avd name") printf '${options.avd ?? STORE_AVD.name}\\nOK\\n' ;;`,
      `  "shell cmd uimode night") echo "Night mode: ${options.night ?? 'yes'}" ;;`,
      `esac`,
    ].join('\n')
  );
  stub(
    path.join(bin, 'xcrun'),
    [
      `echo "xcrun $*" >> '${log}'`,
      `case "$*" in`,
      `  "simctl list devices") echo "    ${options.device ?? 'iPhone 17 Pro Max'} (${UDID}) (Booted)" ;;`,
      `  "simctl get_app_container ${UDID} ${APP} app") echo '${app}' ;;`,
      `  "simctl get_app_container ${UDID} ${APP} data") echo '${data}' ;;`,
      `  "simctl ui ${UDID} appearance") echo "${options.appearance ?? 'dark'}" ;;`,
      `esac`,
    ].join('\n')
  );
  // The flow writes its shots under the working directory, as Maestro does.
  stub(
    path.join(bin, 'maestro-run'),
    [
      `echo "maestro $*" >> '${log}'`,
      `if [ -e '${data}/Documents/marker' ]; then echo "app data present" >> '${log}'; fi`,
      `touch '${data}/Documents/marker'`,
      `case "$*" in *"STORE_LANGUAGE=${options.fail ?? '-'}"*) exit 1 ;; esac`,
      `mkdir -p screenshots/store-capture`,
      `for s in 01-feed 02-activity; do echo "$*" > "screenshots/store-capture/$s.png"; done`,
    ].join('\n')
  );
  const raw = path.join(root, 'raw');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    VELOQ_DEVICE_LOCK_HELD: '1',
    VELOQ_SIM_LOCK_HELD: UDID,
    VELOQ_STORE_MAESTRO: path.join(bin, 'maestro-run'),
    VELOQ_STORE_RAW: raw,
  };
  const calls = () => fs.readFileSync(log, 'utf8').trim().split('\n');
  return { env, raw, calls };
}

function lastMatching(lines: string[], pattern: RegExp): string | undefined {
  return lines.filter((l) => pattern.test(l)).pop();
}

describe('the Android store capture', () => {
  it('files each language under its own locale, taken in that language', () => {
    const { env, raw, calls } = tools({});
    const run = spawnSync(capture, ['android', 'ja-JP=ja', 'pt-PT=pt'], { env, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    for (const [play, app] of [
      ['ja-JP', 'ja'],
      ['pt-PT', 'pt'],
    ]) {
      const shot = path.join(raw, 'android', play, '01-feed.png');
      expect(fs.readFileSync(shot, 'utf8')).toContain(`STORE_LANGUAGE=${app} `);
    }
    expect(calls().filter((c) => c.startsWith('maestro'))).toHaveLength(2);
  });

  it('clears the app before each pass, the dark theme pass included', () => {
    const { env, calls } = tools({});
    expect(spawnSync(capture, ['android', 'ja-JP=ja', 'pt-PT=pt'], { env }).status).toBe(0);
    const passes = calls()
      .filter((l) => l === `adb shell pm clear ${APP}` || l.startsWith('maestro'))
      .map((l) => (l.startsWith('maestro') ? 'maestro' : 'clear'));
    expect(passes.filter((p) => p === 'maestro').length).toBeGreaterThan(0);
    passes.forEach((p, i) => {
      if (p === 'maestro') expect(passes[i - 1]).toBe('clear');
    });
  });

  it('refuses a physical handset and an emulator that is not the store one', () => {
    for (const avd of ['', 'Pixel_6_API_34']) {
      const { env, raw, calls } = tools({ avd });
      const run = spawnSync(capture, ['android', 'en-US=en-US'], { env, encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('store capture: the device is');
      expect(calls().filter((c) => c.startsWith('maestro'))).toHaveLength(0);
      expect(fs.existsSync(raw)).toBe(false);
    }
  });

  it('turns dark mode off for the run and puts it back afterwards', () => {
    const { env, calls } = tools({ night: 'yes' });
    expect(spawnSync(capture, ['android', 'en-US=en-US'], { env }).status).toBe(0);
    const lines = calls();
    const off = lines.indexOf('adb shell cmd uimode night no');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(lines.findIndex((l) => l.startsWith('maestro')));
    expect(lastMatching(lines, /uimode night /)).toBe('adb shell cmd uimode night yes');
  });

  it('puts dark mode back when a language fails, and files nothing for it', () => {
    const { env, raw, calls } = tools({ night: 'auto', fail: 'de-DE' });
    const run = spawnSync(capture, ['android', 'en-US=en-US', 'de-DE=de-DE'], { env });
    expect(run.status).not.toBe(0);
    expect(lastMatching(calls(), /uimode night /)).toBe('adb shell cmd uimode night auto');
    expect(fs.existsSync(path.join(raw, 'android', 'en-US', '01-feed.png'))).toBe(true);
    expect(fs.existsSync(path.join(raw, 'android', 'de-DE'))).toBe(false);
  });

  it('refuses a locale given without its app language', () => {
    const { env, calls } = tools({ night: 'no' });
    expect(spawnSync(capture, ['android', 'ja-JP'], { env }).status).toBe(2);
    expect(lastMatching(calls(), /uimode night /)).toBe('adb shell cmd uimode night no');
  });
});

describe('the iOS store capture', () => {
  it('captures in the light appearance and puts the simulator appearance back', () => {
    const { env, raw, calls } = tools({ appearance: 'dark' });
    const run = spawnSync(captureIos, [UDID, 'fr-FR=fr'], { env, encoding: 'utf8' });
    expect(run.status).toBe(0);
    const lines = calls();
    const light = lines.indexOf(`xcrun simctl ui ${UDID} appearance light`);
    expect(light).toBeGreaterThan(-1);
    expect(light).toBeLessThan(lines.findIndex((l) => l.startsWith('maestro')));
    expect(lastMatching(lines, /appearance /)).toBe(`xcrun simctl ui ${UDID} appearance dark`);
    expect(fs.existsSync(path.join(raw, 'ios', 'fr-FR', '01-feed.png'))).toBe(true);
  });

  it('empties the app data before each pass, so no pass starts on the last one', () => {
    const { env, calls } = tools({});
    expect(spawnSync(captureIos, [UDID, 'fr-FR=fr', 'de-DE=de'], { env }).status).toBe(0);
    expect(calls()).not.toContain('app data present');
    expect(calls().filter((l) => l.startsWith('maestro'))).toHaveLength(2);
  });

  it('files an iPad simulator captures apart from the iPhone ones', () => {
    const { env, raw } = tools({ device: 'iPad Pro 13-inch (M4)' });
    expect(spawnSync(captureIos, [UDID, 'en-US=en-US'], { env }).status).toBe(0);
    expect(fs.existsSync(path.join(raw, 'ipad', 'en-US', '01-feed.png'))).toBe(true);
    expect(fs.existsSync(path.join(raw, 'ios'))).toBe(false);
  });
});
