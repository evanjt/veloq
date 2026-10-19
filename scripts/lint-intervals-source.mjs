#!/usr/bin/env node
// Every intervals.icu request goes through the session: the sync, the
// on-demand verbs, the backfills, the credential check and the track fetch
// all ask an `IntervalsSession` or a `Source`, and only the intervals module
// calls the endpoint module's requests. A request that names the endpoint
// module directly is one a second data source would have to be threaded
// through by hand.
//
// A request is a `pub async fn` in the endpoint module, read from the tree so
// a new one is covered the day it lands. Refused outside `net/intervals/`: a
// request named through an `endpoints::` path, in a call or in an import, and
// a glob import of the module. Its constants, types and parsers stay free to
// use.
//
// The callers name the source the app runs as `LiveSource`, built by
// `live_source`, both owned by `net/live.rs`, so a fork plugs its own source
// in by editing that file and its own module. `IntervalsSession` named outside
// `net/intervals/` and that owner is refused.
//
// Test code is exempt: a `#[cfg(test)]` item, a `tests` directory and a
// `tests.rs` file. Comments are not read.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';
import { blankTestItems } from './lib/rustTestItems.mjs';
import { withoutComments } from './lint-intervals-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const CRATE = 'modules/veloqrs/rust/veloqrs';

// Relative to the crate's `src/`.
const OWNER = 'net/intervals/';
const ENDPOINTS = `${OWNER}endpoints.rs`;
const LIVE_OWNER = 'net/live.rs';

const REQUEST_FN = /\bpub(?:\([^)]*\))?\s+async\s+fn\s+(\w+)/g;

const isTestFile = (rel) => /(^|\/)tests(\/|\.rs$)/.test(rel);

/** The names of the requests the endpoint module's source declares. */
export const requestNames = (endpointsSource) =>
  new Set([...withoutComments(endpointsSource).matchAll(REQUEST_FN)].map((m) => m[1]));

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

// The lines of `source`, a file at `rel` under the crate's `src/`, that name
// one of `requests` through the endpoint module from outside the intervals
// module.
export const strayRequests = (rel, source, requests) => {
  if (rel.startsWith(OWNER) || isTestFile(rel)) return [];
  const code = withoutComments(blankTestItems(source));
  const found = new Set();
  for (const m of code.matchAll(/\bendpoints\s*::\s*(\*|\w+|\{)/g)) {
    const after = m.index + m[0].length;
    if (m[1] === '*') {
      found.add(lineAt(code, m.index));
    } else if (m[1] === '{') {
      const close = code.indexOf('}', after);
      const group = code.slice(after, close === -1 ? code.length : close);
      for (const name of group.matchAll(/\b\w+\b/g)) {
        if (requests.has(name[0])) found.add(lineAt(code, after + name.index));
      }
    } else if (requests.has(m[1])) {
      found.add(lineAt(code, m.index));
    }
  }
  return [...found].sort((a, b) => a - b);
};

// The lines of `source`, a file at `rel` under the crate's `src/`, that name
// the intervals.icu session from outside the intervals module and the live
// source owner.
export const straySessionNames = (rel, source) => {
  if (rel.startsWith(OWNER) || rel === LIVE_OWNER || isTestFile(rel)) return [];
  const code = withoutComments(blankTestItems(source));
  const found = new Set();
  for (const m of code.matchAll(/\bIntervalsSession\b/g)) found.add(lineAt(code, m.index));
  return [...found].sort((a, b) => a - b);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = `${CRATE}/src/`;
  const sources = treeSources(ROOT, [relative(ROOT, join(ROOT, src))]);
  const endpoints = sources.get(`${src}${ENDPOINTS}`);
  if (!endpoints) {
    console.error(`Intervals source guard: ${src}${ENDPOINTS} is not in the tree.`);
    process.exit(2);
  }
  const requests = requestNames(endpoints.toString('utf8'));
  const hits = [];
  const named = [];
  for (const [rel, bytes] of sources) {
    if (!rel.endsWith('.rs') || !rel.startsWith(src)) continue;
    const text = bytes.toString('utf8');
    for (const line of strayRequests(rel.slice(src.length), text, requests)) {
      hits.push(`${rel}:${line}`);
    }
    for (const line of straySessionNames(rel.slice(src.length), text)) {
      named.push(`${rel}:${line}`);
    }
  }
  if (hits.length === 0 && named.length === 0) {
    console.log('Intervals source guard: every intervals.icu request goes through the session.');
    process.exit(0);
  }
  if (hits.length > 0) {
    console.error('An intervals.icu request is made outside the session.');
    console.error(
      `Ask the IntervalsSession or a Source method in ${CRATE}/src/${OWNER}mod.rs instead:\n`
    );
    for (const hit of hits) console.error(`  ${hit}`);
  }
  if (named.length > 0) {
    if (hits.length > 0) console.error('');
    console.error('The intervals.icu session is named outside the live source owner.');
    console.error(
      `Name LiveSource and build it with live_source from ${CRATE}/src/${LIVE_OWNER}, or take \`&impl Source\`:\n`
    );
    for (const hit of named) console.error(`  ${hit}`);
  }
  process.exit(1);
}
