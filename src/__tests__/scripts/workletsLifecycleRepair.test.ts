import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const { patchSource, applyPatch } = require('../../../scripts/patch-worklets-lifecycle');

const source = `public class WorkletsModule {
  private final AtomicBoolean mInvalidated = new AtomicBoolean(false);

  public void invalidate() {
    if (mInvalidated.getAndSet(true)) {
      return;
    }
    mAndroidUIScheduler.deactivate();
  }
}`;

const paths = [
  'android/src/networking/com/swmansion/worklets/WorkletsModule.java',
  'android/src/no-networking/com/swmansion/worklets/WorkletsModule.java',
];
const expected = Object.fromEntries(
  paths.map((path) => [path, createHash('sha256').update(source).digest('hex')])
);

function fixture(version = '0.8.3'): string {
  const root = mkdtempSync(join(tmpdir(), 'worklets-repair-'));
  const entry = join(root, 'node_modules/react-native-worklets');
  mkdirSync(entry, { recursive: true });
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ version }));
  for (const path of paths) {
    const target = join(entry, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, source);
  }
  return root;
}

it('registers once on repeated initialise and removes once on repeated invalidate', () => {
  const patched = patchSource(source, expected[paths[0]]);
  expect(patched).toContain('mLifecycleRegistered.compareAndSet(false, true)');
  expect(patched).toContain('addLifecycleEventListener(this)');
  expect(patched).toContain('mLifecycleRegistered.compareAndSet(true, false)');
  expect(patched).toContain('removeLifecycleEventListener(this)');
  expect(patchSource(patched, expected[paths[0]])).toBe(patched);
});

it('repairs both source sets and a second install changes neither', () => {
  const root = fixture();
  try {
    applyPatch(root, false, expected);
    const first = paths.map((path) =>
      readFileSync(join(root, 'node_modules/react-native-worklets', path), 'utf8')
    );
    expect(first[0]).toContain('addLifecycleEventListener(this)');
    expect(first[1]).toContain('addLifecycleEventListener(this)');
    applyPatch(root, false, expected);
    expect(
      paths.map((path) =>
        readFileSync(join(root, 'node_modules/react-native-worklets', path), 'utf8')
      )
    ).toEqual(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses an unexpected version or changed source', () => {
  const old = fixture('0.10.4');
  const changed = fixture();
  try {
    expect(() => applyPatch(old, false, expected)).toThrow('0.8.3');
    writeFileSync(
      join(changed, 'node_modules/react-native-worklets', paths[1]),
      source.replace('public void invalidate()', 'public void dispose()')
    );
    expect(() => applyPatch(changed, false, expected)).toThrow('source changed');
    expect(
      readFileSync(join(changed, 'node_modules/react-native-worklets', paths[0]), 'utf8')
    ).toBe(source);
  } finally {
    rmSync(old, { recursive: true, force: true });
    rmSync(changed, { recursive: true, force: true });
  }
});

it('refuses source drift that preserves the insertion points', () => {
  const changed = fixture();
  try {
    const target = join(changed, 'node_modules/react-native-worklets', paths[1]);
    writeFileSync(
      target,
      source.replace('public class WorkletsModule', 'public class ChangedWorkletsModule')
    );
    expect(() => applyPatch(changed, false, expected)).toThrow('source changed');
    expect(
      readFileSync(join(changed, 'node_modules/react-native-worklets', paths[0]), 'utf8')
    ).toBe(source);
  } finally {
    rmSync(changed, { recursive: true, force: true });
  }
});
