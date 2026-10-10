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

function isBelow(candidate, floor) {
  const actual = versionOf(candidate);
  const target = versionOf(floor);
  if (!actual || !target) return true;
  for (let i = 0; i < 3; i += 1) {
    if (actual[i] !== target[i]) return actual[i] < target[i];
  }
  return false;
}

// A floor holds whatever the SDK bundles. While the bundle sits below it the
// package is taken outside the SDK as an exact pin on the floor's major and
// minor, so a repair never brings a new minor's peers in with it.
const FLOORS = {
  'react-native-screens': {
    version: '4.28.0',
    reason: 'earlier releases initialise native state without a lock and crash Fabric mounting',
  },
  'expo-task-manager': {
    version: '56.0.24',
    reason: 'earlier releases keep every task callback and leak the background location service',
  },
  'expo-location': {
    version: '56.0.24',
    reason: 'earlier releases leak location watches',
  },
  'react-native-reanimated': {
    version: '4.3.4',
    reason:
      'earlier releases crash on withheld exiting animations, deadlock the CSS registry against the Fabric commit and leak a view unmounted mid-animation',
  },
  '@shopify/react-native-skia': {
    version: '2.9.1',
    reason:
      'earlier releases dereference a null EGL surface on first canvas render, which crash-loops launch on some Android GPUs',
  },
};

function heldAtFloor(candidate, floor) {
  return /^\d/.test(candidate) && sharesMajorMinor(candidate, floor);
}

let bundled;
let pkg;
let lock;
try {
  bundled = readJson(join(root, 'node_modules', 'expo', 'bundledNativeModules.json'));
} catch {
  console.error(
    'check-expo-sdk: could not read node_modules/expo/bundledNativeModules.json. Run npm install first.'
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
const belowFloor = [];

for (const [name, floor] of Object.entries(FLOORS)) {
  if (!(name in declared)) continue;
  const resolved = lockVersion(name);
  if (
    isBelow(declared[name], floor.version) ||
    resolved === null ||
    isBelow(resolved, floor.version)
  ) {
    belowFloor.push({
      name,
      declared: declared[name],
      resolved: resolved ?? 'missing',
      floor: floor.version,
      reason: floor.reason,
    });
  }
}

for (const [name, bundledRange] of Object.entries(bundled)) {
  if (!(name in declared)) continue;

  const declaredRange = declared[name];
  const floor = FLOORS[name];
  const held = floor !== undefined && isBelow(bundledRange, floor.version);
  const expected = held ? `an exact pin from ${floor.version} on its minor` : bundledRange;

  if (
    held ? !heldAtFloor(declaredRange, floor.version) : !matchesSdk(declaredRange, bundledRange)
  ) {
    mismatches.push({ name, declared: declaredRange, expected });
  }

  const resolved = lockVersion(name);
  const lockExpected = held ? declaredRange : bundledRange;
  if (resolved === null || !matchesSdk(resolved, lockExpected)) {
    drift.push({ name, declared: declaredRange, resolved: resolved ?? 'missing' });
  }
}

const nativeVersion = declared['react-native'];
if (nativeVersion) {
  for (const [name, range] of Object.entries(declared)) {
    if (!name.startsWith('@react-native/')) continue;
    if (!sharesMajorMinor(range, nativeVersion)) {
      mismatches.push({
        name,
        declared: range,
        expected: `${versionOf(nativeVersion)?.slice(0, 2).join('.')}.x`,
      });
    }
    const resolved = lockVersion(name);
    if (!resolved || !sharesMajorMinor(resolved, nativeVersion)) {
      drift.push({ name, declared: range, resolved: resolved ?? 'missing' });
    }
  }
}

function printTable(rows, columns) {
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(r[c.key]).length))
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

if (belowFloor.length > 0) {
  failed = true;
  console.error('\nBelow a required floor (package.json or package-lock.json):');
  printTable(belowFloor, [
    { key: 'name', header: 'package' },
    { key: 'declared', header: 'declared' },
    { key: 'resolved', header: 'lock' },
    { key: 'floor', header: 'floor' },
    { key: 'reason', header: 'why' },
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
  console.error('\nFix: align the flagged packages with the SDK and update the lockfile.');
  process.exit(1);
}

console.log('check-expo-sdk: all Expo SDK packages match the bundled SDK versions.');
process.exit(0);
