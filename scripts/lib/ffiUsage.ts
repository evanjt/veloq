/**
 * What the FFI usage report reads and what it counts.
 *
 * Both were wrong and both failed silently. The manifest was parsed with a
 * regex expecting double quotes, and Prettier writes it with single, so the
 * report analysed nothing and printed a clean zero. And a caller was counted
 * anywhere under `modules/veloqrs/src`, which includes the delegate layer that
 * forwards every export by name, so an export that is delegated and called by
 * nobody scored as used.
 *
 * The manifest is TypeScript, so it is imported rather than parsed. There is
 * no regex left to drift.
 *
 * The counting was wrong twice more and in the same silent way. It matched any
 * identifier equal to an export's camel name, so `current` scored 1,198 off
 * `ref.current` and `new` 603 off the keyword, and it keyed by camel name,
 * which 22 exports share and `new` shares twelve ways. A call now needs a
 * receiver, and a row is one manifest entry, so `RouteManager.getAll` and
 * `SectionManager.getAll` are two rows and not one number belonging to
 * neither.
 */

import * as fs from 'fs';
import * as path from 'path';

import { FFI_EXPORTS } from '../../src/__tests__/bindings/ffi-exports.generated';

/** Every export the manifest declares, in the order it declares them. */
export function exportedNames(): string[] {
  return FFI_EXPORTS.map((e) => e.camelName);
}

/** One export, addressed so two objects' `getAll` stay apart. */
export interface ExportKey {
  key: string;
  object?: string;
  camelName: string;
}

/**
 * The row an export gets in the report. A standalone function is its own name;
 * a method is qualified by the object that owns it, which is the only thing
 * that tells twelve different `new` exports apart.
 */
export function keyOf(e: { object?: string; camelName: string }): string {
  return e.object ? `${e.object}.${e.camelName}` : e.camelName;
}

/** Every manifest entry as a row of its own. */
export function exportedKeys(): ExportKey[] {
  return FFI_EXPORTS.map((e) => ({
    key: keyOf(e),
    object: e.object,
    camelName: e.camelName,
  }));
}

/**
 * The export name a call site's method belongs to.
 *
 * The bindings escape a JS keyword with a trailing underscore, so
 * `sections().delete_()` is the export the manifest names `delete`, and
 * without this it read as named by nothing.
 */
export function exportNameOf(method: string, declared: Set<string>): string {
  if (declared.has(method)) return method;
  const unescaped = method.replace(/_$/, '');
  return declared.has(unescaped) ? unescaped : method;
}

/** One `receiver.method(` found in a source file. */
export interface Call {
  receiver: string;
  method: string;
  /** Offset of the call in the text it was found in. */
  index: number;
}

/**
 * The receiver a call hangs off, given everything to the left of its dot.
 *
 * The delegate layer reaches an object through an accessor,
 * `host.engine.routes().getAll()`, so the token before the dot is a closing
 * bracket. Stepping back over a balanced call or index leaves the name that
 * says which object this is, which is the whole point of reading the receiver.
 */
export function receiverOf(before: string): string {
  let end = before.replace(/\s+$/, '').length;
  const text = before.slice(0, end);
  if (end > 0 && (text[end - 1] === ')' || text[end - 1] === ']')) {
    const close = text[end - 1];
    const open = close === ')' ? '(' : '[';
    let depth = 0;
    let i = end - 1;
    for (; i >= 0; i--) {
      if (text[i] === close) depth++;
      else if (text[i] === open && --depth === 0) break;
    }
    if (i < 0) return '';
    end = i;
  }
  const name = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(text.slice(0, end).replace(/\s+$/, ''));
  return name ? name[1] : '';
}

/**
 * The calls in a stretch of source.
 *
 * A call needs a receiver and an opening bracket. Matching a bare identifier
 * counted `ref.current`, the `new` keyword and a destructured `sections` as
 * callers of the exports that happen to share those names.
 *
 * Takes the whole file, not a line: a Prettier-wrapped chain puts
 * `.getScreenData(` on a line of its own, and reading line by line finds no
 * receiver before the dot and drops the call entirely.
 */
export function callsIn(text: string): Call[] {
  const call = /\??\.\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  const found: Call[] = [];
  for (const m of text.matchAll(call)) {
    const receiver = receiverOf(text.slice(0, m.index));
    if (!receiver) continue;
    found.push({ receiver, method: m[1], index: m.index });
  }
  // UniFFI names a constructor `new` and the bindings expose it as
  // `new Thing()`, so the export named `new` has no `.new(` anywhere and read
  // as unreachable on all thirteen objects.
  const construct = /\bnew\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  for (const m of text.matchAll(construct)) {
    found.push({ receiver: m[1], method: 'new', index: m.index });
  }
  return found;
}

/**
 * Calls to the standalone exports, which have no receiver to require.
 *
 * `takeFetchAndStoreResult()` is imported and called bare, so the receiver
 * rule that fixed the method counts drops it entirely. Restricting this to the
 * seventeen standalone names keeps it away from the identifiers that caused
 * the problem: none of them is `current`, `new` or `sections`.
 */
export function standaloneCallsIn(text: string, standalone: Set<string>): Call[] {
  const found: Call[] = [];
  const call = /(?<![.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  for (const m of text.matchAll(call)) {
    if (!standalone.has(m[1])) continue;
    found.push({ receiver: '', method: m[1], index: m.index });
  }
  return found;
}

/**
 * Which engine accessor reaches which UniFFI object, read out of the generated
 * bindings rather than kept by hand: `routes(): RouteManagerLike` is what makes
 * `host.engine.routes().getAll()` a call to `RouteManager.getAll` and not to
 * `SectionManager.getAll`.
 */
let accessors: Record<string, string> | null = null;
export function accessorObjects(): Record<string, string> {
  if (accessors) return accessors;
  const generated = path.resolve(__dirname, '../../modules/veloqrs/src/generated/veloqrs.ts');
  const map: Record<string, string> = {};
  if (fs.existsSync(generated)) {
    const source = fs.readFileSync(generated, 'utf-8');
    for (const m of source.matchAll(/^\s+([a-z][A-Za-z0-9]*)\(\): ([A-Za-z0-9]+)Like;/gm)) {
      map[m[1]] = m[2];
    }
  }
  accessors = map;
  return map;
}

/**
 * Which object each name in one file is declared to hold.
 *
 * `SectionPreview` has no engine accessor: the delegate keeps its own handle,
 * `function previewObj(): SectionPreviewLike`, so `previewObj().start()` is a
 * call to `SectionPreview.start` and nothing but the declaration says so. The
 * binding is read out of the file being scanned, so it costs one regex and
 * stays true as the file changes.
 */
export function typeBindings(source: string): Record<string, string> {
  const map: Record<string, string> = {};
  // One level of alias: `type EngineHandle = VeloqEngineLike` is how the
  // delegate host names the engine, so nothing is declared `VeloqEngineLike`
  // directly and `host.engine` would resolve to nothing without it.
  const aliases: Record<string, string> = {};
  for (const m of source.matchAll(/\btype\s+([A-Za-z0-9_$]+)\s*=\s*([A-Za-z0-9]+)Like\b/g)) {
    aliases[m[1]] = m[2];
  }
  const declared = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:\(\))?\s*:\s*([A-Za-z0-9_$]+)/g;
  for (const m of source.matchAll(declared)) {
    const named = m[2].endsWith('Like') ? m[2].slice(0, -4) : aliases[m[2]];
    if (named) map[m[1]] = named;
  }
  return map;
}

/**
 * Which object a receiver names, through a declaration in its own file, the
 * engine's accessor, or the object's own name.
 *
 * The accessor is only consulted where accessors are used. `activities` is
 * `ActivityManager` in a delegate and an array of activities on half the
 * screens in `src/`, and taking the accessor's word for it everywhere put
 * `Set.add` and `String.trim` back on the report.
 */
function objectOf(
  receiver: string,
  objects: Set<string>,
  local: Record<string, string> = {},
  accessorsApply = false
): string | undefined {
  const viaLocal = local[receiver];
  if (viaLocal && objects.has(viaLocal)) return viaLocal;
  if (accessorsApply) {
    const viaAccessor = accessorObjects()[receiver];
    if (viaAccessor) return viaAccessor;
  }
  const lower = receiver.toLowerCase();
  for (const object of objects) if (object.toLowerCase() === lower) return object;
  return undefined;
}

/**
 * Which export rows a call could be.
 *
 * The receiver decides when it names an object, through the engine's accessor
 * or by the object's own name. Otherwise a shared method name resolves to every
 * candidate: a call through a variable the script cannot type is ambiguous, and
 * saying so beats picking one.
 */
export function resolveCall(
  call: Call,
  keys: ExportKey[],
  local: Record<string, string> = {},
  accessorsApply = true
): string[] {
  const method = exportNameOf(call.method, new Set(keys.map((k) => k.camelName)));
  const candidates = keys.filter((k) => k.camelName === method);
  if (candidates.length === 0) return [];
  const objects = new Set(keys.map((k) => k.object).filter((o): o is string => !!o));
  const named = objectOf(call.receiver, objects, local, accessorsApply);
  if (named) {
    const owned = candidates.filter((k) => k.object === named);
    return owned.map((k) => k.key);
  }
  return candidates.map((k) => k.key);
}

/**
 * Whether the receiver placed this call on one object.
 *
 * An unplaced call is not evidence about any export. `StyleSheet.create` is
 * 338 of the 341 the old report attributed to `VeloqEngine.create`, and to
 * `SectionManager.create` as well, which is how one line of styling became two
 * exports' headline figure.
 */
export function callIsAttributed(
  call: Call,
  keys: ExportKey[],
  local: Record<string, string> = {},
  accessorsApply = true
): boolean {
  const method = exportNameOf(call.method, new Set(keys.map((k) => k.camelName)));
  const candidates = keys.filter((k) => k.camelName === method);
  if (candidates.length === 0) return false;
  // A standalone export has no object to be reached through, so a bare call to
  // its name is the call.
  if (candidates.every((k) => !k.object)) return true;
  // A method is only reachable through its object, so the receiver has to name
  // it however few exports share the name. Letting an unshared name through on
  // its own put `Set.delete`, `String.trim` and `Set.clear` back on the report
  // as 32, 23 and 22 calls to three different managers.
  const objects = new Set(keys.map((k) => k.object).filter((o): o is string => !!o));
  return objectOf(call.receiver, objects, local, accessorsApply) !== undefined;
}

/**
 * Paths that name an export without a screen being behind it. The generated
 * bindings and the manifest describe the whole surface, and a test proves
 * nothing about reach.
 */
const NOT_A_CALLER = [
  'modules/veloqrs/src/generated/',
  'src/generated/',
  '__tests__',
  // Any generated module, wherever it sits. `maplibreRenderer.generated.ts` is
  // a megabyte of vendored renderer under `src/features/`, and every method
  // name in it read as a caller.
  '.generated.',
];

/** The one layer that forwards every export by name, whether or not it is used. */
const DELEGATE_LAYER = 'modules/veloqrs/src/delegates/';

const normalise = (file: string): string => file.replace(/\\/g, '/');

/** Whether a match in this file is evidence that something calls the export. */
export function isCallerFile(file: string): boolean {
  const path = normalise(file);
  if (path.includes(DELEGATE_LAYER)) return false;
  return !NOT_A_CALLER.some((fragment) => path.includes(fragment));
}

/**
 * Whether this file is the delegate layer. A match here is reach as far as the
 * FFI boundary and no further: the delegate renames as it forwards, so the app
 * calls `forceRedetectSections` for an export named `forceRedetect` and no
 * search for the export's own name will ever find the screen behind it.
 * Counting it as used hides a dead export; ignoring it calls fifty live ones
 * dead. It is its own answer.
 */
export function isDelegateFile(file: string): boolean {
  return normalise(file).includes(DELEGATE_LAYER);
}

/**
 * Whether this file is part of the layer that holds engine handles.
 *
 * Wider than the delegates: `EngineClient.ts` sits beside them and calls the
 * engine's own methods through `this.engine`. It is not a delegate, so a call
 * there is a real caller and not forwarding, but it is where the handle is
 * typed, so its receivers resolve the same way.
 */
export function isEngineLayerFile(file: string): boolean {
  return normalise(file).includes('modules/veloqrs/src/');
}

/** Where an export was found, worst first. */
export type Reach = 'called' | 'delegated' | 'unreachable';

/** What the counts in one file mean for an export's reach. */
export function reachOf(inSrc: number, inDelegates: number): Reach {
  if (inSrc > 0) return 'called';
  if (inDelegates > 0) return 'delegated';
  return 'unreachable';
}

/**
 * Exports with no placed call anywhere, each with the reason it is owned
 * somewhere else. Keyed by the report's own row, `Object.method`, because
 * eleven of these are named `new` and a camel name cannot tell them apart.
 *
 * Without this the report's first honest run is a list of fifteen that a
 * reader has to re-investigate every time.
 */
export const OWNED_ELSEWHERE: Record<string, string> = {
  // UniFFI names a constructor `new` and the engine's accessor builds each
  // manager on the Rust side, so TypeScript holds the handle and never
  // constructs one. There is no call to find and nothing to wire up.
  'ActivityManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'BasemapManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'DetectionManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'FitnessManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'HeatmapManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'MapManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'RouteManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'SectionManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'SettingsManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'StrengthManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',
  'SyncManager.new': 'built by the engine accessor in Rust, never constructed from TypeScript',

  // The basemap tile store. Reached by the offline map work rather than a
  // screen, so none of it has a caller here yet.
  'BasemapManager.setPath': 'the basemap tile store, reached from the offline map work rather than a screen',
  'BasemapManager.putTile': 'the basemap tile store, written by the tile pipeline',
  'BasemapManager.getTile': 'the basemap tile store, read by the tile pipeline',
  'BasemapManager.getCacheSize': 'the basemap tile store, read by the cache accounting',
  'BasemapManager.getSourceSize': 'the basemap tile store, read by the cache accounting',
  'BasemapManager.clearTiles': 'the basemap tile store, the whole-store clear',
  'BasemapManager.clearSourceTiles': 'the basemap tile store, the per-source clear',
  'BasemapManager.evictTo': 'the basemap tile store, the budget eviction',

  'DetectionManager.getMatchStrictness':
    'the read half of a setter the settings screen has, and its screen is unbuilt',
  validateBackupDatabase:
    'reached through a dynamic property off the native module, so no static call exists to find',
  'SettingsManager.clearUserProfileCaches':
    'called through a cast to an inline optional-method type, deliberately, so there is no typed receiver to read',
};
