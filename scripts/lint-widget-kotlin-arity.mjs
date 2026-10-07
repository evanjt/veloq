#!/usr/bin/env node
// A widget Kotlin call must pass as many arguments as the function it calls declares.
//
// The Android widget sources under widget/android/java are tracked and copied into a generated
// Android project at prebuild, so nothing compiles them until a build runs there. A helper that
// loses a parameter while one call site keeps the old argument leaves the tracked source
// uncompilable, and a hand-patched generated copy on a developer's machine hides it. This reads
// the tracked files and compares each call of a function declared in them with its declaration:
// more arguments than parameters, or fewer than the parameters with no default.
//
// A function declared more than once is skipped, since the call may bind to either overload. A
// call through a receiver is checked only when the receiver is an object or class declared in
// the same tree, so a framework method that shares a name is left alone.

import { resolve } from 'node:path';

import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);
const TREE = 'widget/android/java';

/** The source with comments blanked and string contents replaced, so offsets and lines hold. */
function mask(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      const stop = end === -1 ? source.length : end + 3;
      blank(i + 3, stop - 3);
      i = stop;
    } else if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '"' || source[i] === "'") {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length && source[j] !== quote && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** The text between the bracket at `open` and its match, and the offset after the match. */
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return undefined;
}

/** Top-level comma-separated parts; `angles` also nests generics, which a call cannot. */
function split(text, angles) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (angles && c === '<') depth++;
    else if (angles && c === '>' && text[i - 1] !== '-') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((p) => p.trim() !== '');
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;

// Out of the index inside a checkout, so the verdict is on what a commit records and not on
// whichever session has a file open; a fixture root that is not a repository is read off the disk.
const listing = treeSources(root, [TREE]);
refuseEmptyListing(listing, 'Widget Kotlin arity guard');
const sources = [...listing]
  .filter(([path]) => path.endsWith('.kt'))
  .map(([path, bytes]) => ({
    file: path.slice(TREE.length + 1),
    text: mask(bytes.toString('utf8')),
  }));

const declared = new Map();
const declarations = new Set();
const owners = new Set();
for (const { file, text } of sources) {
  for (const m of text.matchAll(/\b(?:object|class|interface)\s+(\w+)/g)) owners.add(m[1]);
  for (const m of text.matchAll(/\bfun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(\w+)\s*\(/g)) {
    const params = balanced(text, m.index + m[0].length - 1);
    if (!params) continue;
    declarations.add(`${file}:${m.index + m[0].lastIndexOf(m[1])}`);
    const list = split(params.inner, true);
    const entry = {
      total: list.length,
      required: list.filter((p) => !/^[^=]*=/.test(p.replace(/->/g, ''))).length,
      vararg: list.some((p) => /^\s*vararg\b/.test(p)),
    };
    declared.set(m[1], declared.has(m[1]) ? null : entry);
  }
}

const found = [];
for (const { file, text } of sources) {
  for (const m of text.matchAll(/(?<before>(?:\w+\s*\.\s*)?)\b(?<name>\w+)\s*\(/g)) {
    const entry = declared.get(m.groups.name);
    if (!entry) continue;
    if (declarations.has(`${file}:${m.index + m.groups.before.length}`)) continue;
    const receiver = m.groups.before.replace(/\s*\.\s*$/, '');
    if (receiver && !owners.has(receiver)) continue;
    const open = m.index + m[0].length - 1;
    const args = balanced(text, open);
    if (!args) continue;
    const trailingLambda = /^[ \t]*\{/.test(text.slice(args.end));
    const count = split(args.inner, false).length + (trailingLambda ? 1 : 0);
    const tooMany = !entry.vararg && count > entry.total;
    const tooFew = count < entry.required;
    if (tooMany || tooFew) {
      found.push(
        `${file}:${lineOf(text, m.index)}: ${m.groups.name} declares ${entry.total} parameter(s), ` +
          `${entry.required} without a default, and the call passes ${count}`
      );
    }
  }
}

if (found.length > 0) {
  console.error(found.join('\n'));
  process.exit(1);
}
