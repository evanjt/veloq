/**
 * Scenario: `tsc` in a worktree resolves `veloqrs` to the main checkout, so it
 * reports errors that are not in the tree being committed. Sessions were
 * taught to reach for `--no-verify`, which skips every gate including the lint
 * ratchet, and two warnings then landed over the ceiling and failed the next
 * session's merge rather than the commit that made them.
 *
 * Expected behaviour: one gate can be skipped by name, so the reason to skip
 * all of them goes away. The skip is announced rather than silent, it never
 * turns a failing gate into a passing run, and the ratchet is not skippable:
 * that is the thing the escape hatch exists to protect.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/run-gates.sh');
const HOOK = join(__dirname, '../../../.husky/pre-commit');

function runGates(
  gates: string[],
  extraEnv: Record<string, string> = {}
): { status: number; output: string } {
  try {
    const output = execFileSync('sh', ['-e', SCRIPT, ...gates], {
      encoding: 'utf8',
      env: { ...gitFreeEnv(), ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('skipping one gate by name', () => {
  it('does not run the gate it was told to skip', () => {
    const { status, output } = runGates(['tsc:echo TSC_RAN', 'lint:echo LINT_RAN'], {
      VELOQ_SKIP_GATES: 'tsc',
    });

    expect(status).toBe(0);
    expect(output).not.toContain('TSC_RAN');
  });

  it('still runs every other gate', () => {
    const { output } = runGates(['tsc:echo TSC_RAN', 'lint:exit 3'], {
      VELOQ_SKIP_GATES: 'tsc',
    });

    expect(output).toContain('lint');
  });

  it('still fails when a gate that ran failed', () => {
    const { status } = runGates(['tsc:exit 1', 'lint:exit 3'], { VELOQ_SKIP_GATES: 'tsc' });

    expect(status).not.toBe(0);
  });

  it('says which gate it skipped, so a skip is never silent', () => {
    const { output } = runGates(['tsc:echo TSC_RAN'], { VELOQ_SKIP_GATES: 'tsc' });

    expect(output).toMatch(/skipped/i);
    expect(output).toContain('tsc');
  });

  it('skips nothing when nothing asked for a skip', () => {
    const { status, output } = runGates(['tsc:echo TSC_RAN', 'lint:echo LINT_RAN']);

    expect(status).toBe(0);
    expect(output).not.toMatch(/skipped/i);
  });

  /** A passing run prints no gate output, so a skipped gate that failed would
   * otherwise be invisible: it has to be absent, not quiet. */
  it('does not let a skipped gate fail the run', () => {
    const { status } = runGates(['tsc:exit 1', 'lint:echo LINT_RAN'], {
      VELOQ_SKIP_GATES: 'tsc',
    });

    expect(status).toBe(0);
  });

  /**
   * The ratchet is what `--no-verify` walked past, so an escape hatch that
   * could skip it would be the same hole with a tidier name.
   */
  it('refuses to skip the lint gate that carries the ceiling', () => {
    const { status, output } = runGates(['lint:echo LINT_RAN'], { VELOQ_SKIP_GATES: 'lint' });

    expect(status).not.toBe(0);
    expect(output).toMatch(/lint/);
    expect(output).not.toContain('LINT_RAN');
  });

  it('refuses a name that is not a gate at all, rather than skipping nothing quietly', () => {
    const { status } = runGates(['tsc:echo TSC_RAN'], { VELOQ_SKIP_GATES: 'typescript' });

    expect(status).not.toBe(0);
  });
});

describe('the hook tells a worktree session what to skip instead of everything', () => {
  it('names the variable, so the instruction is where the trap is met', () => {
    expect(readFileSync(HOOK, 'utf8')).toContain('VELOQ_SKIP_GATES');
  });
});
