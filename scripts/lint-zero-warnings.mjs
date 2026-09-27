#!/usr/bin/env node
// The lint script holds the tree at zero warnings, and only that.
//
// ESLint obeys whatever `--max-warnings` the lint script passes, so a commit
// that raised it beside a matching new warning passed every gate that read the
// number from the tree it judged. A second flag beside the zero is refused too:
// it would be the one ESLint obeys or the one a reader believes, and neither is
// safe.
//
// Reads the staged package.json in a checkout, since that is what the commit
// records, or the file given as the one argument, which the merge gate passes
// for its merged copy and the tests pass for a fixture.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function source(path) {
  if (path) return readFileSync(path, 'utf8');
  try {
    return execFileSync('git', ['show', ':package.json'], { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    return readFileSync('package.json', 'utf8');
  }
}

const pkg = JSON.parse(source(process.argv[2]));
const flags = (pkg.scripts?.lint ?? '').match(/--max-warnings[= ]\S+/g) ?? [];
if (flags.length === 1 && /[= ]0$/.test(flags[0])) process.exit(0);

console.error("lint-zero-warnings: package.json's lint script must pass --max-warnings 0, and only that");
console.error(`  found: ${flags.length > 0 ? flags.join(', ') : 'no --max-warnings flag'}`);
console.error('  fix the warnings, or disable one line with its reason; the number is not raised');
process.exit(1);
