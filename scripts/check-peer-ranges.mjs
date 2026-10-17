#!/usr/bin/env node
// Fail on a peer dependency the locked tree does not satisfy.
//
// `.npmrc` sets legacy-peer-deps, which an install needs for the React Native
// tree, so npm never refuses a lock whose peers are broken and a bump that
// leaves a library on a peer it does not support installs cleanly. This reads
// the lock as `npm ls` judges it and fails on every invalid or missing peer
// that the allowlist below does not name with a reason. An allowlist entry
// whose problem has gone fails too, so the list only holds what is still true.
//
// Usage: node scripts/check-peer-ranges.mjs [--root <dir>] [--allow <file.json>]

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trackedText } from './lib/indexedSources.mjs';

const argv = process.argv.slice(2);
const argument = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const root = argument('--root') ?? join(dirname(fileURLToPath(import.meta.url)), '..');

// Each entry is one problem `npm ls` reports, keyed by the package it names and
// the package whose range it fails.
const ALLOWED = [
  {
    kind: 'missing',
    name: '@react-native/metro-config',
    requiredBy: 'react-native-worklets',
    reason:
      'read only by the worklets bundle mode, which the app does not use; Metro runs on expo/metro-config',
  },
  {
    kind: 'invalid',
    name: 'picomatch',
    requiredBy: 'fdir',
    reason:
      'fdir loads picomatch only for its own glob builder, and its two users here, tinyglobby and jest-haste-map, crawl with filters of their own and never call it',
  },
  {
    kind: 'invalid',
    name: '@testing-library/react-native',
    requiredBy: 'expo-router',
    reason:
      "read only by the router's test helper, which awaits the render it is handed, and a synchronous render awaits as itself; the suite renders with version 13",
  },
  {
    kind: 'invalid',
    name: 'ws',
    requiredBy: '@expo/ws-tunnel',
    reason:
      'the CLI loads the tunnel only for EXPO_UNSTABLE_TUNNEL_V2 or a web container, and the dev server here never runs either',
  },
];

function loadAllowed() {
  const file = argument('--allow');
  return file ? JSON.parse(readFileSync(file, 'utf8')) : ALLOWED;
}

// The files are judged as the index holds them, the way the other whole-tree
// guards read, so an unstaged lock in a shared checkout is not what fails.
function listTree() {
  const scratch = mkdtempSync(join(tmpdir(), 'check-peer-ranges-'));
  try {
    for (const file of ['package.json', 'package-lock.json', '.npmrc']) {
      const text = trackedText(root, file);
      if (text === undefined) {
        if (file === '.npmrc') continue;
        throw new Error(`${file} is not in the tree`);
      }
      writeFileSync(join(scratch, file), text);
    }
    const result = spawnSync('npm', ['ls', '--package-lock-only', '--all', '--json'], {
      cwd: scratch,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    try {
      return { tree: JSON.parse(result.stdout), status: result.status, stderr: result.stderr };
    } catch {
      throw new Error(`npm ls printed no tree:\n${result.stderr}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// `invalid` reads `"<range>" from node_modules/<path>` or `from the root project`.
function invalidSource(text) {
  const match = text.match(/^"(.*)" from (.*)$/);
  if (!match) return { range: text, requiredBy: text };
  const from = match[2];
  const at = from.lastIndexOf('node_modules/');
  return {
    range: match[1],
    requiredBy: at === -1 ? from : from.slice(at + 'node_modules/'.length),
  };
}

function collectProblems(tree) {
  const found = new Map();
  const add = (problem) => {
    const key = `${problem.kind}\0${problem.name}\0${problem.requiredBy}`;
    if (!found.has(key)) found.set(key, problem);
  };
  const walk = (node, parent) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child.missing) {
        const detail = (child.problems ?? [])[0] ?? '';
        const range = detail.match(/^missing: .+?@([^,]*), required by/)?.[1] ?? '';
        add({ kind: 'missing', name, requiredBy: parent, range, version: 'absent' });
      } else if (typeof child.invalid === 'string') {
        add({ kind: 'invalid', name, version: child.version, ...invalidSource(child.invalid) });
      }
      if (!child.deduped) walk(child, name);
    }
  };
  walk(tree, 'the root project');
  return [...found.values()];
}

function main() {
  let allowed;
  let listing;
  try {
    allowed = loadAllowed();
    listing = listTree();
  } catch (error) {
    console.error(`check-peer-ranges: ${error.message}`);
    process.exit(1);
  }

  const problems = collectProblems(listing.tree);
  if (listing.status !== 0 && problems.length === 0) {
    console.error(
      `check-peer-ranges: npm ls failed with no peer problem named:\n${listing.stderr}`
    );
    process.exit(1);
  }

  const matches = (entry, problem) =>
    entry.kind === problem.kind &&
    entry.name === problem.name &&
    entry.requiredBy === problem.requiredBy;
  const unreasoned = allowed.filter((entry) => !entry.reason || !entry.reason.trim());
  const unexplained = problems.filter(
    (problem) => !allowed.some((entry) => entry.reason?.trim() && matches(entry, problem))
  );
  const stale = allowed.filter((entry) => !problems.some((problem) => matches(entry, problem)));

  for (const problem of unexplained) {
    const found = problem.kind === 'missing' ? 'absent' : `${problem.name}@${problem.version}`;
    console.error(
      `${problem.kind}: ${problem.requiredBy} wants ${problem.name} "${problem.range}", the lock has ${found}`
    );
  }
  for (const entry of unreasoned) {
    console.error(`allowlist entry for ${entry.name} from ${entry.requiredBy} gives no reason`);
  }
  for (const entry of stale) {
    console.error(
      `allowlist entry for ${entry.kind} ${entry.name} from ${entry.requiredBy} matches nothing; remove it`
    );
  }

  if (unexplained.length + unreasoned.length + stale.length > 0) {
    console.error(
      '\ncheck-peer-ranges: move the dependency into its peer range, or add an allowlist entry in scripts/check-peer-ranges.mjs saying why the range does not matter here.'
    );
    process.exit(1);
  }
  console.log(
    `check-peer-ranges: every peer range holds, ${problems.length} allowlisted with a reason.`
  );
}

main();
