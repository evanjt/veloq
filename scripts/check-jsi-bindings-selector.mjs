#!/usr/bin/env node
// Refuse an installed iOS module whose JSI-bindings method React Native never calls.
//
// React Native installs a TurboModule's JSI bindings by asking it for one selector, and
// 0.87 changed which: it now calls `installJSIBindingsWithRuntime:callInvoker:` and never
// the one-argument form. A module that implements only the old selector compiles, links and
// launches with its bindings missing, and nitro-modules turns that into an abort at every
// iOS launch. Nothing at build time says so, and Android takes another path entirely.
//
// So the selectors the installed React Native calls are read off its module manager, and
// every `.m` and `.mm` file in an installed package or local module that carries a podspec
// is checked for a JSI-bindings method answering one of them.
//
// Reads `node_modules` on purpose: it checks the installed packages, which are the
// environment and not tracked files. It reads through whatever `node_modules` is, so a
// worktree linked to the main checkout checks the copies its builds would ship.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANAGER = join(
  'node_modules',
  'react-native',
  'ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleManager.mm'
);

/** The JSI-bindings selectors a module manager source asks a module for. */
export function calledSelectors(source) {
  const found = new Set();
  for (const match of source.matchAll(/@selector\(\s*(installJSIBindingsWithRuntime[\w:\s]*)\)/g)) {
    found.add(match[1].replace(/\s+/g, ''));
  }
  return [...found];
}

/** `text` with every parenthesised run removed, nesting included. */
function withoutParens(text) {
  let depth = 0;
  let out = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += char;
  }
  return out;
}

/** The JSI-bindings selectors an Objective-C source defines a method for. */
export function definedSelectors(source) {
  const found = [];
  const methods = /^[ \t]*-\s*\(\s*void\s*\)\s*(installJSIBindingsWithRuntime\s*:[^{;]*)[{;]/gm;
  for (const match of source.matchAll(methods)) {
    const keywords = [...withoutParens(match[1]).matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
    found.push(keywords.map((keyword) => `${keyword}:`).join(''));
  }
  return found;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** The installed packages and local modules, scope directories expanded. */
function moduleDirectories(root) {
  const dirs = [];
  const modules = join(root, 'node_modules');
  if (isDirectory(modules)) {
    for (const entry of readdirSync(modules)) {
      if (entry.startsWith('.')) continue;
      const dir = join(modules, entry);
      if (entry.startsWith('@') && isDirectory(dir)) {
        for (const member of readdirSync(dir)) dirs.push(join(dir, member));
      } else {
        dirs.push(dir);
      }
    }
  }
  const local = join(root, 'modules');
  if (isDirectory(local)) {
    for (const entry of readdirSync(local)) dirs.push(join(local, entry));
  }
  return dirs.filter(isDirectory);
}

/** Whether `dir` carries a podspec at its top or under `ios`, which is what CocoaPods links. */
function isPod(dir) {
  for (const place of [dir, join(dir, 'ios')]) {
    if (isDirectory(place) && readdirSync(place).some((name) => name.endsWith('.podspec'))) {
      return true;
    }
  }
  return false;
}

/** Every Objective-C source under `dir`, leaving out nested installs and Android trees. */
function objcSources(dir, seen = new Set()) {
  const real = realpathSync(dir);
  if (seen.has(real)) return [];
  seen.add(real);
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'android') continue;
    const path = join(dir, entry);
    if (isDirectory(path)) files.push(...objcSources(path, seen));
    else if (entry.endsWith('.mm') || entry.endsWith('.m')) files.push(path);
  }
  return files;
}

/**
 * What stops `root` passing: `{ manager }` when React Native is installed and its module
 * manager names no JSI-bindings selector, else every source defining only uncalled ones.
 */
export function unanswered(root) {
  if (!existsSync(join(root, 'node_modules', 'react-native'))) return { called: [], files: [] };
  const managerPath = join(root, MANAGER);
  const called = existsSync(managerPath) ? calledSelectors(readFileSync(managerPath, 'utf8')) : [];
  if (called.length === 0) return { manager: MANAGER, called, files: [] };
  const files = [];
  for (const dir of moduleDirectories(root)) {
    if (!isPod(dir)) continue;
    for (const file of objcSources(dir)) {
      const defined = definedSelectors(readFileSync(file, 'utf8'));
      if (defined.length > 0 && !defined.some((selector) => called.includes(selector))) {
        files.push({ file: relative(root, file), defined });
      }
    }
  }
  return { called, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
  const { manager, called, files } = unanswered(root);
  if (manager !== undefined) {
    console.error(
      'React Native is installed, and its module manager names no JSI-bindings selector:'
    );
    console.error(`  ${manager}`);
    console.error(
      'Update scripts/check-jsi-bindings-selector.mjs to where React Native now asks for one.'
    );
    process.exit(1);
  }
  if (files.length > 0) {
    console.error('An iOS module implements a JSI-bindings selector React Native never calls,');
    console.error(
      'so its bindings are never installed and anything that reads them fails at launch:'
    );
    for (const { file, defined } of files)
      console.error(`  ${file} implements ${defined.join(', ')}`);
    console.error(`React Native calls ${called.join(', ')}.`);
    console.error('Patch or move the package so it implements the called selector.');
    process.exit(1);
  }
}
