#!/usr/bin/env node
// Rewrites the three files that follow from the link method table and the
// engine's exports, in the order each reads the one before:
//   1. web/connect/methods.json, rendered from `METHODS` in the engine;
//   2. the generated bindings, from the engine's exported signatures;
//   3. web/connect/schema.d.ts, from the first two.
//
// Two branches that each add a method change all three, and git merges them
// by taking one side (the `regenerated` driver in `.gitattributes`), so this
// runs after such a merge and its output is what the tree commits. The
// freshness guards stay the check that the committed files match.
//
// Usage: node scripts/regenerate-link-files.mjs

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = gitFreeEnv();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, env, encoding: 'utf8', ...options });
  if (result.error) throw new Error(`could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (exit ${result.status})\n${result.stderr ?? ''}`
    );
  }
  return result.stdout;
}

const methods = run('cargo', ['run', '-q', '-p', 'veloqrs', '--example', 'link_methods_json'], {
  cwd: join(ROOT, 'modules/veloqrs/rust'),
  stdio: ['ignore', 'pipe', 'inherit'],
});
writeFileSync(join(ROOT, 'web/connect/methods.json'), methods);
run('npm', ['run', '--silent', 'ffi:generate'], { stdio: 'inherit' });
run('node', ['scripts/generate-link-schema.mjs'], { stdio: 'inherit' });
