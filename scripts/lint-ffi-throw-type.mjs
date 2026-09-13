#!/usr/bin/env node
// An exported function throws `VeloqError`, and nothing else.
//
// `uniffi_bindgen` renders a throw type only when it is an enum, an object, or
// a custom type wrapping one. Anything else panics the generator
// (`uniffi_bindgen-0.31.0/src/interface/mod.rs:1338`, "unknown throw type"),
// which writes no bindings and leaves the committed ones in place.
//
// Nothing else catches it. The generator is not run by any gate, `cargo build`
// is happy, and `npm run ffi:manifest` reads the committed manifest rather than
// the library, so the tree compiles, tests pass and the app starts. The cost
// lands on whoever next changes the FFI surface and cannot regenerate: that was
// `B707`, three commits later.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};
const ROOT = flagValue('--root', join(HERE, '..'));
const CRATE = join(ROOT, 'modules/veloqrs/rust/veloqrs/src');

/** The one error type the bindings can render. */
const ALLOWED = 'VeloqError';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.rs')) out.push(full);
  }
  return out;
}

// The return type of the signature beginning at `line`, which may wrap over
// several lines: everything from the `->` to the `{` that opens the body.
function returnType(lines, line) {
  const text = lines.slice(line, line + 12).join('\n');
  const arrow = text.indexOf('->');
  if (arrow === -1) return '';
  const brace = text.indexOf('{', arrow);
  return text.slice(arrow + 2, brace === -1 ? undefined : brace).trim();
}

const offenders = [];

/** The signature lines an `#[uniffi::export]` at `i` covers. */
function exportedSignatures(lines, i) {
  const out = [];
  const isImpl = lines[i].includes('impl ') || /^\s*impl /.test(lines[i + 1] ?? '');
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\s*(pub )?fn /.test(lines[j])) {
      out.push(j);
      // A free function's attribute covers that one signature and stops.
      if (!isImpl) return out;
    }
    // An exported impl block ends at the brace in the first column.
    if (isImpl && lines[j] === '}') return out;
  }
  return out;
}

/** The error type of a `Result<_, E>` return, or null when it is not one. */
function throwType(ret) {
  const m = ret.match(/^Result\s*<(.*)>$/s);
  if (!m) return null;
  let depth = 0;
  let split = -1;
  for (let k = 0; k < m[1].length; k++) {
    const c = m[1][k];
    if (c === '<' || c === '(') depth++;
    else if (c === '>' || c === ')') depth--;
    else if (c === ',' && depth === 0) split = k;
  }
  if (split === -1) return null;
  return m[1]
    .slice(split + 1)
    .trim()
    .replace(/^crate::/, '');
}

for (const file of walk(CRATE)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/^\s*#\[uniffi::export/.test(line)) return;
    for (const j of exportedSignatures(lines, i)) {
      const err = throwType(returnType(lines, j));
      if (err === null || err === ALLOWED) continue;
      offenders.push({ where: `${relative(ROOT, file)}:${j + 1}`, name: lines[j].trim(), err });
    }
  });
}

if (offenders.length === 0) {
  console.log(`FFI throw types: every export throws ${ALLOWED}.`);
  process.exit(0);
}

console.error(
  'An exported function throws a type the binding generator cannot render, so\n' +
    '`npm run ffi:generate` panics with "unknown throw type" and writes nothing.\n' +
    'Nothing else fails: the crate compiles and the committed bindings stay stale.\n'
);
for (const o of offenders) console.error(`  ${o.where}  throws ${o.err}\n    ${o.name}`);
console.error(
  `\nReturn ${ALLOWED} instead, mapping the inner error into one of its variants.\n` +
    'It is the only error type on the surface, and the only one that renders.'
);
process.exit(1);
