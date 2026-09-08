/**
 * Scenario: the detector ordering guard stats its roots without checking they
 * exist, so in a worktree where the tracematch submodule is not populated it
 * throws an uncaught ENOENT. `npm run audit` chains its checks with `&&`, so
 * the seven after this one never ran.
 *
 * Expected behaviour: an absent submodule is reported and passes, an absent
 * one is not confused with a clean check, and a populated one that returns a
 * hash container still fails.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/lint-detector-ordering.mjs');
const SECTIONS = 'modules/veloqrs/rust/tracematch/src/sections';

function runGuard(cwd: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'detector-ordering-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this repo, so the audit gate stays usable', () => {
  expect(runGuard(REPO).status).toBe(0);
});

it('passes when the submodule is not checked out, so the checks after it still run', () => {
  const { status } = runGuard(fixture());

  expect(status).toBe(0);
});

it('says the submodule is absent rather than claiming the ordering was checked', () => {
  const { output } = runGuard(fixture());

  expect(output).toContain('tracematch not checked out');
  expect(output).not.toContain('no public function returns a hash container');
});

it('does not throw a raw ENOENT stack, which reads as a broken repository', () => {
  const { output } = runGuard(fixture());

  expect(output).not.toContain('ENOENT');
});

it('still fails a populated submodule that returns a hash container', () => {
  const root = fixture({
    [`${SECTIONS}/identity.rs`]: 'pub fn carriers(&self) -> HashMap<String, usize> { todo!() }\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SECTIONS}/identity.rs:1`);
});

it('passes a populated submodule whose public functions return ordered containers', () => {
  const root = fixture({
    [`${SECTIONS}/identity.rs`]: 'pub fn carriers(&self) -> BTreeMap<String, usize> { todo!() }\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(0);
  expect(output).toContain('no public function returns a hash container');
});
