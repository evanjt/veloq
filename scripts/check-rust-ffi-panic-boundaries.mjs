#!/usr/bin/env node
// Native C and JNI entry points catch panics before the ABI, except input-only free functions.

import { join, resolve } from 'node:path';
import { treeSources } from './lib/indexedSources.mjs';

const sourceRoot = process.argv.includes('--root')
  ? process.argv[process.argv.indexOf('--root') + 1]
  : 'modules/veloqrs/rust/veloqrs/src';
const entryPoint = /\bextern\s+(?:"([^"]*)"\s+)?fn\s+(\w+)/g;
const attributeStart = /#\s*\[/g;
const exportWord = /\b(?:no_mangle|export_name)\b/;
const macroExtern = /\bextern\s+(?:"[^"]*"\s*)?fn\s+[\w$]/g;
const macroDefinition = /\bmacro_rules!\s*\w+\s*([({\[])/g;
const refusal = /^(?:false|true|\(\)|-?\d+|std::ptr::null_mut\(\)|u8::from\(false\)|[A-Z][A-Z0-9_]*(?:::[A-Z][A-Z0-9_]*)*)$/;
const label = /^(?:"(?:\\.|[^"\\])*"|[A-Z][A-Z0-9_]*(?:::[A-Z][A-Z0-9_]*)*)$/;

// The default root is this repository's crate, read out of the index. A `--root`
// is a fixture directory, which has only its disk.
function rustSources(dir) {
  const fromRepository = !process.argv.includes('--root');
  const sources = fromRepository ? treeSources(process.cwd(), [dir]) : treeSources(resolve(dir));
  return [...sources]
    .filter(([name]) => name.endsWith('.rs'))
    .map(([name, bytes]) => ({
      path: fromRepository ? name : join(dir, name),
      source: bytes.toString('utf8'),
    }));
}

function skipLexeme(source, index) {
  if (source.startsWith('//', index)) {
    const end = source.indexOf('\n', index + 2);
    return end === -1 ? source.length : end;
  }
  if (source.startsWith('/*', index)) {
    const end = source.indexOf('*/', index + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (source[index] === "'") {
    const character = source.slice(index).match(/^'(?:\\(?:u\{[0-9a-fA-F_]+\}|x[0-9a-fA-F]{2}|.)|[^'\\\n])'/);
    return character ? index + character[0].length : index;
  }
  // A raw string takes no escapes and ends at a quote followed by as many
  // hashes as it opened with. `r#ident` is a raw identifier, not a string.
  const previous = index > 0 ? source[index - 1] : '';
  if (!/\w/.test(previous)) {
    const raw = source.slice(index, index + 260).match(/^(?:br|cr|r)(#*)"/);
    if (raw) {
      const end = source.indexOf(`"${raw[1]}`, index + raw[0].length);
      return end === -1 ? source.length : end + 1 + raw[1].length;
    }
  }
  if (source[index] !== '"') return index;
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === '\\') i += 1;
    else if (source[i] === '"') return i + 1;
  }
  return source.length;
}

function lexemeRanges(source) {
  const ranges = [];
  for (let i = 0; i < source.length; i += 1) {
    const end = skipLexeme(source, i);
    if (end === i) continue;
    ranges.push([i, end]);
    i = end - 1;
  }
  return ranges;
}

function withoutComments(source, ranges) {
  const chars = source.split('');
  for (const [start, end] of ranges) {
    if (!source.startsWith('//', start) && !source.startsWith('/*', start)) continue;
    for (let i = start; i < end; i += 1) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}

function withoutStrings(text, offset, ranges) {
  const chars = text.split('');
  for (const [start, end] of ranges) {
    for (let i = Math.max(start, offset); i < Math.min(end, offset + text.length); i += 1) {
      chars[i - offset] = ' ';
    }
  }
  return chars.join('');
}

function codeMatches(source, pattern, ranges) {
  return [...source.matchAll(pattern)].filter((match) =>
    !ranges.some(([start, end]) => start <= match.index && match.index < end));
}

function closingAt(source, start, opening, closing) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const next = skipLexeme(source, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    if (source[i] === opening) depth += 1;
    if (source[i] === closing && --depth === 0) return i;
  }
  return -1;
}

function argumentsOf(source) {
  const args = [];
  const stack = [];
  let start = 0;
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < source.length; i += 1) {
    const next = skipLexeme(source, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const char = source[i];
    if ('([{'.includes(char)) stack.push(char);
    else if (char in pairs && stack.pop() !== pairs[char]) return null;
    else if (char === ',' && stack.length === 0) {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (stack.length > 0) return null;
  args.push(source.slice(start).trim());
  return args;
}

function isWrapped(body) {
  const opening = body.match(/^crate::ffi_refuse_on_panic\s*\(/);
  if (!opening) return false;
  const close = closingAt(body, opening[0].length - 1, '(', ')');
  if (close === -1 || body.slice(close + 1).trim() !== '') return false;
  const args = argumentsOf(body.slice(opening[0].length, close));
  return args?.length === 3 && label.test(args[0]) && refusal.test(args[1])
    && /^(?:move\s+)?\|\s*\|\s*\S/.test(args[2]);
}

function isInputOnlyFree(header, body) {
  const parameters = header.match(/\(([^)]*)\)/)?.[1] ?? '';
  const names = (argumentsOf(parameters) ?? []).map((parameter) => parameter.match(/^\s*(\w+)\s*:/)?.[1]);
  if (!names[0] || names.some((name) => !name)) return false;
  const cleaned = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  const [pointer, length] = names;
  const nullCheck = `if${pointer}.is_null(){return;}`;
  if (!cleaned.startsWith(nullCheck)) return false;
  const drop = cleaned.slice(nullCheck.length);
  return drop === `drop(unsafe{Box::from_raw(${pointer})});`
    || drop === `drop(unsafe{CString::from_raw(${pointer})});`
    || (length !== undefined
      && drop === `drop(unsafe{Box::from_raw(std::ptr::slice_from_raw_parts_mut(${pointer},${length}))});`);
}

function checkFile({ path, source }) {
  const ranges = lexemeRanges(source);
  const searchSource = withoutComments(source, ranges);
  const entries = codeMatches(searchSource, entryPoint, ranges);
  const attributes = codeMatches(searchSource, attributeStart, ranges).flatMap((attribute) => {
    const opening = attribute.index + attribute[0].length - 1;
    const closing = closingAt(source, opening, '[', ']');
    if (closing === -1) return [];
    const text = withoutStrings(searchSource.slice(opening + 1, closing), opening + 1, ranges);
    return [{ index: attribute.index, end: closing + 1, text }];
  });
  const macros = codeMatches(searchSource, macroDefinition, ranges).map((macro) => {
    const opening = macro.index + macro[0].length - 1;
    const closing = { '(': ')', '{': '}', '[': ']' }[macro[1]];
    return [opening, closingAt(source, opening, macro[1], closing)];
  });
  const inMacro = (index) => macros.some(([start, end]) => start < index && (end === -1 || index < end));
  // A macro can export a symbol the checks below never see: its attribute may
  // arrive as a fragment and its name as `$name`. So a macro that builds an
  // attribute from a fragment, exports, or declares an extern fn is refused.
  const macroFailures = [
    ...attributes.filter((attribute) => inMacro(attribute.index) && attribute.text.includes('$'))
      .map(() => `${path}: macro_rules! builds an attribute from a fragment`),
    ...codeMatches(searchSource, macroExtern, ranges).filter((entry) => inMacro(entry.index))
      .map(() => `${path}: macro_rules! declares an extern fn`),
  ];
  const exportedEntries = new Map();
  const failures = macroFailures.concat(attributes.filter((attribute) => exportWord.test(attribute.text)).flatMap((attribute) => {
    if (inMacro(attribute.index)) {
      return [`${path}: macro_rules! contains an exported symbol attribute`];
    }
    const rest = searchSource.slice(attribute.end);
    const declaration = rest.match(/^\s*(?:#\s*\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?extern\s+(?:"[^"]*"\s+)?fn\s+\w+/);
    const entryIndex = declaration === null
      ? -1
      : attribute.end + declaration[0].search(/\bextern\b/);
    const entry = entries.find((candidate) => candidate.index === entryIndex);
    if (!entry) return [`${path}: exported symbol attribute has no recognised entry point`];
    exportedEntries.set(entryIndex, (exportedEntries.get(entryIndex) ?? 0) + 1);
    return [];
  }));
  for (const [index, count] of exportedEntries) {
    if (count !== 1) failures.push(`${path}: exported entry at ${index} has ${count} symbol attributes`);
  }
  return failures.concat(entries.flatMap((entry) => {
    const name = entry[2];
    if (entry[1] !== undefined && !['C', 'system'].includes(entry[1])) {
      return [`${path}: ${name} has an unsupported extern ABI`];
    }
    const headerStart = entry.index + entry[0].length;
    const start = source.indexOf('{', headerStart);
    const end = start === -1 ? -1 : closingAt(source, start, '{', '}');
    if (end === -1 || source.slice(headerStart, start).includes(';')) {
      return [`${path}: ${name} has an unrecognised extern body`];
    }
    const header = source.slice(headerStart, start);
    const body = source.slice(start + 1, end).trim();
    if (name.endsWith('_free') && isInputOnlyFree(header, body)) return [];
    if (isWrapped(body)) return [];
    return [`${path}: ${name} must be enclosed by ffi_refuse_on_panic`];
  }));
}

const failures = rustSources(sourceRoot).flatMap(checkFile);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
}
