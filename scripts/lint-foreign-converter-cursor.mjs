#!/usr/bin/env node
// A foreign-implemented object may only cross the FFI through its handle map.
//
// `FfiConverterObjectWithCallbacks` overrides `lower` and `lift` to consult
// the map a JavaScript implementation lives in. It does not override
// `writeIntoCursor`, which falls to `FfiConverterObject.lowerHandle` and
// throws "Cannot lower this object to a pointer" for anything that is not
// Rust-backed. Every container writes its item into a cursor, and so does
// every record field, so `Option<Arc<dyn Trait>>`, `Vec<Arc<dyn Trait>>` and a
// struct field of that type all compile, generate and throw at the first call.
//
// The generator says nothing about it. `setObserver` took an optional observer
// from the generator upgrade of 2026-09-15, threw on every launch for five
// days, and the only signal was a `console.warn` that a release build strips:
// the engine observer was withheld and every screen ran deaf.
//
// So the legal uses of such a converter are `lower`, `lift`, `drop`, `clone`
// and its own declaration. Naming it bare, as the export list does, is fine.
// Anything else is the cursor path and fails here.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};
const ROOT = flagValue('--root', join(HERE, '..'));

const GENERATED = 'modules/veloqrs/src/generated';

// The methods that go through the handle map rather than the byte cursor.
const BY_HANDLE = new Set(['lower', 'lift', 'drop', 'clone']);

// The three containers of the runtime, all of which write their item into a
// cursor: `ffi-converters.ts` declares no fourth.
const CONTAINER = /new (FfiConverterOptional|FfiConverterArray|FfiConverterMap)\(([^()]*)\)/gs;

const DECLARATION = /const (\w+) = new FfiConverterObjectWithCallbacks\(/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const offenders = [];
const files = [...treeSources(ROOT, [GENERATED])].filter(
  ([rel]) => rel.endsWith('.ts') && !rel.slice(GENERATED.length + 1).includes('/')
);

for (const [rel, bytes] of files) {
  const path = join(ROOT, rel);
  const text = bytes.toString('utf8');
  const where = relative(ROOT, path).split('\\').join('/');

  const foreign = new Set();
  for (const m of text.matchAll(DECLARATION)) foreign.add(m[1]);
  if (foreign.size === 0) continue;

  for (const m of text.matchAll(CONTAINER)) {
    for (const converter of foreign) {
      if (!new RegExp(`\\b${converter}\\b`).test(m[2])) continue;
      offenders.push(`${where}:${lineOf(text, m.index)}  new ${m[1]}(${converter})`);
    }
  }

  for (const converter of foreign) {
    const call = new RegExp(`\\b${converter}\\.(\\w+)\\(`, 'g');
    for (const m of text.matchAll(call)) {
      if (BY_HANDLE.has(m[1])) continue;
      offenders.push(`${where}:${lineOf(text, m.index)}  ${converter}.${m[1]}()`);
    }
  }
}

if (files.length === 0) {
  console.error(`Foreign converter guard: nothing to read under ${GENERATED}.`);
  process.exit(1);
}

if (offenders.length === 0) {
  console.log('Foreign converter guard: every foreign object crosses by handle.');
  process.exit(0);
}

console.error(
  'A foreign-implemented converter is written into a byte cursor. That path\n' +
    'never consults the handle map a JavaScript implementation lives in, so the\n' +
    'call throws "Cannot lower this object to a pointer" at run time, with no\n' +
    'compile error and nothing in a release build to say so.\n'
);
for (const offender of offenders) console.error(`  ${offender}`);
console.error(
  '\nTake the object bare rather than in an option, a sequence, a map or a record\n' +
    'field, so the generator emits lower() and the handle map is consulted. The\n' +
    'shape is veloqrs `set_observer`, and src/__tests__/bindings/\n' +
    'observerLoweredByHandle.test.ts holds the runtime behaviour this rests on.'
);
process.exit(1);
