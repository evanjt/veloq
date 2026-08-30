/**
 * Shared native module loader for veloqrs.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';

let _module: typeof import('veloqrs') | null = null;
let _loadAttempted = false;

export function getNativeModule(): typeof import('veloqrs') | null {
  if (_loadAttempted) return _module;
  _loadAttempted = true;
  try {
    _module = require('veloqrs');
  } catch {
    _module = null;
  }
  return _module;
}

export function getRouteEngine(): typeof import('veloqrs').routeEngine | null {
  const mod = getNativeModule();
  return mod?.routeEngine ?? null;
}

/**
 * Whether the engine is open, not merely whether a handle exists.
 *
 * `getRouteEngine` hands back a singleton created on the first require, so a
 * null check there answers "did the native module load", never "can it answer
 * a question". Before `initWithPath` every read returns its empty default, so
 * a caller that branches on the handle reads those defaults as facts.
 */
export function isRouteEngineReady(): boolean {
  return getRouteEngine()?.ready ?? false;
}

export type DetectionStrictness = 'relaxed' | 'default' | 'strict';

/**
 * Route-grouping params (MatchConfig).
 */
const MATCH_PRESETS: Record<DetectionStrictness, { matchPct: number; endpoint: number }> = {
  relaxed: { matchPct: 50, endpoint: 300 },
  default: { matchPct: 55, endpoint: 250 },
  strict: { matchPct: 65, endpoint: 180 },
};

// The configuration the detector is validated at. Written in full so it
// cannot inherit a value an older config left behind.
export const UNIFIED_CONFIG = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};

/**
 * Apply the route-grouping strictness to the Rust engine. The detector's own
 * parameters are the user's sliders and are not touched: a preset answers
 * how tightly rides group into routes, not how sections are cut. The engine
 * persists match strictness, so the next load picks it up without help.
 */
export function applyDetectionStrictness(strictness: DetectionStrictness): void {
  const engine = getRouteEngine();
  if (!engine) return;
  const matchPreset = MATCH_PRESETS[strictness];
  engine.setMatchStrictness(matchPreset.matchPct, matchPreset.endpoint);
}

/**
 * Get the plain filesystem path for the routes SQLite database.
 * FileSystem.documentDirectory returns a file:// URI, but SQLite needs a plain path.
 */
export function getRouteDbPath(): string | null {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) return null;
  const plainPath = docDir.startsWith('file://') ? docDir.slice(7) : docDir;
  return `${plainPath}routes.db`;
}
