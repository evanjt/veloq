#!/usr/bin/env node
// Find, and with --delete remove, the local branches whose work the target
// already holds.
//
// A branch that lands as a squash or a re-commit, or that was cut before the
// target's history was rewritten, is never an ancestor of the target. `git
// branch -d` and `--merged` judge by ancestry, so they refuse every one of
// them, and the landed branches pile up beside the few that hold the only copy
// of unlanded work. This judges by content instead. A branch's own commits are
// the ones neither the target nor a retired line holds, and the branch has
// landed when it has none, when the target holds the change each one makes,
// when the target holds all of them as one squashed change, or when merging it
// into the target would change nothing.
//
// A change amended while it landed matches nothing in the target, so the
// caller may vouch for a branch with --landed or --landed-file when its record
// says the work landed on a commit the target holds.
//
// Kept whatever its content or the caller's word: the target, a branch checked
// out in any worktree, and a branch the caller names with --keep or
// --keep-file, which is how work still claimed is protected. Only `refs/heads`
// is read or deleted; tags and every other namespace are left alone.
//
// Usage: prune-landed-branches.mjs [--into <ref>] [--keep <branch>]...
//          [--keep-file <path|->] [--landed <branch>]... [--landed-file <path|->]
//          [--delete --rollback <path>]
//
// Prints `landed <branch> <why>` or `keep <branch> <why>` per branch. With
// --delete it first writes every branch and its tip to the rollback note, one
// `<branch> <sha>` per line, and then deletes the landed ones, each only if its
// tip has not moved. `git update-ref refs/heads/<branch> <sha>` puts one back.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// The tags a history rewrite leaves on the line it retired, the same names
// scripts/check-retired-history.sh refuses to merge back. The rewrite carried
// that line's content into the target, so its commits are not a branch's own.
const RETIRED_TAGS = ['refs/tags/pre-squash-*', 'refs/tags/pre-consolidation-*'];

function usage(message) {
  process.stderr.write(`prune-landed-branches: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    into: 'main',
    keep: new Set(),
    vouched: new Set(),
    remove: false,
    rollback: null,
  };
  const readNames = (path, into) => {
    const text = readFileSync(path === '-' ? 0 : path, 'utf8');
    for (const line of text.split('\n')) if (line.trim()) into.add(line.trim());
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      return argv[++i];
    };
    if (arg === '--into') options.into = value();
    else if (arg === '--keep') options.keep.add(value());
    else if (arg === '--keep-file') readNames(value(), options.keep);
    else if (arg === '--landed') options.vouched.add(value());
    else if (arg === '--landed-file') readNames(value(), options.vouched);
    else if (arg === '--delete') options.remove = true;
    else if (arg === '--rollback') options.rollback = value();
    else usage(`unknown argument ${arg}`);
  }
  if (options.remove && !options.rollback) {
    usage('--delete needs --rollback <path>, written before any branch is deleted');
  }
  return options;
}

function git(args, input) {
  const run = spawnSync('git', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 1 << 30,
  });
  if (run.error) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function gitOut(args, input) {
  const run = git(args, input);
  if (run.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${run.stderr.trim()}`);
  }
  return run.stdout;
}

/**
 * The id of one change: its file headers and its added and removed lines, with
 * whitespace dropped as `git patch-id` drops it, but context lines, hunk
 * positions and blob ids left out too. A job dispatched again on a newer base
 * re-commits the same lines inside different context, which `git patch-id`
 * reads as a different patch. An empty change has no id.
 */
function changeId(patch) {
  const hash = createHash('sha1');
  let lines = 0;
  for (const line of patch.split('\n')) {
    if (line === '' || line.startsWith(' ') || line.startsWith('@@') || line.startsWith('index ')) {
      continue;
    }
    hash.update(line.replace(/\s+/g, ''));
    hash.update('\n');
    lines++;
  }
  return lines ? hash.digest('hex') : null;
}

/** The change id of each non-merge commit `log` selects. */
function changeIds(range) {
  const log = gitOut(['log', '-p', '--no-merges', '--format=%x00commit %H', ...range]);
  return log
    .split('\0')
    .map((entry) => changeId(entry.replace(/^commit [0-9a-f]+\n/, '')))
    .filter(Boolean);
}

function branchTips() {
  return gitOut(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '));
}

function checkedOut() {
  const held = new Set();
  for (const line of gitOut(['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('branch refs/heads/')) held.add(line.slice('branch refs/heads/'.length));
  }
  return held;
}

function isAncestor(a, b) {
  return git(['merge-base', '--is-ancestor', a, b]).status === 0;
}

/**
 * The newest point the branch shares with the target or a retired line, the
 * base its own commits sit on. None when the shared points are not on one line.
 */
function ownBase(branch, lines) {
  const bases = lines
    .map((line) => git(['merge-base', line, branch]))
    .filter((run) => run.status === 0)
    .map((run) => run.stdout.trim());
  return bases.find((candidate) => bases.every((other) => isAncestor(other, candidate))) ?? null;
}

function judge(branch, into, intoTree, retired, targetChanges) {
  const not = ['--not', into, ...retired];
  const own = gitOut(['rev-list', branch, ...not])
    .split('\n')
    .filter(Boolean);
  if (own.length === 0)
    return { landed: true, why: 'the target or a retired line holds every commit' };

  const missing = changeIds([branch, ...not]).filter((id) => !targetChanges.has(id));
  if (missing.length === 0) {
    return { landed: true, why: `the target holds all ${own.length} own commits by change` };
  }

  const base = ownBase(branch, [into, ...retired]);
  if (base) {
    const squashed = changeId(gitOut(['diff', base, branch]));
    if (squashed && targetChanges.has(squashed)) {
      return { landed: true, why: `the target holds its ${own.length} own commits as one change` };
    }
    const merged = git(['merge-tree', '--write-tree', `--merge-base=${base}`, into, branch]);
    if (merged.status === 0 && merged.stdout.split('\n')[0] === intoTree) {
      return { landed: true, why: 'merging it into the target changes nothing' };
    }
  }
  return {
    landed: false,
    why: `${missing.length} of ${own.length} own commits hold a change the target lacks`,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const into = git(['rev-parse', '--verify', '--quiet', `${options.into}^{commit}`]);
  if (into.status !== 0) usage(`the target ${options.into} does not resolve to a commit`);
  const intoSha = into.stdout.trim();
  const intoTree = gitOut(['rev-parse', `${intoSha}^{tree}`]).trim();
  const retired = gitOut(['for-each-ref', '--format=%(objectname)', ...RETIRED_TAGS])
    .split('\n')
    .filter(Boolean);
  const targetChanges = new Set(changeIds([intoSha]));
  const held = checkedOut();
  const intoName = options.into.replace(/^refs\/heads\//, '');

  const tips = branchTips();
  const landed = [];
  for (const [branch, sha] of tips) {
    let verdict;
    if (branch === intoName) verdict = { landed: false, why: 'it is the target' };
    else if (held.has(branch)) verdict = { landed: false, why: 'a worktree has it checked out' };
    else if (options.keep.has(branch))
      verdict = { landed: false, why: 'the caller names it as claimed' };
    else if (options.vouched.has(branch))
      verdict = { landed: true, why: 'the caller vouches it landed' };
    else verdict = judge(sha, intoSha, intoTree, retired, targetChanges);
    process.stdout.write(`${verdict.landed ? 'landed' : 'keep'} ${branch} ${verdict.why}\n`);
    if (verdict.landed) landed.push([branch, sha]);
  }

  if (!options.remove) return;
  writeFileSync(options.rollback, tips.map(([branch, sha]) => `${branch} ${sha}\n`).join(''));
  let failed = 0;
  for (const [branch, sha] of landed) {
    const run = git(['update-ref', '-d', `refs/heads/${branch}`, sha]);
    if (run.status !== 0) {
      failed++;
      process.stderr.write(`prune-landed-branches: kept ${branch}: ${run.stderr.trim()}\n`);
    }
  }
  process.stdout.write(
    `deleted ${landed.length - failed} landed branches; ${options.rollback} holds every tip before\n`
  );
  if (failed) process.exitCode = 1;
}

main();
