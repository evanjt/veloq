#!/usr/bin/env node
// Refuse a tracked Kotlin, Java or C header CodeQL neither scans nor excludes.
//
// CodeQL extracts Kotlin and Java only from a compile it traces, so a file is
// scanned only when `scripts/codeql-android-compile.sh` compiles it from its
// tracked path: the main and shipped-variant source sets of the Gradle
// projects it names, and the directories :app compiles in place. C and C++
// are scanned without a build, and a header only through a source that
// includes it. Anything else reads as unscanned on the code scanning status
// page, so it is either compiled or named in the config's `paths-ignore`.
//
// Usage: node scripts/check-codeql-coverage.mjs [--root <dir>]

import { basename, resolve } from 'node:path';
import { load } from 'js-yaml';

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const COMPILE_SCRIPT = 'scripts/codeql-android-compile.sh';
const CONFIG = '.github/codeql/codeql-config.yml';

const JVM_SOURCE = /\.(kt|java)$/;
const C_SOURCE = /\.(c|cc|cpp|cxx)$/;
const C_HEADER = /\.(h|hh|hpp)$/;
const INCLUDE = /^\s*#\s*include\s+"([^"]+)"/gm;

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

/** The words of a bash array assignment, `NAME=( ... )`, or null when there is none. */
function bashArray(script, name) {
  const match = script.match(new RegExp(`^${name}=\\(([\\s\\S]*?)\\)`, 'm'));
  if (!match) return null;
  return match[1]
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .flatMap((line) => line.split(/\s+/))
    .filter(Boolean);
}

function requiredArray(script, name) {
  const words = bashArray(script, name);
  if (!words) throw new Error(`${COMPILE_SCRIPT} assigns no ${name}`);
  return words;
}

/** The directories whose Kotlin and Java the traced compile reads from where they are tracked. */
function tracedDirectories(script) {
  const variants = requiredArray(script, 'TASKS').map((task) => {
    const match = task.match(/^compile(\w+?)(Kotlin|JavaWithJavac)$/);
    if (!match) throw new Error(`${COMPILE_SCRIPT} runs ${task}, which is not a compile task`);
    return match[1].charAt(0).toLowerCase() + match[1].slice(1);
  });
  const sourceSets = ['main', ...new Set(variants)];
  const modules = requiredArray(script, 'PROJECTS')
    .filter((project) => project !== ':app')
    .flatMap((project) =>
      sourceSets.map((set) => `modules/${project.slice(1)}/android/src/${set}/`)
    );
  const inPlace = (bashArray(script, 'APP_SOURCES') ?? []).map(
    (dir) => `${dir.replace(/\/$/, '')}/`
  );
  return [...modules, ...inPlace];
}

/** One `paths-ignore` entry as CodeQL reads it: `*` within a segment, `**` across them. */
function ignoreMatcher(pattern) {
  const body = pattern
    .replace(/\/+$/, '')
    .split(/(\*\*\/?|\*)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  const regex = new RegExp(`^${body}(?:/.*)?$`);
  return (file) => regex.test(file);
}

/** Every tracked file CodeQL would count for java-kotlin or c-cpp and not scan. */
function unscanned(files, contents, script, ignores) {
  const traced = tracedDirectories(script);
  const ignored = ignores.map(ignoreMatcher);
  const included = new Set();
  for (const file of files) {
    if (!C_SOURCE.test(file) && !C_HEADER.test(file)) continue;
    for (const [, name] of contents(file).matchAll(INCLUDE)) included.add(basename(name));
  }
  return files.filter((file) => {
    if (ignored.some((matches) => matches(file))) return false;
    if (JVM_SOURCE.test(file)) return !traced.some((dir) => file.startsWith(dir));
    if (C_HEADER.test(file)) return !included.has(basename(file));
    return false;
  });
}

function main() {
  const sources = indexedSources(root);
  refuseEmptyListing(sources, 'CodeQL coverage guard');
  const text = (file) => sources.get(file)?.toString('utf8') ?? '';
  for (const file of [COMPILE_SCRIPT, CONFIG]) {
    if (!sources.has(file)) {
      console.error(`${file} is not tracked, so what CodeQL scans cannot be read`);
      process.exit(1);
    }
  }
  const config = load(text(CONFIG)) ?? {};
  const missed = unscanned(
    [...sources.keys()],
    text,
    text(COMPILE_SCRIPT),
    config['paths-ignore'] ?? []
  );
  if (missed.length === 0) return;
  for (const file of missed) {
    console.error(
      `${file} is neither compiled by ${COMPILE_SCRIPT} nor in the paths-ignore of ${CONFIG}`
    );
  }
  process.exit(1);
}

main();
