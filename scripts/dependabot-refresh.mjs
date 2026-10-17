#!/usr/bin/env node
// Asks the Dependabot pull requests that failed on an older main to rebase, so
// their Test run sees the current one. The selection is in
// lib/dependabot-refresh.js; this reads the pull requests through `gh` and
// comments on each one selected. `--dry-run` prints the selection only.
//
// Usage: node scripts/dependabot-refresh.mjs [--dry-run]

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { refreshCandidates, isDependabot, REBASE_COMMAND } = createRequire(import.meta.url)(
  './lib/dependabot-refresh.js'
);

const dryRun = process.argv.includes('--dry-run');

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const json = (...args) => JSON.parse(gh(...args));

const BEHIND_QUERY = `query($owner: String!, $name: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: "refs/heads/main") { compare(headRef: $head) { behindBy } }
  }
}`;

function behindBy(headRefName) {
  const result = json(
    'api',
    'graphql',
    '-F',
    'owner={owner}',
    '-F',
    'name={repo}',
    '-f',
    `head=${headRefName}`,
    '-f',
    `query=${BEHIND_QUERY}`
  );
  return result.data?.repository?.ref?.compare?.behindBy ?? 0;
}

function latestRun(headRefName) {
  const runs = json(
    'run',
    'list',
    '--workflow',
    'test.yml',
    '--event',
    'pull_request',
    '--branch',
    headRefName,
    '--limit',
    '1',
    '--json',
    'headSha,status,conclusion,createdAt'
  );
  return runs[0] ?? null;
}

const open = json(
  'pr',
  'list',
  '--state',
  'open',
  '--base',
  'main',
  '--limit',
  '100',
  '--json',
  'number,author,headRefName,headRefOid,comments'
);

const prs = open.filter(isDependabot).map((pr) => ({
  ...pr,
  latestRun: latestRun(pr.headRefName),
  behindBy: behindBy(pr.headRefName),
}));

const selected = refreshCandidates(prs);
for (const number of selected) {
  console.log(`#${number}: ${REBASE_COMMAND}`);
  if (!dryRun) gh('pr', 'comment', String(number), '--body', REBASE_COMMAND);
}
if (selected.length === 0) console.log('No Dependabot pull request needs a rebase.');
