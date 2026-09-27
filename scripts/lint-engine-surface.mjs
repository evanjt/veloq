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
import { execFileSync } from 'node:child_process';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function flag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const ROOT = resolve(flag('--root', resolve(HERE, '..')));
const ENGINE_CEILING = Number(flag('--engine-ceiling', '0'));
const STORE_CEILING = Number(flag('--store-ceiling', '0'));
const SRC = join(ROOT, 'src');

// The shared module, however a file spells the reach: an import or the one
// `require` a store uses to keep the binding chain out of its import graph.
const REACHES_ENGINE = /(?:from|require\()\s*'@\/shared\/native\/engine'/;

/** The same reach for `git grep`, which takes POSIX extended and not this. */
const REACHES_ENGINE_ERE = "(from|require\\()[[:space:]]*'@/shared/native/engine'";

// The other door: `veloqrs` exports the client itself as `engine`, so a file
// can reach it with no shared-layer import at all. Prettier breaks a long
// import over several lines, so this is matched over the whole file, and
// `git grep`, which reads a line at a time, only finds the candidates.
const IMPORTS_VELOQRS_ENGINE = /import\s*\{[^}]*\bengine\b[^}]*\}\s*from\s*'veloqrs'/;
const IMPORTS_VELOQRS_ERE = "from[[:space:]]*'veloqrs'";

const reachesEngine = (source) =>
  REACHES_ENGINE.test(source) || IMPORTS_VELOQRS_ENGINE.test(source);

/** Where the module belongs, and where the tests mock it. */
const UNCOUNTED = [join(SRC, 'shared', 'native'), join(SRC, '__tests__')];

/**
 * The tracked `.ts` and `.tsx` under `src`, as the index holds them, or null
 * when this root is not a checkout.
 */
function indexedSources(root) {
  const paths = git(root, ['ls-files', '-z', '--', 'src/*.ts', 'src/*.tsx']);
  if (paths === null) return null;
  return paths
    .split('\0')
    .filter(Boolean)
    .map((rel) => join(root, rel));
}

/** The tracked files whose indexed content matches, as absolute paths. */
function indexedMatches(root, pattern) {
  // `git grep` exits 1 when nothing matched, which is an answer and not a
  // failure, so the empty case comes back as an empty list.
  const hits = git(root, ['grep', '-l', '-z', '--cached', '-E', pattern, '--', 'src'], true);
  return (hits ?? '')
    .split('\0')
    .filter(Boolean)
    .map((rel) => join(root, rel));
}

/** A tracked file's content as the index holds it, not as the disk does. */
function indexedContent(root, file) {
  return git(root, ['show', `:${relative(root, file)}`], true);
}

function git(root, args, emptyOnFailure = false) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      // `cwd` does not decide which index git reads: a hook exports GIT_DIR,
      // GIT_INDEX_FILE and GIT_WORK_TREE and those win. Reading another tree's
      // index, this counted nothing and then told the reader to lower both
      // ceilings to zero, which hands back every file a sweep took.
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return emptyOnFailure ? '' : null;
  }
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
  ? [
      ...new Set([
        ...indexedMatches(ROOT, REACHES_ENGINE_ERE),
        ...indexedMatches(ROOT, IMPORTS_VELOQRS_ERE).filter((file) =>
          IMPORTS_VELOQRS_ENGINE.test(indexedContent(ROOT, file))
        ),
      ]),
    ].filter((file) => !uncounted(file))
  : counted.filter((file) => reachesEngine(readFileSync(file, 'utf8')));
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
