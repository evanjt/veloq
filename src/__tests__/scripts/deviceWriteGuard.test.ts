/**
 * Scenario: six rounds of the account wipe each closed what the last audit
 * found beside the library, and each next audit found a write nobody had
 * listed: a temporary file beside the record zip, the widget's snapshot. The
 * wipe test holds the inventory, and this guard is what makes a new write
 * reach it.
 *
 * Expected behaviour: the guard counts write sites per file across the
 * TypeScript, the engine and the native code, and fails naming a file whose
 * count moved or that the list never named. Comments, tests, the config
 * plugins and Rust test modules write nothing on a device and are not counted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-device-writes.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-device-writes-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string, listed: Record<string, number>) {
  const listFile = path.join(root, 'sites.json');
  fs.writeFileSync(listFile, JSON.stringify(listed));
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root, '--baseline', listFile], {
      encoding: 'utf8',
      env: gitFreeEnv(),
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const TS_STORE = `
import AsyncStorage from '@react-native-async-storage/async-storage';
export const save = (v: string) => AsyncStorage.setItem('k', v);
`;

const RUST_WRITER = `
pub fn write(path: &str) {
    std::fs::write(path, b"x").unwrap();
}

#[cfg(test)]
pub(crate) mod fixtures {
    pub fn seed() { let _ = tempfile::tempdir(); }
}

pub fn temp() { let _ = tempfile::Builder::new(); }

#[cfg(test)]
mod tests {
    #[test]
    fn t() { std::fs::write("x", "{}").unwrap(); }
}
`;

describe('the device write guard', () => {
  it('passes a tree whose every write site is listed', () => {
    const root = treeWith({ 'src/shared/a.ts': TS_STORE });

    expect(runGuard(root, { 'src/shared/a.ts': 1 }).status).toBe(0);
  });

  it('refuses a new file that writes, and names it', () => {
    const root = treeWith({ 'src/shared/a.ts': TS_STORE, 'src/features/b/store.ts': TS_STORE });
    const run = runGuard(root, { 'src/shared/a.ts': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/b/store.ts');
  });

  it('refuses a listed file that gained a write', () => {
    const root = treeWith({
      'src/shared/a.ts': `${TS_STORE}\nexport const d = FileSystem.documentDirectory;\n`,
    });
    const run = runGuard(root, { 'src/shared/a.ts': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/shared/a.ts  2, listed 1');
  });

  it('refuses a listed file that no longer writes', () => {
    const root = treeWith({ 'src/shared/a.ts': 'export const nothing = 1;\n' });

    expect(runGuard(root, { 'src/shared/a.ts': 1 }).status).toBe(1);
  });

  it('counts the engine, Android and iOS writes', () => {
    const root = treeWith({
      'modules/veloqrs/rust/veloqrs/src/store.rs': RUST_WRITER,
      'modules/veloq-x/android/src/main/java/X.kt': 'val f = File(context.filesDir, "s.json")\n',
      'widget/ios/W/Model.swift':
        'let u = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: g)\n',
    });

    expect(
      runGuard(root, {
        'modules/veloqrs/rust/veloqrs/src/store.rs': 2,
        'modules/veloq-x/android/src/main/java/X.kt': 1,
        'widget/ios/W/Model.swift': 1,
      }).status
    ).toBe(0);
  });

  it('counts only what a checkout tracks, not a generated file git ignores', () => {
    const root = treeWith({
      '.gitignore': 'android/app/src/main/java/com/veloq/app/dev/\n',
      'src/shared/a.ts': TS_STORE,
      'android/app/src/main/java/com/veloq/app/dev/widget/Snapshot.kt':
        'val f = File(context.filesDir, "widget.json")\n',
    });
    initFixtureRepo(root);

    const run = runGuard(root, { 'src/shared/a.ts': 1 });

    expect(run.output).not.toContain('Snapshot.kt');
    expect(run.status).toBe(0);
  });

  it('counts no comment, test, config plugin or Rust test module', () => {
    const root = treeWith({
      'src/shared/a.ts':
        '// AsyncStorage.setItem(k, v) is how this used to work\nexport const x = 1;\n',
      'src/__tests__/a.test.ts': TS_STORE,
      'src/plugins/with-thing.js': 'AsyncStorage.setItem("k", "v");\n',
      'src/plugins/with-thing.ts': TS_STORE,
      'modules/veloqrs/rust/veloqrs/src/only_tests.rs':
        '#[cfg(test)]\nmod tests {\n    fn t() { let _ = tempfile::tempdir(); }\n}\n',
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
