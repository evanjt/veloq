#!/usr/bin/env node
// No record crossing the FFI carries a field TypeScript lifts as `bigint`.
//
// `JSON.stringify` throws `Do not know how to serialize a BigInt`, and `tsc`
// cannot see it. So the first caller that persists an engine record whole, a
// TanStack `placeholderData`, a widget snapshot, a crash-report payload, throws
// in release on every launch. Nothing does it today, which is exactly why
// nothing catches it.
//
// Every field the sweep converted was a unix-second timestamp, a duration in
// seconds, a SQLite rowid, a version counter or a byte count. `f64` is exact to
// 2^53, which is 285 million years of seconds and 9 petabytes, so none of them
// loses anything by crossing as a number.
//
// The check reads the generated bindings rather than the Rust, because the
// generated file is the contract TypeScript actually holds, and a field that
// reaches `bigint` by any route shows up there.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = join(ROOT, 'modules/veloqrs/src/generated/veloqrs.ts');

// `  fieldName?: /*i64*/ bigint;` as the generator emits a record field. A
// function signature carries its own parentheses and is not matched.
const FIELD = /^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??:\s*\/\*([iu]\d+)\*\/\s*bigint;/;

const source = readFileSync(GENERATED, 'utf-8');
const offenders = [];
source.split('\n').forEach((line, i) => {
  const field = FIELD.exec(line);
  if (field) offenders.push({ line: i + 1, name: field[1], rust: field[2] });
});

if (offenders.length > 0) {
  console.error('A record field crosses the FFI as bigint, which JSON.stringify refuses:');
  for (const o of offenders) {
    console.error(`  modules/veloqrs/src/generated/veloqrs.ts:${o.line}  ${o.name}: ${o.rust}`);
  }
  console.error('');
  console.error('  Declare the field as f64 in Rust and run `npm run ffi:manifest`.');
  console.error('  Exact to 2^53: seconds, durations, rowids, versions and byte counts all fit.');
  process.exit(1);
}

console.log('FFI bigint guard: no record field crosses as bigint.');
