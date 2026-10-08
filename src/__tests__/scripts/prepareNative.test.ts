/**
 * Scenario: the generated native projects are untracked, so the identity one
 * builds is whatever was selected when it was last generated, and a build
 * compiles that tree as it stands.
 *
 * Expected behaviour: a project that builds the other identity, or none, is
 * regenerated from clean before the build and keeps its release signing files;
 * so is one generated from other native configuration (app config, plugins,
 * the plugin packages and the sources they copy), or with no record of what it
 * was generated from. A project generated from the current configuration for
 * the selected identity is left alone. An APP_VARIANT that names no identity is
 * refused before anything is generated.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = path.join(__dirname, '../../..');

let tree: string;

// One application target whose single configuration carries the identifier.
const PBX = [
  '\\t\\tT1 = {',
  '\\t\\t\\tisa = PBXNativeTarget;',
  '\\t\\t\\tbuildConfigurationList = L1;',
  '\\t\\t\\tproductType = "com.apple.product-type.application";',
  '\\t\\t};',
  '\\t\\tL1 = {',
  '\\t\\t\\tisa = XCConfigurationList;',
  '\\t\\t\\tbuildConfigurations = (C1,);',
  '\\t\\t};',
  '\\t\\tC1 = {',
  '\\t\\t\\tisa = XCBuildConfiguration;',
  '\\t\\t\\tPRODUCT_BUNDLE_IDENTIFIER = %s;',
  '\\t\\t};',
  '',
].join('\\n');

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
      'case "$APP_VARIANT" in production) id=com.veloq.app ;; *) id=com.veloq.app.dev ;; esac\n' +
      'rm -rf "$4"\n' +
      'if [ "$4" = ios ]; then\n' +
      '  mkdir -p ios/Orchard.xcodeproj\n' +
      `  printf '${PBX}' "$id" > ios/Orchard.xcodeproj/project.pbxproj\n` +
      'else\n' +
      '  mkdir -p "$4/app" && echo "applicationId \'$id\'" > "$4/app/build.gradle"\n' +
      'fi\n',
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

const devGradle = "applicationId 'com.veloq.app.dev'\n";
const SIGNING = {
  'android/keystore.properties': 'storeFile=release.keystore\n',
  'android/app/release.keystore': 'orchard-key',
};

function signing() {
  for (const [file, contents] of Object.entries(SIGNING)) write(file, contents);
}

const kept = () => Object.fromEntries(Object.keys(SIGNING).map((file) => [file, read(file)]));

/** Generate a project for the selected identity, then forget the call. */
function generated(platform = 'android', variant?: string) {
  const { result } = prepare(platform, variant);
  expect(result.status).toBe(0);
  fs.rmSync(path.join(tree, 'calls'));
}

const GENERATE_ANDROID = 'npx expo prebuild --platform android --clean --no-install CI=1';

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

  it('leaves a project generated from the current configuration for the selected identity alone', () => {
    write('app.json', '{"expo":{"plugins":["./src/plugins/with-orchard"]}}\n');
    write('src/plugins/with-orchard.js', 'module.exports = (config) => config;\n');
    generated();
    signing();
    const gradle = read('android/app/build.gradle');
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([]);
    expect(result.stderr).toBe('');
    expect(read('android/app/build.gradle')).toBe(gradle);
  });

  it('regenerates a project of the selected identity when a config plugin changed since', () => {
    write('src/plugins/with-orchard.js', 'module.exports = (config) => config;\n');
    generated();
    signing();
    write(
      'src/plugins/with-orchard.js',
      'module.exports = (config) => ({ ...config, signed: 1 });\n'
    );
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([GENERATE_ANDROID]);
    expect(result.stderr).toContain('native configuration changed since it was generated');
    expect(kept()).toEqual(SIGNING);
  });

  it.each([
    ['the app config', 'app.json', '{"expo":{"name":"Orchard","version":"2.0.0"}}\n'],
    ['the identity module', 'scripts/lib/app-identity.js', null],
    ['a plugin package version', 'node_modules/expo-orchard/package.json', '{"version":"2.0.0"}\n'],
    ['an asset the config names', 'src/assets/orchard.png', 'larger'],
  ])('regenerates when %s changed since', (_what, file, contents) => {
    write(
      'app.json',
      '{"expo":{"name":"Orchard","icon":"./src/assets/orchard.png","plugins":[["expo-orchard",{}]]}}\n'
    );
    write('node_modules/expo-orchard/package.json', '{"version":"1.0.0"}\n');
    write('src/assets/orchard.png', 'small');
    generated();
    write(file, contents ?? `${read(file)}// edited\n`);
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([GENERATE_ANDROID]);
  });

  it('regenerates iOS when a source its extensions copy changed, and Android not', () => {
    write('push/ios/Orchard/Service.swift', 'let a = 1\n');
    generated('ios');
    generated('android');
    write('push/ios/Orchard/Service.swift', 'let a = 2\n');
    expect(prepare('android').calls).toEqual([]);
    expect(prepare('ios').calls).toEqual(['npx expo prebuild --platform ios --clean CI=1']);
  });

  it('regenerates a project of the selected identity with no record of what generated it, once', () => {
    write('android/app/build.gradle', devGradle);
    signing();
    const first = prepare('android');
    expect(first.result.status).toBe(0);
    expect(first.calls).toEqual([GENERATE_ANDROID]);
    expect(first.result.stderr).toContain('no record of the configuration it was generated from');
    expect(kept()).toEqual(SIGNING);
    fs.rmSync(path.join(tree, 'calls'));
    expect(prepare('android').calls).toEqual([]);
  });

  it('keeps no record of a generation that failed, so the next build generates again', () => {
    generated();
    write('src/plugins/with-orchard.js', 'module.exports = (config) => config;\n');
    expect(prepare('android', undefined, { TEST_FAIL_GENERATE: '1' }).result.status).toBe(9);
    write('android/app/build.gradle', devGradle);
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([GENERATE_ANDROID, GENERATE_ANDROID]);
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
    generated();
    for (const [file, contents] of Object.entries(SIGNING)) write(`.native-keep/${file}`, contents);
    const { result, calls } = prepare('android');
    expect(result.status).toBe(0);
    expect(calls).toEqual([]);
    expect(kept()).toEqual(SIGNING);
    expect(fs.existsSync(path.join(tree, '.native-keep'))).toBe(false);
  });

  it('never overwrites a signing file with an older one left aside', () => {
    generated();
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
