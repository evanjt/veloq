/**
 * Scenario: a branch lands as a squash or a re-commit, or was cut before the
 * target's history was rewritten, so it is never an ancestor of the target.
 * `git branch -d` and `--merged` judge by ancestry, refuse every such branch,
 * and the landed ones pile up beside the few that hold the only copy of
 * unlanded work, with nothing to tell the two apart.
 *
 * Expected behaviour: `scripts/prune-landed-branches.mjs` judges a branch
 * landed by content: the target holds the lines each of its own commits
 * changes, or all of them as one squashed change, or merging it would change
 * nothing. A branch holding a patch
 * the target lacks, a branch checked out in a worktree and a branch the caller
 * names as claimed are kept. Deleting writes a rollback note of every branch
 * first, and nothing outside `refs/heads` is touched.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/prune-landed-branches.mjs');

const boxes: string[] = [];

afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

function git(repo: string, ...args: string[]): string {
  return runGit(args, repo).trim();
}

function commitFile(repo: string, path: string, contents: string, subject: string): void {
  writeFileSync(join(repo, path), contents);
  git(repo, 'add', path);
  git(repo, 'commit', '-q', '-m', subject);
}

function prune(repo: string, ...args: string[]) {
  const run = spawnSync('node', [SCRIPT, ...args], {
    cwd: repo,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function branches(repo: string): string[] {
  return git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort();
}

/**
 * A garden ledger whose `trunk` has taken some branches by squash, one by
 * re-commit and one by plain merge, and lacks one branch's patch entirely.
 */
function ledger(): { repo: string; box: string } {
  const box = mkdtempSync(join(tmpdir(), 'prune-landed-'));
  boxes.push(box);
  const repo = join(box, 'ledger');
  runGit(['init', '-q', '-b', 'trunk', repo], box);
  commitFile(repo, 'beds.txt', 'tomato\nbasil\n', 'Plant the first beds');
  commitFile(repo, 'tools.txt', 'spade\n', 'List the shed tools');
  commitFile(repo, 'rows.txt', 'onion\ngarlic\nshallot\n', 'Plan the allium rows');

  git(repo, 'checkout', '-q', '-b', 'redispatched');
  commitFile(repo, 'rows.txt', 'onion\ngarlic\nchive\n', 'Swap shallots for chives');
  git(repo, 'checkout', '-q', 'trunk');

  git(repo, 'checkout', '-q', '-b', 'squashed');
  commitFile(repo, 'beds.txt', 'tomato\nbasil\nchard\n', 'Add chard');
  commitFile(repo, 'beds.txt', 'tomato\nbasil\nchard\nleek\n', 'Add leek');

  git(repo, 'checkout', '-q', 'trunk');
  git(repo, 'checkout', '-q', '-b', 'recommitted');
  commitFile(repo, 'tools.txt', 'spade\nrake\n', 'Add the rake');

  git(repo, 'checkout', '-q', 'trunk');
  git(repo, 'checkout', '-q', '-b', 'unlanded');
  commitFile(repo, 'compost.txt', 'leaves\n', 'Start the compost heap');

  git(repo, 'checkout', '-q', 'trunk');
  git(repo, 'checkout', '-q', '-b', 'merged');
  commitFile(repo, 'water.txt', 'tuesday\n', 'Water on tuesdays');

  git(repo, 'checkout', '-q', 'trunk');
  git(repo, 'checkout', '-q', '-b', 'claimed');
  commitFile(repo, 'seeds.txt', 'pea\n', 'Order the peas');
  git(repo, 'checkout', '-q', 'trunk');

  git(repo, 'checkout', '-q', '-b', 'in-a-tree');
  commitFile(repo, 'fence.txt', 'north\n', 'Mend the north fence');
  git(repo, 'checkout', '-q', 'trunk');

  // The same change made again on a newer base, so its context differs, then
  // edited further, so neither git's patch-id nor a merge reads it as landed.
  commitFile(repo, 'rows.txt', 'leek\ngarlic\nshallot\n', 'Swap onions for leeks');
  commitFile(repo, 'rows.txt', 'leek\ngarlic\nchive\n', 'Swap shallots for chives');
  commitFile(repo, 'rows.txt', 'leek\ngarlic\nchives\n', 'Plural chives');
  git(repo, 'merge', '-q', '--squash', 'squashed');
  git(repo, 'commit', '-q', '-m', 'Add chard and leek');
  git(repo, 'cherry-pick', 'recommitted');
  git(repo, 'merge', '-q', '--squash', 'claimed');
  git(repo, 'commit', '-q', '-m', 'Order the peas');
  git(repo, 'merge', '-q', '--squash', 'in-a-tree');
  git(repo, 'commit', '-q', '-m', 'Mend the north fence');
  git(repo, 'merge', '-q', '--no-ff', 'merged', '-m', 'Merge the watering day');
  // A later edit to the squashed lines, so merging the squashed branch again
  // would no longer leave the target unchanged and only its patch says landed.
  commitFile(repo, 'beds.txt', 'tomato\nbasil\nchard\nleek\nbean\n', 'Add beans');
  runGit(['-C', repo, 'worktree', 'add', '-q', join(box, 'fence-tree'), 'in-a-tree'], box);
  git(repo, 'tag', 'harvest-2025');
  git(repo, 'update-ref', 'refs/archive/old-shed', git(repo, 'rev-parse', 'unlanded'));
  return { repo, box };
}

describe('prune-landed-branches', () => {
  it('names the landed branches and keeps the rest without deleting anything', () => {
    const { repo } = ledger();
    const before = branches(repo);
    const run = prune(repo, '--into', 'trunk', '--keep', 'claimed');
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    const landed = run.stdout.split('\n').filter((line) => line.startsWith('landed '));
    const kept = run.stdout.split('\n').filter((line) => line.startsWith('keep '));
    expect(landed.map((line) => line.split(' ')[1]).sort()).toEqual([
      'merged',
      'recommitted',
      'redispatched',
      'squashed',
    ]);
    expect(kept.map((line) => line.split(' ')[1]).sort()).toEqual([
      'claimed',
      'in-a-tree',
      'trunk',
      'unlanded',
    ]);
    expect(run.stdout).toMatch(/^landed squashed .*as one change$/m);
    expect(branches(repo)).toEqual(before);
  });

  it('deletes only the landed branches, after writing a rollback note of every branch', () => {
    const { repo, box } = ledger();
    const archived = git(repo, 'rev-parse', 'refs/archive/old-shed');
    const tips = new Map(branchTips(repo));
    const rollback = join(box, 'rollback.txt');
    const run = prune(
      repo,
      '--into',
      'trunk',
      '--keep',
      'claimed',
      '--delete',
      '--rollback',
      rollback
    );
    expect(run.status).toBe(0);
    expect(branches(repo)).toEqual(['claimed', 'in-a-tree', 'trunk', 'unlanded']);
    expect(git(repo, 'rev-parse', 'refs/archive/old-shed')).toBe(archived);
    expect(git(repo, 'rev-parse', 'refs/tags/harvest-2025')).toBeTruthy();
    const noted = readFileSync(rollback, 'utf8').trim().split('\n');
    expect(new Map(noted.map((line) => line.split(' ') as [string, string]))).toEqual(tips);
  });

  it('reads claimed branches from a file, one per line', () => {
    const { repo, box } = ledger();
    const claims = join(box, 'claims.txt');
    writeFileSync(claims, 'claimed\n\n');
    const run = prune(repo, '--into', 'trunk', '--keep-file', claims);
    expect(run.stdout).toMatch(/^keep claimed /m);
  });

  it("takes the caller's word that a branch landed, but never over a claim or a worktree", () => {
    const { repo, box } = ledger();
    const vouched = join(box, 'vouched.txt');
    writeFileSync(vouched, 'unlanded\nin-a-tree\n');
    const run = prune(
      repo,
      '--into',
      'trunk',
      '--keep',
      'claimed',
      '--landed',
      'claimed',
      '--landed-file',
      vouched
    );
    expect(run.stdout).toMatch(/^landed unlanded the caller vouches it landed$/m);
    expect(run.stdout).toMatch(/^keep claimed /m);
    expect(run.stdout).toMatch(/^keep in-a-tree /m);
  });

  it('refuses to delete without a rollback note', () => {
    const { repo } = ledger();
    const before = branches(repo);
    const run = prune(repo, '--into', 'trunk', '--delete');
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/--rollback/);
    expect(branches(repo)).toEqual(before);
  });

  it('refuses a target that does not resolve', () => {
    const { repo } = ledger();
    const run = prune(repo, '--into', 'no-such-branch');
    expect(run.status).toBe(2);
    expect(run.stderr).toMatch(/no-such-branch/);
  });

  it('counts a branch cut before a rewrite as landed when only the retired line holds its commits', () => {
    const { repo } = ledger();
    git(repo, 'checkout', '-q', '-b', 'old-line', 'trunk~3');
    commitFile(repo, 'shed.txt', 'paint\n', 'Paint the shed');
    git(repo, 'tag', 'pre-squash-2025-11-01');
    git(repo, 'checkout', '-q', '-b', 'cut-before', 'old-line');
    git(repo, 'checkout', '-q', '-b', 'cut-before-with-work', 'old-line');
    commitFile(repo, 'gate.txt', 'oil hinges\n', 'Oil the gate');
    git(repo, 'checkout', '-q', 'trunk');
    commitFile(repo, 'shed.txt', 'paint\n', 'Paint the shed in the rewritten line');
    const run = prune(repo, '--into', 'trunk', '--keep', 'claimed');
    expect(run.stdout).toMatch(/^landed cut-before /m);
    expect(run.stdout).toMatch(/^landed old-line /m);
    expect(run.stdout).toMatch(/^keep cut-before-with-work /m);
  });
});

function branchTips(repo: string): [string, string][] {
  return git(repo, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads')
    .split('\n')
    .map((line) => line.split(' ') as [string, string]);
}
