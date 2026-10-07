#!/usr/bin/env node
// A comment that cites a line number or a line count is wrong the next time
// anyone edits the file, and nothing tells the reader it has gone stale. Both
// files this was written for had drifted by 30 to 200 per cent before anyone
// noticed. Name the symbol instead, or say nothing.

import { commentSyntaxOf, commentsOf } from './lib/commentSyntax.mjs';
import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

// A line cited in words, a line count, or a path with a line after a colon. A
// decimal is a figure and not a line: coverage reports `lines 73.71`.
const CITATION =
  /\b(lines? \d+(?!\.?\d)(\s*[-–]\s*\d+)?|\d+ lines)\b|\.(rs|tsx?|m?js|sql|kt|swift|sh|ya?ml|toml):\d+/i;

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

// Out of the index and not off the disk: this runs in the one checkout every
// worktree merges through, so a working copy here is whatever session has a
// file open rather than what anyone is committing.
//
// Every tracked file is read whose comments have a syntax this knows, and the
// generated ones are left out (see lib/commentSyntax.mjs). Tests are read too.
// A test's header is a comment like any other, and the fixtures that quote a
// citation do so inside strings, which are not.
function sources() {
  const tracked = indexedSources(root);
  refuseEmptyListing(tracked, 'Comment line-reference guard');
  return [...tracked].filter(([file]) => commentSyntaxOf(file));
}

const failures = [];
for (const [file, bytes] of sources()) {
  const text = bytes.toString('utf8');
  const lines = text.split('\n');
  for (const { line, text: comment } of commentsOf(text, commentSyntaxOf(file))) {
    if (!CITATION.test(comment)) continue;
    failures.push(`${file}:${line}  ${lines[line - 1].trim()}`);
  }
}

if (failures.length > 0) {
  console.error(`A comment must not cite a line number or a line count. ${failures.length} do.`);
  console.error('Name the symbol, or drop the reference.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Comment line-reference guard: no comment cites a line.');
