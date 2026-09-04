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
 */

import { FFI_EXPORTS } from '../../src/__tests__/bindings/ffi-exports.generated';

/** Every export the manifest declares, in the order it declares them. */
export function exportedNames(): string[] {
  return FFI_EXPORTS.map((e) => e.camelName);
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
  'ffi-exports.generated',
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

/** Where an export was found, worst first. */
export type Reach = 'called' | 'delegated' | 'unreachable';

/** What the counts in one file mean for an export's reach. */
export function reachOf(inSrc: number, inDelegates: number): Reach {
  if (inSrc > 0) return 'called';
  if (inDelegates > 0) return 'delegated';
  return 'unreachable';
}

/**
 * Exports with no caller in `src/` that are not findings, each with the reason
 * it is owned somewhere else. Without this the report's first honest run is a
 * list of six that a reader has to re-investigate every time.
 */
export const OWNED_ELSEWHERE: Record<string, string> = {
  setPath: 'the basemap tile store, reached from the offline map work rather than a screen',
  putTile: 'the basemap tile store, written by the tile pipeline',
  getSourceSize: 'the basemap tile store, read by the cache accounting',
  clearSourceTiles: 'the basemap tile store, the per-source clear',
  evictTo: 'the basemap tile store, the budget eviction',
  getMatchStrictness: 'the read half of a setter the settings screen has, and its screen is unbuilt',
};
