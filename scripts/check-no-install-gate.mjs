#!/usr/bin/env node
// Veloq is free, and it is the same app from every source: the App Store, Google
// Play, GitHub Releases and a build from source. Nothing is gated on where it was
// installed or on a purchase, so a store integrity or licensing check has no
// verdict on a sideloaded or source build, and the feature it gates breaks there.
//
// Refused in the app, the OAuth proxy, the push and widget code and the native
// modules: a dependency named for Play Integrity, Play Licensing, App Attest or
// SafetyNet, and a call to one of those checks or to an install-source lookup.
// Test code is exempt: a `__tests__` directory and a `*.test.*` file.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));

const DEPENDENCY_NAME = /integrity|licensing|app-attest|safetynet/i;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

const IDENTIFIERS = [
  'com.google.android.play.core.integrity',
  'com.google.android.vending.licensing',
  'getInstallSourceInfo',
  'getInstallerPackageName',
  'playintegrity.googleapis.com',
  'DCAppAttestService',
];

const SOURCE_DIRS = ['src', 'oauth-proxy/src', 'push', 'widget'];
const NATIVE_MODULE = /^modules\/[^/]+\/(android|ios)\//;
const CONFIG_FILES = ['app.config.js'];

const isScanned = (rel) =>
  (SOURCE_DIRS.some((dir) => rel.startsWith(`${dir}/`)) ||
    NATIVE_MODULE.test(rel) ||
    CONFIG_FILES.includes(rel)) &&
  !/(^|\/)__tests__\//.test(rel) &&
  !/\.test\.[^/]+$/.test(rel);

const sources = treeSources(ROOT, ['package.json', ...SOURCE_DIRS, 'modules', ...CONFIG_FILES]);
const hits = [];

const packageText = sources.get('package.json');
if (packageText) {
  const manifest = JSON.parse(packageText.toString('utf8'));
  for (const field of DEPENDENCY_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (DEPENDENCY_NAME.test(name)) hits.push(`package.json: dependency ${name}`);
    }
  }
}

for (const [rel, bytes] of sources) {
  if (!isScanned(rel)) continue;
  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((text, i) => {
    for (const identifier of IDENTIFIERS) {
      if (text.includes(identifier)) hits.push(`${rel}:${i + 1}: ${identifier}`);
    }
  });
}

if (hits.length === 0) {
  console.log('No install gate guard: nothing is gated on where the app was installed.');
  process.exit(0);
}
console.error('A store integrity, licensing or install-source check is in the app.');
console.error('Veloq is the same app from every source, so nothing may depend on one:\n');
for (const hit of hits) console.error(`  ${hit}`);
process.exit(1);
