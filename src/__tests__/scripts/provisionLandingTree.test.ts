/**
 * Scenario: the landing tree is a worktree, and a fresh worktree has an empty
 * engine submodule, so cargo cannot load the workspace, and a `node_modules`
 * that resolves `veloqrs` to the main checkout's module, so `tsc` judges the
 * bindings the candidate does not carry. A gate run there passes or fails on
 * another tree's code.
 *
 * Expected behaviour: `scripts/provision-landing-tree.sh` checks the engine out
 * at the candidate's own pin, links every package from the main checkout but
 * `veloqrs`, which it points at the landing tree's own module, and prepares the
 * hooks. Whatever a previous landing left stale it puts right, and what it
 * cannot provide it refuses, naming what is missing.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/provision-landing-tree.sh');
const ENGINE = 'modules/veloqrs/rust/tracematch';

const boxes: string[] = [];

afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'protocol.file.allow=always', ...args], {
    cwd,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function write(root: string, path: string, contents: string): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

interface Fixture {
  box: string;
  checkout: string;
  landing: string;
  engine: string;
  older: string;
  pin: string;
}

/**
 * A main checkout carrying the engine as a submodule pinned at its second
 * commit, an installed `node_modules` whose `veloqrs` is the checkout's own,
 * and a landing worktree made beside it the way git makes one: the submodule
 * directory empty and no `node_modules` at all.
 */
function fixture(): Fixture {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'provision-')));
  boxes.push(box);

  const engine = join(box, 'engine');
  mkdirSync(engine);
  git(engine, 'init', '-q', '-b', 'main');
  write(engine, 'lib.rs', 'pub fn one() {}\n');
  git(engine, 'add', '-A');
  git(engine, 'commit', '-qm', 'first');
  const older = git(engine, 'rev-parse', 'HEAD').trim();
  write(engine, 'lib.rs', 'pub fn two() {}\n');
  git(engine, 'commit', '-qam', 'second');
  const pin = git(engine, 'rev-parse', 'HEAD').trim();

  const checkout = join(box, 'veloq');
  mkdirSync(checkout);
  git(checkout, 'init', '-q', '-b', 'main');
  write(checkout, 'modules/veloqrs/index.ts', 'export const engine = 1;\n');
  write(checkout, '.gitignore', 'node_modules/\n');
  git(checkout, 'submodule', 'add', '-q', engine, ENGINE);
  git(checkout, 'add', '-A');
  git(checkout, 'commit', '-qm', 'base');

  write(checkout, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
  symlinkSync(join(checkout, 'modules/veloqrs'), join(checkout, 'node_modules/veloqrs'));

  const landing = join(box, 'veloq-landing');
  git(checkout, 'worktree', 'add', '-q', '--detach', landing, 'HEAD');
  return { box, checkout, landing, engine, older, pin };
}

function provision(fx: Fixture): { status: number; output: string } {
  const result = spawnSync('bash', [SCRIPT, fx.landing, fx.checkout], {
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

const engineHead = (fx: Fixture) => git(join(fx.landing, ENGINE), 'rev-parse', 'HEAD').trim();

describe('the engine submodule', () => {
  it('is checked out at the candidate’s pin, leaving the landing tree clean', () => {
    const fx = fixture();
    expect(readdirSync(join(fx.landing, ENGINE))).toEqual([]);

    const { status, output } = provision(fx);

    expect(output).not.toMatch(/fatal/);
    expect(status).toBe(0);
    expect(engineHead(fx)).toBe(fx.pin);
    expect(git(fx.landing, 'status', '--porcelain').trim()).toBe('');
  });

  it('is moved to the pin when a previous landing left it elsewhere', () => {
    const fx = fixture();
    expect(provision(fx).status).toBe(0);
    git(join(fx.landing, ENGINE), 'checkout', '-q', '--detach', fx.older);
    write(fx.landing, `${ENGINE}/lib.rs`, 'an edit nobody committed\n');

    expect(provision(fx).status).toBe(0);

    expect(engineHead(fx)).toBe(fx.pin);
    expect(git(join(fx.landing, ENGINE), 'status', '--porcelain').trim()).toBe('');
  });

  it('follows a candidate that moves the pin', () => {
    const fx = fixture();
    expect(provision(fx).status).toBe(0);
    git(fx.landing, 'update-index', '--cacheinfo', `160000,${fx.older},${ENGINE}`);
    git(fx.landing, 'commit', '-qm', 'the candidate pins the older engine');

    expect(provision(fx).status).toBe(0);

    expect(engineHead(fx)).toBe(fx.older);
  });

  it('refuses when the main checkout has no engine clone to take it from', () => {
    const fx = fixture();
    git(fx.checkout, 'submodule', 'deinit', '-q', '-f', ENGINE);

    const { status, output } = provision(fx);

    expect(status).not.toBe(0);
    expect(output).toContain(join(fx.checkout, ENGINE));
    expect(readdirSync(join(fx.landing, ENGINE))).toEqual([]);
  });

  it('refuses a pin no clone it knows of holds, naming it', () => {
    const fx = fixture();
    const nowhere = '0123456789abcdef0123456789abcdef01234567';
    git(fx.landing, 'update-index', '--cacheinfo', `160000,${nowhere},${ENGINE}`);
    git(fx.landing, 'commit', '-qm', 'the candidate pins an engine nobody has');

    const { status, output } = provision(fx);

    expect(status).not.toBe(0);
    expect(output).toContain(nowhere);
  });
});

describe('node_modules', () => {
  const link = (fx: Fixture, name: string) => join(fx.landing, 'node_modules', name);

  it('links every package from the main checkout and veloqrs to the landing tree’s own module', () => {
    const fx = fixture();

    expect(provision(fx).status).toBe(0);

    expect(lstatSync(join(fx.landing, 'node_modules')).isSymbolicLink()).toBe(false);
    expect(realpathSync(link(fx, 'left-pad'))).toBe(join(fx.checkout, 'node_modules/left-pad'));
    expect(readlinkSync(link(fx, 'veloqrs'))).toBe(join(fx.landing, 'modules/veloqrs'));
  });

  it('repoints a veloqrs link left on the main checkout’s module', () => {
    const fx = fixture();
    mkdirSync(join(fx.landing, 'node_modules'));
    symlinkSync(join(fx.checkout, 'modules/veloqrs'), link(fx, 'veloqrs'));

    expect(provision(fx).status).toBe(0);

    expect(readlinkSync(link(fx, 'veloqrs'))).toBe(join(fx.landing, 'modules/veloqrs'));
  });

  it('replaces a whole-directory link, leaving the main checkout’s install as it was', () => {
    const fx = fixture();
    symlinkSync(join(fx.checkout, 'node_modules'), join(fx.landing, 'node_modules'));

    expect(provision(fx).status).toBe(0);

    expect(lstatSync(join(fx.landing, 'node_modules')).isSymbolicLink()).toBe(false);
    expect(readlinkSync(link(fx, 'veloqrs'))).toBe(join(fx.landing, 'modules/veloqrs'));
    expect(readlinkSync(join(fx.checkout, 'node_modules/veloqrs'))).toBe(
      join(fx.checkout, 'modules/veloqrs')
    );
  });

  it('picks up a package the main checkout gained since the last landing', () => {
    const fx = fixture();
    expect(provision(fx).status).toBe(0);
    write(fx.checkout, 'node_modules/@scope/late/index.js', 'module.exports = 2;\n');

    expect(provision(fx).status).toBe(0);

    expect(realpathSync(link(fx, '@scope'))).toBe(join(fx.checkout, 'node_modules/@scope'));
  });
});

describe('hooks', () => {
  it('are prepared when the landing tree has none', () => {
    const fx = fixture();
    const prepare = 'mkdir -p .husky/_ && touch .husky/_/prepared';
    write(fx.landing, 'package.json', JSON.stringify({ scripts: { prepare } }));

    expect(provision(fx).status).toBe(0);

    expect(existsSync(join(fx.landing, '.husky/_/prepared'))).toBe(true);
  });
});
