#!/usr/bin/env node
// A tracked link under the veloqrs pod directory bundles nothing on iOS.
//
// CocoaPods lists a pod's files by walking its own directory and does not
// descend into a link, so a resource bundle globbed through one is empty: the
// pod installs, the app builds, and every sprite and glyph request answers 404.
// Android's Gradle follows links, which is why the same link looks right there.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const POD_DIR = 'modules/veloqrs/ios/';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const listing = execFileSync('git', ['ls-files', '-s', '-z', '--', POD_DIR], {
  cwd: root,
  env: gitFreeEnv(),
  encoding: 'utf8',
});

const links = listing
  .split('\0')
  .filter((entry) => entry.startsWith('120000 '))
  .map((entry) => entry.slice(entry.indexOf('\t') + 1));

if (links.length > 0) {
  console.error(
    `lint-pod-source-links: ${links.length} tracked link(s) under ${POD_DIR}, which CocoaPods does not follow:`
  );
  for (const link of links) console.error(`  ${link}`);
  console.error('Copy the files from the podspec instead, the way BasemapAssets is.');
  process.exit(1);
}
