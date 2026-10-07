#!/usr/bin/env node
// A tracematch pointer that moves the bitwise golden must move DETECTOR_REVISION.
//
// The golden is the record of what the detector cuts, and it lives in the
// tracematch submodule. `DETECTOR_REVISION` lives in veloqrs and is folded into
// the section config digest, so a bump is what drops the evidence cache the old
// detector wrote. A pointer bump that changes the golden and leaves the
// revision alone ships a new detector over the old cache.
//
// The check compares what a commit made now would record against `HEAD`: the
// staged pointer, the golden at each pointed commit, and the staged revision.
// Both commits have to be in the local submodule clone to compare the golden.
// When one is not, the guard says so and passes: a fresh worktree or CI runner
// holds no submodule, and the commit that moved the pointer was checked where it
// was made.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

const SUB = 'modules/veloqrs/rust/tracematch';
const GOLDEN = 'tests/fixtures/geolife_bitwise_golden.txt';
const REVISION_FILE = 'modules/veloqrs/rust/veloqrs/src/persistence/sections/mod.rs';
const REVISION = /pub const DETECTOR_REVISION:\s*u32\s*=\s*(\d+)\s*;/;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const staged = /^160000 ([0-9a-f]{40}) /.exec(git(['ls-files', '-s', '--', SUB], root) ?? '')?.[1];
const recorded = /^160000 commit ([0-9a-f]{40})\t/.exec(
  git(['ls-tree', 'HEAD', SUB], root) ?? ''
)?.[1];

if (!staged || !recorded || staged === recorded) process.exit(0);

const sub = join(root, SUB);
const short = (sha) => sha.slice(0, 7);
const held = (sha) =>
  existsSync(join(sub, '.git')) && git(['cat-file', '-e', `${sha}^{commit}`], sub) !== null;

if (!held(staged) || !held(recorded)) {
  console.log(
    `Detector revision not compared: the tracematch clone does not hold ${short(recorded)} and ${short(staged)}.`
  );
  process.exit(0);
}

const golden = (sha) => git(['rev-parse', '--verify', '-q', `${sha}:${GOLDEN}`], sub) ?? '';
if (golden(recorded) === golden(staged)) process.exit(0);

const revisionOf = (text) => REVISION.exec(text ?? '')?.[1];
const before = revisionOf(git(['show', `HEAD:${REVISION_FILE}`], root));
const after = revisionOf(git(['show', `:${REVISION_FILE}`], root));

if (before === undefined || after === undefined) {
  console.error(`DETECTOR_REVISION was not found in ${REVISION_FILE}, so it cannot be compared.`);
  process.exit(1);
}
if (before !== after) process.exit(0);

console.error(
  `The bitwise golden moved from ${short(recorded)} to ${short(staged)} and DETECTOR_REVISION is still ${after}.`
);
console.error('');
console.error('A detector that cuts different sections needs a new revision, or upgraded installs');
console.error('adopt the evidence cache the old detector wrote. Bump it in the same commit:');
console.error(`  ${REVISION_FILE}`);
process.exit(1);

function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      env: GIT_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
