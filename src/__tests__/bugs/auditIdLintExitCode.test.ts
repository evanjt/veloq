/**
 * Scenario: about ninety comments across the crate and the app named an
 * internal audit id, which `style.md` bans. The document those ids live in is
 * local and has no remote, so a reader anywhere else cannot resolve one, and
 * the entry moves to the closed file the moment the work lands.
 *
 * Expected behaviour: the guard fails on a comment naming one, in Rust or in
 * TypeScript, and says nothing about a live identifier that merely looks like
 * one. The generated bindings carry the crate's own docstrings, so a hit there
 * would be the same comment reported twice and is skipped.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-audit-ids.mjs');

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

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'audit-ids-'));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this repo, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('fails on a Rust doc comment naming an item', () => {
  const { status, output } = runGuard(
    fixture({
      'modules/veloqrs/rust/veloqrs/src/lib.rs': '/// The window `B132` put in Rust.\nfn a() {}\n',
    })
  );

  expect(status).toBe(1);
  expect(output).toContain('modules/veloqrs/rust/veloqrs/src/lib.rs:1');
});

it('fails on a TypeScript block comment and on a line comment', () => {
  expect(
    runGuard(fixture({ 'src/a.ts': '/**\n * Decided in `Q65`.\n */\nexport const a = 1;\n' }))
      .status
  ).toBe(1);
  expect(
    runGuard(fixture({ 'src/b.ts': '// Left over from `SB13`.\nexport const b = 2;\n' })).status
  ).toBe(1);
});

it('names every key the audit uses, not just the common ones', () => {
  for (const id of ['SB1', 'B12', 'F4', 'X6', 'U30', 'D45', 'C27', 'R6', 'S20', 'Q154', 'I64']) {
    expect(
      runGuard(fixture({ 'src/c.ts': `// From \`${id}\`.\nexport const c = 3;\n` })).status
    ).toBe(1);
  }
});

it('says nothing about code that merely looks like an id', () => {
  const { status } = runGuard(
    fixture({
      'src/d.ts': '// The B12 vitamin row and a b12 key.\nconst Q65 = 1;\nexport const d = Q65;\n',
    })
  );

  expect(status).toBe(0);
});

it('skips the generated bindings, which carry the crate comments already', () => {
  const { status } = runGuard(
    fixture({
      'modules/veloqrs/src/generated/veloqrs.ts': '/** Decided in `Q65`. */\nexport const g = 1;\n',
    })
  );

  expect(status).toBe(0);
});
