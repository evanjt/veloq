#!/usr/bin/env node

// Guard the SDK's native dependency versions in both package files.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { trackedText } from './lib/indexedSources.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// The two package files are judged as the tree records them. The bundled
// versions come out of node_modules, which is never tracked.
function readTrackedJson(file) {
  const text = trackedText(root, file);
  if (text === undefined) throw new Error(`${file} is not in the tree`);
  return JSON.parse(text);
}

function versionOf(range) {
  if (typeof range !== 'string') return null;
  const match = range.match(/^[~^]?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function matchesSdk(candidate, expected) {
  const actual = versionOf(candidate);
  const target = versionOf(expected);
  if (!actual || !target) return false;
  if (expected.startsWith('^')) return actual[0] === target[0];
  if (expected.startsWith('~')) {
    return actual[0] === target[0] && actual[1] === target[1] && !candidate.startsWith('^');
  }
  return candidate === expected;
}

function sharesMajorMinor(candidate, reference) {
  const actual = versionOf(candidate);
  const target = versionOf(reference);
  return actual && target && actual[0] === target[0] && actual[1] === target[1];
}

// SDK 56 bundles 4.25.2. The 4.28.0 repair must be checked as an exact pin.
const SDK_EXCEPTIONS = {
  'react-native-screens': { bundled: '4.25.2', allowed: '4.28.0' },
};

let bundled;
let pkg;
let lock;
try {
  bundled = readJson(join(root, 'node_modules', 'expo', 'bundledNativeModules.json'));
} catch {
  console.error(
    'check-expo-sdk: could not read node_modules/expo/bundledNativeModules.json. Run npm install first.',
  );
  process.exit(1);
}
try {
  pkg = readTrackedJson('package.json');
} catch {
  console.error('check-expo-sdk: could not read package.json.');
  process.exit(1);
}
try {
  lock = readTrackedJson('package-lock.json');
} catch {
  lock = null;
}

const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

function lockVersion(name) {
  if (!lock || !lock.packages) return null;
  const entry = lock.packages[`node_modules/${name}`];
  return entry ? entry.version || null : null;
}

const mismatches = [];
const drift = [];

for (const [name, expectedRange] of Object.entries(bundled)) {
  if (!(name in declared)) continue;

  const declaredRange = declared[name];
  const exception = SDK_EXCEPTIONS[name];
  const expected = exception?.bundled === expectedRange ? exception.allowed : expectedRange;

  if (!matchesSdk(declaredRange, expected)) {
    mismatches.push({ name, declared: declaredRange, expected });
  }

  const resolved = lockVersion(name);
  if (resolved === null || !matchesSdk(resolved, expected)) {
    drift.push({ name, declared: declaredRange, resolved: resolved ?? 'missing' });
  }
}

const nativeVersion = declared['react-native'];
if (nativeVersion) {
  for (const [name, range] of Object.entries(declared)) {
    if (!name.startsWith('@react-native/')) continue;
    if (!sharesMajorMinor(range, nativeVersion)) {
      mismatches.push({ name, declared: range, expected: `${versionOf(nativeVersion)?.slice(0, 2).join('.')}.x` });
    }
    const resolved = lockVersion(name);
    if (!resolved || !sharesMajorMinor(resolved, nativeVersion)) {
      drift.push({ name, declared: range, resolved: resolved ?? 'missing' });
    }
  }
}

function printTable(rows, columns) {
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(r[c.key]).length)),
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  console.error(line(columns.map((c) => c.header)));
  console.error(line(widths.map((w) => '-'.repeat(w))));
  for (const row of rows) {
    console.error(line(columns.map((c) => row[c.key])));
  }
}

let failed = false;

if (mismatches.length > 0) {
  failed = true;
  console.error('\nExpo SDK mismatch (package.json vs bundledNativeModules.json):');
  printTable(mismatches, [
    { key: 'name', header: 'package' },
    { key: 'declared', header: 'declared' },
    { key: 'expected', header: 'expected' },
  ]);
}

if (drift.length > 0) {
  failed = true;
  console.error('\nLockfile drift (package.json vs package-lock.json):');
  printTable(drift, [
    { key: 'name', header: 'package' },
    { key: 'declared', header: 'declared' },
    { key: 'resolved', header: 'lock' },
  ]);
}

if (failed) {
  console.error(
    '\nFix: align the flagged packages with the SDK and update the lockfile.',
  );
  process.exit(1);
}

console.log('check-expo-sdk: all Expo SDK packages match the bundled SDK versions.');
process.exit(0);
