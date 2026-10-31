#!/usr/bin/env node
// Refuses a tag release unless the Test and E2E Gate runs that main's push of
// the tagged sha started both concluded success. The decision is in
// lib/main-gates.js; this reads those runs through `gh`, waits while one is
// still going, and exits non-zero naming each failed run or missing gate.
//
// Usage: GITHUB_REPOSITORY=owner/name node scripts/check-main-gates.mjs <sha>
// It reads GH_TOKEN, which needs `actions: read`.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const { GATES, judgeMainGates } = createRequire(import.meta.url)('./lib/main-gates.js');

/** A gate with no run yet may be about to start, so it is awaited this long. */
const APPEAR_WAIT_S = 600;
/** A gate still going after this long is refused rather than awaited. */
const MAX_WAIT_S = 7200;
const POLL_S = 30;

const sha = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
if (!sha || !repo) {
  console.error('usage: GITHUB_REPOSITORY=owner/name node scripts/check-main-gates.mjs <sha>');
  process.exit(2);
}

function gateRuns(gate) {
  const json = execFileSync(
    'gh',
    [
      'api',
      `repos/${repo}/actions/workflows/${gate}/runs?head_sha=${sha}&event=push&branch=main&per_page=100`,
    ],
    { encoding: 'utf8' }
  );
  return JSON.parse(json).workflow_runs ?? [];
}

function refuse(lines) {
  for (const line of lines) console.error(`::error::${line}`);
  process.exit(1);
}

for (let waited = 0; ; waited += POLL_S) {
  const runs = Object.fromEntries(GATES.map((gate) => [gate, gateRuns(gate)]));
  const verdict = judgeMainGates(runs);
  if (verdict.failed.length > 0) refuse(verdict.failed);
  if (waited >= APPEAR_WAIT_S && verdict.missing.length > 0) {
    refuse(verdict.missing.map((gate) => `${gate} has no push run on main for ${sha}.`));
  }
  if (verdict.pending.length === 0 && verdict.missing.length === 0) {
    console.log(`Test and E2E Gate passed on main for ${sha}.`);
    process.exit(0);
  }
  if (waited >= MAX_WAIT_S) {
    refuse(verdict.pending.map((gate) => `${gate} is still running on main for ${sha}.`));
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_S * 1000));
}
