#!/usr/bin/env node
// Fails when the head lockfile carries an advisory the base lockfile lacks.
// Reads two `cargo audit --json` reports and prints each new advisory.
//
// Usage: node scripts/new-advisories.mjs <base report> <head report>

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { newAdvisories } = createRequire(import.meta.url)('./lib/new-advisories.js');

const [basePath, headPath] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error('usage: new-advisories.mjs <base report> <head report>');
  process.exit(2);
}

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

const added = newAdvisories(read(basePath), read(headPath));
if (added.length === 0) {
  console.log('No advisory the base lockfile lacks.');
} else {
  console.error('Advisories this change brings into the lockfile:');
  for (const key of added) console.error(`  ${key}`);
  process.exit(1);
}
