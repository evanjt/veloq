#!/usr/bin/env node
// Every intervals.icu request path and query is built in the endpoint module,
// and every request goes through the transport from there. A path built
// anywhere else is a request a second data source could not be put behind.
//
// Refused outside the owners: a string literal beginning `"/activity` or
// `"/athlete`, and a call to one of the transport's request methods. Test code
// is exempt: a `#[cfg(test)]` item, a `tests` directory and a `tests.rs` file.
// Comments are not read.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';
import { blankTestItems } from './lib/rustTestItems.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const CRATE = 'modules/veloqrs/rust/veloqrs';

// The files that own the requests, relative to the crate's `src/`.
const ENDPOINTS = 'net/intervals/endpoints.rs';
const CALL_OWNERS = [ENDPOINTS, 'net/transport.rs'];

const PATH_LITERAL = /"\/(?:activity|athlete)\b/;
const REQUEST_CALL =
  /(?<!fn\s+)\b(?:get_bytes|get_json|post_json|put_json|post_multipart)\s*(?:::\s*<|\()/;

const isTestFile = (rel) => /(^|\/)tests(\/|\.rs$)/.test(rel);

// `source` with every comment blanked and every line break kept, so a match
// is code and its line number is the file's. A string literal is skipped
// whole, so `//` inside one is not read as a comment.
export const withoutComments = (source) => {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const nl = source.indexOf('\n', i);
      i = (nl === -1 ? source.length : nl) - 1;
    } else if (ch === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      const end = close === -1 ? source.length : close + 2;
      out += source.slice(i, end).replace(/[^\n]/g, '');
      i = end - 1;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j;
    } else if (ch === "'") {
      const literal = /^'(?:\\.[^']*|[^\\'])'/.exec(source.slice(i, i + 12));
      out += literal ? literal[0] : ch;
      if (literal) i += literal[0].length - 1;
    } else {
      out += ch;
    }
  }
  return out;
};

// The lines of `source`, a file at `rel` under the crate's `src/`, that build
// an intervals.icu request outside the endpoint module.
export const strayRequests = (rel, source) => {
  if (isTestFile(rel)) return [];
  const checkPaths = rel !== ENDPOINTS;
  const checkCalls = !CALL_OWNERS.includes(rel);
  if (!checkPaths && !checkCalls) return [];
  const found = [];
  withoutComments(blankTestItems(source))
    .split('\n')
    .forEach((text, i) => {
      if ((checkPaths && PATH_LITERAL.test(text)) || (checkCalls && REQUEST_CALL.test(text))) {
        found.push(i + 1);
      }
    });
  return found;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = `${CRATE}/src/`;
  const hits = [];
  for (const [rel, bytes] of treeSources(ROOT, [relative(ROOT, join(ROOT, src))])) {
    if (!rel.endsWith('.rs') || !rel.startsWith(src)) continue;
    const inCrate = rel.slice(src.length);
    for (const line of strayRequests(inCrate, bytes.toString('utf8'))) {
      hits.push(`${rel}:${line}`);
    }
  }
  if (hits.length === 0) {
    console.log('Intervals paths guard: every request is built in the endpoint module.');
    process.exit(0);
  }
  console.error('An intervals.icu request is built outside the endpoint module.');
  console.error(`Add a fetcher to ${CRATE}/src/${ENDPOINTS} and call that instead:\n`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
