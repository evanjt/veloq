import fs from 'fs';
import os from 'os';
import path from 'path';
import { runGit } from '../__shared__/gitFixture';

const { computeSourceHash, isBuildInput } = require('../../../scripts/compute-source-hash');

let root: string;
const inputs = [
  'src/app.ts',
  'widget/ios/shared/RecordDeepLink.swift',
  'widget/android/view.xml',
  'push/ios/Extension/NotificationService.swift',
  'app.config.js',
  'package-lock.json',
  'assets/icon.png',
  'patches/library.patch',
  'modules/engine/Cargo.lock',
  'scripts/build.sh',
  '.github/workflows/build.yml',
  '.github/workflows/build-android.yml',
  '.github/workflows/e2e-gate.yml',
  'modules/veloqrs/scripts/build-rust.js',
  'src/__tests__/unit.test.ts',
];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-source-hash-'));
  runGit(['init', '--quiet'], root);
  for (const file of inputs) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'original');
  }
  runGit(['add', '.'], root);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it.each(['android', 'ios'])(
  'invalidates %s apps when any shared build input changes',
  (profile) => {
    const initial = computeSourceHash(root, profile);
    for (const file of inputs.filter(
      (file) =>
        !file.startsWith('widget/') && !file.startsWith('push/') && !file.includes('__tests__')
    )) {
      fs.writeFileSync(path.join(root, file), 'changed');
      expect(computeSourceHash(root, profile)).not.toBe(initial);
      fs.writeFileSync(path.join(root, file), 'original');
      expect(computeSourceHash(root, profile)).toBe(initial);
    }
  }
);

it.each(['android', 'ios'])(
  'invalidates %s widgets without invalidating the other platform',
  (profile) => {
    const other = profile === 'ios' ? 'android' : 'ios';
    const initial = computeSourceHash(root, profile);
    const otherInitial = computeSourceHash(root, other);
    const file = inputs.find((file) => file.startsWith(`widget/${profile}/`))!;
    fs.writeFileSync(path.join(root, file), 'changed');
    expect(computeSourceHash(root, profile)).not.toBe(initial);
    expect(computeSourceHash(root, other)).toBe(otherInitial);
  }
);

it.each([
  '.github/workflows/test.yml',
  '.github/workflows/codeql.yml',
  'scripts/lint-workflows.mjs',
  'scripts/lint-android-bundle.mjs',
  'scripts/run-guards.mjs',
  'scripts/rgba-baseline.json',
  'scripts/engine-orphan-allowlist.json',
  'scripts/feature-lazy-requires.json',
])('ignores %s, which no native build reads', (file) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), 'original');
  runGit(['add', file], root);
  for (const profile of ['android', 'ios']) {
    const initial = computeSourceHash(root, profile);
    fs.writeFileSync(path.join(root, file), 'changed');
    expect(computeSourceHash(root, profile)).toBe(initial);
    fs.writeFileSync(path.join(root, file), 'original');
  }
});

it.each([
  '.github/workflows/build-ios.yml',
  '.github/workflows/e2e.yml',
  '.github/actions/compute-version-info/action.yml',
  'scripts/build-record.js',
  'scripts/lib/app-identity.js',
  'scripts/new-generator.mjs',
])('invalidates for %s, which is hashed by default', (file) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), 'original');
  runGit(['add', file], root);
  const initial = computeSourceHash(root, 'android');
  fs.writeFileSync(path.join(root, file), 'changed');
  expect(computeSourceHash(root, 'android')).not.toBe(initial);
});

it('invalidates iOS apps, and not Android ones, when the push extension changes', () => {
  expect(isBuildInput('push/ios/Extension/NotificationService.swift', 'ios')).toBe(true);
  expect(isBuildInput('push/ios/Extension/NotificationService.swift', 'all')).toBe(true);
  expect(isBuildInput('push/ios/Extension/NotificationService.swift', 'android')).toBe(false);
  const ios = computeSourceHash(root, 'ios');
  const android = computeSourceHash(root, 'android');
  fs.writeFileSync(path.join(root, 'push/ios/Extension/NotificationService.swift'), 'changed');
  expect(computeSourceHash(root, 'ios')).not.toBe(ios);
  expect(computeSourceHash(root, 'android')).toBe(android);
});

it('invalidates through a tracked link when the file it names changes', () => {
  fs.mkdirSync(path.join(root, 'modules/shared/ios'), { recursive: true });
  fs.symlinkSync(
    '../../../push/ios/Extension/NotificationService.swift',
    path.join(root, 'modules/shared/ios/NotificationService.swift')
  );
  runGit(['add', '.'], root);
  const initial = computeSourceHash(root, 'ios');
  fs.writeFileSync(path.join(root, 'push/ios/Extension/NotificationService.swift'), 'changed');
  expect(computeSourceHash(root, 'ios')).not.toBe(initial);
});

it('ignores generated files and unit tests, but detects tracked additions and removals', () => {
  const initial = computeSourceHash(root);
  fs.mkdirSync(path.join(root, 'ios/build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ios/build/generated'), 'generated');
  fs.writeFileSync(path.join(root, 'src/__tests__/unit.test.ts'), 'changed');
  expect(computeSourceHash(root)).toBe(initial);
  fs.writeFileSync(path.join(root, 'src/new.ts'), 'new');
  runGit(['add', 'src/new.ts'], root);
  expect(computeSourceHash(root)).not.toBe(initial);
  runGit(['rm', '--cached', 'src/new.ts'], root);
  expect(computeSourceHash(root)).toBe(initial);
  runGit(['rm', '--cached', 'src/app.ts'], root);
  expect(computeSourceHash(root)).not.toBe(initial);
});

it('invalidates when the pinned submodule commit changes', () => {
  const initial = computeSourceHash(root);
  for (const digit of ['1', '2']) {
    runGit(
      ['update-index', '--add', '--cacheinfo', `160000,${digit.repeat(40)},modules/submodule`],
      root
    );
    expect(computeSourceHash(root)).not.toBe(initial);
  }
  const pinned = computeSourceHash(root);
  runGit(['update-index', '--cacheinfo', `160000,${'3'.repeat(40)},modules/submodule`], root);
  expect(computeSourceHash(root)).not.toBe(pinned);
});

it('hashes a tracked symlink to a directory by its target', () => {
  fs.mkdirSync(path.join(root, 'assets/fonts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/fonts/glyph.pbf'), 'glyph');
  fs.symlinkSync('../../assets/fonts', path.join(root, 'modules/engine/fonts'));
  runGit(['add', '.'], root);
  const initial = computeSourceHash(root);
  fs.rmSync(path.join(root, 'modules/engine/fonts'));
  fs.symlinkSync('../../assets', path.join(root, 'modules/engine/fonts'));
  expect(computeSourceHash(root)).not.toBe(initial);
});

describe('the local identity of a working tree', () => {
  it('counts untracked source under a build directory and leaves ignored and root files out', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'android/\n');
    runGit(['add', '.gitignore'], root);
    const ci = computeSourceHash(root);
    const initial = computeSourceHash(root, 'android', { local: true });
    expect(initial).toBe(ci);

    fs.writeFileSync(path.join(root, 'notes.txt'), 'scratch');
    fs.mkdirSync(path.join(root, 'android/app/build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'android/app/build/out.apk'), 'built');
    expect(computeSourceHash(root, 'android', { local: true })).toBe(initial);

    fs.writeFileSync(path.join(root, 'src/added.ts'), 'export const added = 1;');
    expect(computeSourceHash(root, 'android', { local: true })).not.toBe(initial);
    expect(computeSourceHash(root)).toBe(ci);
  });

  it('counts a tracked file deleted from the working tree', () => {
    const initial = computeSourceHash(root, 'android', { local: true });
    fs.rmSync(path.join(root, 'src/app.ts'));
    expect(computeSourceHash(root, 'android', { local: true })).not.toBe(initial);
  });

  it('reads a dirty submodule from its working tree and a clean one from its commit', () => {
    const sub = path.join(root, 'modules/engine/core');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'lib.rs'), 'pub fn one() {}');
    runGit(['init', '--quiet'], sub);
    runGit(['add', '.'], sub);
    runGit(['-c', 'user.name=f', '-c', 'user.email=f@f.invalid', 'commit', '-qm', 'one'], sub);
    const head = runGit(['rev-parse', 'HEAD'], sub).trim();
    runGit(['update-index', '--add', '--cacheinfo', `160000,${head},modules/engine/core`], root);

    const clean = computeSourceHash(root, 'android', { local: true });
    expect(clean).toBe(computeSourceHash(root));

    fs.writeFileSync(path.join(sub, 'lib.rs'), 'pub fn two() {}');
    const edited = computeSourceHash(root, 'android', { local: true });
    expect(edited).not.toBe(clean);
    expect(computeSourceHash(root)).toBe(clean);

    fs.writeFileSync(path.join(sub, 'new.rs'), 'pub fn three() {}');
    expect(computeSourceHash(root, 'android', { local: true })).not.toBe(edited);
  });
});
