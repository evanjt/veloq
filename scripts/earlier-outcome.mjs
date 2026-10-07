#!/usr/bin/env node
// Prints what an earlier run of this workflow measured the sha at: `success`,
// `failure`, or nothing when no run did. Reads the run history through `gh`.
//
// Usage: node scripts/earlier-outcome.mjs <repo> <workflow file> <sha> <current run id>

import { execFileSync } from 'node:child_process';

import { createRequire } from 'node:module';

const { earlierOutcome } = createRequire(import.meta.url)('./lib/earlier-outcome.js');

const [repo, workflow, sha, currentRunId] = process.argv.slice(2);
if (!repo || !workflow || !sha || !currentRunId) {
  console.error('usage: earlier-outcome.mjs <repo> <workflow file> <sha> <current run id>');
  process.exit(2);
}

const api = (path) =>
  JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8' }));

const pages = api(
  `repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${sha}&branch=main&per_page=100`
);
const runs = pages.flatMap((page) => page.workflow_runs ?? []);
const withJobs = runs
  .filter((run) => String(run.id) !== String(currentRunId))
  .map((run) => ({
    id: run.id,
    created_at: run.created_at,
    jobs: api(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`).flatMap(
      (page) => page.jobs ?? []
    ),
  }));

process.stdout.write(earlierOutcome(withJobs, currentRunId) ?? '');
