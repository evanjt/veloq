/**
 * Scenario: the veloqrs crate carried both spellings at once, so
 * `normalize_features` sat beside `ensure_visit_count_denormalisation` and a
 * grep for either form missed the other.
 *
 * Expected behaviour: the guard fails on the American form, and passes the
 * words that are not ours to spell: serde, HTTP, the UniFFI surface and the
 * one phase token TypeScript keys on.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-au-spelling.mjs');
const CRATE = 'modules/veloqrs/rust/veloqrs/src';

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
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

function crate(contents: string): string {
  const root = mkdtempSync(join(tmpdir(), 'au-spelling-'));
  roots.push(root);
  const full = join(root, CRATE, 'lib.rs');
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this repo, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('fails on an American identifier', () => {
  const { status, output } = runGuard(crate('fn normalize_features() {}\n'));

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/lib.rs:1`);
  expect(output).toContain('normalis');
});

it('fails on an American word in a comment', () => {
  expect(runGuard(crate('// materialized PR and trend badges\n')).status).toBe(1);
});

it('passes serde, which names its own traits', () => {
  expect(runGuard(crate('#[derive(Serialize, Deserialize)]\nstruct A;\n')).status).toBe(0);
});

it('passes the HTTP spellings, which the RFC fixes', () => {
  expect(
    runGuard(crate('const H: &str = "Authorization";\nconst S: u16 = 401; // Unauthorized\n'))
      .status
  ).toBe(0);
});

it('passes the UniFFI surface, a rename there is not a spelling change', () => {
  expect(runGuard(crate('fn is_initialized(&self) -> bool { true }\n')).status).toBe(0);
});

it('still fails on our own initialisation prose beside the exempt name', () => {
  const { status, output } = runGuard(
    crate('/// Initialize the schema.\nfn is_initialized() -> bool { true }\n')
  );

  expect(status).toBe(1);
  expect(output).toContain(`${CRATE}/lib.rs:1`);
  expect(output).not.toContain(`${CRATE}/lib.rs:2`);
});

it("passes a vendor's own error variant quoted in a comment", () => {
  expect(runGuard(crate('// ok() ignores AlreadyInitialized on repeated calls\n')).status).toBe(0);
});

it('passes the phase token TypeScript keys on', () => {
  expect(runGuard(crate('set_phase("analyzing", n);\n')).status).toBe(0);
});

it('ignores files outside the crate', () => {
  const root = crate('// clean\n');
  writeFileSync(join(root, 'notes.md'), 'normalized\n');
  execFileSync('git', ['add', '-A'], { cwd: root });

  expect(runGuard(root).status).toBe(0);
});
