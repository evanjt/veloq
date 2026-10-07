/**
 * Scenario: a branch that merged the integration branch into itself first,
 * which is how a branch stays current, merges back as a fast-forward. Git runs
 * `pre-merge-commit` only for a merge that creates a commit, so a fast-forward
 * made by hand runs no gate at all. `scripts/land-branch.sh` gates its
 * candidate before it fast-forwards, so its own move is covered.
 *
 * Expected behaviour: `post-merge` warns about a fast-forward nothing gated and
 * points at the lander, stays quiet for a merge that made a commit and for the
 * candidate the lander gated, and runs no battery itself, since after the ref
 * has moved it cannot refuse.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitFreeEnv } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const hook = (name: string) => readFileSync(join(ROOT, '.husky', name), 'utf8');

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
}

/** Both streams of a merge, with the lander's switch when one is given. */
function merge(cwd: string, args: string, gated?: string): string {
  return execFileSync('sh', ['-c', `git merge ${args} 2>&1`], {
    env: { ...gitFreeEnv(), ...(gated ? { VELOQ_LANDING_GATED: gated } : {}) },
    cwd,
    encoding: 'utf8',
  });
}

/** A repository carrying this project's own post-merge hook and a battery that marks that it ran. */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ffmerge-'));
  mkdirSync(join(dir, 'hooks'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'hooks/post-merge'), hook('post-merge'), { mode: 0o755 });
  writeFileSync(join(dir, 'scripts/merge-gates.sh'), '#!/bin/sh\ntouch "$PWD/gates-ran"\n', {
    mode: 0o755,
  });
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'core.hooksPath', 'hooks');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'file'), 'base\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

let dir = '';

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

/** A branch one commit ahead, so merging it back is a fast-forward. */
function ahead(): string {
  dir = scratchRepo();
  const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  git(dir, 'checkout', '-q', '-b', 'branch');
  writeFileSync(join(dir, 'file'), 'ahead\n');
  git(dir, 'commit', '-q', '-am', 'ahead');
  git(dir, 'checkout', '-q', base);
  return base;
}

/** The landing shape: a merge built elsewhere, then fast-forwarded onto. */
function landed(): string {
  dir = scratchRepo();
  const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  git(dir, 'checkout', '-q', '-b', 'branch');
  writeFileSync(join(dir, 'other'), 'theirs\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'theirs');
  git(dir, 'checkout', '-q', '-b', 'staging', base);
  git(dir, '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '--no-edit', 'branch');
  git(dir, 'checkout', '-q', base);
  return git(dir, 'rev-parse', 'staging').trim();
}

describe('a fast-forward made by hand', () => {
  it('lands, warns that no gate ran, and names the lander that gates first', () => {
    ahead();
    const before = git(dir, 'rev-parse', '--short', 'HEAD').trim();

    const said = merge(dir, '--no-edit branch');

    expect(said).toMatch(/Fast-forward/);
    expect(said).toMatch(/no gate ran/i);
    expect(said).toContain('land-branch.sh');
    expect(said).toContain(`VELOQ_MERGE_BASE=${before} ./scripts/merge-gates.sh`);
  });

  it('runs no battery, since after the ref has moved it cannot refuse', () => {
    ahead();

    merge(dir, '--no-edit branch');

    expect(existsSync(join(dir, 'gates-ran'))).toBe(false);
  });

  it('warns onto a merge commit too, which is what a hand-made landing looks like', () => {
    landed();

    const said = merge(dir, '--ff-only staging');

    expect(git(dir, 'rev-parse', 'HEAD^2').trim().length).toBeGreaterThan(0);
    expect(said).toMatch(/no gate ran/i);
  });
});

describe('a move something already gated', () => {
  it('stays quiet for a merge that made a commit, which pre-merge-commit gated', () => {
    dir = scratchRepo();
    const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'branch');
    writeFileSync(join(dir, 'other'), 'theirs\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'theirs');
    git(dir, 'checkout', '-q', base);
    writeFileSync(join(dir, 'file'), 'ours\n');
    git(dir, 'commit', '-q', '-am', 'ours');

    const said = merge(dir, '--no-edit --no-ff branch');

    expect(said).not.toMatch(/no gate ran/i);
    expect(existsSync(join(dir, 'gates-ran'))).toBe(false);
  });

  it('stays quiet for the candidate the lander gated', () => {
    const candidate = landed();

    const said = merge(dir, '--ff-only staging', candidate);

    expect(said).not.toMatch(/no gate ran/i);
  });

  it('still warns when the lander’s gated candidate is not where the ref landed', () => {
    const candidate = landed();
    git(dir, 'checkout', '-q', 'staging');
    writeFileSync(join(dir, 'file'), 'after the gate\n');
    git(dir, 'commit', '-q', '-am', 'after the gate');
    git(dir, 'checkout', '-q', '-');

    const said = merge(dir, '--ff-only staging', candidate);

    expect(said).toMatch(/no gate ran/i);
  });
});
