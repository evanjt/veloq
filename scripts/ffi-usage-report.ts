#!/usr/bin/env npx tsx
/**
 * Which FFI exports nothing in the app calls.
 *
 * Usage:
 *   npx tsx scripts/ffi-usage-report.ts
 *   npx tsx scripts/ffi-usage-report.ts --unused    # just the list
 *   npx tsx scripts/ffi-usage-report.ts --check     # exit 1 on an unlisted one
 *   npx tsx scripts/ffi-usage-report.ts --areas     # the reach of each area
 *   npx tsx scripts/ffi-usage-report.ts --check-areas   # exit 1 on an area that grew
 *   npx tsx scripts/ffi-usage-report.ts --client    # per EngineClient method
 *   npx tsx scripts/ffi-usage-report.ts --json
 *
 * What counts as a caller, and which exports are owned elsewhere, live in
 * lib/ffiUsage.ts beside the reasons for each.
 */

import * as fs from 'fs';
import * as path from 'path';

import { indexedSources as readIndex } from './lib/indexedSources.mjs';
import {
  OWNED_ELSEWHERE,
  areaOf,
  surfaceOverCeiling,
  type AreaSurface,
  clientMethodReach,
  type Reach,
  callIsAttributed,
  callsIn,
  standaloneCallsIn,
  exportedKeys,
  isCallerFile,
  isDelegateFile,
  isEngineLayerFile,
  reachOf,
  resolveCall,
  typeBindings,
} from './lib/ffiUsage';

const REPO = path.resolve(__dirname, '..');
const ROOTS = [path.join(REPO, 'src'), path.join(REPO, 'modules/veloqrs/src')];
const EXTENSIONS = ['.ts', '.tsx'];
const CEILINGS = path.join(REPO, 'scripts/ffi-area-ceilings.json');

/**
 * The area ratchet counts the index rather than the disk.
 *
 * Every worktree merges through the one checkout, so a total taken over its
 * working tree puts one session's uncommitted file into everybody else's
 * merge, and the merge fails on a file it never touched. The index is the tree
 * the commit or the merge is actually making. Nothing else here reads it: the
 * other modes are reports a person runs on the tree in front of them.
 */
const FROM_INDEX = process.argv.includes('--check-areas');

/**
 * The tracked sources, by path relative to the repository, or null off-index.
 *
 * The listing, the batch and the walk over it live in `lib/indexedSources.mjs`,
 * which four guards already share. Two copies of that walk meant `B1082`'s
 * defect, a gitlink's header carrying no size and read as a blob's, was fixed
 * in one and left in the other, and a short read here fell back to the working
 * tree rather than saying so.
 */
function indexedSources(): Map<string, string> | null {
  let sources: Map<string, Buffer>;
  try {
    sources = readIndex(REPO, ['src', 'modules/veloqrs/src']);
  } catch (error) {
    // A root that is not a checkout has no index to read and falls back to the
    // disk below, which is what the fixtures rely on. A checkout whose read
    // failed part way is a different thing: say so rather than quietly mix the
    // index with the working tree, which is `B922` by another route.
    if (fs.existsSync(path.join(REPO, '.git'))) throw error;
    return null;
  }

  const text = new Map<string, string>();
  for (const [file, bytes] of sources) {
    if (!EXTENSIONS.includes(path.extname(file))) continue;
    if (!isCallerFile(file) && !isDelegateFile(file)) continue;
    text.set(file, bytes.toString('utf-8'));
  }
  return text;
}

const INDEXED = FROM_INDEX ? indexedSources() : null;

interface UsageInfo {
  /** The row: a standalone name, or `Object.method`. */
  key: string;
  name: string;
  object?: string;
  usageCount: number;
  delegateCount: number;
  /** Calls the receiver could not place, counted against every candidate. */
  ambiguousCount: number;
  reach: Reach;
  files: { file: string; line: number; context: string }[];
}

/** Every file a caller could be in, relative to the repository root. */
function callerFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (EXTENSIONS.includes(path.extname(entry.name))) {
        const rel = path.relative(REPO, full);
        if (isCallerFile(rel) || isDelegateFile(rel)) found.push(rel);
      }
    }
  };
  if (INDEXED) return [...INDEXED.keys()];
  for (const root of ROOTS) if (fs.existsSync(root)) walk(root);
  return found;
}

/** A caller file's text, out of the index where the area ratchet is running. */
function sourceOf(file: string): string {
  return INDEXED?.get(file) ?? fs.readFileSync(path.join(REPO, file), 'utf-8');
}

/** Which exports each area of the app names, sorted. */
function areaSurface(usage: UsageInfo[]): AreaSurface {
  const areas: Record<string, Set<string>> = {};
  for (const entry of usage) {
    for (const { file } of entry.files) {
      const area = areaOf(file);
      if (area === null) continue;
      (areas[area] ??= new Set()).add(entry.key);
    }
  }
  return Object.fromEntries(
    Object.keys(areas)
      .sort()
      .map((area) => [area, [...areas[area]].sort()])
  );
}

/**
 * One pass over the files rather than one grep per export. With 248 exports
 * the old shape read every file 248 times, which is why nobody ran it.
 */
function report(): UsageInfo[] {
  const keys = exportedKeys();
  const standalone = new Set(keys.filter((k) => !k.object).map((k) => k.camelName));
  const usage = new Map<string, UsageInfo>();
  for (const k of keys) {
    usage.set(k.key, {
      key: k.key,
      name: k.camelName,
      object: k.object,
      usageCount: 0,
      delegateCount: 0,
      ambiguousCount: 0,
      reach: 'unreachable',
      files: [],
    });
  }

  // The names are declared where they are defined, not where they are used:
  // `host.ts` types the engine handle and every delegate calls `host.engine`,
  // and `engine.ts` types the handle the screens hold. So the bindings are
  // collected over the whole tree and merged with each file's own, rather than
  // read from the file in hand alone.
  const files = callerFiles();
  const sources = new Map<string, string>();
  const shared: Record<string, string> = {};
  for (const file of files) {
    const source = sourceOf(file);
    sources.set(file, source);
    Object.assign(shared, typeBindings(source));
  }

  for (const file of files) {
    const delegate = isDelegateFile(file);
    const engineLayer = isEngineLayerFile(file);
    const source = sources.get(file) as string;
    const local = { ...shared, ...typeBindings(source) };
    const lineStarts: number[] = [0];
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1);
    const lineOf = (index: number): number => {
      let lo = 0;
      let hi = lineStarts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lineStarts[mid] <= index) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    for (const call of [...callsIn(source), ...standaloneCallsIn(source, standalone)]) {
      // A call the receiver could not place is not evidence about any export
      // sharing the name, so it is recorded and kept out of the count.
      const attributed = callIsAttributed(call, keys, local, engineLayer);
      for (const key of resolveCall(call, keys, local, engineLayer)) {
        const entry = usage.get(key);
        if (!entry) continue;
        if (!attributed) {
          entry.ambiguousCount++;
          continue;
        }
        if (delegate) {
          entry.delegateCount++;
          continue;
        }
        entry.usageCount++;
        const line = lineOf(call.index);
        entry.files.push({
          file,
          line: line + 1,
          context: source.slice(lineStarts[line], lineStarts[line + 1] ?? source.length).trim().substring(0, 80),
        });
      }
    }
  }

  for (const entry of usage.values()) {
    entry.reach = reachOf(entry.usageCount, entry.delegateCount);
  }

  return [...usage.values()].sort((a, b) => b.usageCount - a.usageCount);
}

/**
 * Which `EngineClient` methods no production code calls.
 *
 * The export report cannot answer this: a delegate renames as it forwards and
 * two client methods can sit on one delegate, so an export reached under one
 * name hides the method beside it that nothing calls (`D42`).
 */
function clientReport(): [string, number][] {
  const classPath = path.join(REPO, 'modules/veloqrs/src/EngineClient.ts');
  const classSource = fs.readFileSync(classPath, 'utf-8');
  const files = callerFiles().map((file) => ({
    file,
    source: fs.readFileSync(path.join(REPO, file), 'utf-8'),
  }));
  return [...clientMethodReach(classSource, files)].sort((a, b) => a[1] - b[1]);
}

if (process.argv.includes('--client')) {
  const rows = clientReport();
  const unreached = rows.filter(([, count]) => count === 0);
  console.log(`=== ENGINECLIENT METHODS (${rows.length}) ===\n`);
  console.log(`Called from the app: ${rows.length - unreached.length}`);
  console.log(`Called by nothing outside the engine layer: ${unreached.length}\n`);
  for (const [method] of unreached) console.log(`  - ${method}`);
  process.exit(0);
}

const usageReport = report();
const used = usageReport.filter((u) => u.reach === 'called');
const delegated = usageReport.filter((u) => u.reach === 'delegated');
const unused = usageReport.filter((u) => u.reach === 'unreachable');
const unlisted = unused.filter((u) => !(u.key in OWNED_ELSEWHERE));

if (usageReport.length === 0) {
  console.error('The manifest declared no exports. Run: npm run ffi:manifest');
  process.exit(1);
}

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        used,
        delegated,
        unused,
        unlisted: unlisted.map((u) => u.name),
        summary: {
          total: usageReport.length,
          used: used.length,
          delegated: delegated.length,
          unused: unused.length,
        },
      },
      null,
      2
    )
  );
  process.exit(unlisted.length > 0 && process.argv.includes('--check') ? 1 : 0);
}

if (process.argv.includes('--areas') || process.argv.includes('--check-areas')) {
  const surface = areaSurface(usageReport);
  const ceilings: AreaSurface = fs.existsSync(CEILINGS)
    ? (JSON.parse(fs.readFileSync(CEILINGS, 'utf-8')) as AreaSurface)
    : {};

  if (process.argv.includes('--areas')) {
    console.log('=== ENGINE REACH BY AREA ===\n');
    for (const [area, keys] of Object.entries(surface)) {
      const allowed = ceilings[area]?.length;
      console.log(`${area}: ${keys.length}${allowed === undefined ? '' : ` of ${allowed}`}`);
      for (const key of keys) console.log(`  - ${key}`);
      console.log();
    }
    process.exit(0);
  }

  // A guard that read nothing must not report that nothing is over its
  // ceiling. Every checkout this runs in has areas; an empty surface means the
  // listing failed, or came from a tree this is not about, and the honest
  // answer is a refusal rather than a pass.
  if (Object.keys(surface).length === 0) {
    console.error('Engine area guard: no area reaches the engine at all.');
    console.error('');
    console.error('Nothing was read, so nothing was checked. Either the tracked sources');
    console.error('could not be listed, or git was pointed at another tree: the variables');
    console.error('a hook inherits beat the directory this was run in.');
    process.exit(1);
  }

  const over = surfaceOverCeiling(surface, ceilings);
  if (over.length === 0) {
    const total = Object.values(surface).reduce((sum, keys) => sum + keys.length, 0);
    console.log(
      `Engine area guard: ${Object.keys(surface).length} areas reach ${total} exports between ` +
        'them, none more than it is allowed to.'
    );
    process.exit(0);
  }
  for (const { area, added } of over) {
    const known = ceilings[area] === undefined;
    console.error(
      known
        ? `${area} reaches the engine and has no entry in scripts/ffi-area-ceilings.json:`
        : `${area} reaches ${added.length} export(s) it did not reach before:`
    );
    for (const key of added) console.error(`  - ${key}`);
  }
  console.error('');
  console.error('One screen read per screen: an area\'s reach only falls. Read the screen');
  console.error('data it already has, or lower another entry in the same commit if this');
  console.error('call is what replaces it.');
  process.exit(1);
}

if (process.argv.includes('--check')) {
  if (unlisted.length === 0) {
    console.log(
      `FFI usage guard: ${used.length} of ${usageReport.length} exports reach a screen, ` +
        `${delegated.length} reach the delegate layer and no further.`
    );
    process.exit(0);
  }
  console.error(
    `${unlisted.length} FFI export(s) are exported from Rust and named by nothing, not even a delegate:`
  );
  for (const u of unlisted) console.error(`  - ${u.key}`);
  console.error('');
  console.error('Either wire it up, delete it, or add it to OWNED_ELSEWHERE in');
  console.error('scripts/lib/ffiUsage.ts with the reason it has no caller here.');
  process.exit(1);
}

if (process.argv.includes('--unused')) {
  console.log(`=== UNREACHABLE FFI EXPORTS (${unused.length}/${usageReport.length}) ===\n`);
  for (const u of unused) {
    const reason = OWNED_ELSEWHERE[u.key];
    console.log(reason ? `  - ${u.key}  (owned elsewhere: ${reason})` : `  - ${u.key}`);
  }
  console.log(`\n${unlisted.length} of these have no recorded owner.`);
} else {
  console.log('=== FFI USAGE REPORT ===\n');
  console.log(
    'A Rust export\'s caller is the delegate that forwards it, not a screen. The\n' +
      'delegate renames as it forwards, so the app-facing unit is the EngineClient\n' +
      'method in front of it and that is the thing with screens behind it. Read\n' +
      '"delegated" as reaching the FFI boundary and no further under this name.\n'
  );
  console.log(`Total FFI exports: ${usageReport.length}`);
  console.log(`Called from the app: ${used.length}`);
  console.log(`Delegated but never called under that name: ${delegated.length}`);
  console.log(`Named by nothing: ${unused.length} (${unlisted.length} without a recorded owner)\n`);

  console.log('--- MOST USED (top 15) ---\n');
  for (const u of used.slice(0, 15)) {
    // A shared camel name the receiver could not place is counted against every
    // export that declares it, so the row says how much of its own count that is.
    const shared = u.ambiguousCount > 0 ? `, ${u.ambiguousCount} unplaced` : '';
    console.log(`${u.key} (${u.usageCount} calls${shared})`);
    for (const f of u.files.slice(0, 3)) console.log(`  ${f.file}:${f.line}`);
    if (u.files.length > 3) console.log(`  ... and ${u.files.length - 3} more`);
    console.log();
  }

  if (unused.length > 0) {
    console.log(`\n--- NAMED BY NOTHING (${unused.length}) ---\n`);
    for (const u of unused) console.log(`  - ${u.key}`);
    console.log('\nRun with --unused for just this list, or --check to gate on it.');
  }
}
