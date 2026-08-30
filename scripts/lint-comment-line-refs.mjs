#!/usr/bin/env node
// A comment that cites a line number or a line count is wrong the next time
// anyone edits the file, and nothing tells the reader it has gone stale. Both
// files this was written for had drifted by 30 to 200 per cent before anyone
// noticed. Name the symbol instead, or say nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMENT = /^\s*(\*|\/\/)/;
const CITATION = /\b(lines? \d+(\s*[-–]\s*\d+)?|\d+ lines)\b/i;

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

function sources() {
  const out = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: root, encoding: 'utf8' });
  return out
    .split('\0')
    .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__'));
}

const failures = [];
for (const file of sources()) {
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    if (!COMMENT.test(line) || !CITATION.test(line)) return;
    failures.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error(`A comment must not cite a line number or a line count. ${failures.length} do.`);
  console.error('Name the symbol, or drop the reference.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Comment line-reference guard: none in src.');
