#!/usr/bin/env node

// Guards against the dependabot-induced half-migration that skews Expo SDK
// versions: a single expo-* package bumped to the wrong major leaves the app
// on a broken mix of SDK 55/56 native modules. bundledNativeModules.json is
// the authoritative per-SDK version map shipped inside the installed expo
// package, so we treat it as the source of truth and flag any declared range
// whose major diverges, plus any lockfile drift away from package.json.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Pull the leading numeric major out of a semver range like "~56.0.3",
// "^56", "56.0.14" or "0.85.3". Returns null when no major is parseable
// (e.g. "./modules/veloqrs", "*", git/file specifiers).
function majorOf(range) {
  if (typeof range !== 'string') return null;
  const match = range.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return Number(match[1]);
}

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
  pkg = readJson(join(root, 'package.json'));
} catch {
  console.error('check-expo-sdk: could not read package.json.');
  process.exit(1);
}
try {
  lock = readJson(join(root, 'package-lock.json'));
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
  const expectedMajor = majorOf(expectedRange);
  const declaredMajor = majorOf(declaredRange);

  if (expectedMajor !== null && declaredMajor !== null && expectedMajor !== declaredMajor) {
    mismatches.push({ name, declared: declaredRange, expected: expectedRange });
  }

  const resolved = lockVersion(name);
  if (resolved !== null) {
    const resolvedMajor = majorOf(resolved);
    const declaredMajorForLock = majorOf(declaredRange);
    if (
      resolvedMajor !== null &&
      declaredMajorForLock !== null &&
      resolvedMajor !== declaredMajorForLock
    ) {
      drift.push({ name, declared: declaredRange, resolved });
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
  console.error('\nExpo SDK major mismatch (package.json vs bundledNativeModules.json):');
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
    '\nFix: align the flagged expo-* packages to the SDK bundled major, then run npm install.',
  );
  process.exit(1);
}

console.log('check-expo-sdk: all Expo SDK packages match the bundled SDK versions.');
process.exit(0);
