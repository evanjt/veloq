#!/usr/bin/env node
// A pending dependency script leaves its installed package incomplete.

import { spawnSync } from 'node:child_process';

const result = spawnSync('npm', ['install-scripts', 'ls', '--json'], {
  encoding: 'utf8',
});

if (result.error || result.status !== 0) {
  console.error(result.error ?? result.stderr ?? 'Could not inspect dependency install scripts');
  process.exit(1);
}

let listing;
try {
  listing = JSON.parse(result.stdout);
} catch {
  console.error('Could not parse dependency install script listing');
  process.exit(1);
}

const pending = (listing.allowScripts ?? []).flatMap(({ changes }) =>
  changes.filter(({ change }) => change === 'pending').map(({ key }) => key)
);
if (pending.length > 0) {
  console.error(`Unreviewed dependency install scripts: ${pending.join(', ')}`);
  process.exit(1);
}
