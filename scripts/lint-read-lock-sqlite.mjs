#!/usr/bin/env node
// `PersistentEngine` holds a `rusqlite::Connection`, which is `Send + !Sync`,
// and the crate carries an `unsafe impl Sync` that is sound only because every
// caller touching SQLite goes through the write lock. A closure under
// `with_engine_read` that reaches the connection breaks that: `prepare` is a
// `RefCell` borrow_mut, so the first concurrent read-lock holder that is not on
// the JS thread panics on the borrow or corrupts the statement cache.
//
// The invariant is stated at `persistence/mod.rs` above the `unsafe impl`, and
// three paths had drifted past it. Nothing was checking, because the compiler
// cannot: the unsafe impl is exactly the promise that the compiler stops asking.
//
// What this reads is the call graph, not the closure body. A read-lock closure
// calls `e.get_sections_for_activity(..)`, and it is the method behind that
// name, several files away, that prepares a statement. So the guard resolves
// every method a read-lock closure names, follows what those call, and reports
// the ones that reach SQLite.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'modules/veloqrs/rust/veloqrs/src';

/** What counts as touching the connection. */
const TOUCHES_DB = /\bself\.db\b|\bconn\.prepare|\btx\.prepare|\bself\.conn\b/;

/** `with_engine_read(|e| ...)` and its `with_persistent_engine_read` sibling. */
const READ_LOCK = /\bwith_(?:persistent_)?engine_read\s*\(\s*\|(\w+)\|/;

function rustFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...rustFiles(path));
    else if (entry.endsWith('.rs')) out.push(path);
  }
  return out;
}

const files = rustFiles(ROOT);
const sources = new Map(files.map((path) => [path, readFileSync(path, 'utf8')]));

/**
 * Every `fn name(` in the crate, with its body, keyed by name.
 *
 * Names collide across impls and this does not disambiguate them. That is the
 * safe direction for a guard: a collision can only make it report a method that
 * does not in fact reach SQLite, which a reader resolves, never hide one that
 * does.
 */
const bodies = new Map();
for (const [path, text] of sources) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)\s*[(<]/.exec(lines[i]);
    if (!m) continue;
    const body = [];
    let depth = 0;
    let opened = false;
    for (let j = i; j < lines.length; j++) {
      depth += (lines[j].match(/\{/g) ?? []).length;
      if (depth > 0) opened = true;
      depth -= (lines[j].match(/\}/g) ?? []).length;
      body.push(lines[j]);
      if (opened && depth <= 0) break;
    }
    const found = bodies.get(m[1]) ?? [];
    found.push({ path, line: i + 1, body: body.join('\n') });
    bodies.set(m[1], found);
  }
}

/** Whether `name` reaches SQLite, directly or through what it calls. */
const verdicts = new Map();
function reachesDb(name, seen = new Set()) {
  if (verdicts.has(name)) return verdicts.get(name);
  if (seen.has(name)) return null;
  seen.add(name);
  for (const { body } of bodies.get(name) ?? []) {
    if (TOUCHES_DB.test(body)) {
      verdicts.set(name, name);
      return name;
    }
  }
  for (const { body } of bodies.get(name) ?? []) {
    for (const call of body.matchAll(/\bself\.(\w+)\s*\(/g)) {
      const via = reachesDb(call[1], seen);
      if (via) {
        verdicts.set(name, via);
        return via;
      }
    }
  }
  return null;
}

const offences = [];
for (const [path, text] of sources) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = READ_LOCK.exec(lines[i]);
    if (!open) continue;
    const binding = open[1];
    // The closure, to its closing brace.
    let depth = 0;
    let opened = false;
    const closure = [];
    for (let j = i; j < lines.length; j++) {
      depth += (lines[j].match(/[({]/g) ?? []).length;
      if (depth > 0) opened = true;
      depth -= (lines[j].match(/[)}]/g) ?? []).length;
      closure.push({ line: j + 1, text: lines[j] });
      if (opened && depth <= 0) break;
    }
    // Matched over the whole closure rather than line by line: the binding and
    // the method it calls sit on different lines whenever the chain is
    // wrapped, which is most of them, and a per-line scan saw none of those.
    const text = closure.map((l) => l.text).join('\n');
    const calls = new RegExp(`\\b${binding}\\s*\\n?\\s*\\.\\s*(\\w+)\\s*\\(`, 'g');
    for (const call of text.matchAll(calls)) {
      const via = reachesDb(call[1]);
      if (!via) continue;
      const before = text.slice(0, call.index).split('\n').length - 1;
      offences.push({
        path,
        line: closure[before].line,
        method: call[1],
        via: via === call[1] ? null : via,
      });
    }
  }
}

if (offences.length === 0) {
  console.log('Read-lock guard: no read-lock closure reaches SQLite.');
  process.exit(0);
}

console.error(
  `A read-lock closure must not touch the connection. ${offences.length} do.\n` +
    'The unsafe impl Sync on PersistentEngine is sound only while every SQLite\n' +
    'read goes through the write lock. Move the call to with_engine, or give the\n' +
    'reader a connection of its own.\n'
);
for (const { path, line, method, via } of offences) {
  const how = via ? ` (reaches SQLite through ${via})` : '';
  console.error(`  ${path}:${line}  ${method}${how}`);
}
process.exit(1);
