/**
 * Scenario: a branch that merged the integration branch into itself first,
 * which is how a branch stays current, merges back as a fast-forward. Git runs
 * `pre-merge-commit` only for a merge that creates a commit, so for that whole
 * class it runs nothing, and every whole-tree guard the hook holds is skipped.
 * It is the class worked in a worktree, whose own commits ran no hooks either.
 *
 * Expected behaviour: `post-merge`, which does fire on a fast-forward, runs the
 * same battery and says loudly that nothing gated the merge. It cannot refuse,
 * the ref has already moved, so saying so is the whole job.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const hook = (name: string) => readFileSync(join(ROOT, '.husky', name), 'utf8');

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
    },
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

describe('a fast-forward merge is gated after the fact, since it cannot be gated before', () => {
  let dir = '';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('runs the battery when the merge created no commit, so no hook gated it', () => {
    dir = scratchRepo();
    const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'branch');
    writeFileSync(join(dir, 'file'), 'ahead\n');
    git(dir, 'commit', '-q', '-am', 'ahead');
    git(dir, 'checkout', '-q', base);

    const out = git(dir, 'merge', '--no-edit', 'branch');

    expect(out).toMatch(/Fast-forward/);
    expect(existsSync(join(dir, 'gates-ran'))).toBe(true);
  });

  it('says so, rather than passing quietly, because nothing ran before the ref moved', () => {
    dir = scratchRepo();
    const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'branch');
    writeFileSync(join(dir, 'file'), 'ahead\n');
    git(dir, 'commit', '-q', '-am', 'ahead');
    git(dir, 'checkout', '-q', base);

    const said = execFileSync('sh', ['-c', 'git merge --no-edit branch 2>&1'], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(said).toMatch(/no gate ran/i);
  });

  it('stays out of the way of a merge that made a commit, which pre-merge-commit already gated', () => {
    dir = scratchRepo();
    const base = git(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
    git(dir, 'checkout', '-q', '-b', 'branch');
    writeFileSync(join(dir, 'other'), 'theirs\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'theirs');
    git(dir, 'checkout', '-q', base);
    writeFileSync(join(dir, 'file'), 'ours\n');
    git(dir, 'commit', '-q', '-am', 'ours');

    git(dir, 'merge', '--no-edit', '--no-ff', 'branch');

    expect(existsSync(join(dir, 'gates-ran'))).toBe(false);
  });

  /**
   * One battery, two hooks. A gate that lives in only one of them is the hole
   * this item is about, so the two must not drift apart.
   */
  it('runs the same battery the merge commit path runs', () => {
    expect(hook('post-merge')).toMatch(/merge-gates\.sh/);
    expect(hook('pre-merge-commit')).toMatch(/merge-gates\.sh/);
  });
});
