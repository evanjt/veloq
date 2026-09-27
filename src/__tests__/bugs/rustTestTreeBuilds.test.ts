/**
 * Scenario: a commit deleted a `PersistentEngine` method whose only caller was
 * an integration test. `cargo check` of the library passed, the merge battery
 * built only the suites the merge touched, and none of them named the method,
 * so `cargo check --tests` was broken on main and no Rust integration suite
 * could build at all. It was found days later by an agent whose own item needed
 * a test build.
 *
 * Expected behaviour: the tree that holds the tests is built somewhere. The
 * branch pays for it on its own commit when it staged Rust, and the merge pays
 * for it again on the merged tree, where a deletion and its caller can arrive
 * from two different branches.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

describe('the Rust test tree is built by a gate', () => {
  it('is checked on the merged tree, where two branches can combine into a break', () => {
    expect(read('scripts/merge-gates.sh')).toMatch(/cargo check --tests/);
  });

  it('is checked by the branch that staged the Rust, so it fails on its own commit', () => {
    expect(read('.husky/pre-commit')).toMatch(/rust-tests/);
    expect(read('package.json')).toMatch(/"lint:rust-tests"/);
  });

  it('only runs when Rust is staged, so a TypeScript commit pays nothing', () => {
    expect(read('scripts/check-rust-tests.ts')).toMatch(/stagedRustFiles/);
  });
});

/**
 * Scenario: most worktrees run with the tracematch submodule absent, and the
 * veloqrs workspace names it as a member, so cargo cannot load the workspace at
 * all. The gate read that as a test caller left broken, and `rusttests` was not
 * skippable, so `--no-verify` was the only way through and it dropped the lint
 * ratchet with it.
 *
 * Expected behaviour: an absent submodule is named as the cause, with the
 * recipe that fixes it, and the gate can be dropped by name like the others.
 */
describe('a checkout without the tracematch submodule', () => {
  const SCRIPT = join(ROOT, 'scripts/check-rust-tests.ts');
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** A repository shaped like this one with veloqrs Rust staged and tracematch an empty directory. */
  function repoWithoutTracematch(): string {
    const root = mkdtempSync(join(tmpdir(), 'rust-tests-gate-'));
    roots.push(root);
    const lib = join(root, 'modules/veloqrs/rust/veloqrs/src/lib.rs');
    mkdirSync(join(lib, '..'), { recursive: true });
    writeFileSync(lib, 'pub fn edited() {}\n');
    mkdirSync(join(root, 'modules/veloqrs/rust/tracematch'), { recursive: true });
    runGit(['init', '-q'], root);
    runGit(['add', '-A'], root);
    return root;
  }

  it('refuses naming the missing submodule and the clone recipe, not a test caller', () => {
    const root = repoWithoutTracematch();

    const result = spawnSync('npx', ['tsx', SCRIPT], {
      cwd: root,
      env: gitFreeEnv(),
      encoding: 'utf-8',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain('modules/veloqrs/rust/tracematch');
    expect(output).toMatch(/submodule/);
    expect(output).toContain('git ls-tree HEAD modules/veloqrs/rust/tracematch');
    expect(output).toContain('git clone --no-checkout');
    expect(output).toContain('VELOQ_SKIP_GATES=rusttests');
    expect(output).not.toContain('A test is the only caller');
  });

  it('can be skipped by name, and the skip is announced', () => {
    let status = 0;
    let output = '';
    try {
      output = execFileSync(
        'sh',
        ['-e', join(ROOT, 'scripts/run-gates.sh'), 'rusttests:echo RUSTTESTS_RAN', 'lint:true'],
        {
          encoding: 'utf8',
          env: { ...gitFreeEnv(), VELOQ_SKIP_GATES: 'rusttests' },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
    } catch (error) {
      const e = error as { status: number; stdout?: string; stderr?: string };
      status = e.status;
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }

    expect(status).toBe(0);
    expect(output).toMatch(/rusttests skipped/);
    expect(output).not.toContain('RUSTTESTS_RAN');
  });

  it('is named among the skippable gates where the hook explains the skip', () => {
    expect(read('.husky/pre-commit')).toMatch(/VELOQ_SKIP_GATES=rusttests/);
  });
});
