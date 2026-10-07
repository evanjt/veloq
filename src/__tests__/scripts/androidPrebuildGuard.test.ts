/**
 * Scenario: a release bumps the version in app.json and the Android build file
 * together. Expected behaviour: the prebuild guard follows app.json, so a bump
 * passes, while a build file that disagrees with app.json (including the
 * versionCode 1 and versionName "1.0" prebuild writes) is refused.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/check-android-prebuild.mjs');

const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function fixture(
  app: { version: string; versionCode: number },
  gradle: { code: string; name: string }
) {
  const dir = mkdtempSync(join(tmpdir(), 'prebuild-guard-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'android/app'), { recursive: true });
  writeFileSync(
    join(dir, 'app.json'),
    JSON.stringify({ expo: { version: app.version, android: { versionCode: app.versionCode } } })
  );
  const realGradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8')
    .replace(/versionCode\s+\d+/, `versionCode ${gradle.code}`)
    .replace(/versionName\s+["'][^"']*["']/, `versionName "${gradle.name}"`);
  writeFileSync(join(dir, 'android/app/build.gradle'), realGradle);
  writeFileSync(
    join(dir, 'android/build.gradle'),
    readFileSync(join(ROOT, 'android/build.gradle'), 'utf8')
  );
  return dir;
}

function run(dir: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('check-android-prebuild version match', () => {
  it('passes when the build file carries a bumped version that app.json carries', () => {
    expect(
      run(fixture({ version: '0.4.1', versionCode: 30 }, { code: '30', name: '0.4.1' })).status
    ).toBe(0);
  });

  it('refuses a build file that lags app.json', () => {
    const result = run(
      fixture({ version: '0.4.1', versionCode: 30 }, { code: '29', name: '0.4.0' })
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('missing versionCode');
    expect(result.output).toContain('missing versionName');
  });

  it('refuses the prebuild defaults', () => {
    const result = run(fixture({ version: '0.4.0', versionCode: 29 }, { code: '1', name: '1.0' }));
    expect(result.status).toBe(1);
  });
});
