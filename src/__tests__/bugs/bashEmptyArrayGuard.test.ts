/**
 * Scenario: bash before 4.4 reads an empty array under `set -u` as unbound,
 * and macOS ships 3.2. Linux CI runs bash 5, so an unguarded `"${a[@]}"` in a
 * Maestro shell script passes there and stops the suite on a Mac.
 *
 * Expected behaviour: the guard fails on an unguarded expansion in a script
 * that sets `set -u`, names the line, and accepts the `${a[@]+"${a[@]}"}` form,
 * the `${#a[@]}` length, comments and scripts without `set -u`.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-bash-empty-arrays.mjs');
const roots: string[] = [];

function run(body: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'bash-arrays-'));
  roots.push(root);
  mkdirSync(join(root, '.maestro'));
  writeFileSync(join(root, '.maestro/suite.sh'), body);
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('bash empty array guard', () => {
  it('refuses an unguarded expansion under set -u and names the line', () => {
    const result = run('#!/bin/bash\nset -uo pipefail\nadb "${device[@]}" devices\n');
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('suite.sh:3');
  });

  it('refuses an unquoted and a star expansion too', () => {
    expect(run('set -u\nadb ${d[@]} x\n').status).not.toBe(0);
    expect(run('set -u\nadb "${d[*]}" x\n').status).not.toBe(0);
  });

  it('accepts the guarded form, the length and comments', () => {
    const body = [
      'set -uo pipefail',
      '# "${a[@]}" is unbound when empty',
      'if [ ${#a[@]} -eq 0 ]; then :; fi',
      'adb ${a[@]+"${a[@]}"} devices',
      'adb ${a[@]+"${a[@]}"} ${b[@]+"${b[@]}"} devices',
      '',
    ].join('\n');
    expect(run(body).status).toBe(0);
  });

  it('ignores a script that does not set -u', () => {
    expect(run('adb "${a[@]}" devices\n').status).toBe(0);
  });
});
