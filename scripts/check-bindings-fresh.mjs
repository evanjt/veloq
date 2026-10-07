#!/usr/bin/env node
// Compare regenerated bindings with the index without rewriting the checkout.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, indexedSources } from './lib/indexedSources.mjs';

const MODULE = 'modules/veloqrs';
const DIRECTORIES = ['src/generated', 'cpp/generated'];

function generatedFiles(root, directory, files = new Map()) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) generatedFiles(root, path, files);
    else files.set(`${MODULE}/${path}`, readFileSync(join(root, path)));
  }
  return files;
}

function generate(root, output) {
  const run = spawnSync('npm', ['run', '--silent', 'ffi:generate', '--', '--out-dir', output], {
    cwd: root,
    env: gitFreeEnv(),
    stdio: 'inherit',
  });
  if (run.error) throw new Error(`could not start binding generation: ${run.error.message}`);
  if (run.status !== 0) {
    throw new Error(`binding generation failed (${run.signal ?? `exit ${run.status}`})`);
  }
}

function check(root) {
  const committed = indexedSources(root, DIRECTORIES.map((dir) => `${MODULE}/${dir}`));
  if (committed.size === 0) throw new Error('read nothing from the indexed bindings');
  const output = mkdtempSync(join(tmpdir(), 'bindings-fresh-'));
  try {
    generate(root, output);
    const generated = new Map(DIRECTORIES.flatMap((dir) => [...generatedFiles(output, dir)]));
    const paths = new Set([...committed.keys(), ...generated.keys()]);
    const changed = [...paths].filter((path) => {
      const before = committed.get(path);
      const after = generated.get(path);
      return !before || !after || !before.equals(after);
    });
    if (changed.length > 0) {
      throw new Error(`stale bindings:\n${changed.sort().join('\n')}\nRun npm run ffi:generate and stage the result.`);
    }
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

try {
  const at = process.argv.indexOf('--root');
  const root = at === -1 ? process.cwd() : resolve(process.argv[at + 1]);
  check(root);
  console.log('check-bindings-fresh: indexed bindings match the Rust source');
} catch (error) {
  console.error(`check-bindings-fresh: ${error.message}`);
  process.exitCode = 1;
}
