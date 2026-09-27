/**
 * Scenario: git runs `pre-merge-commit` only for a merge that commits by
 * itself. A conflicted merge is concluded with `git commit`, which runs
 * `pre-commit` alone, so a resolved conflict on `schema.rs` landed with no
 * merged-tree lint count and none of the suites the merge touched.
 *
 * Expected behaviour: `pre-commit` concluding a merge runs the merge battery,
 * and an ordinary commit does not.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const HOOK = join(__dirname, '../../../.husky/pre-commit');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, contents: string, executable = false): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
  if (executable) chmodSync(full, 0o755);
}

/**
 * A repository whose hook is the real `pre-commit`, with every script it calls
 * stubbed. Each stub records its name, so the test reads what the hook ran
 * rather than paying for the real battery.
 */
function repoWithRealHook(): { root: string; ran: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), 'merge-commit-gates-'));
  roots.push(root);
  const ran = join(root, '.ran');
  const record = (name: string) => `#!/bin/sh\necho ${name} >> "${ran}"\n`;
  for (const name of [
    'check-commit-index.sh',
    'check-commit-lock.sh',
    'check-no-private-data.sh',
    'format-staged.sh',
    'merge-gates.sh',
    'run-gates.sh',
  ]) {
    write(root, `scripts/${name}`, record(name), true);
  }
  write(root, 'scripts/check-staged-tree.sh', '#!/bin/sh\n[ "$1" = verify ] || echo tree\n', true);
  const bin = join(root, '.bin');
  write(root, 'shared.txt', 'base\n');
  write(root, '.gitignore', '.ran\n.bin/\n.hooks/\n');
  mkdirSync(join(root, '.hooks'));
  copyFileSync(HOOK, join(root, '.hooks/pre-commit'));
  chmodSync(join(root, '.hooks/pre-commit'), 0o755);

  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-qm', 'base'], root);
  runGit(['config', 'core.hooksPath', '.hooks'], root);
  return { root, ran, bin };
}

function commit(
  root: string,
  bin: string,
  message: string[] = ['--no-edit']
): { status: number; output: string } {
  const result = spawnSync('git', ['commit', '-q', ...message], {
    cwd: root,
    env: { ...gitFreeEnv(), PATH: `${bin}:${process.env.PATH ?? ''}` },
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

function hookRan(ran: string): string[] {
  if (!existsSync(ran)) return [];
  return readFileSync(ran, 'utf8').trim().split('\n');
}

describe('concluding a conflicted merge with git commit', () => {
  it('runs the merge battery, after the lock check and before the parallel gates', () => {
    const { root, ran, bin } = repoWithRealHook();
    runGit(['checkout', '-q', '-b', 'audit/side'], root);
    write(root, 'shared.txt', 'side\n');
    runGit(['commit', '-qam', 'side', '--no-verify'], root);
    runGit(['checkout', '-q', 'main'], root);
    write(root, 'shared.txt', 'main\n');
    runGit(['commit', '-qam', 'main', '--no-verify'], root);
    const merge = spawnSync('git', ['merge', 'audit/side'], { cwd: root, env: gitFreeEnv() });
    expect(merge.status).not.toBe(0);
    write(root, 'shared.txt', 'resolved\n');
    runGit(['add', 'shared.txt'], root);
    rmSync(ran, { force: true });

    const { status, output } = commit(root, bin);

    expect({ status, output }).toEqual({ status: 0, output: '' });
    const order = hookRan(ran);
    expect(order).toContain('merge-gates.sh');
    expect(order.indexOf('merge-gates.sh')).toBeGreaterThan(order.indexOf('check-commit-lock.sh'));
    expect(order.indexOf('merge-gates.sh')).toBeLessThan(order.indexOf('run-gates.sh'));
    expect(runGit(['log', '-1', '--format=%P'], root).trim().split(' ')).toHaveLength(2);
  });

  it('leaves an ordinary commit on the pre-commit battery alone', () => {
    const { root, ran, bin } = repoWithRealHook();
    write(root, 'shared.txt', 'edited\n');
    runGit(['add', 'shared.txt'], root);

    const { status, output } = commit(root, bin, ['-m', 'edited']);

    expect({ status, output }).toEqual({ status: 0, output: '' });
    expect(hookRan(ran)).toContain('run-gates.sh');
    expect(hookRan(ran)).not.toContain('merge-gates.sh');
  });
});
