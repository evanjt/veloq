#!/usr/bin/env node
// A worktree placed outside the main checkout's parent sees no `.cargo/config.toml`.
//
// Cargo resolves config from the working directory's **ancestors**, so the file
// at `~/projects/personal/intervals/.cargo/config.toml` reaches a checkout only
// if that checkout sits under that directory. It carries `[build] jobs = 8`,
// set after two builds at cargo's default of 32 jobs reached 15.5 GB, and
// `[env] TRACEMATCH_CORPUS`, which the local bitwise gates read.
//
// Nothing warns when it is missed. The build is simply faster and hungrier, and
// the corpus failure names a missing directory rather than a missing variable.
//
// Cargo merges every config on the chain rather than stopping at the nearest,
// and the crate tracks a `.cargo/config.toml` of its own, so the guard looks for
// the two settings rather than for any file. `rustc-wrapper` is left out: a
// tree without sccache builds correctly, only slower.
//
// CI has no such file and is not meant to: the refusal fires only when the main
// checkout's chain sets a key and this tree's does not, which is exactly the
// misplaced worktree and never a fresh clone.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const KEYS = ['build.jobs', 'env.TRACEMATCH_CORPUS'];

// The pre-commit hook exports GIT_DIR and GIT_COMMON_DIR, and those win over
// `cwd`, so a guard pointed at a fixture would find the real repository.
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

// Where cargo is invoked from for this crate, and the tree whose ancestors
// therefore decide what it reads.
const crate = join(root, 'modules', 'veloqrs', 'rust');
const main = mainCheckout(root);

if (main !== null && main !== root) {
  const ours = chainSettings(crate);
  const theirs = chainSettings(join(main, 'modules', 'veloqrs', 'rust'));
  const missing = KEYS.filter((key) => theirs.has(key) && !ours.has(key));
  if (missing.length > 0) {
    console.error("This worktree's cargo config chain misses what the main checkout's sets:");
    console.error(`  this tree  ${root}`);
    console.error(`  main tree  ${main}`);
    for (const key of missing) console.error(`  ${key.padEnd(21)} set by ${theirs.get(key)}`);
    console.error('');
    console.error("Cargo reads config from the working directory's ancestors, so a");
    console.error("worktree outside the main checkout's parent gets neither the job cap");
    console.error('nor TRACEMATCH_CORPUS, and nothing says so: the build is just hungrier.');
    console.error('Put the worktree under the same parent as the main checkout:');
    console.error(`  git worktree add ${join(dirname(main), 'veloq-<id>')} -b audit/<id>`);
    process.exit(1);
  }
}

/** Each of `KEYS` set anywhere on the config chain from `from` to the root, mapped to its file. */
function chainSettings(from) {
  const found = new Map();
  let dir = from;
  for (;;) {
    for (const name of ['config.toml', 'config']) {
      const file = join(dir, '.cargo', name);
      if (!existsSync(file)) continue;
      for (const key of settingsIn(readFileSync(file, 'utf8'))) {
        if (KEYS.includes(key) && !found.has(key)) found.set(key, file);
      }
    }
    const up = dirname(dir);
    if (up === dir) return found;
    dir = up;
  }
}

/**
 * The dotted keys a cargo config sets, to two levels: `[build] jobs = 8`,
 * `build.jobs = 8` and `[env.TRACEMATCH_CORPUS]` all yield their key. Enough
 * TOML for cargo's own config, which has no multi-line keys.
 */
function settingsIn(text) {
  const keys = [];
  let table = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s+/, '');
    if (line === '' || line.startsWith('#')) continue;
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?/);
    if (header) {
      table = splitKey(header[1]);
      if (table.length >= 2) keys.push(table.slice(0, 2).join('.'));
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_.\-"' ]+?)\s*=/);
    if (assignment) {
      const full = [...table, ...splitKey(assignment[1])];
      if (full.length >= 2) keys.push(full.slice(0, 2).join('.'));
    }
  }
  return keys;
}

function splitKey(key) {
  return key.split('.').map((part) => part.trim().replace(/^["']|["']$/g, ''));
}

/** The main checkout's working tree, found through the shared git directory. */
function mainCheckout(from) {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: from, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    return dirname(common);
  } catch {
    return null;
  }
}
