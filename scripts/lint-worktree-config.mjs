#!/usr/bin/env node
// Config a leak wrote onto the main checkout, which nothing else shows.
//
// Both keys read here arrived the same way: a Jest fixture ran `git config`
// with the hook's `GIT_DIR` still in its environment, and that beats `cwd`, so
// the write landed on the real repository rather than on the fixture. `B1068`
// closed that channel. This reads the damage, because both keys are cheap to
// read and both failures are expensive to diagnose.
//
// On 2026-09-15 `core.bare` was true on the main checkout, a repository with a
// working tree and seven `audit/*` worktrees hanging off it. Every `git status`,
// commit and merge there answered "fatal: this operation must be run in a work
// tree", which names neither the key nor the repository, and a merge retry loop
// read it as a transient error and kept going for minutes. Worktrees were
// unaffected, so nothing anywhere else showed it.
//
// The same leak wrote `user.email = guard@test`, and 78 commits went out under
// it before anyone read the config: a local identity beats the global one and
// announces nothing, so the only signal was in `git log`.
//
// A repository that really is bare, with no working tree, is a legitimate shape
// and is left alone. Nothing here runs in one.

import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';

// The pre-commit hook exports GIT_DIR and GIT_COMMON_DIR, and those win over
// `cwd`, so a guard pointed at a fixture would read the real repository.
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_WORK_TREE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  return env;
})();

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

// RFC 2606 and RFC 6761 reserve these, so no person's address ends in one and
// every fixture's does. Matching the shape rather than a list of known fixture
// addresses means the next fixture is caught too.
const RESERVED = ['test', 'example', 'invalid', 'localhost'];

// `--show-toplevel` is the obvious question and it is the one git refuses once
// `core.bare` is set, which is the symptom rather than the test. The git
// directory answers either way, and its name is the discriminator: a checkout
// keeps its repository in a `.git` beside the tree, a repository that really is
// bare is the directory itself. A linked worktree's common dir is the main
// checkout's, so this fires from anywhere, which is the point: the breakage is
// in the main checkout and invisible from every worktree.
const gitDir = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const reallyBare = gitDir !== '' && basename(gitDir) !== '.git';
const toplevel = gitDir === '' ? root : dirname(gitDir);

const problems = [];

// A repository that really is bare, with no working tree, is a legitimate shape
// and nothing here runs in one.
if (!reallyBare && git(['config', '--local', '--get', 'core.bare']) === 'true') {
  problems.push([
    'core.bare is true on a checkout that has a working tree:',
    `  ${toplevel}`,
    '',
    'Every git command with a working tree fails there, naming neither this',
    'key nor the repository, and the worktrees hanging off it are unaffected',
    'so nothing else shows it. Put it back:',
    `  git -C ${toplevel} config --local core.bare false`,
  ]);
}

const email = git(['config', '--local', '--get', 'user.email']);
const domain = email.split('@')[1] ?? '';
const label = domain.split('.').pop()?.toLowerCase() ?? '';
if (email !== '' && RESERVED.includes(label)) {
  problems.push([
    `user.email is a fixture's on this checkout, not a person's:`,
    `  ${toplevel}`,
    `  user.email = ${email}`,
    '',
    'A local identity beats the global one and nothing announces it, so every',
    'commit and merge from here carries it. Seventy-eight did on 2026-09-15.',
    'Take it off and the global identity answers again:',
    `  git -C ${toplevel} config --local --unset user.email`,
    `  git -C ${toplevel} config --local --unset user.name`,
  ]);
}

if (problems.length === 0) {
  console.log('Work tree config: no leaked keys on the checkout.');
  process.exit(0);
}

for (const [index, lines] of problems.entries()) {
  if (index > 0) console.error('');
  for (const line of lines) console.error(line);
}
process.exit(1);

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}
