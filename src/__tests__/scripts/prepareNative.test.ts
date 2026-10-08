/**
 * Scenario: the generated native projects are untracked, so the identity one
 * builds is whatever was selected when it was last generated, and a build
 * compiles that tree as it stands.
 *
 * Expected behaviour: a project that builds the other identity, or none, is
 * regenerated from clean before the build and keeps its release signing files;
 * a project that already builds the selected identity is left alone; an
 * APP_VARIANT that names no identity is refused before anything is generated.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');

let tree: string;

beforeEach(() => {
  tree = fs.mkdtempSync(path.join(os.tmpdir(), 'prepare-native-'));
  fs.mkdirSync(path.join(tree, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(tree, 'bin'));
  for (const name of ['prepare-native.mjs', 'lib/app-identity.js']) {
    fs.copyFileSync(path.join(root, 'scripts', name), path.join(tree, 'scripts', name));
  }
  // The generator stub replaces the platform directory with an empty project
  // for the selected identity, or fails when asked to.
  fs.writeFileSync(
    path.join(tree, 'bin/npx'),
    '#!/bin/sh\n' +
      'echo "npx $* CI=$CI" >> calls\n' +
      '[ "${TEST_FAIL_GENERATE:-}" = 1 ] && { rm -rf "$4"; exit 9; }\n' +
      'case "$APP_VARIANT" in production) id=com.orchard.app ;; *) id=com.orchard.app.dev ;; esac\n' +
      'rm -rf "$4" && mkdir -p "$4/app"\n' +
      'echo "applicationId \'$id\'" > "$4/app/build.gradle"\n',
    { mode: 0o755 }
  );
});

afterEach(() => {
  fs.rmSync(tree, { recursive: true, force: true });
});

function write(file: string, contents: string) {
  fs.mkdirSync(path.dirname(path.join(tree, file)), { recursive: true });
  fs.writeFileSync(path.join(tree, file), contents);
}

const read = (file: string) =>
  fs.existsSync(path.join(tree, file)) ? fs.readFileSync(path.join(tree, file), 'utf8') : null;

function prepare(platform: string, variant?: string, extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.join(tree, 'bin')}:${process.env.PATH}`,
    ...extra,
  };
  delete env.APP_VARIANT;
  delete env.CI;
  if (variant !== undefined) env.APP_VARIANT = variant;
  const result = spawnSync(
    process.execPath,
    ['scripts/prepare-native.mjs', '--platform', platform],
    { cwd: tree, encoding: 'utf8', env }
  );
  const calls = read('calls')?.trim().split('\n') ?? [];
  return { result, calls };
}

// The identity module names the real packages, so the stub's are not the ones checked.
const devGradle = "applicationId 'com.veloq.app.dev'\n";
const SIGNING = {
  'android/keystore.properties': 'storeFile=release.keystore\n',
  'android/app/release.keystore': 'orchard-key',
};

function signing() {
  for (const [file, contents] of Object.entries(SIGNING)) write(file, contents);
}

const kept = () => Object.fromEntries(Object.keys(SIGNING).map((file) => [file, read(file)]));

describe('prepare-native', () => {
  it('regenerates a Dev Android project for a production build and keeps the signing files', () => {
    write('android/app/build.gradle', devGradle);
    signing();
    const { result, calls } = prepare('android', 'production');
    expect(result.status).toBe(0);
    expect(calls).toEqual(['npx expo prebuild --platform android --clean --no-install CI=1']);
    expect(result.stderr).toContain('builds com.veloq.app.dev, regenerating it for Veloq');
    expect(kept()).toEqual(SIGNING);
    expect(fs.existsSync(path.join(tree, '.native-keep'))).toBe(false);
  });

  it('leaves a project that already builds the selected identity alone', () => {
    write('android/app/build.gradle', devGradle);
    signing();
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([]);
    expect(result.stderr).toBe('');
    expect(read('android/app/build.gradle')).toBe(devGradle);
  });

  it('generates a missing Android project', () => {
    const { result, calls } = prepare('android', 'dev');
    expect(result.status).toBe(0);
    expect(calls).toEqual(['npx expo prebuild --platform android --clean --no-install CI=1']);
    expect(result.stderr).toContain('no android/ project');
  });

  it.each(['prod', 'release'])('refuses APP_VARIANT=%s before generating anything', (variant) => {
    write('android/app/build.gradle', devGradle);
    const { result, calls } = prepare('android', variant);
    expect(result.status).toBe(2);
    expect(calls).toEqual([]);
    expect(result.stderr).toContain(`APP_VARIANT=${variant} names no identity`);
    expect(read('android/app/build.gradle')).toBe(devGradle);
  });

  it('refuses an unknown platform', () => {
    const { result, calls } = prepare('windows');
    expect(result.status).toBe(2);
    expect(calls).toEqual([]);
  });

  it('generates iOS with its Pods installed', () => {
    const { result, calls } = prepare('ios', 'production');
    expect(result.status).toBe(0);
    expect(calls).toEqual(['npx expo prebuild --platform ios --clean CI=1']);
  });

  it('puts the signing files back and fails when generation fails', () => {
    write('android/app/build.gradle', devGradle);
    signing();
    const { result } = prepare('android', 'production', { TEST_FAIL_GENERATE: '1' });
    expect(result.status).toBe(9);
    expect(kept()).toEqual(SIGNING);
  });

  it('restores signing files a killed run left aside, before comparing', () => {
    write('android/app/build.gradle', devGradle);
    for (const [file, contents] of Object.entries(SIGNING)) write(`.native-keep/${file}`, contents);
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([]);
    expect(kept()).toEqual(SIGNING);
    expect(fs.existsSync(path.join(tree, '.native-keep'))).toBe(false);
  });

  it('never overwrites a signing file with an older one left aside', () => {
    write('android/app/build.gradle', devGradle);
    signing();
    write('.native-keep/android/keystore.properties', 'storeFile=stale.keystore\n');
    const { result } = prepare('android');
    expect(result.status).toBe(0);
    expect(read('android/keystore.properties')).toBe(SIGNING['android/keystore.properties']);
    expect(read('.native-keep/android/keystore.properties')).toBe('storeFile=stale.keystore\n');
  });

  it('refuses a regeneration while an earlier run left a conflicting file aside', () => {
    write('android/app/build.gradle', devGradle);
    signing();
    write('.native-keep/android/keystore.properties', 'storeFile=stale.keystore\n');
    const { result, calls } = prepare('android', 'production');
    expect(result.status).toBe(2);
    expect(calls).toEqual([]);
    expect(result.stderr).toContain('.native-keep/ still holds signing files');
    expect(kept()).toEqual(SIGNING);
    expect(read('.native-keep/android/keystore.properties')).toBe('storeFile=stale.keystore\n');
  });
});
