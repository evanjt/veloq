#!/usr/bin/env node
// A veloqrs test that reads the process-wide engine install without holding the
// serial lock hands that install to a stamped write, and the write is refused
// whenever a parallel test has moved the install. It passes in a full run and
// fails in a filtered or loaded one.
//
// So a `#[test]` under the crate's `src` tree whose body names `engine_install`
// must also take `serial_global_state`, by path, by name or through the alias a
// `use ... as` gave it in the same file. Each test is judged on its own body:
// a lock taken by the test beside it does not cover it.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = 'modules/veloqrs/rust/veloqrs/src';

// Blank string literals and comments, keeping offsets, so prose that names the
// install is not read as a call.
function codeOnly(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === 'r' && /^r#*"/.test(source.slice(i, i + 8)) && !/\w/.test(source[i - 1] ?? '')) {
      const hashes = /^r(#*)"/.exec(source.slice(i))[1];
      const close = `"${hashes}`;
      const end = source.indexOf(close, i + 2 + hashes.length);
      const stop = end === -1 ? source.length : end + close.length;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j + 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function bodyEnd(code, open) {
  let depth = 1;
  let j = open + 1;
  while (j < code.length && depth > 0) {
    if (code[j] === '{') depth += 1;
    else if (code[j] === '}') depth -= 1;
    j += 1;
  }
  return j;
}

const offenders = [];
for (const [file, bytes] of treeSources(ROOT, [SRC])) {
  if (!file.endsWith('.rs')) continue;
  // Blanked strings keep their quotes' width, so offsets in `code` match the source.
  const code = codeOnly(bytes.toString('utf8'));
  const names = new Set(['serial_global_state']);
  for (const m of code.matchAll(/\bserial_global_state\s+as\s+(\w+)/g)) names.add(m[1]);
  const takes = new RegExp(`\\b(?:${[...names].join('|')})\\s*\\(`);
  for (const m of code.matchAll(/#\[(?:\w+::)?test\b[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:async\s+)?fn\s+(\w+)[^{]*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = code.slice(open, bodyEnd(code, open));
    if (/\bengine_install\s*\(/.test(body) && !takes.test(body)) {
      const line = code.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line} ${m[1]}`);
    }
  }
}

if (offenders.length > 0) {
  console.error('lint-rust-test-serial: a test reads engine_install() without serial_global_state():');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('Take `let _serial = crate::test_globals::serial_global_state();` before reading the install.');
  process.exit(1);
}
console.log('lint-rust-test-serial: every test that reads engine_install() holds the serial lock');
