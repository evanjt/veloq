#!/usr/bin/env node
// A suite that made its fixture with `mkdtemp` and did not remove it left a
// directory in /tmp on every run. Tens of thousands of them used up the
// machine's inodes, and every gate failed with "no space left on device" while
// the disk was nearly empty.
//
// config/jest.tempDirs.js removes what a test file made through `fs.mkdtemp`
// when the file ends, and config/jest.setup.js installs it for every suite. So
// this guard holds two things: the setup file still installs the tracker and
// removes in an `afterAll`, and no test file makes a directory the tracker
// cannot see, which is `mktemp` run in a child process.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);

const tree = treeView(ROOT, ['src', 'config/jest.setup.js']);

function walk(dir) {
  return tree.files(
    dir,
    (rel) => /\.test\.(ts|tsx)$/.test(rel) && !rel.split('/').includes('node_modules')
  );
}

const failures = [];

const setupPath = join(ROOT, 'config/jest.setup.js');
const setup = tree.text(setupPath) ?? '';
const installs = /require\(\s*["']\.\/jest\.tempDirs["']\s*\)/.test(setup);
const removes = /afterAll\(\s*\(\)\s*=>\s*\{[^}]*\.removeAll\(\)/.test(setup);
if (!installs || !removes) {
  failures.push(
    'config/jest.setup.js does not install the temp directory tracker and remove its directories in an afterAll'
  );
}

for (const file of walk(join(ROOT, 'src'))) {
  const lines = tree.text(file).split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/)/.test(line)) return;
    if (/\bmktemp\b/.test(line)) {
      failures.push(
        `${relative(ROOT, file).split('\\').join('/')}:${i + 1} makes a temp path with mktemp, which nothing removes`
      );
    }
  });
}

if (failures.length > 0) {
  console.error(`Test temp directories left behind: ${failures.length}. /tmp runs out of inodes.`);
  console.error('Make fixtures with fs.mkdtempSync, which config/jest.tempDirs.js removes when the file ends.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Test temp directory guard: the tracker is installed and no test makes a path it cannot see.');
