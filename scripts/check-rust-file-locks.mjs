#!/usr/bin/env node
// Engine file locks go through persistence::file_lock, never std's File locking.
//
// std::fs::File::lock and its siblings return Unsupported on the Android target,
// and the engine's init lock read that as storage being unavailable, so every
// Android launch left the engine closed while Linux tests passed. flock works on
// every target the engine ships to, and file_lock is where it is called.

import { join, resolve } from 'node:path';
import { treeSources } from './lib/indexedSources.mjs';

const sourceRoot = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : 'modules/veloqrs/rust/veloqrs/src';
const owner = /(^|\/)persistence\/file_lock\.rs$/;
const fileReceiver = /\b\w*file\w*\s*\.\s*(?:try_lock|lock_shared|try_lock_shared|lock|unlock)\s*\(/gi;
const pathCall = /\bFile::(?:try_lock|lock_shared|try_lock_shared|lock|unlock)\b/g;

function rustSources(dir) {
  const fromRepository = !process.argv.includes('--root');
  const sources = fromRepository ? treeSources(process.cwd(), [dir]) : treeSources(resolve(dir));
  return [...sources]
    .filter(([name]) => name.endsWith('.rs'))
    .map(([name, bytes]) => ({
      path: fromRepository ? name : join(dir, name),
      source: bytes.toString('utf8'),
    }));
}

const failures = [];
for (const { path, source } of rustSources(sourceRoot)) {
  if (owner.test(path)) continue;
  source.split('\n').forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '');
    for (const pattern of [fileReceiver, pathCall]) {
      pattern.lastIndex = 0;
      if (pattern.test(code)) failures.push(`${path}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (failures.length) {
  console.error('std File locking is unsupported on Android; lock through persistence::file_lock:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
