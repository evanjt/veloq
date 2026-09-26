// The tracked files and their bytes, both out of the index.
//
// Every worktree merges through one checkout and the whole-tree guards run
// there on every commit and every merge, so a guard that lists the index but
// reads the bytes off the disk judges whichever session happens to have a file
// open. On 2026-09-15 two em dashes inside another session's in-flight binding
// regeneration failed `npm run audit` for the fleet, on a file nobody was
// merging. That is `B922`'s defect, which the lint ceiling was fixed for, and
// it was still live in three guards written after it.
//
// The bytes come back as buffers rather than strings: a guard has to tell text
// from a binary blob before it decodes, and the index holds both.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `cwd` does not decide which repository git reads. The pre-commit hook exports
// GIT_DIR and GIT_INDEX_FILE, and those win, so a guard pointed at a fixture
// with --root would list the repository's own files instead. Drop them.
const INHERITED = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_COMMON_DIR',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_CEILING_DIRECTORIES',
];

/** `process.env` with every inherited git pointer removed. */
export function gitFreeEnv(base = process.env) {
  const env = { ...base };
  for (const key of INHERITED) delete env[key];
  return env;
}

function git(root, args, input) {
  return execFileSync('git', args, {
    cwd: root,
    env: gitFreeEnv(),
    input,
    // A generated blob is megabytes and the listings are long. The default
    // 1 MB is what failed elsewhere, so this is room rather than a limit.
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
}

/**
 * The tracked paths under `pathspec`, each with the bytes the index holds.
 *
 * A path the index lists but has no blob for, which is a submodule entry,
 * is left out rather than reported: there is nothing to read.
 */
export function indexedSources(root, pathspec = []) {
  const files = git(root, ['ls-files', '-z', '--', ...pathspec], undefined)
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  if (files.length === 0) return new Map();

  // One `cat-file` for the lot: a process per file is thousands of processes.
  //
  // `-z` so the requests are NUL-delimited, the way `ls-files -z` answered. A
  // path holding a newline is two requests to a line-delimited `--batch`, and
  // the replies then stop matching the requests: the walk below reads a header
  // where a blob should be, gives up, and hands back a short map. Every guard
  // over this judges only what it returns, so the files after the odd one were
  // reported clean without being read.
  const batch = git(root, ['cat-file', '--batch', '-z'], files.map((file) => `:${file}\0`).join(''));

  const sources = new Map();
  let at = 0;
  let read = 0;
  for (const file of files) {
    const newline = batch.indexOf(0x0a, at);
    if (newline === -1) break;
    const header = batch.subarray(at, newline).toString('utf8');
    const parts = header.split(' ');
    read += 1;
    // Anything that is not a blob answers with a header and no body, and the
    // walk has to step over the one line rather than read a length. Two shapes:
    // `<path> missing` for a path the index does not hold, and `<sha> submodule`
    // for a gitlink, which is what `modules/veloqrs/rust/tracematch` is. Reading
    // the submodule's header as a blob's is what stopped the walk at file 730 of
    // 3,022 and left everything sorting after it unread.
    const size = Number(parts[2]);
    if (!Number.isFinite(size)) {
      at = newline + 1;
      continue;
    }
    const start = newline + 1;
    sources.set(file, batch.subarray(start, start + size));
    at = start + size + 1;
  }

  // A reply that does not answer every request means the walk lost its place,
  // and a short map read by a guard is a clean tree over files nobody read. Say
  // so rather than hand it back (`B1082`, and `S60` for the rule).
  if (read !== files.length) {
    throw new Error(
      `indexedSources: asked git for ${files.length} files and could only read ${read}. ` +
        'The batch reply stopped matching the request list, so the tree was not read.'
    );
  }
  return sources;
}

/** The same shape off the disk, for a root that is not a checkout. */
export function diskSources(root, files) {
  const sources = new Map();
  for (const file of files) {
    try {
      sources.set(file, readFileSync(join(root, file)));
    } catch {
      continue;
    }
  }
  return sources;
}

/**
 * Refuse a corpus the guard could not see, rather than reporting it clean.
 *
 * A guard that reads a listing and finds none of it answers "nothing is over
 * the ceiling" and exits 0, which is indistinguishable from a clean tree.
 * Four went that way on 2026-09-15, two of them ratchets, which can only ever
 * fail on a rise and so can never notice an undercount. Empty is a fact about
 * a fixture and never about this repository: there is no checkout here with
 * nothing tracked under `src`.
 */
export function refuseEmptyListing(sources, what) {
  if (sources.size > 0) return;
  console.error(`${what}: read nothing, so nothing was checked.`);
  console.error('');
  console.error('Either the tracked sources could not be listed, or git was pointed at');
  console.error('another tree: the variables a hook inherits beat the directory this');
  console.error('was run in. A clean answer over an empty listing is not an answer.');
  process.exit(1);
}
