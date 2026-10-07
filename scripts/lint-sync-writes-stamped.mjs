#!/usr/bin/env node
// A sync pass fetches under one install of the library and writes later. If
// the athlete restores a backup in between, `destroy` cancels cooperatively and
// a pass already past its last check is not stopped, so an engine call that
// does not carry the install it was fetched under puts the old library's rows
// into the restored database.
//
// `with_persistent_engine_blocking_for` discards the work when the open install
// is no longer the one it was handed. Every write the sync service makes takes
// the engine through it. Reads take the engine that is open now and may use any
// helper.
//
// A closure that names a write method under any unstamped way of taking the
// engine fails. Test modules at the foot of the file seed engines directly and
// are not read.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const SYNC = 'modules/veloqrs/rust/veloqrs/src/objects/sync.rs';

// Every way of taking the engine that does not check the install. The `_for`
// form is the stamped one and is not listed.
const UNSTAMPED = /\bwith_(?:persistent_)?engine(?:_at|_blocking)?\s*\(/g;

// Engine methods that write. A closure naming one is a write.
const WRITE =
  /\.(?:upsert|set|record|store|delete|clear|insert|mark|retire|prune|update|save|remove)_/;

const sources = treeSources(ROOT, [SYNC]);
const bytes = sources.get(SYNC);
if (bytes === undefined) {
  console.error(`Sync writes guard: ${SYNC} is not in the tree, so nothing was checked.`);
  process.exit(1);
}

const whole = bytes.toString('utf8');
const testModule = whole.search(/^#\[cfg\(test\)\]\r?\nmod \w+ \{/m);
const source = testModule === -1 ? whole : whole.slice(0, testModule);

// From the opening parenthesis to its match, so the closure body comes along.
// Parentheses inside string literals are rare in these closures and would
// only widen the span to the next balanced close.
function callFrom(open) {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

const hits = [];
for (const match of source.matchAll(UNSTAMPED)) {
  const open = match.index + match[0].length - 1;
  const write = callFrom(open).match(WRITE);
  if (write) {
    const line = source.slice(0, match.index).split('\n').length;
    hits.push(`${SYNC}:${line} (${write[0]})`);
  }
}

if (hits.length === 0) {
  console.log('Sync writes guard: every sync write takes the engine under its install.');
  process.exit(0);
}

console.error('These sync writes take the engine without the install they were fetched');
console.error('under, so a restore mid-pass cannot discard them. Use');
console.error('with_persistent_engine_blocking_for(install, ...):\n');
for (const hit of hits) console.error(`  ${hit}`);
process.exit(1);
