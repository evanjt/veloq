#!/usr/bin/env node
// Every place the app or the engine writes on the device has to be listed in
// the wipe test's inventory, wiped by `wipeLibrary` or kept for a reason.
//
// Six rounds of the account wipe each closed the leftovers the last audit
// found, and each next audit found more: a temporary file beside the record
// zip, the widget's snapshot, a quarantined copy, the tray. Every one was a
// write nobody had listed. So the writes are counted here, per file, across
// the TypeScript, the engine, and the Android and iOS native code, and the
// count sits in `src/__tests__/__shared__/deviceWriteSites.json`. A file whose
// count moves fails, naming itself, and the wipe test refuses a file in that
// map which its inventory does not name. A new write therefore fails until
// someone has said what the wipe does with it.
//
// The patterns are the write APIs, not every call: a directory root, a key
// store's setter, a file create or copy, a preference file, a notification.
// A count is a prompt to read the file, not a proof of what it writes.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diskSources, indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue(
  '--baseline',
  join(ROOT, 'src/__tests__/__shared__/deviceWriteSites.json')
);
const WRITE = process.argv.includes('--write');

const TYPESCRIPT = [
  /\b(?:documentDirectory|cacheDirectory)\b/g,
  /\bPaths\.(?:document|cache)\b/g,
  /\bsetItemAsync\(/g,
  /\bAsyncStorage\.(?:setItem|multiSet|mergeItem)\(/g,
  /\bsetSetting(?:\?\.)?\(/g,
  /\b(?:scheduleNotificationAsync|presentNotificationAsync|setNotificationChannelAsync)\(/g,
  /\bregisterTaskAsync\(/g,
  /\bFileSystem\.(?:writeAsStringAsync|copyAsync|moveAsync|downloadAsync|makeDirectoryAsync)\(/g,
  /\b(?:runBackup|writeClearSnapshot|runRecordBackup|runBulkExport|convertLegacyDatabaseToRecordBackup)\(/g,
];
const RUST = [
  /\btempfile::/g,
  /\bFile::create\(/g,
  /\bOpenOptions::new\(/g,
  /\bfs::(?:write|copy|rename|create_dir|create_dir_all)\(/g,
  /\bConnection::open\(/g,
  /\bBackup::new\(/g,
];
const KOTLIN = [
  /\bfilesDir\b/g,
  /\bcacheDir\b/g,
  /\bgetSharedPreferences\(/g,
  /\bopenFileOutput\(/g,
  /\bWorkManager\b/g,
  /\.notify\(/g,
  /\bsetDynamicShortcuts\(/g,
  /\bcreateNotificationChannel\(/g,
];
const SWIFT = [
  /\bcontainerURL\(/g,
  /\bUserDefaults\b/g,
  /\.write\(to:/g,
  /\bcreateDirectory\(/g,
  /\bActivity(?:<[^>]*>)?\.request\(/g,
  /\bSecItemAdd\b/g,
  /\bwriteToFile:|\bwriteToURL:/g,
];

/** Where each language's shipped code lives, and the patterns it is read for. */
const TREES = [
  { dir: 'src', ext: /\.tsx?$/, patterns: TYPESCRIPT },
  { dir: 'modules', ext: /\.tsx?$/, patterns: TYPESCRIPT, under: /^modules\/[^/]+\/src\// },
  { dir: 'modules/veloqrs/rust/veloqrs/src', ext: /\.rs$/, patterns: RUST, rust: true },
  { dir: 'modules', ext: /\.(?:kt|java)$/, patterns: KOTLIN, under: /\/android\/src\/main\// },
  { dir: 'widget/android', ext: /\.(?:kt|java)$/, patterns: KOTLIN },
  { dir: 'android/app/src/main/java', ext: /\.(?:kt|java)$/, patterns: KOTLIN },
  { dir: 'modules', ext: /\.(?:swift|m|mm)$/, patterns: SWIFT, under: /^modules\/[^/]+\/ios\// },
  { dir: 'widget/ios', ext: /\.(?:swift|m|mm)$/, patterns: SWIFT },
  { dir: 'push/ios', ext: /\.(?:swift|m|mm)$/, patterns: SWIFT },
];

/** Tests, generated bindings and the build-time config plugins write nothing on a device. */
const EXEMPT = [
  /\/__tests__\//,
  /\.test\.tsx?$/,
  /\/generated\//,
  /^src\/plugins\//,
  /\/node_modules\//,
  /\/tests?\//,
  /(?:^|\/)tests\.rs$/,
  /_tests\.rs$/,
];

/** Comments name the APIs they explain, and a comment writes nothing. */
const withoutComments = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/\s.*$/gm, '');

/**
 * The source without its `#[cfg(test)] mod name { ... }` blocks, which seed
 * fixtures in temporary directories and ship nothing. They sit between the
 * shipped items in some files, so each block is cut by matching its braces.
 */
const withoutTestModules = (source) => {
  const opener = /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*\{/g;
  let out = '';
  let from = 0;
  let match;
  while ((match = opener.exec(source)) !== null) {
    out += source.slice(from, match.index);
    let depth = 1;
    let at = match.index + match[0].length;
    while (at < source.length && depth > 0) {
      if (source[at] === '{') depth += 1;
      else if (source[at] === '}') depth -= 1;
      at += 1;
    }
    from = at;
    opener.lastIndex = at;
  }
  return out + source.slice(from);
};

function walk(dir, ext, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target') continue;
      walk(full, ext, out);
    } else if (ext.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// A checkout is read from its index: the main checkout carries git-ignored
// generated copies of native code that ship from nowhere, and a disk walk
// counted them. Only a fixture root with no repository is read off the disk.
const sources = existsSync(join(ROOT, '.git'))
  ? indexedSources(
      ROOT,
      TREES.map((tree) => tree.dir)
    )
  : diskSources(
      ROOT,
      TREES.flatMap((tree) =>
        walk(join(ROOT, tree.dir), tree.ext).map((file) =>
          relative(ROOT, file).split('\\').join('/')
        )
      )
    );
refuseEmptyListing(sources, 'Device write guard');

const counts = {};
for (const tree of TREES) {
  for (const [rel, bytes] of sources) {
    if (rel !== tree.dir && !rel.startsWith(`${tree.dir}/`)) continue;
    if (!tree.ext.test(rel)) continue;
    if (tree.under && !tree.under.test(rel)) continue;
    if (EXEMPT.some((pattern) => pattern.test(rel))) continue;
    let source = bytes.toString('utf8');
    if (tree.rust) source = withoutTestModules(source);
    source = withoutComments(source);
    const hits = tree.patterns.reduce((n, pattern) => n + (source.match(pattern) || []).length, 0);
    if (hits > 0) counts[rel] = (counts[rel] ?? 0) + hits;
  }
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`device write sites written: ${total()} across ${Object.keys(counts).length} files`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const moved = [];
for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
  const now = counts[file] ?? 0;
  const listed = baseline[file] ?? 0;
  if (now !== listed) moved.push([file, now, listed]);
}

if (moved.length === 0) {
  console.log(
    `device write guard: ${total()} write sites across ${Object.keys(counts).length} files, all listed.`
  );
  process.exit(0);
}

console.error('A device write site moved. For each file below, say in DEVICE_WRITES in');
console.error('src/__tests__/bugs/wipeLibraryForgetsTheBackupCarrier.test.ts whether the wipe');
console.error('deletes what it writes or keeps it and why, then record the count:\n');
for (const [file, now, listed] of moved) {
  console.error(`  ${file}  ${now}, listed ${listed}`);
}
console.error('\n  npm run lint:device-writes -- --write');
process.exit(1);
