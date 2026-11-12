#!/usr/bin/env node
// Every record and enum the engine hands the app can be answered over the
// link, so each one writes itself as JSON.
//
// A `uniffi::Record` or `uniffi::Enum` without `serde::Serialize` is a type a
// link method cannot return: the method's author meets it as a compile error
// in the middle of other work, or writes a second copy of the record to get
// round it. And `serde_json` writes a `Vec<u8>` as an array of numbers, three
// to four times the bytes of the base64 string `remote::bytes` writes, so a
// byte field names that module or a stream crosses the link bloated.
//
// Usage: node scripts/lint-link-serialize.mjs [--root <repo>]

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { treeSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);
const SOURCES = 'modules/veloqrs/rust/veloqrs/src';

const BYTE_FIELD = /^\s*(?:pub(?:\([a-z]+\))? )?\w+:\s*(?:Option<Vec<u8>>|Vec<u8>),\s*$/;

/** The derive attribute that opens at `lines[at]`, joined, and the line it ends on. */
function deriveAt(lines, at) {
  let text = lines[at];
  let end = at;
  while (!text.includes(')]') && end + 1 < lines.length) text += lines[++end];
  return { text, end };
}

const sources = treeSources(ROOT, [SOURCES]);
const problems = [];
for (const [file, bytes] of sources) {
  if (!file.endsWith('.rs')) continue;
  const lines = bytes.toString('utf8').split('\n');
  for (let at = 0; at < lines.length; at++) {
    if (!/^\s*#\[derive\(/.test(lines[at])) continue;
    const { text, end } = deriveAt(lines, at);
    const record = /uniffi::Record/.test(text);
    if (!record && !/uniffi::Enum/.test(text)) continue;
    let item = end + 1;
    while (item < lines.length && !/^\s*(?:pub(?:\([a-z]+\))? )?(?:struct|enum) /.test(lines[item]))
      item++;
    const name = /(?:struct|enum) (\w+)/.exec(lines[item] ?? '')?.[1] ?? '?';
    if (!/\bSerialize\b/.test(text)) {
      problems.push(`${file}:${at + 1}  ${name} derives uniffi but not serde::Serialize`);
    }
    if (!record) continue;
    // A record written `struct Name {}` opens and closes on its own line and has no fields.
    const head = lines[item] ?? '';
    const opened = head.includes('{')
      ? (head.match(/\{/g) ?? []).length - (head.match(/\}/g) ?? []).length
      : 1;
    for (let row = item + 1, depth = opened; row < lines.length && depth > 0; row++) {
      depth += (lines[row].match(/\{/g) ?? []).length - (lines[row].match(/\}/g) ?? []).length;
      if (!BYTE_FIELD.test(lines[row])) continue;
      let above = row - 1;
      while (above > item && /^\s*(?:#\[|\/\/\/)/.test(lines[above])) {
        if (lines[above].includes('crate::remote::bytes')) break;
        above--;
      }
      if (!lines[above].includes('crate::remote::bytes')) {
        problems.push(
          `${file}:${row + 1}  ${name}.${lines[row].trim()} is a byte field without #[serde(with = "crate::remote::bytes")]`
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error('A record or enum the link would refuse or bloat:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('');
  console.error('  Derive serde::Serialize with #[serde(rename_all = "camelCase")], and write a');
  console.error('  Vec<u8> field as base64 with #[serde(with = "crate::remote::bytes")] (or');
  console.error('  crate::remote::bytes::option for an Option<Vec<u8>>).');
  process.exit(1);
}
