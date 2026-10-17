#!/usr/bin/env node
// Name the areas of the repository a change reaches, for CI to run only the
// jobs that can see it.
//
//   ci-areas.mjs --base <ref> [--root <dir>]
//
// Every workflow that gates a job on what changed reads it from here, so the
// question has one answer. The areas are:
//
//   appJs       the app's JavaScript: source, config, the root npm install
//   native      anything compiled into the native app, or the iOS build itself
//   rust        the engine crate
//   oauthProxy  the OAuth proxy, which has its own install
//   fastlane    the store lanes and their metadata
//   workflows   the workflows and the actions they share
//
// A path no area claims counts as app code, so an unclassified change runs
// the app jobs rather than none. Documentation reaches no area.
//
// A root lockfile change is app code. It is native only when a package it
// adds, removes or moves ships native code, judged against the installed
// `node_modules` at the package's own install path. A changed package that is
// not installed there counts as native, since nothing says it is not, except
// an optional binary built for another platform, which no app build compiles.
//
// The command diffs `<base>...HEAD`, reads both root lockfiles from git, and
// writes `area=true|false` lines to `$GITHUB_OUTPUT`, or to stdout when that
// is unset.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AREAS = ['appJs', 'native', 'rust', 'oauthProxy', 'fastlane', 'workflows'];

const LOCKFILE = 'package-lock.json';

// The workflows and actions the iOS build runs through. Their change is a
// change to the native build even when no native source moves.
const NATIVE_BUILD = [
  '.github/workflows/build.yml',
  '.github/workflows/build-ios.yml',
  '.github/actions/',
];

const NATIVE_MARKERS = ['android', 'ios', 'expo-module.config.json', 'react-native.config.js'];

// First match wins, so a narrower prefix sits above the wider one it carves
// out of.
const RULES = [
  { prefix: 'modules/veloqrs/rust/', areas: ['rust'] },
  { prefix: 'rust-toolchain.toml', areas: ['rust'] },
  { prefix: 'oauth-proxy/', areas: ['oauthProxy'] },
  { prefix: 'config/fastlane/', areas: ['fastlane'] },
  { prefix: '.github/actions/setup-fastlane/', areas: ['workflows', 'fastlane'] },
  { prefix: '.github/', areas: ['workflows'] },
  { prefix: 'widget/', areas: ['native'] },
  { prefix: 'push/', areas: ['native'] },
  { prefix: 'ios/', areas: ['native'] },
  { prefix: 'src/plugins/', areas: ['native'] },
  { prefix: 'modules/', areas: ['native', 'appJs'] },
  { prefix: 'expo-modules/', areas: ['native', 'appJs'] },
  { prefix: 'app.json', areas: ['native', 'appJs'] },
  { prefix: 'app.config.js', areas: ['native', 'appJs'] },
  { prefix: 'docs/', areas: [] },
];

function matches(path, prefix) {
  return prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix;
}

function isDocumentation(path) {
  return path.endsWith('.md') || path === 'LICENSE' || path === 'NOTICE';
}

function areasOfPath(path) {
  if (isDocumentation(path)) return [];
  const rule = RULES.find(({ prefix }) => matches(path, prefix));
  return rule ? rule.areas : ['appJs'];
}

function changedPackages(base, head) {
  const before = base?.packages ?? {};
  const after = head?.packages ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed = [];
  for (const key of keys) {
    if (!key.startsWith('node_modules/')) continue;
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changed.push({ key, entry: after[key] ?? before[key] });
  }
  return changed;
}

function forAnotherPlatform(entry) {
  return Boolean(entry?.optional && (entry.os || entry.cpu));
}

function shipsNative(root, { key, entry }) {
  const dir = join(root, key);
  if (!existsSync(join(dir, 'package.json'))) return !forAnotherPlatform(entry);
  return NATIVE_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

/**
 * The areas a change reaches.
 *
 * @param {object} change
 * @param {string[]} change.paths the changed paths, relative to the repository root
 * @param {object} [change.base] the root lockfile before the change, parsed
 * @param {object} [change.head] the root lockfile after it, parsed
 * @param {string} change.root the directory whose `node_modules` holds the install
 * @returns {Record<string, boolean>} one flag per name in `AREAS`
 */
export function ciAreas({ paths, base, head, root }) {
  const areas = Object.fromEntries(AREAS.map((area) => [area, false]));
  for (const path of paths) {
    for (const area of areasOfPath(path)) areas[area] = true;
    if (NATIVE_BUILD.some((prefix) => matches(path, prefix))) areas.native = true;
  }
  if (paths.includes(LOCKFILE)) {
    if (changedPackages(base, head).some((change) => shipsNative(root, change))) {
      areas.native = true;
    }
  }
  return areas;
}

function lockfileAt(root, ref) {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${ref}:${LOCKFILE}`], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    );
  } catch {
    return undefined;
  }
}

function main(argv) {
  const option = (name) => {
    const at = argv.indexOf(name);
    return at === -1 ? undefined : argv[at + 1];
  };
  const baseRef = option('--base');
  if (!baseRef) {
    process.stderr.write('ci-areas: --base <ref> is required\n');
    process.exit(2);
  }
  const root = resolve(option('--root') ?? '.');
  const paths = execFileSync('git', ['diff', '--name-only', '-z', `${baseRef}...HEAD`], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
  const areas = ciAreas({
    paths,
    base: lockfileAt(root, baseRef),
    head: lockfileAt(root, 'HEAD'),
    root,
  });
  const lines = AREAS.map((area) => `${area}=${areas[area]}\n`).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
  else process.stdout.write(lines);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
