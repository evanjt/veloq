#!/usr/bin/env node
// A built APK can carry a native library and a JavaScript bundle from
// different trees, and uniffi does not notice.
//
// The bindings check one checksum per function, over the function's signature.
// A record that gains or loses a field changes no signature, so a bundle built
// after the change runs happily against a library built before it and lifts
// every field off the wrong offset. On the handset that reads as a fitness
// figure of `4.243991582e-314` on the feed header, and, where the overlay is
// not stripped, "Reading the requested value would read past the end of the
// buffer".
//
// So this compares what the library says its records hold against what the
// generated bindings expect. uniffi writes its metadata into the library as
// length-prefixed strings, and a record is `0x02`, its module, its name and
// then the number of fields, which is the figure a field added or removed
// moves.
//
//     node scripts/lint-native-record-shapes.mjs [apk]
//     node scripts/lint-native-record-shapes.mjs --library <.so> --bindings <.ts>

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BINDINGS = 'modules/veloqrs/src/generated/veloqrs.ts';
const APK = 'android/app/build/outputs/apk/debug/app-debug.apk';
const LIB_IN_APK = 'lib/arm64-v8a/libveloqrs.so';

/** The metadata byte that opens a record definition. */
const RECORD = 0x02;

/** What a record's fields are declared as in the bindings. */
export function bindingRecords(source) {
  const records = new Map();
  const header = /export type (Ffi\w+) = \{\n([\s\S]*?)\n\};/g;
  for (const [, name, body] of source.matchAll(header)) {
    const fields = body
      .split('\n')
      .map((line) => line.match(/^ {2}(\w+)\??:/))
      .filter(Boolean)
      .map((m) => m[1]);
    if (fields.length > 0) records.set(name, fields);
  }
  return records;
}

/**
 * What the library says each record holds, by field count.
 *
 * The count is read rather than the names because a field's type is encoded
 * after it and skipping a type means decoding every type uniffi has. A field
 * added or removed is the whole of the failing case above and it moves the
 * count.
 */
export function libraryRecordArity(bytes) {
  const arity = new Map();
  for (let at = 0; at < bytes.length - 4; at += 1) {
    if (bytes[at] !== RECORD) continue;
    const module = lengthPrefixed(bytes, at + 1);
    if (!module || !module.text.includes('::')) continue;
    const name = lengthPrefixed(bytes, module.next);
    if (!name || !/^Ffi[A-Za-z0-9]+$/.test(name.text)) continue;
    const count = bytes[name.next];
    if (count === undefined || count === 0 || count > 64) continue;
    arity.set(name.text, count);
  }
  return arity;
}

/** The string at `at`, when a plain ASCII one is written there. */
function lengthPrefixed(bytes, at) {
  const length = bytes[at];
  if (!length || length > 120 || at + 1 + length > bytes.length) return null;
  const text = bytes.toString('latin1', at + 1, at + 1 + length);
  if (!/^[\x20-\x7e]+$/.test(text)) return null;
  return { text, next: at + 1 + length };
}

/** Records the bindings and the library disagree about. */
export function disagreements(bindings, arity) {
  const out = [];
  for (const [name, fields] of bindings) {
    const inLibrary = arity.get(name);
    if (inLibrary === undefined) continue;
    if (inLibrary !== fields.length) {
      out.push({ name, bindings: fields.length, library: inLibrary, fields });
    }
  }
  return out;
}

function libraryBytes(path) {
  if (path.endsWith('.apk')) {
    return execFileSync('unzip', ['-p', path, LIB_IN_APK], {
      encoding: 'buffer',
      maxBuffer: 512 * 1024 * 1024,
    });
  }
  return readFileSync(path);
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? null : argv[at + 1];
  };
  const bindingsPath = resolve(flag('--bindings') ?? BINDINGS);
  const libraryPath = resolve(flag('--library') ?? argv.find((a) => !a.startsWith('--')) ?? APK);

  // Nothing built and nothing generated are both the ordinary case on a fresh
  // clone, not a mismatch.
  if (!existsSync(libraryPath) || !existsSync(bindingsPath)) {
    process.exit(0);
  }

  const bindings = bindingRecords(readFileSync(bindingsPath, 'utf8'));
  const arity = libraryRecordArity(libraryBytes(libraryPath));
  const wrong = disagreements(bindings, arity);

  if (wrong.length === 0) {
    console.log(
      `Native record shapes: ${bindings.size} records, ${arity.size} in the library, no disagreement.`
    );
    process.exit(0);
  }

  console.error(`${libraryPath} was built from a different tree than ${bindingsPath}.`);
  for (const record of wrong) {
    console.error(
      `  ${record.name}: the library holds ${record.library} fields, the bindings lift ${record.bindings} (${record.fields.join(', ')})`
    );
  }
  console.error('');
  console.error('Lifting a record off a library that lays it out differently reads every');
  console.error('field off the wrong offset, and reads past the end of the buffer once the');
  console.error('bindings are the longer of the two. Build the native library from this');
  console.error('tree, or take the bundle from the tree the library was built in.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
