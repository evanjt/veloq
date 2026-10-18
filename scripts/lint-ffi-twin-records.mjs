#!/usr/bin/env node
// One struct per engine record: no `FfiX` beside a domain struct named `X`.
//
// A record with a domain struct and an `Ffi` copy holds every field twice, and
// the `From` between them is a third place to add one. A field added to the
// domain struct and not the copy never reaches the app, and a field computed
// on the copy alone has no domain owner, so the two drift without a compiler
// error. Where the shapes match, the domain struct derives `uniffi::Record` and
// keeps the `Ffi` name with `#[uniffi(name = "FfiX")]`; an `i64` that crosses
// as a number is a `WholeNumber`, and a Rust enum that crosses as its token is
// a custom type over `String`.
//
// A twin whose two shapes genuinely differ, a wire body against the screen's
// view of it say, is listed in `scripts/ffi-twin-records-baseline.json` with
// the reason it stays. A twin missing from that list fails, and so does an
// entry that is no longer a twin, so the list only ever shrinks.
//
// Usage: node scripts/lint-ffi-twin-records.mjs [--root <tree>]

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseEmptyListing, trackedText, treeSources } from './lib/indexedSources.mjs';

// `--root` points the guard at another tree, so the rule itself can be tested.
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);
const CRATE = 'modules/veloqrs/rust/veloqrs/src';
const BASELINE = 'scripts/ffi-twin-records-baseline.json';

// A struct declared at any visibility the crate can reach. A test module's own
// fixtures are not engine records.
const STRUCT = /^\s*pub(?:\([a-z]+\))?\s+struct\s+([A-Za-z_]\w*)/gm;
const IN_TESTS = /(^|\/)tests(\/|\.rs$)/;

const sources = treeSources(ROOT, [CRATE]);
refuseEmptyListing(sources, 'lint-ffi-twin-records');

// Every declaration of each name, so a report can point at both halves.
const declared = new Map();
for (const [file, bytes] of sources) {
  if (!file.endsWith('.rs') || IN_TESTS.test(file)) continue;
  const text = bytes.toString('utf8');
  for (const match of text.matchAll(STRUCT)) {
    const name = match[1];
    const offset = match.index + match[0].length - name.length;
    const at = `${file}:${text.slice(0, offset).split('\n').length}`;
    if (!declared.has(name)) declared.set(name, []);
    declared.get(name).push(at);
  }
}

const twins = new Map();
for (const [name, at] of declared) {
  if (!name.startsWith('Ffi') || name.length === 3) continue;
  const domain = declared.get(name.slice(3));
  if (domain) twins.set(name, { ffi: at, domain });
}

const baselineText = trackedText(ROOT, BASELINE);
const baseline = baselineText === undefined ? {} : JSON.parse(baselineText);

const unlisted = [...twins.keys()].filter((name) => !(name in baseline)).sort();
const stale = Object.keys(baseline)
  .filter((name) => !twins.has(name))
  .sort();
const unreasoned = Object.keys(baseline)
  .filter((name) => twins.has(name) && !String(baseline[name] ?? '').trim())
  .sort();

if (unlisted.length > 0) {
  console.error('A record has a second struct for one domain record:');
  for (const name of unlisted) {
    const { ffi, domain } = twins.get(name);
    console.error(`  ${name}  ${ffi.join(', ')}`);
    console.error(`  ${name.slice(3)}  ${domain.join(', ')}`);
  }
  console.error('');
  console.error(`  Derive uniffi::Record on the domain struct under #[uniffi(name = "FfiX")]`);
  console.error('  and delete the copy and its From. If the shapes genuinely differ, list the');
  console.error(`  copy in ${BASELINE} with the reason it stays.`);
}
if (stale.length > 0) {
  console.error(`${BASELINE} lists records that are no longer twinned; remove them:`);
  for (const name of stale) console.error(`  ${name}`);
}
if (unreasoned.length > 0) {
  console.error(`${BASELINE} lists twins with no reason they stay:`);
  for (const name of unreasoned) console.error(`  ${name}`);
}
if (unlisted.length + stale.length + unreasoned.length > 0) process.exit(1);

console.log(`FFI twin records: ${twins.size} listed with a reason, none unlisted.`);
