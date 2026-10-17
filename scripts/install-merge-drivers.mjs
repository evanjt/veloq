#!/usr/bin/env node
// Name the merge drivers `.gitattributes` points at.
//
// An attribute says which driver merges a file, and the driver's command lives
// in git config, which no clone carries. Unnamed, git falls back to its own
// text merge without a word. `prepare` runs this, and so does `land-branch.sh`
// before it merges, since config set here is shared by every worktree of the
// repository. It is re-runnable and writes the same values each time.
//
// ratchet-baseline: the style baseline holds a ceiling per file, and a sweep
// only ever lowers one, so two sweeps that touched it merge by the lower count
// per key (`merge-ratchet-baseline.mjs`).

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

const DRIVERS = {
  'ratchet-baseline': {
    name: 'a ratchet baseline, merged by the lower count per key',
    driver: `node ${shellQuote(join(HERE, 'merge-ratchet-baseline.mjs'))} %O %A %B`,
  },
};

const git = (args) =>
  execFileSync('git', args, { env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

try {
  git(['rev-parse', '--git-dir']);
} catch {
  // Not inside a repository, as when the package is installed from a tarball.
  process.exit(0);
}
for (const [id, { name, driver }] of Object.entries(DRIVERS)) {
  git(['config', `merge.${id}.name`, name]);
  git(['config', `merge.${id}.driver`, driver]);
}
