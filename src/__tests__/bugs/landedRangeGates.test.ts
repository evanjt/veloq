/**
 * Scenario: every landing moves the main checkout with `git merge --ff-only`
 * onto a merge built elsewhere, so `post-merge` runs the battery after HEAD has
 * moved. The suite plan and the format check listed paths by diffing the index
 * against HEAD, which by then is empty, so a landing carrying a Rust suite, a
 * migration and an unformatted file ran no suite and no format check and was
 * reported as passing.
 *
 * Expected behaviour: after a fast-forward both scripts judge the range the
 * move landed, and when a gate fails the hook names the failing paths, says
 * which came from the landing and which are only another session's, and never
 * offers a reset over the shared checkout.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const CRATE = 'modules/veloqrs/rust/veloqrs';

const UNTIDY = 'export  const   a="1"\n';

const REAL_NPX = execFileSync('sh', ['-c', 'command -v npx'], {
  encoding: 'utf8',
  env: gitFreeEnv(),
}).trim();

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: gitFreeEnv(env), encoding: 'utf8', stdio: 'pipe' });
}

function write(root: string, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents, { mode: path.endsWith('.sh') ? 0o755 : 0o644 });
  }
}

function copy(root: string, path: string, mode = 0o644): void {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  copyFileSync(join(REPO, path), full);
  chmodSync(full, mode);
}

interface Fixture {
  root: string;
  env: NodeJS.ProcessEnv;
}

/**
 * A repository carrying the real `post-merge`, the real suite planner and the
 * real format check. `cargo` and `npx jest` are stubs that record what they
 * were asked to run, so the plan is observed without building anything.
 */
function fixture(gates: string): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'landed-range-'));
  roots.push(root);

  copy(root, '.husky/post-merge', 0o755);
  copy(root, 'scripts/check-merge-tests.sh', 0o755);
  copy(root, 'scripts/check-merge-format.sh', 0o755);
  copy(root, 'scripts/plan-merge-tests.ts');
  copy(root, 'scripts/lib/mergeTestTargets.ts');
  // The planner reads which suites cargo will accept from the real manifest.
  copy(root, `${CRATE}/Cargo.toml`);
  write(root, {
    'scripts/merge-gates.sh': `#!/bin/sh\n${gates}`,
    'src/base.ts': 'export const base = 1;\n',
  });

  mkdirSync(join(root, 'bin'));
  write(root, {
    'bin/cargo': `#!/bin/sh\necho "cargo $*" >> "${root}/ran"\n`,
    'bin/npx': `#!/bin/sh\nif [ "$1" = jest ]; then echo "npx $*" >> "${root}/ran"; exit 0; fi\nexec "${REAL_NPX}" "$@"\n`,
  });
  chmodSync(join(root, 'bin/cargo'), 0o755);
  chmodSync(join(root, 'bin/npx'), 0o755);
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'));

  const env: NodeJS.ProcessEnv = {
    ...gitFreeEnv(),
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    VELOQ_MERGE_FORMAT_REPO: REPO,
  };
  delete env.VELOQ_MERGE_BASE;

  git(root, env, 'init', '-q', '-b', 'main');
  git(root, env, 'config', 'core.hooksPath', '.husky');
  git(root, env, 'config', 'commit.gpgsign', 'false');
  appendFileSync(join(root, '.git/info/exclude'), 'node_modules\nbin\nran\n');
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '-q', '--no-verify', '-m', 'base');
  return { root, env };
}

/**
 * The landing shape: a branch merged in a staging branch with the hooks off,
 * as `land-branch.sh` does in its own worktree, then fast-forwarded onto.
 */
function land(
  { root, env }: Fixture,
  files: Record<string, string>,
  neighbour: Record<string, string> = {}
): string {
  git(root, env, 'checkout', '-q', '-b', 'branch');
  write(root, files);
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '-q', '--no-verify', '-m', 'branch');
  git(root, env, 'checkout', '-q', '-b', 'staging', 'main');
  git(root, env, '-c', 'core.hooksPath=/dev/null', 'merge', '-q', '--no-ff', '--no-edit', 'branch');
  git(root, env, 'checkout', '-q', 'main');
  // Another session's work, staged in the shared checkout the landing moves.
  write(root, neighbour);
  for (const path of Object.keys(neighbour)) git(root, env, 'add', path);

  return execFileSync('sh', ['-c', 'git merge --ff-only staging 2>&1'], {
    cwd: root,
    env: gitFreeEnv(env),
    encoding: 'utf8',
  });
}

function ran({ root }: Fixture): string {
  const path = join(root, 'ran');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** The real pair the battery runs, both of them whatever the first says. */
const SCOPED_GATES = `code=0
./scripts/check-merge-format.sh || code=1
./scripts/check-merge-tests.sh || code=1
exit $code
`;

describe('a landing is judged on the range it landed', () => {
  const LANDING = {
    [`${CRATE}/tests/lap_time_backfill_scope.rs`]: '#[test]\nfn scope() {}\n',
    [`${CRATE}/src/migrations/031_example.sql`]: 'SELECT 1;\n',
    'src/landed.ts': UNTIDY,
  };

  let fx: Fixture;
  let said = '';

  beforeAll(() => {
    fx = fixture(SCOPED_GATES);
    said = land(fx, LANDING);
  }, 120_000);

  it('lands as a fast-forward onto a merge commit, which is every landing', () => {
    expect(said).toMatch(/Fast-forward/);
    expect(said).toMatch(/no gate ran/i);
  });

  it('runs the suite whose file the landing touched', () => {
    expect(ran(fx)).toMatch(/cargo test .*--test lap_time_backfill_scope/);
  });

  it('runs the schema suites a migration maps to', () => {
    expect(ran(fx)).toMatch(/--test migration_checksums/);
    expect(ran(fx)).toMatch(/--test migration_upgrade/);
  });

  it('hands the landed TypeScript to jest', () => {
    expect(ran(fx)).toMatch(/npx jest .*src\/landed\.ts/);
  });

  it('names the unformatted file the landing carried', () => {
    expect(said).toMatch(/prettier would rewrite/);
    expect(said).toMatch(/^ {2}src\/landed\.ts$/m);
  });

  it('never tells the lander to reset the shared checkout', () => {
    expect(said).not.toMatch(/reset --hard/);
  });

  it('says the failing file came from the landing', () => {
    expect(said).toMatch(/src\/landed\.ts.*landed by this merge/);
  });

  it('points at a fix-forward or a revert of the merge instead', () => {
    const merge = git(fx.root, fx.env, 'rev-parse', '--short', 'HEAD').trim();

    expect(said).toMatch(/fix-forward/);
    expect(said).toContain(`git revert -m 1 ${merge}`);
  });
});

describe('a failure that is another session’s, not the landing’s', () => {
  // A whole-tree gate that reads the shared index, the way the lint and the
  // guards do, failing on a file another session has staged.
  const INDEX_GATE = `echo "src/neighbour.ts: 1 warning over the ceiling"\nexit 1\n`;

  let fx: Fixture;
  let said = '';

  beforeAll(() => {
    fx = fixture(INDEX_GATE);
    said = land(
      fx,
      { 'src/landed.ts': 'export const a = 1;\n' },
      { 'src/neighbour.ts': 'export const n = 1;\n' }
    );
  }, 120_000);

  it('says the file is only staged in the index, not part of the landing', () => {
    expect(said).toMatch(/src\/neighbour\.ts.*only staged in the index/);
    expect(said).not.toMatch(/src\/neighbour\.ts.*landed by this merge/);
  });

  it('never tells the lander to reset the shared checkout', () => {
    expect(said).not.toMatch(/reset --hard/);
  });
});

describe('a failure beside suites that passed', () => {
  // Jest names every suite it ran, passing or not, and one landed path is a
  // prefix of another. Only the path the failure is about is placed.
  const JEST_GATE = ['echo "PASS src/passed.test.ts"', 'echo "FAIL src/a.tsx"', 'exit 1', ''].join(
    '\n'
  );

  let said = '';

  beforeAll(() => {
    said = land(fixture(JEST_GATE), {
      'src/passed.test.ts': 'export const p = 1;\n',
      'src/a.ts': 'export const a = 1;\n',
      'src/a.tsx': 'export const b = 1;\n',
    });
  }, 120_000);

  it('places the failing file', () => {
    expect(said).toMatch(/failing: src\/a\.tsx, landed by this merge/);
  });

  it('does not place a suite that passed', () => {
    expect(said).not.toMatch(/failing: src\/passed\.test\.ts/);
  });

  it('does not place a path that is only a prefix of the failing one', () => {
    expect(said).not.toMatch(/failing: src\/a\.ts,/);
  });
});

describe('a failure that names no path', () => {
  let said = '';

  beforeAll(() => {
    said = land(fixture('echo "tsc: out of memory"\nexit 1\n'), {
      'src/landed.ts': 'export const a = 1;\n',
    });
  }, 120_000);

  it('says so rather than blaming the landing', () => {
    expect(said).toMatch(/names no path/);
    expect(said).not.toMatch(/landed by this merge/);
  });

  it('never tells the lander to reset the shared checkout', () => {
    expect(said).not.toMatch(/reset --hard/);
  });
});
