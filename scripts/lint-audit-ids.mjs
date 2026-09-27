#!/usr/bin/env node
// An audit id in a comment points at a document that lives on one machine and
// has no remote, so a reader anywhere else cannot resolve it, and the entry it
// names moves to the closed file the moment the work lands. State the
// constraint instead. `git log` and `git blame` are the history.

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

// Slash comments for the TypeScript, JavaScript and Rust, hash comments for the
// shell, the hooks and the workflows. Each file is read in its own syntax, so a
// `#[cfg]` attribute is not a comment and a backticked echo in a script is not
// read as one either.
const SLASH = '(?:\\/\\/+!?|\\*|\\/\\*+)';
const HASH = '#+';

// Three forms, and deliberately no more. A backticked id anywhere, which is the
// audit's own prose style. An id opening a comment before a colon, which is how
// three reached the tree without backticks. And an id, or a comma list of them,
// that is the whole of a parenthesis, which is how a clause most often ended by
// the time the guard learned to read it.
//
// A bare id mid-sentence is left alone on purpose. S22 is the phone the
// measurements were taken on, and the insights engine documents its own rules
// as G1 to G4, R5 to R8 and D9 to D12, which collide with two audit keys by
// coincidence. Matching those would push someone to rename a real vocabulary
// to satisfy a lint, which is worse than the gap. The parenthesised form leaves
// out the D, R and S keys for the same reason: a rule pair and the phone are
// written that way too.
const KEY = '(?:SB|B|F|X|U|D|C|R|S|Q|I)\\d+';
const PAREN_KEY = '(?:SB|B|F|X|U|C|Q|I)\\d+';
const AUDIT_ID = new RegExp('`' + KEY + '`');
const PAREN_ID = new RegExp('\\(' + PAREN_KEY + '(?:, ?' + PAREN_KEY + ')*\\)');

function syntax(marker) {
  return {
    comment: new RegExp('^\\s*' + marker),
    labelled: new RegExp('^\\s*' + marker + '\\s*' + KEY + '\\s*:'),
  };
}

const SLASH_SYNTAX = syntax(SLASH);
const HASH_SYNTAX = syntax(HASH);

// Standard identifiers that happen to read as a key and a number. Backticking is
// what a standard's own name gets in a comment, so the backtick rule on its own
// cannot tell one from an id copied out of the register. S256 is RFC 7636's
// code challenge method and there is no item by that name; rewording it to "the
// hashed challenge method" to satisfy this guard lost the term a reader would
// search for, which is the outcome the paragraph above calls worse than the gap.
//
// Exact matches only, so the key they sit on stays closed: S25 and S2560 are
// still reported.
const STANDARD_IDS = ['S256'];
const STANDARD = new RegExp('`(?:' + STANDARD_IDS.join('|') + ')`', 'g');

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

// The generated bindings carry the crate's own docstrings, so a hit there is
// the Rust comment reported twice and fixed once.
// A generated directory or a `.generated.` file, not any path holding the word.
const GENERATED = /(^|\/)generated\/|\.generated\./;

// Out of the index and not off the disk: this runs in the one checkout every
// worktree merges through, so a working copy here is whatever session has a
// file open rather than what anyone is committing.
function sources() {
  const tracked = indexedSources(root, [
    'src',
    'modules/veloqrs/src',
    'modules/veloqrs/rust/veloqrs/src',
    'modules/veloqrs/rust/veloqrs/tests',
    'modules/veloqrs/rust/veloqrs/benches',
    'modules/veloqrs/rust/veloqrs/examples',
    'scripts',
    '.husky',
    '.github',
  ]);
  refuseEmptyListing(tracked, 'Audit-id guard');
  return [...tracked].filter(([file]) => syntaxOf(file) && !GENERATED.test(file));
}

// The hooks git runs carry no extension, so a file directly under `.husky` is
// a shell script by where it sits.
function syntaxOf(file) {
  if (/\.(tsx?|m?js|rs)$/.test(file)) return SLASH_SYNTAX;
  if (/\.(sh|ya?ml)$/.test(file) || /^\.husky\/[^/.]+$/.test(file)) return HASH_SYNTAX;
  return null;
}

const failures = [];
for (const [file, bytes] of sources()) {
  const text = bytes.toString('utf8');
  const { comment, labelled } = syntaxOf(file);
  text.split('\n').forEach((line, i) => {
    if (!comment.test(line)) return;
    // Scrubbed, not skipped: a line may carry a standard identifier and a real
    // id, and only the second is the thing this guard is for.
    const scrubbed = line.replace(STANDARD, '``');
    if (!AUDIT_ID.test(scrubbed) && !labelled.test(scrubbed) && !PAREN_ID.test(scrubbed)) return;
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
