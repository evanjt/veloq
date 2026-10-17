/**
 * Scenario: a superproject ref pins its engine submodule at a commit that exists
 * only on the pusher's disk. The push succeeds, then every CI checkout fails
 * with `upload-pack: not our ref` and a tagged release never gets a green build.
 *
 * Expected behaviour: `.husky/pre-push` reads the submodule pin at the tip of
 * each pushed ref and refuses it unless the submodule's published repository
 * (the URL in `.gitmodules`, never the local clone's `origin`) holds that commit
 * on a branch or tag. Deleted refs are skipped, and so is a `gate/` ref pushed
 * to the iOS gate's remote, which builds from its own checkout of the submodule.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const ZERO = '0'.repeat(40);
const PIN_PATH = 'modules/veloqrs/rust/tracematch';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function commitIn(repo: string, name: string): string {
  writeFileSync(join(repo, name), `${name}\n`);
  runGit(['add', '-A'], repo);
  runGit(['commit', '-q', '--no-verify', '-m', name], repo);
  return runGit(['rev-parse', 'HEAD'], repo).trim();
}

interface Fixture {
  /** The superproject, holding the hook and its script. */
  superproject: string;
  /** The submodule's working repository, with a bare published remote named `published`. */
  library: string;
  published: string;
}

/** A library whose published remote holds `main` at commit one only. */
function fixture(): Fixture & { one: string } {
  const published = tmp('published-');
  runGit(['init', '-q', '--bare', '-b', 'main'], published);
  const library = tmp('library-');
  runGit(['init', '-q', '-b', 'main'], library);
  const one = commitIn(library, 'one');
  runGit(['remote', 'add', 'published', published], library);
  runGit(['push', '-q', 'published', 'main'], library);

  const superproject = tmp('superproject-');
  runGit(['init', '-q', '-b', 'main'], superproject);
  mkdirSync(join(superproject, '.husky'), { recursive: true });
  mkdirSync(join(superproject, 'scripts'), { recursive: true });
  copyFileSync(join(ROOT, '.husky/pre-push'), join(superproject, '.husky/pre-push'));
  for (const script of ['check-no-private-data.sh', 'check-submodule-pin-pushed.sh']) {
    copyFileSync(join(ROOT, 'scripts', script), join(superproject, 'scripts', script));
  }
  writeFileSync(
    join(superproject, '.gitmodules'),
    `[submodule "${PIN_PATH}"]\n\tpath = ${PIN_PATH}\n\turl = ${published}\n`
  );
  return { superproject, library, published, one };
}

/** Commit a superproject state whose submodule pin is `sha`; returns the commit. */
function pin(superproject: string, sha: string): string {
  runGit(['update-index', '--add', '--cacheinfo', `160000,${sha},${PIN_PATH}`], superproject);
  runGit(['add', '.gitmodules', '.husky', 'scripts'], superproject);
  runGit(['commit', '-q', '--no-verify', '-m', `pin ${sha.slice(0, 7)}`], superproject);
  return runGit(['rev-parse', 'HEAD'], superproject).trim();
}

function push(
  superproject: string,
  ref: string,
  local: string,
  remote = ZERO,
  remoteName = 'origin'
): { status: number; stderr: string } {
  try {
    execFileSync('sh', ['.husky/pre-push', remoteName, 'url'], {
      cwd: superproject,
      env: gitFreeEnv(),
      input: `${ref} ${local} ${ref} ${remote}\n`,
      stdio: 'pipe',
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status: number; stderr: Buffer };
    return { status: failure.status, stderr: failure.stderr.toString() };
  }
}

describe('submodule pin published check in pre-push', () => {
  it('refuses a ref whose pin exists only on the pusher disk, naming the sha and the fix', () => {
    const { superproject, library } = fixture();
    const local = commitIn(library, 'two');
    const tip = pin(superproject, local);

    const result = push(superproject, 'refs/heads/main', tip);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(local);
    expect(result.stderr).toContain(`git -C ${PIN_PATH} push origin ${local}:main`);
  });

  it('passes a ref pinned at the published tip', () => {
    const { superproject, one } = fixture();
    const tip = pin(superproject, one);

    expect(push(superproject, 'refs/heads/main', tip).status).toBe(0);
  });

  it('passes a pin that is an ancestor of a published branch, not only its tip', () => {
    const { superproject, library, one } = fixture();
    commitIn(library, 'two');
    runGit(['push', '-q', 'published', 'main'], library);
    const tip = pin(superproject, one);

    expect(push(superproject, 'refs/heads/main', tip).status).toBe(0);
  });

  it('passes a pin that only a published tag holds', () => {
    const { superproject, library } = fixture();
    runGit(['checkout', '-q', '-b', 'release'], library);
    const onTag = commitIn(library, 'two');
    runGit(['tag', 'r1'], library);
    runGit(['push', '-q', 'published', 'r1'], library);
    const tip = pin(superproject, onTag);

    expect(push(superproject, 'refs/heads/main', tip).status).toBe(0);
  });

  it('refuses a pin on a published branch that was force-moved away from it', () => {
    const { superproject, library, published, one } = fixture();
    runGit(['checkout', '-q', '-b', 'rewritten'], library);
    const rewritten = commitIn(library, 'rewritten');
    runGit(['push', '-q', 'published', 'rewritten'], library);
    runGit(['update-ref', '-d', 'refs/heads/rewritten'], published);
    expect(one).not.toBe(rewritten);
    const tip = pin(superproject, rewritten);

    expect(push(superproject, 'refs/heads/main', tip).status).toBe(1);
  });

  it('checks the first push of a branch the remote has never seen', () => {
    const { superproject, library } = fixture();
    const tip = pin(superproject, commitIn(library, 'two'));

    expect(push(superproject, 'refs/heads/feature', tip, ZERO).status).toBe(1);
  });

  it('checks an annotated tag push the same way', () => {
    const { superproject, library } = fixture();
    const tip = pin(superproject, commitIn(library, 'two'));
    runGit(['tag', '-a', '-m', 'release', 'v9.9.9'], superproject);
    const tag = runGit(['rev-parse', 'v9.9.9'], superproject).trim();
    expect(tag).not.toBe(tip);

    const result = push(superproject, 'refs/tags/v9.9.9', tag);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(runGit(['rev-parse', 'HEAD:' + PIN_PATH], superproject).trim());
  });

  it('skips a deleted ref', () => {
    const { superproject, library } = fixture();
    const unpublished = pin(superproject, commitIn(library, 'two'));

    expect(push(superproject, 'refs/heads/old', ZERO, unpublished).status).toBe(0);
  });

  it('passes a ref whose tree has no submodule pin', () => {
    const { superproject } = fixture();
    writeFileSync(join(superproject, 'readme.txt'), 'plain\n');
    runGit(['add', 'readme.txt', '.husky', 'scripts'], superproject);
    runGit(['commit', '-q', '--no-verify', '-m', 'plain'], superproject);
    const tip = runGit(['rev-parse', 'HEAD'], superproject).trim();

    expect(push(superproject, 'refs/heads/main', tip).status).toBe(0);
  });

  it('refuses when the published repository cannot be read', () => {
    const { superproject, one, published } = fixture();
    const tip = pin(superproject, one);
    rmSync(published, { recursive: true, force: true });

    const result = push(superproject, 'refs/heads/main', tip);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(published);
  });

  it('skips a gate ref pushed to the iOS gate remote, which builds from its own submodule checkout', () => {
    const { superproject, library } = fixture();
    runGit(['config', 'veloq.iosGateRemote', 'mac'], superproject);
    const tip = pin(superproject, commitIn(library, 'two'));

    expect(push(superproject, 'refs/heads/gate/main', tip, ZERO, 'mac').status).toBe(0);
  });

  it('still checks a branch outside gate/ pushed to the iOS gate remote', () => {
    const { superproject, library } = fixture();
    runGit(['config', 'veloq.iosGateRemote', 'mac'], superproject);
    const tip = pin(superproject, commitIn(library, 'two'));

    expect(push(superproject, 'refs/heads/main', tip, ZERO, 'mac').status).toBe(1);
  });

  it('still checks a gate ref pushed to a remote that is not the iOS gate remote', () => {
    const { superproject, library } = fixture();
    runGit(['config', 'veloq.iosGateRemote', 'mac'], superproject);
    const tip = pin(superproject, commitIn(library, 'two'));

    expect(push(superproject, 'refs/heads/gate/main', tip).status).toBe(1);
  });
});
