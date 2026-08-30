/**
 * Scenario: style.md bans the em dash, and three hand-run sweeps each left a
 * corner behind: store metadata fifteen locales deep, maestro flows, Rust test
 * headers.
 *
 * Expected behaviour: the guard reads the whole git index rather than a listed
 * set of directories, so a new corner cannot open, and a clean tree exits 0.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-em-dashes.mjs');

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

function fixture(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'em-dash-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
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

it('fails on store copy, the corner the last three sweeps missed', () => {
  const root = fixture({
    'config/fastlane/metadata/android/de-DE/full_description.txt':
      'Alles bleibt auf dem Gerät — keine Analyse.\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('config/fastlane/metadata/android/de-DE/full_description.txt:1');
});

it('names every line, not only the first', () => {
  const root = fixture({
    'docs/notes.md': 'one — two\nplain\nthree — four\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('docs/notes.md:1');
  expect(output).toContain('docs/notes.md:3');
});

it('skips an allowlisted path, which is how this test file survives the guard', () => {
  const root = fixture({
    'src/__tests__/bugs/emDashLintExitCode.test.ts': "const dash = '\u2014';\n",
    'src/other.ts': "const dash = 'plain';\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('ignores an untracked file', () => {
  const root = fixture({ 'kept.md': 'clean\n' });
  writeFileSync(join(root, 'scratch.md'), 'loose — dash\n');

  expect(runGuard(root).status).toBe(0);
});

it('ignores a binary file that happens to hold the bytes', () => {
  const root = fixture({
    'assets/blob.bin': Buffer.from([0x00, 0xe2, 0x80, 0x94, 0x00]),
  });

  expect(runGuard(root).status).toBe(0);
});

it('passes an en dash and a hyphen through', () => {
  const root = fixture({ 'docs/dashes.md': 'a – b, and c-d\n' });

  expect(runGuard(root).status).toBe(0);
});
