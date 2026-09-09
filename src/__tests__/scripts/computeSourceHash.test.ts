import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { computeSourceHash } = require('../../../scripts/compute-source-hash');

let root: string;
const inputs = [
  'src/app.ts',
  'widget/ios/shared/RecordDeepLink.swift',
  'widget/android/view.xml',
  'app.config.js',
  'package-lock.json',
  'assets/icon.png',
  'patches/library.patch',
  'modules/engine/Cargo.lock',
  'scripts/build.sh',
  '.github/workflows/build.yml',
  'src/__tests__/unit.test.ts',
];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-source-hash-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  for (const file of inputs) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'original');
  }
  execFileSync('git', ['add', '.'], { cwd: root });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it.each(['android', 'ios'])(
  'invalidates %s apps when any shared build input changes',
  (profile) => {
    const initial = computeSourceHash(root, profile);
    for (const file of inputs.filter(
      (file) => !file.startsWith('widget/') && !file.includes('__tests__')
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

it('ignores generated files and unit tests, but detects tracked additions and removals', () => {
  const initial = computeSourceHash(root);
  fs.mkdirSync(path.join(root, 'ios/build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ios/build/generated'), 'generated');
  fs.writeFileSync(path.join(root, 'src/__tests__/unit.test.ts'), 'changed');
  expect(computeSourceHash(root)).toBe(initial);
  fs.writeFileSync(path.join(root, 'src/new.ts'), 'new');
  execFileSync('git', ['add', 'src/new.ts'], { cwd: root });
  expect(computeSourceHash(root)).not.toBe(initial);
  execFileSync('git', ['rm', '--cached', 'src/new.ts'], { cwd: root });
  expect(computeSourceHash(root)).toBe(initial);
  execFileSync('git', ['rm', '--cached', 'src/app.ts'], { cwd: root });
  expect(computeSourceHash(root)).not.toBe(initial);
});

it('invalidates when the pinned submodule commit changes', () => {
  const initial = computeSourceHash(root);
  for (const digit of ['1', '2']) {
    execFileSync(
      'git',
      ['update-index', '--add', '--cacheinfo', `160000,${digit.repeat(40)},modules/submodule`],
      { cwd: root }
    );
    expect(computeSourceHash(root)).not.toBe(initial);
  }
  const pinned = computeSourceHash(root);
  execFileSync(
    'git',
    ['update-index', '--cacheinfo', `160000,${'3'.repeat(40)},modules/submodule`],
    { cwd: root }
  );
  expect(computeSourceHash(root)).not.toBe(pinned);
});
