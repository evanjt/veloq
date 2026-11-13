/**
 * Scenario: `scripts/test-debug-push.sh` was committed as mode 100644 while it
 * re-execs itself through the device lock wrapper. A checkout restores the
 * recorded mode, so the wrapper could not run it and the documented invocation
 * failed with Permission denied. Nothing calls the script, so nothing noticed.
 * Expected behaviour: the guard names every top-level `scripts/*.sh` that starts
 * with a shebang and is tracked without the executable bit. It leaves alone a
 * sourced library with no shebang, a script in a subdirectory, a Node script
 * and a shebang script that is tracked executable.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-script-modes.mjs');

const EXECUTABLE = 0o755;
const PLAIN = 0o644;

type Entry = { body: string; mode: number };

/** A repository holding `files`, each committed with the mode it names. */
function fixtureRepo(files: Record<string, Entry>): { dir: string; root: string } {
  const dir = mkdtempSync(join(tmpdir(), 'script-modes-'));
  const root = join(dir, 'repo');
  mkdirSync(root);
  for (const [rel, { body, mode }] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
    chmodSync(full, mode);
  }
  initFixtureRepo(root);
  return { dir, root };
}

function guardIn(root: string): { status: number; output: string } {
  const r = spawnSync('node', [GUARD, '--root', root], {
    cwd: root,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  return { status: r.status ?? -1, output: `${r.stdout}${r.stderr}` };
}

/** Runs the guard over a fixture and removes it afterwards. */
function judge(files: Record<string, Entry>): { status: number; output: string } {
  const { dir, root } = fixtureRepo(files);
  try {
    return guardIn(root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SH = '#!/bin/sh\necho ok\n';

describe('the script mode guard', () => {
  it('passes a shebang script tracked executable', () => {
    expect(judge({ 'scripts/run.sh': { body: SH, mode: EXECUTABLE } })).toMatchObject({
      status: 0,
    });
  });

  it('refuses a shebang script tracked without the executable bit, naming it', () => {
    const { status, output } = judge({ 'scripts/broken.sh': { body: SH, mode: PLAIN } });
    expect(status).toBe(1);
    expect(output).toContain('scripts/broken.sh');
    expect(output).toContain('100644');
    expect(output).toContain('git update-index --chmod=+x');
  });

  it('names every offender, not only the first', () => {
    const { status, output } = judge({
      'scripts/a-broken.sh': { body: SH, mode: PLAIN },
      'scripts/b-run.sh': { body: SH, mode: EXECUTABLE },
      'scripts/c-broken.sh': { body: SH, mode: PLAIN },
    });
    expect(status).toBe(1);
    expect(output).toContain('scripts/a-broken.sh');
    expect(output).toContain('scripts/c-broken.sh');
    expect(output).not.toContain('scripts/b-run.sh');
  });

  it('leaves a sourced library with no shebang alone, whatever its mode', () => {
    expect(
      judge({
        'scripts/run.sh': { body: SH, mode: EXECUTABLE },
        'scripts/device-lock-path.sh': { body: 'device_lock_path() { :; }\n', mode: PLAIN },
      })
    ).toMatchObject({ status: 0 });
  });

  it('leaves a script in a subdirectory alone, since it runs through its interpreter', () => {
    expect(
      judge({
        'scripts/run.sh': { body: SH, mode: EXECUTABLE },
        'scripts/thread-budget/sample.sh': { body: '#!/system/bin/sh\necho ok\n', mode: PLAIN },
      })
    ).toMatchObject({ status: 0 });
  });

  it('leaves a shebang Node script alone, since it runs through node', () => {
    expect(
      judge({
        'scripts/run.sh': { body: SH, mode: EXECUTABLE },
        'scripts/tool.mjs': { body: '#!/usr/bin/env node\nconsole.log(1);\n', mode: PLAIN },
      })
    ).toMatchObject({ status: 0 });
  });

  it('refuses a tree with no top-level scripts, rather than reporting it clean', () => {
    expect(judge({ 'src/index.ts': { body: 'export {};\n', mode: PLAIN } }).status).toBe(1);
  });
});
