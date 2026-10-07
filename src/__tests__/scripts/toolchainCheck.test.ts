/**
 * Scenario: a fresh clone with Node only runs a native build. The tracematch
 * directory is empty and Rust, cargo-ndk and a JDK are absent.
 *
 * Expected behaviour: the check refuses before the build with one line per
 * missing prerequisite, names the SSH remote when the submodule cannot be
 * fetched, and does nothing in CI.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const script = path.join(__dirname, '../../../scripts/check-toolchain.mjs');
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function freshClone(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolchain-'));
  dirs.push(root);
  spawnSync('git', ['init', '-q'], { cwd: root, env: gitFreeEnv() });
  fs.mkdirSync(path.join(root, 'modules/veloqrs/rust/tracematch'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.gitmodules'),
    '[submodule "modules/veloqrs/rust/tracematch"]\n\tpath = modules/veloqrs/rust/tracematch\n\turl = git@example.invalid:team/tracematch.git\n'
  );
  return root;
}

function check(root: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [script, '--root', root], {
    encoding: 'utf8',
    env: { ...gitFreeEnv(), PATH: path.join(root, 'bin'), HOME: root, ...env },
  });
}

describe('check-toolchain', () => {
  it('names each missing prerequisite on its own line', () => {
    const result = check(freshClone(), {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tracematch is empty');
    expect(result.stderr).toContain('git@example.invalid:team/tracematch.git');
    expect(result.stderr).toContain('cargo not found');
    expect(result.stderr).toContain('JAVA_HOME is not set');
  });

  it('passes the toolchain lines when only the submodule is missing', () => {
    const result = check(freshClone(), { JAVA_HOME: '/jdk' });
    expect(result.stderr).not.toContain('JAVA_HOME');
  });

  it('does nothing in CI', () => {
    const result = check(freshClone(), { CI: 'true' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
