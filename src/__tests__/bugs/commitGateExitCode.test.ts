/**
 * Scenario: `.husky/pre-commit` runs its gates as background subshells that
 * write an exit code each, then reads those codes. The hook runs under
 * `set -e` and a subshell inherits it, so a gate that FAILED died on the
 * failing command and never reached the line recording that it failed. Every
 * exit code the hook found was therefore a zero, and it passed a commit
 * carrying three `tsc` errors and, separately, a new banned import.
 *
 * Expected behaviour: a gate's exit code is recorded whatever the gate does,
 * a failing gate fails the commit and prints its output, and a gate that
 * reports no exit code at all is a failure rather than a silent pass.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGit, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/run-gates.sh');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Run the gate runner with `gates`, as the hook does. */
function runGates(gates: string[], shellFlags: string[] = []): { status: number; output: string } {
  // The hook calls this from a `set -e` shell, which is the condition the bug
  // needed, so the tests drive it the same way.
  const argv = [...shellFlags, SCRIPT, ...gates];
  try {
    const output = execFileSync('sh', argv, {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('the commit gate runner', () => {
  it('passes when every gate passes', () => {
    const { status } = runGates(['first:true', 'second:true']);

    expect(status).toBe(0);
  });

  it('fails when a gate fails, under the errexit the hook sets', () => {
    const { status, output } = runGates(['ok:true', 'bad:false'], ['-e']);

    expect(status).toBe(1);
    expect(output).toContain('bad');
  });

  it('prints the failing gate output, which is the whole point of capturing it', () => {
    const { output } = runGates(['bad:sh -c "echo the reason it failed; exit 3"']);

    expect(output).toContain('the reason it failed');
  });

  it('runs every gate rather than stopping at the first failure', () => {
    const { status, output } = runGates([
      'early:sh -c "echo early output; exit 1"',
      'later:sh -c "echo later output; exit 1"',
    ]);

    expect(status).toBe(1);
    expect(output).toContain('early output');
    expect(output).toContain('later output');
  });

  it('treats a gate that records no exit code as failed, not as absent', () => {
    // A gate killed by the out-of-memory reaper leaves no exit code behind.
    // Reading only the codes that exist counts that gate as a pass.
    const { status, output } = runGates(['killed:sh -c "kill -9 $$"']);

    expect(status).toBe(1);
    expect(output).toContain('killed');
  });

  it('names a gate whose command carries a colon, as `lint:cached` does', () => {
    const { status, output } = runGates(['lint:sh -c "echo ran lint:cached; exit 1"']);

    expect(status).toBe(1);
    expect(output).toContain('ran lint:cached');
    expect(output).toContain('lint');
  });
});

describe('a commit through a hook that uses it', () => {
  /** A repository whose `pre-commit` runs the real gate runner over fake gates. */
  function checkout(gates: string[]): string {
    const root = mkdtempSync(join(tmpdir(), 'commit-gate-'));
    roots.push(root);
    writeFileSync(join(root, 'file.txt'), 'one\n');
    runGit(['init', '-q'], root);
    runGit(['config', 'user.email', 'fixture@example.com'], root);
    runGit(['config', 'user.name', 'Fixture'], root);

    mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
    const hook = join(root, '.git', 'hooks', 'pre-commit');
    const quoted = gates.map((gate) => `'${gate}'`).join(' ');
    writeFileSync(hook, `#!/bin/sh\nset -e\n${SCRIPT} ${quoted}\n`);
    chmodSync(hook, 0o755);
    return root;
  }

  function commit(root: string): { status: number; output: string } {
    runGit(['add', '-A'], root);
    try {
      const output = execFileSync('git', ['commit', '-m', 'probe'], {
        cwd: root,
        encoding: 'utf8',
        env: gitFreeEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, output };
    } catch (error) {
      const e = error as { status: number; stdout?: string; stderr?: string };
      return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
    }
  }

  it('refuses the commit when a gate fails', () => {
    const root = checkout(['ok:true', 'bad:sh -c "echo a real failure; exit 1"']);

    const { status, output } = commit(root);

    expect(status).not.toBe(0);
    expect(output).toContain('a real failure');
    expect(() => runGit(['rev-parse', 'HEAD'], root)).toThrow();
  });

  it('lets the commit through when every gate passes', () => {
    const root = checkout(['ok:true', 'also:true']);

    expect(commit(root).status).toBe(0);
    expect(runGit(['log', '--oneline'], root)).toContain('probe');
  });
});
