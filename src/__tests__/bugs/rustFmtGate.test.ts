/**
 * Scenario: `cargo fmt` runs in CI and in no local gate, so unformatted Rust
 * lands and the Rust Lint job goes red until somebody happens to look. The
 * same red gate was found three times in one afternoon.
 *
 * Expected behaviour: a commit carrying unformatted Rust is refused with the
 * diff, a commit touching no Rust does not pay for the check, and the gate
 * needs neither the workspace nor the tracematch submodule to run.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';
import { EDITION, parseStagedList, stagedRustFiles } from '../../../scripts/lib/rustFmtGate';

const SCRIPT = resolve('scripts/check-rust-fmt.ts');
const CRATE = 'modules/veloqrs/rust/veloqrs/src';
const roots: string[] = [];

const CLEAN = 'pub fn tidy() -> u32 {\n    1\n}\n';
const UNFORMATTED = 'pub fn  untidy( )->u32{\n1\n}\n';

/** A repository shaped like this one, with `files` staged. */
function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'rustfmt-gate-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  runGit(['init', '-q'], root);
  runGit(['add', '-A'], root);
  return root;
}

function runGate(root: string): { status: number; output: string } {
  const result = spawnSync('npx', ['tsx', SCRIPT], {
    cwd: root,
    env: { ...gitFreeEnv(), PATH: process.env.PATH ?? '' },
    encoding: 'utf-8',
  });
  return {
    status: result.status ?? -1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

const rustfmtPresent = spawnSync('rustfmt', ['--version'], { encoding: 'utf-8' }).status === 0;

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('which staged files the gate checks', () => {
  it('takes the Rust this repository owns', () => {
    expect(
      stagedRustFiles([
        'modules/veloqrs/rust/veloqrs/src/ffi.rs',
        'modules/veloqrs/rust/veloqrs/tests/cutover.rs',
      ])
    ).toHaveLength(2);
  });

  it.each([
    ['a TypeScript file', 'src/features/routes/hooks/useSectionRescan.ts'],
    [
      'the tracematch submodule, which has its own CI',
      'modules/veloqrs/rust/tracematch/src/lib.rs',
    ],
    ['a Rust file outside the crate', 'scripts/thing.rs'],
    ['a file that merely mentions rs', 'src/app/rs.tsx'],
  ])('leaves %s alone', (_label, file) => {
    expect(stagedRustFiles([file])).toEqual([]);
  });

  it("reads git's NUL-separated list, so a path with a space survives", () => {
    expect(parseStagedList('a.rs\0b c.rs\0')).toEqual(['a.rs', 'b c.rs']);
  });

  it('names the edition, since rustfmt is not reading Cargo.toml', () => {
    expect(EDITION).toBe('2024');
  });
});

describe('the gate itself', () => {
  it('passes a commit that stages no Rust at all', () => {
    const root = repoWith({ 'src/a.ts': 'export const a = 1;\n' });

    expect(runGate(root).status).toBe(0);
  });

  it('passes formatted Rust', () => {
    if (!rustfmtPresent) return;
    const root = repoWith({ [`${CRATE}/tidy.rs`]: CLEAN });

    expect(runGate(root).status).toBe(0);
  });

  it('refuses unformatted Rust and prints the diff', () => {
    if (!rustfmtPresent) return;
    const root = repoWith({ [`${CRATE}/untidy.rs`]: UNFORMATTED });

    const { status, output } = runGate(root);

    expect(status).toBe(1);
    expect(output).toContain('not rustfmt clean');
    expect(output).toContain('untidy.rs');
  });

  it('runs without the workspace or the tracematch submodule present', () => {
    if (!rustfmtPresent) return;
    // Neither a Cargo.toml nor a tracematch directory exists in this fixture,
    // which is exactly what defeats `cargo fmt` in a fresh worktree.
    const root = repoWith({ [`${CRATE}/untidy.rs`]: UNFORMATTED });

    expect(() => execFileSync('ls', [join(root, 'modules/veloqrs/rust/tracematch')])).toThrow();
    expect(runGate(root).status).toBe(1);
  });
});
