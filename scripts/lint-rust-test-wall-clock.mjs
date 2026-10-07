#!/usr/bin/env node
// A Rust test that asserts a duration measured off the wall clock fails when
// the machine is busy, not when the code regresses. Under fleet load a pooled
// read took over the 100 ms its tests allowed, and the per-push lane went red
// for load. The same class was removed once and came back in thirteen copies
// of one helper within two days.
//
// So an assertion in veloqrs test code may not compare against
// `Duration::from_*` or a `Duration` constant with `<`, nor bound a measured
// value from above. A value is measured when it is `.elapsed()`, an
// `Instant::now() - …`, a `.duration_since(…)`, anything computed from one
// (`.as_millis()`, `.as_secs_f64() * 1000.0`), a local or a vector bound to
// one, or the result of a helper in the same file that measures. From above is
// `<` or `<=` with the measured value on the left, `>` or `>=` with it on the
// right, inside an `assert!` or in the condition of an `if` whose block panics
// (the other way round there, since the panic is the failure). A "does not
// wait for the writer" claim is held by a writer that cannot let go until the
// read returns (`test_globals::read_while_writer_holds`), a scaling claim by a
// work counter, and a timing by a bench under `benches/`, which this skips.
// A hang guard in a loop condition or against an `Instant` deadline is not a
// bound on a measured value and is left alone, as is a lower bound.
//
// Test code is every file under a `tests/` directory and everything from a
// file's first `#[cfg(test)]` on, the convention lint-engine-write-lock.mjs
// reads it by.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const CRATE = 'modules/veloqrs/rust/veloqrs';

const BOUND = [/<(?!=)\s*(?:std::time::)?Duration::from_\w+/, /\.elapsed\(\)\s*<(?![<=])/];

const tree = treeView(ROOT, [`${CRATE}/src`, `${CRATE}/tests`]);

function walk(dir) {
  return tree.files(dir, (rel) => {
    const parts = rel.split('/');
    return rel.endsWith('.rs') && !parts.includes('benches') && !parts.includes('target');
  });
}

// Blank string literals and comments, keeping offsets, so a message that
// mentions a bound is not read as one.
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
    } else if (
      c === 'r' &&
      /^r#*"/.test(source.slice(i, i + 8)) &&
      !/\w/.test(source[i - 1] ?? '')
    ) {
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

const ASSERT = /\b(?:debug_)?assert!\s*\(/g;
const IF = /\bif\s/g;

// Where a measurement starts: the clock read that yields a duration. A time
// since `UNIX_EPOCH` is a timestamp, not something measured.
const MEASURE =
  /\.elapsed\(\)|\bInstant::now\(\)\s*-(?!=)|\.duration_since\((?!\s*(?:std::time::)?(?:SystemTime::)?UNIX_EPOCH)/;

// The index just past the bracket that closes the one opened before `from`.
function closing(code, from, open, close) {
  let depth = 1;
  let j = from;
  while (j < code.length && depth > 0) {
    if (code[j] === open) depth += 1;
    else if (code[j] === close) depth -= 1;
    j += 1;
  }
  return j;
}

// The names in `code` that hold a measured value: a local bound to one, a
// vector one is pushed into, and a helper whose body measures and returns a
// number. Followed to a fixed point, so a median of samples is measured.
function measuredNames(code) {
  const names = new Set();
  const helpers = new Set();
  for (const m of code.matchAll(/\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g)) {
    const params = closing(code, m.index + m[0].length, '(', ')');
    const sig = /^\s*->\s*([\w:]+)\s*(?:where[^{]*)?\{/.exec(code.slice(params));
    if (!sig || !/^(?:f32|f64|u32|u64|u128|usize|(?:std::time::)?Duration)$/.test(sig[1])) continue;
    const open = params + sig[0].length;
    const body = code.slice(open, closing(code, open, '{', '}'));
    if (MEASURE.test(body)) helpers.add(m[1]);
  }
  const isMeasured = (text) =>
    MEASURE.test(text) ||
    [...names].some((n) => new RegExp(`(?<![.\\w])${n}\\b(?!\\s*\\()`).test(text)) ||
    [...helpers].some((h) => new RegExp(`(?<![.\\w])${h}\\s*\\(`).test(text));
  const lets = [...code.matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]+)?=([^;]*);/g)].map((m) => [
    m[1],
    m[2],
  ]);
  const pushes = [
    ...code.matchAll(/(?<![.\w])(\w+)\s*\.\s*(?:push|extend|insert)\s*\(([^;]*)\)\s*;/g),
  ].map((m) => [m[1], m[2]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, rhs] of [...lets, ...pushes]) {
      if (!names.has(name) && isMeasured(rhs)) {
        names.add(name);
        grew = true;
      }
    }
  }
  return isMeasured;
}

// The comparisons at the top level of a condition, as [left, operator,
// right]. `&&`, `||` and a top-level comma end an operand. `->`, `=>`, `<<`,
// `>>` and a turbofish are not comparisons.
function comparisons(condition) {
  const parts = [];
  let depth = 0;
  let start = 0;
  const cut = (end) => parts.push(condition.slice(start, end));
  for (let i = 0; i < condition.length; i += 1) {
    const c = condition[i];
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (depth === 0 && (condition.startsWith('&&', i) || condition.startsWith('||', i))) {
      cut(i);
      start = i + 2;
      i += 1;
    } else if (depth === 0 && c === ',') {
      cut(i);
      start = condition.length;
      break;
    }
  }
  if (start < condition.length) cut(condition.length);
  const found = [];
  for (const part of parts) {
    let d = 0;
    for (let i = 0; i < part.length; i += 1) {
      const c = part[i];
      if ('([{'.includes(c)) d += 1;
      else if (')]}'.includes(c)) d -= 1;
      if (d !== 0 || (c !== '<' && c !== '>')) continue;
      const prev = part[i - 1] ?? '';
      const next = part[i + 1] ?? '';
      if (prev === '-' || prev === '=' || prev === c || next === c || prev === ':') continue;
      const op = next === '=' ? `${c}=` : c;
      found.push([part.slice(0, i), op, part.slice(i + op.length)]);
      break;
    }
  }
  return found;
}

// Whether a comparison bounds a measured value from above, or from below when
// it is the condition a panic fires on.
function boundsFromAbove([left, op, right], isMeasured, panics) {
  const smaller = op.startsWith('<') ? left : right;
  const larger = op.startsWith('<') ? right : left;
  return isMeasured(panics ? larger : smaller);
}

// A wait on a channel with a deadline whose expiry becomes the verdict:
// `rx.recv_timeout(d).ok()` or `.is_ok()` kept and asserted, or asserted in
// place. The deadline is a bound on how long the other side took, so a busy
// machine fails it. A wait that must succeed (`.expect`, `.unwrap`) is a hang
// guard and is left alone, as is a value only used after the wait, a deadline
// of ten seconds or more, a deadline held in a variable, and a negative wait
// (`.is_err()`): nothing arriving is the right answer there and a busy machine
// only makes it more likely.
const SHORT_WAIT =
  /\brecv_timeout\s*\(\s*(?:std::time::)?Duration::(?:from_(?:millis|micros|nanos)|from_secs\s*\(\s*[0-9]\s*\)|from_secs_f(?:32|64))/;
const VERDICT_SUFFIX = /\)\s*\.\s*(?:ok|is_ok)\s*\(\s*\)\s*$/;
const ASSERT_ANY = /\b(?:debug_)?assert(?:_eq|_ne)?!\s*\(/g;

function recvTimeoutVerdicts(code, from) {
  const bools = new Set();
  const options = new Set();
  const lets = [...code.slice(from).matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]+)?=([^;]*);/g)];
  for (const [, name, rhs] of lets) {
    if (SHORT_WAIT.test(rhs) && VERDICT_SUFFIX.test(rhs)) {
      (/\.\s*ok\s*\(\s*\)\s*$/.test(rhs) ? options : bools).add(name);
    }
  }
  for (const [, name, rhs] of lets) {
    const derived = /^\s*(\w+)\s*\.\s*(?:is_some|is_none)\s*\(\s*\)\s*$/.exec(rhs);
    if (derived && options.has(derived[1])) bools.add(name);
  }
  return (args) =>
    (SHORT_WAIT.test(args) && /\.\s*(?:ok|is_ok)\s*\(\s*\)/.test(args)) ||
    [...options].some((n) =>
      new RegExp(`(?<![.\\w])${n}\\s*\\.\\s*(?:is_some|is_none)\\s*\\(`).test(args)
    ) ||
    [...bools].some((n) => new RegExp(`(?<![.\\w])${n}\\b(?!\\s*[.(])`).test(args));
}

function hits(file) {
  const source = tree.text(file);
  const rel = relative(ROOT, file).split('\\').join('/');
  const inTests = rel.split('/').includes('tests');
  const at = source.indexOf('#[cfg(test)]');
  if (!inTests && at === -1) return [];
  const from = inTests ? 0 : at;
  const code = codeOnly(source);
  const testCode = code.slice(from);
  const isMeasured = measuredNames(testCode);
  // A bound named by a constant, `waited < FRAME_BUDGET`, is the same bound.
  const named = [
    ...code.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*:\s*(?:std::time::)?Duration\b/g),
  ].map((m) => new RegExp(`<(?!=)\\s*(?:Self::)?${m[1]}\\b`));
  const bounds = [...BOUND, ...named];
  const found = new Set();
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  ASSERT.lastIndex = from;
  let match;
  while ((match = ASSERT.exec(code))) {
    const open = match.index + match[0].length;
    const args = code.slice(open, closing(code, open, '(', ')') - 1);
    if (
      bounds.some((re) => re.test(args)) ||
      comparisons(args).some((c) => boundsFromAbove(c, isMeasured, false))
    ) {
      found.add(`${rel}:${lineOf(match.index)}`);
    }
  }
  const isVerdict = recvTimeoutVerdicts(code, from);
  ASSERT_ANY.lastIndex = from;
  while ((match = ASSERT_ANY.exec(code))) {
    const open = match.index + match[0].length;
    const args = code.slice(open, closing(code, open, '(', ')') - 1);
    if (isVerdict(args)) found.add(`${rel}:${lineOf(match.index)}`);
  }
  IF.lastIndex = from;
  while ((match = IF.exec(code))) {
    let j = match.index + match[0].length;
    let depth = 0;
    while (j < code.length && !(depth === 0 && code[j] === '{')) {
      if ('(['.includes(code[j])) depth += 1;
      else if (')]'.includes(code[j])) depth -= 1;
      else if (code[j] === ';') break;
      j += 1;
    }
    if (code[j] !== '{') continue;
    const condition = code.slice(match.index + match[0].length, j);
    if (/^\s*let\b/.test(condition)) continue;
    const block = code.slice(j + 1, closing(code, j + 1, '{', '}') - 1);
    if (!/\bpanic!\s*\(/.test(block)) continue;
    if (comparisons(condition).some((c) => boundsFromAbove(c, isMeasured, true))) {
      found.add(`${rel}:${lineOf(match.index)}`);
    }
  }
  return [...found];
}

const files = [...walk(join(ROOT, CRATE, 'src')), ...walk(join(ROOT, CRATE, 'tests'))];
const failures = files.flatMap((file) => hits(file));

if (failures.length > 0) {
  console.error(
    `Rust test assertions bounded by the wall clock: ${failures.length}. A busy machine fails them, not a regression.`
  );
  console.error(
    'Hold a "does not wait" claim with a writer that releases only when the read returns (test_globals::read_while_writer_holds), a scaling claim with a work counter, and a timing in a bench.\n'
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Rust test wall-clock guard: no assertion is bounded by the wall clock.');
