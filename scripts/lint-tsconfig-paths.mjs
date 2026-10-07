#!/usr/bin/env node
// Every `paths` target in tsconfig.json must name a tracked file or directory.
//
// An alias whose target is gone resolves nothing and still reads as a real
// location, and the wildcard `@/*` already covers the prefix, so the dead line
// only misleads the next reader. A target is found when the index holds the
// path itself, the path with a source extension, a directory under it or its
// `index` file.

import { execFileSync } from 'node:child_process';

import { gitFreeEnv, indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const config = indexedSources(root, ['tsconfig.json']);
refuseEmptyListing(config, 'tsconfig paths guard');
const tsconfig = JSON.parse(config.get('tsconfig.json').toString('utf8'));

const baseUrl = (tsconfig.compilerOptions?.baseUrl ?? '.').replace(/^\.\/?/, '').replace(/\/$/, '');
const tracked = new Set(
  execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    env: gitFreeEnv(),
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
);
const directories = new Set();
for (const file of tracked) {
  const parts = file.split('/');
  for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.d.ts', '.json'];
const exists = (target) =>
  directories.has(target) ||
  tracked.has(target) ||
  EXTENSIONS.some((ext) => tracked.has(`${target}${ext}`));

const failures = [];
for (const [alias, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
  for (const target of targets) {
    const relative = target
      .replace(/^\.\//, '')
      .replace(/\/?\*$/, '')
      .replace(/\/$/, '');
    const path = [baseUrl, relative].filter(Boolean).join('/');
    if (!exists(path)) failures.push(`${alias} -> ${target}`);
  }
}

if (failures.length > 0) {
  console.error(`A tsconfig path alias points at nothing tracked: ${failures.length}.\n`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('tsconfig paths guard: every alias target exists.');
