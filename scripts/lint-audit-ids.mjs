#!/usr/bin/env node
// An audit id in a comment points at a document that lives on one machine and
// has no remote, so a reader anywhere else cannot resolve it, and the entry it
// names moves to the closed file the moment the work lands. State the
// constraint instead. `git log` and `git blame` are the history.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMENT = /^\s*(\*|\/\/|\/\/\/|\/\/!|\/\*)/;
const AUDIT_ID = /`(?:SB|B|F|X|U|D|C|R|S|Q|I)\d+`/;

// `cwd` does not decide which repository git reads. The pre-commit hook exports
// GIT_DIR and GIT_INDEX_FILE, and those win, so a guard pointed at a fixture
// with --root would list the repository's own files instead. Drop them.
const GIT_ENV = (() => {
  const env = { ...process.env };
  for (const key of [
    'GIT_DIR',
    'GIT_INDEX_FILE',
    'GIT_WORK_TREE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_COMMON_DIR',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_CEILING_DIRECTORIES',
  ]) {
    delete env[key];
  }
  return env;
})();

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

// The generated bindings carry the crate's own docstrings, so a hit there is
// the Rust comment reported twice and fixed once.
const GENERATED = /generated|\.generated\./;

function sources() {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', 'src', 'modules/veloqrs/src', 'modules/veloqrs/rust/veloqrs/src'],
    { cwd: root, env: GIT_ENV, encoding: 'utf8' }
  );
  return out.split('\0').filter((f) => /\.(tsx?|rs)$/.test(f) && !GENERATED.test(f));
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
    if (!COMMENT.test(line) || !AUDIT_ID.test(line)) return;
    failures.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error(`A comment must not name an audit id. ${failures.length} do.`);
  console.error('Say what the constraint is, not which item found it.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Audit-id guard: no comment names one.');
