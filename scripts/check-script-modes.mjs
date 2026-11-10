#!/usr/bin/env node
// A shell script that starts with a shebang is run by its path. Git records
// whether a file may run in its mode, 100755 or 100644, and a checkout restores
// that mode, so a script committed as 100644 fails with Permission denied the
// first time anyone runs it by name. The mode is the only thing that says so:
// nothing in the gates reads the file, and a script nothing calls stays broken.
//
// Checked: the top-level `scripts/*.sh` files that start with `#!`, as the index
// holds them. Not checked:
//   - a shell library another script sources, which has no shebang;
//   - a script in a subdirectory, such as `scripts/thread-budget/`, which is
//     pushed to a device and run as `sh sample.sh`, so its mode is never read;
//   - Node and Python scripts, which run through their interpreter.
//
// Usage: node scripts/check-script-modes.mjs [--root DIR]

import { execFileSync } from 'node:child_process';

import { gitFreeEnv, indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const EXECUTABLE = '100755';
const TOP_LEVEL_SHELL = /^scripts\/[^/]+\.sh$/;

// `ls-files -s` names each path with the mode the index holds for it.
const listing = execFileSync('git', ['ls-files', '-s', '-z', '--', 'scripts'], {
  cwd: root,
  env: gitFreeEnv(),
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

const modes = new Map();
for (const entry of listing.split('\0')) {
  if (entry === '') continue;
  const tab = entry.indexOf('\t');
  const mode = entry.slice(0, tab).split(' ')[0];
  const file = entry.slice(tab + 1);
  if (TOP_LEVEL_SHELL.test(file)) modes.set(file, mode);
}
refuseEmptyListing(modes, 'Script mode guard');

// The bytes come from the index, as every whole-tree guard reads them, so a
// shebang that another session has open on disk does not decide the verdict.
const sources = indexedSources(root, [...modes.keys()]);

const failures = [];
for (const [file, mode] of modes) {
  if (mode === EXECUTABLE) continue;
  const bytes = sources.get(file);
  if (bytes === undefined || bytes.subarray(0, 2).toString('latin1') !== '#!') continue;
  failures.push(`${file}  tracked as ${mode}`);
}

if (failures.length > 0) {
  console.error(
    `${failures.length} shell script(s) start with a shebang and are tracked without the executable bit.`
  );
  console.error('');
  for (const line of failures) console.error(`  ${line}`);
  console.error('');
  console.error('A checkout restores the recorded mode, so running the script by its path fails');
  console.error('with Permission denied. Mark each one executable in the index:');
  console.error('  git update-index --chmod=+x <file>');
  process.exit(1);
}
