#!/usr/bin/env node
/**
 * Engine orphan report: public PersistentRouteEngine methods whose only
 * callers are tests. Such a method is dead app surface — the app cannot
 * reach it, tests keep it compiling, and its semantics can silently drift
 * from the path the app actually uses (the rename_section case: promoted
 * on rename, no FFI caller, deleted 2026-07-28).
 *
 * Report-only. Run: npm run ffi:orphans
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CRATE = path.join(ROOT, 'modules/veloqrs/rust/veloqrs');
const SRC = path.join(CRATE, 'src');
const TESTS = path.join(CRATE, 'tests');

function rustFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rustFiles(p));
    else if (entry.name.endsWith('.rs')) out.push(p);
  }
  return out;
}

// Public methods declared inside `impl PersistentRouteEngine` blocks.
// Brace-count from each impl header; collect `pub fn` names in that span.
function engineMethods() {
  const methods = new Map(); // name -> file
  for (const file of rustFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    let depth = 0;
    let inImpl = false;
    for (const line of lines) {
      if (!inImpl && /^impl\s+PersistentRouteEngine\b/.test(line)) {
        inImpl = true;
        depth = 0;
      }
      if (inImpl) {
        const m = line.match(/^\s*pub\s+fn\s+([a-z0-9_]+)/);
        if (m) methods.set(m[1], path.relative(ROOT, file));
        for (const ch of line) {
          if (ch === '{') depth += 1;
          if (ch === '}') depth -= 1;
        }
        if (depth <= 0 && line.includes('}')) inImpl = depth > 0;
      }
    }
  }
  return methods;
}

function callers(name, files, skipDeclFile) {
  let count = 0;
  const re = new RegExp(`\\.${name}\\s*\\(`);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (re.test(line) && !line.trim().startsWith('//')) count += 1;
    }
    if (file === skipDeclFile) count -= 0; // declaration lines never match `.name(`
  }
  return count;
}

const methods = engineMethods();
const srcFiles = rustFiles(SRC);
const testFiles = fs.existsSync(TESTS) ? rustFiles(TESTS) : [];

const orphans = [];
const testOnly = [];
for (const [name, file] of [...methods.entries()].sort()) {
  const inSrc = callers(name, srcFiles);
  if (inSrc > 0) continue;
  const inTests = callers(name, testFiles);
  if (inTests > 0) testOnly.push({ name, file, inTests });
  else orphans.push({ name, file });
}

console.log(`Engine methods scanned: ${methods.size}`);
console.log(`\n=== TEST-ONLY METHODS (${testOnly.length}) — the rename_section class ===`);
for (const t of testOnly) console.log(`  ${t.name}  (${t.file}, ${t.inTests} test call sites)`);
console.log(`\n=== NO CALLERS AT ALL (${orphans.length}) ===`);
for (const o of orphans) console.log(`  ${o.name}  (${o.file})`);
console.log(
  '\nNote: a src caller can be another engine method or an FFI object; this report' +
    '\ndoes not prove reachability from the app, only that non-test code uses it.'
);
