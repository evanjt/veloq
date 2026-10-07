#!/usr/bin/env node
// Nothing crossing the FFI is lifted as `bigint` in TypeScript: no record field,
// no export parameter and no export return.
//
// `JSON.stringify` throws `Do not know how to serialize a BigInt`, and `tsc`
// cannot see it. So the first caller that persists an engine record whole, a
// TanStack `placeholderData`, a widget snapshot, a crash-report payload, throws
// in release on every launch. A parameter or a return lifted as `bigint` is the
// same value one hand conversion away: the delegate wraps it in `BigInt(` or
// `Number(`, some truncating and some not, and a caller that keeps a returned
// run id or byte count is one `JSON.stringify` from the throw.
//
// Every value converted was a unix timestamp, a duration, a SQLite rowid or run
// id, a version counter, a day count or a byte count. `f64` is exact to 2^53,
// which is 285 million years of seconds and 9 petabytes, so none of them loses
// anything by crossing as a number. A count of something else crosses as `u32`,
// which lifts as a number too.
//
// The check reads the generated bindings rather than the Rust, because the
// generated file is the contract TypeScript actually holds, and a field that
// reaches `bigint` by any route shows up there.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

// `--root` points the guard at another tree, so the rule itself can be tested.
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);
const GENERATED = 'modules/veloqrs/src/generated/veloqrs.ts';

// Any `bigint` in code, so a field, a parameter, a return, `Array<bigint>`,
// `Map<string, bigint>`, `bigint | undefined` and `Promise<bigint>` all match.
// Comments are not code. The one `bigint` the bindings keep is the handle a
// callback vtable receives from Rust: it is the generator's own plumbing, it
// never reaches a caller, and no Rust type controls it.
const BIGINT = /\bbigint\b/;
const VTABLE_HANDLE = /\buniffiHandle:\s*bigint\b/g;
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

const generated = treeSources(ROOT, [GENERATED]).get(GENERATED);
if (generated === undefined) {
  console.error('lint-ffi-bigint: the generated bindings are not in the tree, so nothing was checked.');
  process.exit(1);
}
const source = generated.toString('utf8');
const offenders = [];
source.split('\n').forEach((line, i) => {
  if (COMMENT.test(line)) return;
  if (BIGINT.test(line.replace(VTABLE_HANDLE, ''))) {
    offenders.push({ line: i + 1, text: line.trim() });
  }
});

if (offenders.length > 0) {
  console.error('A value crosses the FFI as bigint, which JSON.stringify refuses:');
  for (const o of offenders) {
    console.error(`  modules/veloqrs/src/generated/veloqrs.ts:${o.line}  ${o.text}`);
  }
  console.error('');
  console.error('  Declare the field, parameter or return as f64 in Rust (or u32 for a plain');
  console.error('  count) and run `npm run ffi:generate`.');
  console.error('  Exact to 2^53: seconds, durations, rowids, versions and byte counts all fit.');
  process.exit(1);
}

console.log('FFI bigint guard: nothing crosses as bigint.');
