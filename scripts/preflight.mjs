#!/usr/bin/env node
// Runs locally the checks that CI catches most often, so a push does not carry
// a failure that costs a round trip to find.
//
//   jest        the app suite under America/Los_Angeles, a zone west of UTC
//   map-pages   the map-page smoke
//   tooling     the tooling suites
//   advisories  cargo audit --deny warnings
//   workflows   the workflow lint
//
// Every check runs, so one pass lists every failure. Exit 0: all passed. 1: at
// least one failed, each named at the end.
//
// Usage: node scripts/preflight.mjs

import { spawnSync } from 'node:child_process';

const CHECKS = [
  {
    name: 'jest (America/Los_Angeles)',
    command: 'npm',
    args: ['run', '--silent', 'test'],
    env: { TZ: 'America/Los_Angeles' },
  },
  { name: 'test:map-pages', command: 'npm', args: ['run', '--silent', 'test:map-pages'] },
  { name: 'test:tooling', command: 'npm', args: ['run', '--silent', 'test:tooling'] },
  {
    name: 'cargo audit',
    command: 'cargo',
    args: ['audit', '--deny', 'warnings'],
    cwd: 'modules/veloqrs/rust',
  },
  { name: 'lint:workflows', command: 'npm', args: ['run', '--silent', 'lint:workflows'] },
];

const failed = [];
for (const check of CHECKS) {
  console.log(`\n== ${check.name}`);
  const result = spawnSync(check.command, check.args, {
    stdio: 'inherit',
    cwd: check.cwd,
    env: { ...process.env, ...check.env },
  });
  if (result.error) console.error(`${check.command} did not start: ${result.error.message}`);
  if (result.error || result.status !== 0) failed.push(check.name);
}

console.log('');
if (failed.length > 0) {
  console.error(`preflight failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('preflight passed');
