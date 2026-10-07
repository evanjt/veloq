#!/usr/bin/env node
// Two counts that may only fall: the files reaching the engine module directly,
// and the stores.
//
// The front end is moving to one screen read per screen, so both shrink as the
// screen-read items land. Nothing enforced that. A feature fix that adds a
// `getEngine` import, or a twenty-first store, passed every gate, and the
// inventory the migration is planned from went stale the same day.
//
// A ratchet and not a ban: the counts are where they are, and the ceiling only
// ever moves down. Refusing a ceiling the tree has already beaten is the other
// half of that, or ground a sweep took is quietly given back by the next commit
// that adds one.
//
// The shared engine layer, `src/shared/native`, is where the module belongs and
// is not counted. Neither are the tests, which mock it rather than reach it.
//
// Counted out of the index and not off the disk, where there is one. A total
// over the working tree is the defect the lint ceiling already had: every
// worktree merges through the one checkout, so one session's unsaved file put
// the count over and failed every merge anyone attempted, on a file the merge
// never touched. The index is the tree a commit or a merge is actually making.
// A tree that is not a checkout, a fixture, falls back to reading the disk.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './lib/indexedSources.mjs';
import { ENGINE_CANDIDATE_ERE, reachesEngine } from './lib/engineReach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function flag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const ROOT = resolve(flag('--root', resolve(HERE, '..')));
const ENGINE_CEILING = Number(flag('--engine-ceiling', '0'));
const STORE_CEILING = Number(flag('--store-ceiling', '0'));
const SRC = join(ROOT, 'src');

// What counts as reaching the engine is `lib/engineReach.mjs`, which the
// render-read lint reads too. `git grep`, which reads a line at a time, only
// finds the candidates and the module decides over the whole file.

/** Where the module belongs, and where the tests mock it. */
const UNCOUNTED = [join(SRC, 'shared', 'native'), join(SRC, '__tests__')];

/**
 * The tracked `.ts` and `.tsx` under `src`, as the index holds them, or null
 * when this root is not a checkout.
 */
function indexedSources(root) {
  const listing = git(root, ['ls-files', '-z', '--', 'src/*.ts', 'src/*.tsx']);
  if (listing.status !== 0) {
    if (!existsSync(join(root, '.git'))) return null;
    unreadable(`git ls-files could not list the index: ${listing.stderr.trim()}`);
  }
  return listing.stdout
    .split('\0')
    .filter(Boolean)
    .map((rel) => join(root, rel));
}

/** The tracked files whose indexed content matches, as absolute paths. */
function indexedMatches(root, pattern) {
  // `git grep` exits 1 when nothing matched, which is an answer and not a
  // failure. A blob it cannot read exits 1 as well, or 0 when another file
  // matched, and says so only on stderr: taken as no match, a pruned object
  // dropped a call site from the count and the guard asked for the ceiling to
  // fall. So stderr decides, not the code.
  const hits = git(root, ['grep', '-l', '-z', '--cached', '-E', pattern, '--', 'src']);
  if (hits.stderr !== '' || (hits.status !== 0 && hits.status !== 1)) {
    unreadable(`git grep could not read the index:\n${hits.stderr.trim()}`);
  }
  return hits.stdout
    .split('\0')
    .filter(Boolean)
    .map((rel) => join(root, rel));
}

/** A tracked file's content as the index holds it, not as the disk does. */
function indexedContent(root, file) {
  const rel = relative(root, file);
  const shown = git(root, ['show', `:${rel}`]);
  if (shown.status !== 0) unreadable(`git show could not read ${rel}: ${shown.stderr.trim()}`);
  return shown.stdout;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    // `cwd` does not decide which index git reads: a hook exports GIT_DIR,
    // GIT_INDEX_FILE and GIT_WORK_TREE and those win. Reading another tree's
    // index, this counted nothing and then told the reader to lower both
    // ceilings to zero, which hands back every file a sweep took.
    env: gitFreeEnv(),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) unreadable(`git could not be run: ${result.error.message}`);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** A read that failed part way is a refusal, never a count. */
function unreadable(detail) {
  console.error(
    'Engine surface: a file the index names could not be read, so nothing was counted.'
  );
  console.error('');
  console.error(detail);
  console.error('');
  console.error('Do not lower the ceilings on this answer: a file the guard could not read');
  console.error('is not a file that stopped reaching the engine.');
  process.exit(1);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const uncounted = (file) => UNCOUNTED.some((dir) => file.startsWith(dir + '/'));

const indexed = indexedSources(ROOT);
const read = indexed ?? walk(SRC);

// A guard that read nothing must not report a count. Every tree this runs in
// has TypeScript under `src`, so an empty listing means the listing failed or
// came from a tree this is not about, and the honest answer is a refusal. It
// matters more here than in a plain guard: this one's advice on an undercount
// is to lower the ceiling, and following that gives the ground away for good.
if (read.length === 0) {
  console.error('Engine surface: read nothing under src, so nothing was counted.');
  console.error('');
  console.error('Either the tracked sources could not be listed, or git was pointed at');
  console.error('another tree. Do not lower the ceilings on this answer.');
  process.exit(1);
}

const counted = read.filter((file) => !uncounted(file));
const callSites = indexed
  ? indexedMatches(ROOT, ENGINE_CANDIDATE_ERE).filter(
      (file) =>
        /\.tsx?$/.test(file) && !uncounted(file) && reachesEngine(indexedContent(ROOT, file), file)
    )
  : counted.filter((file) => reachesEngine(readFileSync(file, 'utf8'), file));
const stores = counted.filter((file) => file.endsWith('Store.ts'));

let failed = false;

function check(label, files, ceiling, what) {
  const count = files.length;
  if (count > ceiling) {
    failed = true;
    console.error(`${label}: ${count} ${what}, ceiling ${ceiling}.`);
    console.error('This count may only fall. The files, so the new one is visible:');
    for (const file of files.sort()) console.error(`  ${relative(ROOT, file)}`);
    console.error('');
    return;
  }
  if (count < ceiling) {
    failed = true;
    console.error(`${label}: ${count} ${what}, ceiling ${ceiling}.`);
    console.error(`Lower the ceiling to ${count} in package.json's lint:engine-surface script,`);
    console.error('or the next commit gives the ground back.');
    console.error('');
  }
}

check('Engine call sites', callSites, ENGINE_CEILING, 'files reach the engine directly');
check('Stores', stores, STORE_CEILING, 'stores');

if (failed) process.exit(1);
console.log(
  `Engine surface: ${callSites.length} call sites and ${stores.length} stores, both on the ceiling.`
);
