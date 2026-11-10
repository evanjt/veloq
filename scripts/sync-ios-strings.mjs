#!/usr/bin/env node
// Rewrite the iOS string catalogues and the widget sample in the generated project before an
// iOS build, so a translation edit reaches the build without regenerating the project.
//
//   node scripts/sync-ios-strings.mjs
//
// The identity comes from APP_VARIANT, as it does for `prepare-native.mjs`, which must have
// generated the project first. See `scripts/lib/iosStringSync.js`.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { syncIosStrings } = require('./lib/iosStringSync.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  syncIosStrings(ROOT, process.env);
} catch (error) {
  console.error(`sync-ios-strings: ${error.message}`);
  process.exit(1);
}
