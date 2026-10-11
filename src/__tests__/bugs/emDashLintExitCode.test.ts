/**
 * Scenario: style.md bans the em dash, and three hand-run sweeps each left a
 * corner behind: store metadata fifteen locales deep, maestro flows, Rust test
 * headers.
 *
 * Expected behaviour: the guard reads the whole git index rather than a listed
 * set of directories, so a new corner cannot open.
 */

import { execFileSync } from 'node:child_process';
import { initFixtureRepo, gitFreeEnv, runGit } from '../__shared__/gitFixture';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-em-dashes.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      env: gitFreeEnv(),
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
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
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

it('skips migration SQL, whose bytes are hashed and cannot be swept', () => {
  const root = fixture({
    'modules/veloqrs/rust/veloqrs/src/migrations/017_b4_core.sql':
      '-- B4 core \u2014 durable identity.\nCREATE TABLE t (a INTEGER);\n',
    'modules/veloqrs/rust/veloqrs/src/lib.rs': '// plain\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('still fails on Rust outside the migrations directory', () => {
  const root = fixture({
    'modules/veloqrs/rust/veloqrs/src/objects/sections.rs': '// one \u2014 two\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('modules/veloqrs/rust/veloqrs/src/objects/sections.rs:1');
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

it.each(['&mdash;', '&#8212;', '&#x2014;', '&#X2014;', '&#08212;'])(
  'fails on the dash written as the HTML reference %s, which renders the same on a web page',
  (reference) => {
    const root = fixture({
      'docs/site.html': `<p>plain</p>\n<p>Open source ${reference} sideload</p>\n`,
    });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain('docs/site.html:2');
  }
);

it('passes the en dash and arrow references through', () => {
  const root = fixture({ 'docs/site.html': '<p>a &ndash; b &rarr; c &#8211; d</p>\n' });

  expect(runGuard(root).status).toBe(0);
});

it('passes an en dash and a hyphen through', () => {
  const root = fixture({ 'docs/dashes.md': 'a – b, and c-d\n' });

  expect(runGuard(root).status).toBe(0);
});

describe('the tracematch submodule, which has an index of its own', () => {
  const SUBMODULE = 'modules/veloqrs/rust/tracematch';

  function fixtureWithSubmodule(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'em-dash-sub-'));
    roots.push(root);
    const inner = join(root, SUBMODULE);
    for (const [path, contents] of Object.entries(files)) {
      const full = join(inner, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, contents);
    }
    // The outer index holds only a gitlink for this path, so the inner repo
    // needs a commit before the outer one can add it.
    runGit(['init', '-q'], inner);
    runGit(['add', '-A'], inner);
    runGit(['commit', '-q', '-m', 'inner'], inner);
    writeFileSync(join(root, 'README.md'), 'clean\n');
    initFixtureRepo(root);
    return root;
  }

  it('fails on a dash in a file only the submodule tracks', () => {
    const root = fixtureWithSubmodule({ 'tests/fold.rs': '// one — two\n' });

    const { status, output } = runGuard(root);

    expect(status).toBe(1);
    expect(output).toContain(`${SUBMODULE}/tests/fold.rs:1`);
  });

  it('passes when the submodule is clean', () => {
    const root = fixtureWithSubmodule({ 'tests/fold.rs': '// one, two\n' });

    expect(runGuard(root).status).toBe(0);
  });

  it('ignores an untracked file in the submodule', () => {
    const root = fixtureWithSubmodule({ 'tests/fold.rs': '// plain\n' });
    writeFileSync(join(root, SUBMODULE, 'scratch.md'), 'loose — dash\n');

    expect(runGuard(root).status).toBe(0);
  });

  it('passes when the submodule directory is not checked out', () => {
    const root = fixture({ 'README.md': 'clean\n' });
    mkdirSync(join(root, SUBMODULE), { recursive: true });

    expect(runGuard(root).status).toBe(0);
  });
});
