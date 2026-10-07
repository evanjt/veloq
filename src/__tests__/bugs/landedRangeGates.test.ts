/**
 * Scenario: the suite plan and the format check list a merge's paths by
 * diffing the index against HEAD. In the landing tree the candidate is already
 * committed, so that diff is empty, and a landing carrying a Rust suite, a
 * migration and an unformatted file would run no suite and no format check and
 * be reported as passing. The shared checkout's index and disk held other
 * sessions' files too, which the battery used to judge when it ran there.
 *
 * Expected behaviour: `land-branch.sh` hands the battery the target the
 * candidate was built on, so both scripts judge exactly the range that would
 * land, a failure refuses the landing before the target moves, and nothing
 * another session keeps in the checkout is read or blamed.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const LANDER = join(REPO, 'scripts/land-branch.sh');
const CRATE = 'modules/veloqrs/rust/veloqrs';

const UNTIDY = 'export  const   a="1"\n';

const REAL_NPX = execFileSync('sh', ['-c', 'command -v npx'], {
  encoding: 'utf8',
  env: gitFreeEnv(),
}).trim();

const boxes: string[] = [];

afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

/** Where the format gate reads prettier from, which the fixture has no install of. */
const FORMAT_REPO = { VELOQ_MERGE_FORMAT_REPO: REPO };

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...gitFreeEnv(env), ...FORMAT_REPO },
    encoding: 'utf8',
    stdio: 'pipe',
  });
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
  box: string;
  root: string;
  env: NodeJS.ProcessEnv;
}

/** The real pair the battery runs, both of them whatever the first says. */
const SCOPED_GATES = `#!/bin/sh
code=0
./scripts/check-merge-format.sh || code=1
./scripts/check-merge-tests.sh || code=1
exit $code
`;

/**
 * A checkout carrying the real suite planner and the real format check as its
 * battery. `cargo` and `npx jest` are stubs that record what they were asked
 * to run, so the plan is observed without building anything.
 */
function fixture(): Fixture {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'landed-range-')));
  boxes.push(box);
  const root = join(box, 'veloq');
  mkdirSync(root);

  copy(root, 'scripts/check-merge-tests.sh', 0o755);
  copy(root, 'scripts/check-merge-format.sh', 0o755);
  copy(root, 'scripts/plan-merge-tests.ts');
  copy(root, 'scripts/lib/mergeTestTargets.ts');
  // The planner reads which suites cargo will accept from the real manifest.
  copy(root, `${CRATE}/Cargo.toml`);
  cpSync(join(REPO, CRATE, 'tests'), join(root, CRATE, 'tests'), { recursive: true });
  write(root, {
    'scripts/merge-gates.sh': SCOPED_GATES,
    'src/base.ts': 'export const base = 1;\n',
    '.gitignore': 'node_modules\n',
  });
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'));

  mkdirSync(join(box, 'bin'));
  write(box, {
    'bin/cargo': `#!/bin/sh\necho "cargo $*" >> "${box}/ran"\n`,
    'bin/npx': `#!/bin/sh\nif [ "$1" = jest ]; then echo "npx $*" >> "${box}/ran"; exit 0; fi\nexec "${REAL_NPX}" "$@"\n`,
  });
  chmodSync(join(box, 'bin/cargo'), 0o755);
  chmodSync(join(box, 'bin/npx'), 0o755);

  const env: NodeJS.ProcessEnv = {
    ...gitFreeEnv(),
    PATH: `${join(box, 'bin')}:${process.env.PATH}`,
  };

  git(root, env, 'init', '-q', '-b', 'main');
  git(root, env, 'config', 'commit.gpgsign', 'false');
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '-q', '--no-verify', '-m', 'base');
  return { box, root, env };
}

/**
 * Commit `files` on a branch, leave `neighbour` staged and edited in the
 * checkout the way another session would, and land the branch.
 */
function land(
  { root, env }: Fixture,
  files: Record<string, string>,
  neighbour: Record<string, string> = {}
): { status: number; output: string } {
  git(root, env, 'checkout', '-q', '-b', 'branch');
  write(root, files);
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '-q', '--no-verify', '-m', 'branch');
  git(root, env, 'checkout', '-q', 'main');
  write(root, neighbour);
  for (const path of Object.keys(neighbour)) git(root, env, 'add', path);

  const result = spawnSync('bash', [LANDER, 'branch'], {
    cwd: root,
    env: { ...gitFreeEnv(env), ...FORMAT_REPO, VELOQ_LAND_ATTEMPTS: '2', VELOQ_LAND_SLEEP: '0' },
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

function ran({ box }: Fixture): string {
  const path = join(box, 'ran');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('a landing is judged on the range it would land', () => {
  const LANDING = {
    [`${CRATE}/tests/lap_time_backfill_scope.rs`]: '#[test]\nfn scope() {}\n',
    [`${CRATE}/src/migrations/031_example.sql`]: 'SELECT 1;\n',
    'src/landed.ts': UNTIDY,
  };

  let fx: Fixture;
  let before = '';
  let said = { status: 0, output: '' };

  beforeAll(() => {
    fx = fixture();
    before = git(fx.root, fx.env, 'rev-parse', 'HEAD').trim();
    said = land(fx, LANDING);
  }, 120_000);

  it('runs the suite whose file the landing touched', () => {
    expect(ran(fx)).toMatch(/cargo test .*--test app/);
  });

  it('runs the schema suites a migration maps to', () => {
    expect(ran(fx)).toMatch(/--test migration(?:\s|$)/);
  });

  it('hands the landed TypeScript to jest', () => {
    expect(ran(fx)).toMatch(/npx jest .*src\/landed\.ts/);
  });

  it('names the unformatted file the landing carried', () => {
    expect(said.output).toMatch(/prettier would rewrite/);
    expect(said.output).toMatch(/^ {2}src\/landed\.ts$/m);
  });

  it('refuses the landing and leaves the target where it was', () => {
    expect(said.status).not.toBe(0);
    expect(git(fx.root, fx.env, 'rev-parse', 'HEAD').trim()).toBe(before);
    expect(existsSync(join(fx.root, 'src/landed.ts'))).toBe(false);
  });
});

describe('another session’s files in the checkout', () => {
  let fx: Fixture;
  let said = { status: 0, output: '' };

  beforeAll(() => {
    fx = fixture();
    said = land(fx, { 'src/landed.ts': 'export const a = 1;\n' }, { 'src/neighbour.ts': UNTIDY });
  }, 120_000);

  it('are neither judged nor blamed, so the landing goes through', () => {
    expect(said.output).not.toMatch(/neighbour\.ts/);
    expect(said.status).toBe(0);
    expect(readFileSync(join(fx.root, 'src/landed.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('stay as that session left them', () => {
    expect(git(fx.root, fx.env, 'diff', '--cached', '--name-only').trim()).toBe('src/neighbour.ts');
    expect(readFileSync(join(fx.root, 'src/neighbour.ts'), 'utf8')).toBe(UNTIDY);
  });
});
