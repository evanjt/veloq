#!/usr/bin/env node
// style.md allows no JSDoc in TypeScript. Tags such as `@param` and `@returns`
// restate a signature the compiler already checks, and 145 of them collected in
// 28 files while no gate looked. A plain description comment is the codebase's
// normal docstring form and is not judged here, only the tag lines.
//
// The listing is the whole index, narrowed to TypeScript sources whose comments
// are readable, which leaves out the generated bindings: they carry the crate's
// own docstrings and are fixed in Rust.

import { commentSyntaxOf, commentsOf } from './lib/commentSyntax.mjs';
import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const TAG = /^\s*@(?:param|returns?|example|throws|fileoverview)\b/;

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

// Out of the index and not off the disk: this runs in the one checkout every
// worktree merges through, so a working copy here is whatever session has a
// file open rather than what anyone is committing.
const tracked = indexedSources(root);
refuseEmptyListing(tracked, 'JSDoc tag guard');

const failures = [];
for (const [file, bytes] of tracked) {
  if (!/\.tsx?$/.test(file) || !commentSyntaxOf(file)) continue;
  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  for (const { line, text: comment } of commentsOf(text, 'slash')) {
    if (TAG.test(comment)) failures.push(`${file}:${line}  ${lines[line - 1].trim()}`);
  }
}

if (failures.length > 0) {
  console.error(`style.md allows no JSDoc in TypeScript. ${failures.length} tag lines.`);
  console.error('Say it in a plain description, or leave it to the signature.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('JSDoc tag guard: no tag lines in TypeScript.');
