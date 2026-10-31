#!/usr/bin/env node
// Lists the superseded Actions cache entries on main, and deletes them with
// `--delete`. The selection is in lib/prune-caches.js; this reads the cache
// listing through `gh`. Without `--delete` it prints the selection and the
// total the cache holds, which is how the total is recorded.
//
// Usage: node scripts/prune-caches.mjs --repo <owner/name> [--delete]

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { supersededEntries } = createRequire(import.meta.url)('./lib/prune-caches.js');

const args = process.argv.slice(2);
const repoAt = args.indexOf('--repo');
const repo = repoAt === -1 ? undefined : args[repoAt + 1];
if (!repo) {
  console.error('usage: prune-caches.mjs --repo <owner/name> [--delete]');
  process.exit(2);
}
const doDelete = args.includes('--delete');

function gh(...ghArgs) {
  const run = spawnSync('gh', ghArgs, { encoding: 'utf8' });
  if (run.error) {
    console.error(`gh did not start: ${run.error.message}`);
    process.exit(1);
  }
  if (run.status !== 0) {
    console.error(`gh ${ghArgs.join(' ')} failed:\n${run.stderr}`);
    process.exit(1);
  }
  return run.stdout;
}

const pages = JSON.parse(
  gh('api', '--paginate', '--slurp', `repos/${repo}/actions/caches?per_page=100`)
);
const entries = pages.flatMap((page) => page.actions_caches ?? []);
const superseded = supersededEntries(entries);

const gb = (bytes) => (bytes / 1e9).toFixed(2);
const total = entries.reduce((sum, e) => sum + e.size_in_bytes, 0);
const freed = superseded.reduce((sum, e) => sum + e.size_in_bytes, 0);
console.log(
  `${entries.length} entries hold ${gb(total)} GB; ${superseded.length} superseded hold ${gb(freed)} GB`
);

for (const entry of superseded) {
  console.log(`${doDelete ? 'delete' : 'superseded'} ${entry.id} ${entry.key}`);
  if (doDelete) gh('api', '-X', 'DELETE', `repos/${repo}/actions/caches/${entry.id}`);
}
