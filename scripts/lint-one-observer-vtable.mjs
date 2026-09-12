#!/usr/bin/env node
// One foreign binding may run its callback-interface initialisation per
// process, and no more.
//
// `uniffi_veloqrs_fn_init_callback_vtable_engineobserver` is a single exported
// slot. JavaScript installs its vtable at `EngineClient.ts:293-303`. Generated
// Kotlin installs its own during `UniffiLib` initialisation, and generated
// Swift at its one-time initialisation. Last writer wins, and Rust's `notify`
// (`objects/observer.rs`) then dispatches a JS-registered observer handle
// through the other language's handle map, which at best panics on a Rust
// thread. There is no compile error, no type error and no test that reaches
// it: it is a device failure in the warm case, which is the case that works
// today, and the Android push handler runs in the app process beside live JS.
//
// So: exactly one installer in the tree, and it is the TypeScript one. A
// second binding that carries the initialisation fails here, whether it was
// generated, vendored or hand-written, and the message says what to do instead.
//
// This guard is armed before the bindings it guards exist, on purpose. The
// hazard arrives with the first generated Kotlin or Swift file, in a diff of
// tens of thousands of lines that nobody reads, and the point is to fail that
// diff rather than the device.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};
const ROOT = flagValue('--root', join(HERE, '..'));

// The symbol, and the call shape a binding wraps it in.
const SYMBOL = 'init_callback_vtable_engineobserver';

// Where a foreign binding could land. Rust itself declares the slot and must
// not be scanned; the C++ turbomodule bridges the TypeScript installer and is
// the one installer.
const ROOTS = [
  'modules/veloqrs/android',
  'modules/veloqrs/ios',
  'modules/veloqrs/uniffi',
  'android/app/src/main/java',
  'ios',
];
const EXT = /\.(kt|kts|java|swift|m|mm|h)$/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue; // a dangling link in a build directory is not our business
    }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'build' || name === 'Pods') continue;
      walk(full, out);
    } else if (EXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];
for (const r of ROOTS) {
  for (const file of walk(join(ROOT, r))) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(SYMBOL)) {
      offenders.push(relative(ROOT, file).split('\\').join('/'));
    }
  }
}

if (offenders.length === 0) {
  console.log('Observer vtable guard: TypeScript is the only installer.');
  process.exit(0);
}

console.error(
  'A second foreign binding installs the engine observer vtable. There is one\n' +
    'slot per process and the last writer wins, so this makes Rust dispatch a\n' +
    "JavaScript-registered observer handle through another language's handle map,\n" +
    'on a device, with no compile error.\n'
);
for (const file of offenders) console.error(`  ${file}`);
console.error(
  '\nReach Rust without the callback interface instead: a hand-written JNI symbol,\n' +
    'the shape modules/veloqrs/rust/veloqrs/src/basemap/jni.rs already uses for the\n' +
    'tile interceptor, which has the same problem and says so in its header.'
);
process.exit(1);
