/**
 * Scenario: `core.bare` was set true on the main checkout on 2026-09-15, on a
 * repository with a working tree and seven worktrees hanging off it. Every
 * `git status`, commit and merge in that checkout answered "this operation must
 * be run in a work tree", which names neither the key nor the repository, and a
 * merge retry loop read it as transient and kept going for minutes. Worktrees
 * were unaffected, so it was invisible from anywhere else.
 *
 * Expected behaviour: the guard names the key and the checkout, and stays quiet
 * on a healthy tree and on a genuinely bare clone with no working tree.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-worktree-config.mjs');

function git(root: string, ...args: string[]) {
  runGit(args, root);
}

function checkout(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-bare-'));
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), 'x\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.email=g@t', '-c', 'user.name=G', 'commit', '-qm', 'first');
  return root;
}

function runGuard(root: string) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [GUARD, '--root', root], {
        encoding: 'utf8',
        env: gitFreeEnv(),
      }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('the work tree config guard', () => {
  it('is quiet on a checkout with a working tree', () => {
    expect(runGuard(checkout()).code).toBe(0);
  });

  it('refuses a checkout marked bare that still has a working tree', () => {
    const root = checkout();
    git(root, 'config', '--local', 'core.bare', 'true');

    const { code, out } = runGuard(root);
    expect(code).toBe(1);
    expect(out).toContain('core.bare');
    expect(out).toContain(root);
    // The repair, not just the diagnosis.
    expect(out).toContain('config --local core.bare false');
  });

  it('is quiet on a repository that really is bare', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-really-bare-'));
    git(root, 'init', '-q', '--bare');

    expect(runGuard(root).code).toBe(0);
  });

  it('is quiet where there is no repository at all', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-no-repo-'));

    expect(runGuard(root).code).toBe(0);
  });
});

/**
 * Scenario: the same leak that wrote `core.bare` wrote an identity. A fixture's
 * `git config user.email guard@test`, run with the hook's `GIT_DIR` still in
 * its environment, landed on the main checkout, and 78 commits went out
 * authored `Guard <guard@test>` before anyone read the config. The global
 * identity was right the whole time and the local key beat it silently.
 *
 * Expected behaviour: the guard names a local identity in a reserved test
 * domain, which is a fixture's and never a person's, and leaves a real one
 * alone.
 */
describe('a fixture identity left on the checkout', () => {
  it('is refused, with the key, the checkout and the repair', () => {
    const root = checkout();
    git(root, 'config', '--local', 'user.email', 'guard@test');

    const { code, out } = runGuard(root);
    expect(code).toBe(1);
    expect(out).toContain('user.email');
    expect(out).toContain('guard@test');
    expect(out).toContain(root);
    expect(out).toContain('config --local --unset user.email');
  });

  it('reads every reserved domain, not only the one that bit', () => {
    for (const email of [
      'fixture@veloq.invalid',
      'a@b.test',
      'a@localhost',
      'a@something.example',
    ]) {
      const root = checkout();
      git(root, 'config', '--local', 'user.email', email);

      expect(runGuard(root).code).toBe(1);
    }
  });

  it('leaves a real local identity alone, which is somebody deliberately set', () => {
    const root = checkout();
    git(root, 'config', '--local', 'user.email', 'evan@evanjt.com');

    expect(runGuard(root).code).toBe(0);
  });

  it('says so when both the bare flag and the identity are wrong', () => {
    const root = checkout();
    git(root, 'config', '--local', 'core.bare', 'true');
    git(root, 'config', '--local', 'user.email', 'guard@test');

    const { code, out } = runGuard(root);
    expect(code).toBe(1);
    expect(out).toContain('core.bare');
    expect(out).toContain('user.email');
  });
});
