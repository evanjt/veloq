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

function sameLine(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function lineBelow(a, b) {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
}

// A floor holds whatever the SDK bundles. A repair is released once per release
// line, and a later line can branch before the repair reaches it, so each floor
// names the first fixed version on every line that carries one. A version passes
// when its own line is listed and it is at or above that line's fix, or when its
// line is newer than every listed line. While the bundle fails, the package is
// taken outside the SDK as an exact pin on the first fixed line at or above the
// bundle's, so a repair never brings a new minor's peers in with it and never
// goes back to an older line than the SDK's.
const FLOORS = {
  'react-native-screens': {
    fixedIn: ['4.29.0'],
    reason:
      'earlier releases initialise native state without a lock, crash Fabric mounting on teardown and throw on orphaned fragments',
  },
  'expo-task-manager': {
    fixedIn: ['56.0.24', '57.0.7'],
    reason: 'earlier releases keep every task callback and leak the background location service',
  },
  'expo-location': {
    fixedIn: ['56.0.24', '57.0.10'],
    reason: 'earlier releases leak location watches',
  },
  'react-native-reanimated': {
    fixedIn: ['4.3.4', '4.5.4'],
    reason:
      'earlier releases crash on withheld exiting animations, deadlock the CSS registry against the Fabric commit and leak a view unmounted mid-animation',
  },
  'react-native-worklets': {
    fixedIn: ['0.13.0'],
    reason:
      'earlier releases never register their lifecycle listener, so frames keep being scheduled while Android caches the app and it is killed for CPU',
  },
  '@shopify/react-native-skia': {
    fixedIn: ['2.9.1'],
    reason:
      'earlier releases dereference a null EGL surface on first canvas render, which crash-loops launch on some Android GPUs',
  },
};

function meetsFloor(candidate, floor) {
  const actual = versionOf(candidate);
  if (!actual) return false;
  const fix = floor.fixedIn.find((version) => sameLine(versionOf(version), actual));
  if (fix) return !isBelow(candidate, fix);
  return floor.fixedIn.every((version) => lineBelow(versionOf(version), actual));
}

/** The fixed version a held package is pinned to: the first listed line not older than the bundle's. */
function heldFix(bundledRange, floor) {
  const bundledVersion = versionOf(bundledRange);
  return (
    floor.fixedIn.find(
      (version) => bundledVersion && !lineBelow(versionOf(version), bundledVersion)
    ) ?? floor.fixedIn[floor.fixedIn.length - 1]
  );
}

function heldAtFloor(candidate, fix) {
  return /^\d/.test(candidate) && sharesMajorMinor(candidate, fix) && !isBelow(candidate, fix);
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
const held = new Set();

for (const [name, floor] of Object.entries(FLOORS)) {
  if (!(name in declared)) continue;
  const resolved = lockVersion(name);
  if (!meetsFloor(declared[name], floor) || resolved === null || !meetsFloor(resolved, floor)) {
    belowFloor.push({
      name,
      declared: declared[name],
      resolved: resolved ?? 'missing',
      floor: floor.fixedIn.join(', '),
      reason: floor.reason,
    });
  }
}

for (const [name, bundledRange] of Object.entries(bundled)) {
  if (!(name in declared)) continue;

  const declaredRange = declared[name];
  const floor = FLOORS[name];
  const isHeld = floor !== undefined && !meetsFloor(bundledRange, floor);
  if (isHeld) held.add(name);
  const fix = isHeld ? heldFix(bundledRange, floor) : null;
  const expected = isHeld ? `an exact pin from ${fix} on its minor` : bundledRange;

  if (isHeld ? !heldAtFloor(declaredRange, fix) : !matchesSdk(declaredRange, bundledRange)) {
    mismatches.push({ name, declared: declaredRange, expected });
  }

  const resolved = lockVersion(name);
  const lockExpected = isHeld ? declaredRange : bundledRange;
  if (resolved === null || !matchesSdk(resolved, lockExpected)) {
    drift.push({ name, declared: declaredRange, resolved: resolved ?? 'missing' });
  }
}

// Expo's own install check and doctor skip what `expo.install.exclude` lists, so
// an entry there is a package only this guard judges. It may name only a package
// held above its bundled version; any other entry would hide an SDK mismatch.
const strayExcludes = (pkg.expo?.install?.exclude ?? []).filter((name) => !held.has(name));

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

if (strayExcludes.length > 0) {
  failed = true;
  console.error(
    `\nExcluded from Expo's install check but not held above the SDK (package.json expo.install.exclude): ${strayExcludes.join(', ')}`
  );
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
