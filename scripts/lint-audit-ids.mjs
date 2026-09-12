#!/usr/bin/env node
// An audit id in a comment points at a document that lives on one machine and
// has no remote, so a reader anywhere else cannot resolve it, and the entry it
// names moves to the closed file the moment the work lands. State the
// constraint instead. `git log` and `git blame` are the history.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMENT = /^\s*(\*|\/\/|\/\/\/|\/\/!|\/\*)/;

// Two forms, and deliberately no more. A backticked id anywhere, which is the
// audit's own prose style, and an id opening a comment before a colon, which is
// how three reached the tree without backticks.
//
// A bare id mid-sentence is left alone on purpose. `S22` is the phone the
// measurements were taken on, and the insights engine documents its own rules
// as `G1` to `G4`, `R5` to `R8` and `D9` to `D12`, which collide with two audit
// keys by coincidence. Matching those would push someone to rename a real
// vocabulary to satisfy a lint, which is worse than the gap.
const KEY = '(?:SB|B|F|X|U|D|C|R|S|Q|I)\\d+';
const AUDIT_ID = new RegExp('`' + KEY + '`');
const LABELLED_ID = new RegExp('^\\s*(?:\/\/+!?|\\*|\/\\*+)\\s*' + KEY + '\\s*:');

// Standard identifiers that happen to read as a key and a number. Backticking is
// what a standard's own name gets in a comment, so the backtick rule on its own
// cannot tell one from an id copied out of the register. `S256` is RFC 7636's
// code challenge method and there is no item S256; rewording it to "the hashed
// challenge method" to satisfy this guard lost the term a reader would search
// for, which is the outcome the paragraph above calls worse than the gap.
//
// Exact matches only, so the key they sit on stays closed: `S25` and `S2560` are
// still reported.
const STANDARD_IDS = ['S256'];
const STANDARD = new RegExp('`(?:' + STANDARD_IDS.join('|') + ')`', 'g');

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
    if (!COMMENT.test(line)) return;
    // Scrubbed, not skipped: a line may carry a standard identifier and a real
    // id, and only the second is the thing this guard is for.
    const scrubbed = line.replace(STANDARD, '``');
    if (!AUDIT_ID.test(scrubbed) && !LABELLED_ID.test(scrubbed)) return;
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
