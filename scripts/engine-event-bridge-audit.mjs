#!/usr/bin/env node
// Encodes the Rust-first invalidation rule. Engine-derived React Query / useMemo
// data is stale unless something wakes it: an engine subscription or a
// GlobalDataSync queryClient.invalidateQueries on sync complete. The strength
// and wellness stale-data bugs were exactly this: a hook read engine data but
// nothing invalidated its query key after a sync.
//
// Checks:
//   1. Hooks that read engine data (getRouteEngine / engine.get* / routeEngine.*)
//      inside a useQuery queryFn or a useMemo must EITHER subscribe via
//      useEngineSubscription / createEngineHook OR have every queryKey group they
//      use invalidated in GlobalDataSync. Orphans are flagged.
//   2. Every initialize* store hydrator imported into backup.ts must be called in
//      the post-restore reinitializeAllStores block, so a restored preference
//      key isn't silently left un-hydrated.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_DIR = join(ROOT, 'src/hooks');
const SHARED_APP_DIR = join(ROOT, 'src/shared/app');
const QUERY_KEYS_FILE = join(ROOT, 'src/shared/query/queryKeys.ts');
const GLOBAL_SYNC_FILE = join(ROOT, 'src/shared/ui/GlobalDataSync.tsx');
const BACKUP_FILE = join(ROOT, 'src/lib/export/backup.ts');

const rel = (p) => relative(ROOT, p);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

// Top-level query key groups: queryKeys.<group> = { ... }. We treat the group
// as the unit of invalidation because GlobalDataSync invalidates by group root
// (e.g. queryKeys.strength.all), and TanStack partial-key matching covers the
// members.
function parseQueryKeyGroups(src) {
  const groups = new Set();
  // Match `  groupName: {` at the first indent level inside `export const queryKeys = {`.
  const body = src.slice(src.indexOf('queryKeys'));
  const re = /^ {2}([a-zA-Z]\w*):\s*\{/gm;
  let m;
  while ((m = re.exec(body))) groups.add(m[1]);
  return groups;
}

// Query key groups GlobalDataSync invalidates (any queryKeys.<group>.* reference
// inside an invalidateQueries/resetQueries call).
function parseInvalidatedGroups(src, knownGroups) {
  const invalidated = new Set();
  const re = /queryKeys\.(\w+)\./g;
  let m;
  while ((m = re.exec(src))) {
    if (knownGroups.has(m[1])) invalidated.add(m[1]);
  }
  return invalidated;
}

const ENGINE_READ = /\bgetRouteEngine\s*\(|\bengine\.get[A-Z]|\brouteEngine\.\w/;

// Anything that wakes engine-derived React Query data when the engine changes:
// the subscription helpers, a raw engine.subscribe(...), or a call into one of
// the useEngine*/useSection*/useGroup*/useRoute* hooks that subscribe internally.
// useMemo recomputes from its own inputs, not on sync, so a useMemo-only hook is
// query-on-demand, not the data-sync shape these bugs lived in — out of scope.
const SUBSCRIBES =
  /\buseEngineSubscription\b|\bcreateEngineHook\b|\.subscribe\s*\(|\buse(?:Engine|Section|Group|Route)[A-Z]\w*\s*\(/;

// Hooks whose queryFn fetches from intervalsApi are API-sourced — the engine
// read is a write-through cache fallback. They refresh on their own staleTime,
// not on activity sync, so they aren't the sync-derived shape these bugs had.
const API_BACKED = /\bintervalsApi\./;

// Verified-acceptable engine-derived hooks that intentionally don't invalidate
// on sync-complete: custom sections are user-created (not activity-sync-mutated)
// and refresh via their own refresh() on create/delete.
const EXEMPT = new Set(['src/hooks/routes/useCustomSections.ts']);

// The strength + wellness stale-data bugs were a useQuery whose queryFn read
// engine data, keyed on a centralized queryKeys.<group>, with that group missing
// from GlobalDataSync's invalidation set. We scope the audit to exactly that
// shape: useQuery + centralized query key. Derive-from-input useMemo hooks and
// action hooks are excluded — they have no sync-driven refresh expectation.
function findEngineHookOrphans(knownGroups, invalidatedGroups) {
  const orphans = [];
  for (const file of [...walk(HOOKS_DIR), ...walk(SHARED_APP_DIR)]) {
    const src = readFileSync(file, 'utf8');
    if (!ENGINE_READ.test(src)) continue;
    if (!/\buseQuery\b/.test(src)) continue;

    const usedGroups = new Set();
    const re = /queryKeys\.(\w+)\b/g;
    let m;
    while ((m = re.exec(src))) {
      if (knownGroups.has(m[1])) usedGroups.add(m[1]);
    }
    if (usedGroups.size === 0) continue;

    if (SUBSCRIBES.test(src)) continue;
    if (API_BACKED.test(src)) continue;
    if (EXEMPT.has(rel(file))) continue;

    const uncovered = [...usedGroups].filter((g) => !invalidatedGroups.has(g));
    if (uncovered.length > 0) {
      orphans.push({
        file: rel(file),
        reason: `query key group(s) not invalidated by GlobalDataSync: ${uncovered.join(', ')}`,
      });
    }
  }
  return orphans;
}

// Every initialize* hydrator imported into backup.ts must be invoked in the
// reinitializeAllStores body. A restored preference whose initializer is missing
// reads pre-restore in-memory state until the next app launch.
function findReinitGaps(src) {
  const imported = new Set();
  const importRe = /\b(initialize[A-Z]\w*)\b/g;
  let m;
  while ((m = importRe.exec(src))) imported.add(m[1]);

  const bodyStart = src.indexOf('reinitializeAllStores');
  if (bodyStart === -1) {
    return { missing: [...imported], noBody: true };
  }
  // Reinit body runs to the end of the function (next `^}` at column 0).
  const after = src.slice(bodyStart);
  const bodyEnd = after.search(/\n\}/);
  const body = bodyEnd === -1 ? after : after.slice(0, bodyEnd);

  const called = new Set();
  const callRe = /\b(initialize[A-Z]\w*)\s*\(/g;
  while ((m = callRe.exec(body))) called.add(m[1]);

  const missing = [...imported].filter((name) => !called.has(name));
  return { missing, noBody: false };
}

function main() {
  const queryKeysSrc = readFileSync(QUERY_KEYS_FILE, 'utf8');
  const globalSyncSrc = readFileSync(GLOBAL_SYNC_FILE, 'utf8');
  const backupSrc = readFileSync(BACKUP_FILE, 'utf8');

  const knownGroups = parseQueryKeyGroups(queryKeysSrc);
  const invalidatedGroups = parseInvalidatedGroups(globalSyncSrc, knownGroups);

  let failed = false;

  const orphans = findEngineHookOrphans(knownGroups, invalidatedGroups);
  if (orphans.length > 0) {
    failed = true;
    console.error('Engine-event bridge orphans (engine-derived data with no refresh path):');
    for (const o of orphans) console.error(`  ${o.file}\n    ${o.reason}`);
    console.error('');
    console.error('Fix: subscribe via useEngineSubscription/createEngineHook, or add the');
    console.error('     query key group to GlobalDataSync\'s sync-complete invalidation block.');
    console.error('');
  }

  const { missing, noBody } = findReinitGaps(backupSrc);
  if (noBody) {
    failed = true;
    console.error('Could not locate reinitializeAllStores in backup.ts — restore reinit check skipped.');
  } else if (missing.length > 0) {
    failed = true;
    console.error('Imported store initializers never called in reinitializeAllStores:');
    for (const name of missing) console.error(`  ${name}`);
    console.error('');
    console.error('Fix: add the initialize* call to the reinitializeAllStores Promise.all block,');
    console.error('     or drop the unused import.');
    console.error('');
  }

  if (failed) {
    process.exit(1);
  }

  console.log('engine-event-bridge-audit: OK');
  console.log(`  query key groups: ${knownGroups.size}, invalidated by GlobalDataSync: ${invalidatedGroups.size}`);
}

main();
