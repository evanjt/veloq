#!/usr/bin/env node
// The engine's TLS stays on bundled roots until Android can run the platform
// verifier.
//
// reqwest 0.12's `rustls-tls` feature verifies against webpki-roots and makes no
// JVM call. From 0.13 every rustls feature pulls rustls-platform-verifier, which
// on Android needs a Kotlin component in the app build, a Proguard keep rule and
// `rustls_platform_verifier::android::init_with_env` before the first request.
// Without them the crate compiles for every target and every HTTPS request the
// engine makes fails on the handset: sync, map tiles and geocoding alike.
//
// Dependabot reads 0.12 to 0.13 as a minor step and would open it as a pull
// request of its own, where the dropped `rustls-tls` feature fails the build
// every month. So the cargo entry ignores reqwest's minor updates for as long as
// this hold stands.
//
// When the Android verifier wiring lands, the hold is lifted here and in
// `.github/dependabot.yml` together.
//
// Usage: node scripts/lint-tls-verifier-hold.mjs [--root <dir>]

import { resolve } from 'node:path';

import { load } from 'js-yaml';

import { trackedText } from './lib/indexedSources.mjs';

const LOCK = 'modules/veloqrs/rust/Cargo.lock';
const DEPENDABOT = '.github/dependabot.yml';
const VERIFIER = 'rustls-platform-verifier';
const HELD = 'reqwest';
const HELD_UPDATE = 'version-update:semver-minor';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const failures = [];

const lock = trackedText(root, LOCK);
if (lock === undefined) {
  failures.push(`${LOCK} is not in the tree, so the TLS verifier could not be checked.`);
} else if (lockedPackages(lock).has(VERIFIER)) {
  failures.push(
    `${LOCK} resolves ${VERIFIER}.`,
    '  On Android it needs a Kotlin component, a Proguard rule and init_with_env before',
    '  any request, none of which the engine has, so every HTTPS request would fail there.',
    '  Keep reqwest on 0.12 with `rustls-tls`, or land the Android wiring and lift this hold.'
  );
}

const config = trackedText(root, DEPENDABOT);
if (config === undefined) {
  failures.push(`${DEPENDABOT} is not in the tree, so the ${HELD} hold could not be checked.`);
} else {
  const problem = heldProblem(config);
  if (problem !== null) {
    failures.push(
      `${DEPENDABOT}: ${problem}`,
      `  Dependabot reads ${HELD} 0.12 to 0.13 as ${HELD_UPDATE} and opens a pull request`,
      '  for it, where the dropped `rustls-tls` feature fails the build.',
      `  Ignore it in the cargo entry: dependency-name "${HELD}", update-types ["${HELD_UPDATE}"].`
    );
  }
}

if (failures.length === 0) process.exit(0);
console.error('The engine TLS hold is broken:');
for (const line of failures) console.error(line);
process.exit(1);

/** The package names a cargo lockfile resolves. */
function lockedPackages(text) {
  const names = new Set();
  let inPackage = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inPackage = line === '[[package]]';
      continue;
    }
    if (!inPackage) continue;
    const match = /^name\s*=\s*"([^"]*)"/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/** Why the cargo entries fail to hold the minor update back, or null when they hold it. */
function heldProblem(text) {
  let parsed;
  try {
    parsed = load(text);
  } catch (error) {
    return `does not parse: ${error.message}`;
  }
  const cargo = (parsed?.updates ?? []).filter((u) => u?.['package-ecosystem'] === 'cargo');
  if (cargo.length === 0) return 'has no cargo update entry to hold the line in.';
  for (const entry of cargo) {
    const ignore = (entry.ignore ?? []).find((i) => i?.['dependency-name'] === HELD);
    if (ignore === undefined) {
      return `the cargo entry for ${entry.directory ?? '(no directory)'} does not ignore ${HELD}.`;
    }
    // An ignore with no update types ignores every update.
    const types = ignore['update-types'];
    if (Array.isArray(types) && !types.includes(HELD_UPDATE)) {
      return `the ${HELD} ignore lists ${types.join(', ') || 'no update types'} and not ${HELD_UPDATE}.`;
    }
  }
  return null;
}
