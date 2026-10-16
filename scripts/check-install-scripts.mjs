#!/usr/bin/env node
// A pending dependency script leaves its installed package incomplete.
//
// The verdict is read from the lockfile and `allowScripts`, never from
// `node_modules`. A tree whose `node_modules` links each entry into another
// checkout makes npm's own listing load every linked package as a project
// root, devDependencies included, and one of those carrying a yarn `patch:`
// spec fails it outright. The lockfile also holds a dependency a branch adds
// before any install has it, which a walk of the installed packages misses.
//
// Matching follows npm's: a registry package is named by its resolved URL, a
// name-only entry covers every version, a pinned entry the versions it lists
// joined by `||`, and a `false` entry denies, which counts as reviewed. An
// optional package this platform cannot install and a bundled one never run
// their scripts. A package whose identity cannot be read from the lockfile
// fails the guard rather than passing unjudged. Inside a checkout both files
// are read from the index, the tree a commit or merge records.
//
// Usage: node scripts/check-install-scripts.mjs [--root DIR]

import { resolve } from 'node:path';

import { trackedText } from './lib/indexedSources.mjs';

const argv = process.argv.slice(2);
const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : process.cwd());

const manifestText = trackedText(root, 'package.json');
const lockText = trackedText(root, 'package-lock.json');
if (manifestText === undefined || lockText === undefined) {
  console.error(
    `No package.json and package-lock.json in ${root}, so dependency install scripts cannot be judged`
  );
  process.exit(1);
}

let manifest;
let lock;
try {
  manifest = JSON.parse(manifestText);
  lock = JSON.parse(lockText);
} catch (error) {
  console.error(`Could not parse package.json and package-lock.json: ${error.message}`);
  process.exit(1);
}

if (!lock.packages) {
  console.error('package-lock.json has no packages section; lockfileVersion 2 or later is needed');
  process.exit(1);
}

const policy = manifest.allowScripts ?? {};
const pending = [];
const unjudged = [];

for (const [location, entry] of Object.entries(lock.packages)) {
  if (location === '' || entry.link || entry.inBundle || !entry.hasInstallScript) continue;
  if ((entry.optional || entry.devOptional) && !installsHere(entry)) continue;

  const identity = location.includes('node_modules/') ? registryIdentity(entry.resolved) : null;
  if (!identity) {
    unjudged.push(location);
    continue;
  }
  if (verdict(identity, policy) === null) pending.push(`${identity.name}@${identity.version}`);
}

if (unjudged.length > 0) {
  console.error(
    `Install scripts the lockfile cannot name a registry package for: ${unjudged.join(', ')}`
  );
}
if (pending.length > 0) {
  console.error(`Unreviewed dependency install scripts: ${[...new Set(pending)].join(', ')}`);
  console.error('Review each, then record it with npm install-scripts approve or deny.');
}
if (unjudged.length > 0 || pending.length > 0) process.exit(1);

/** The name and version a registry tarball URL carries, or null. */
function registryIdentity(resolved) {
  if (typeof resolved !== 'string') return null;
  const match = /^https?:\/\/[^/]+\/(.+)\/-\/([^/]+)\.tgz$/.exec(resolved);
  if (!match) return null;
  const name = decodeURIComponent(match[1]);
  const base = name.split('/').pop();
  if (!match[2].startsWith(`${base}-`)) return null;
  return { name, version: match[2].slice(base.length + 1) };
}

/** true when allowed, false when denied, null when no entry covers the package. */
function verdict({ name, version }, entries) {
  let allowed = false;
  for (const [key, value] of Object.entries(entries)) {
    if (!covers(key, name, version)) continue;
    if (value === false) return false;
    if (value === true) allowed = true;
  }
  return allowed ? true : null;
}

function covers(key, name, version) {
  const at = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  const keyName = at === -1 ? key : key.slice(0, at);
  const spec = at === -1 ? '' : key.slice(at + 1).trim();
  if (keyName !== name) return false;
  if (spec === '' || spec === '*') return true;
  // A range or a tag never matches: it would cover versions nobody reviewed.
  const pins = spec.split('||').map((pin) => pin.trim().replace(/^[v=]+/, ''));
  if (!pins.every((pin) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pin))) {
    return false;
  }
  return pins.some((pin) => pin.replace(/\+.*$/, '') === version.replace(/\+.*$/, ''));
}

/** Whether an optional package's os, cpu and libc fields admit this machine. */
function installsHere(entry) {
  return (
    admits(process.platform, entry.os) &&
    admits(process.arch, entry.cpu) &&
    (process.platform !== 'linux' || entry.libc === undefined || admits(libc(), entry.libc))
  );
}

function admits(value, list) {
  if (list === undefined) return true;
  const items = Array.isArray(list) ? list : [list];
  if (items.length === 1 && items[0] === 'any') return true;
  let matched = false;
  let negated = 0;
  for (const item of items) {
    if (item.startsWith('!')) {
      if (item.slice(1) === value) return false;
      negated += 1;
    } else if (item === value) {
      matched = true;
    }
  }
  return matched || negated === items.length;
}

function libc() {
  return process.report?.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
}
