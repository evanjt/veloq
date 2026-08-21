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

export type DetectionMethod = 'corridor' | 'density' | 'flow' | 'unified';
export type DetectionStrictness = 'relaxed' | 'default' | 'strict';

/**
 * UI slider stops. Three positions: relaxed (20), default (60), strict (90).
 * `key` matches the i18n key used by the settings sliders/chips.
 */
export const DETECTION_PRESETS = [
  { key: 'detectionRelaxed', value: 20, strictness: 'relaxed' as const },
  { key: 'default', value: 60, strictness: 'default' as const },
  { key: 'detectionStrict', value: 90, strictness: 'strict' as const },
] as const;

export type DetectionPresetStop = (typeof DETECTION_PRESETS)[number];

/**
 * Snap a 0-100 strictness slider value to the nearest preset stop.
 */
export function getDetectionPresetByValue(value: number): DetectionPresetStop {
  let closest: DetectionPresetStop = DETECTION_PRESETS[0];
  let closestDist = Math.abs(closest.value - value);
  for (let i = 1; i < DETECTION_PRESETS.length; i++) {
    const candidate: DetectionPresetStop = DETECTION_PRESETS[i];
    const dist = Math.abs(candidate.value - value);
    if (dist < closestDist) {
      closest = candidate;
      closestDist = dist;
    }
  }
  return closest;
}

export function getStrictnessFromValue(value: number): DetectionStrictness {
  return getDetectionPresetByValue(value).strictness;
}

/**
 * Route-grouping params (MatchConfig). Independent of detection method.
 */
const MATCH_PRESETS: Record<DetectionStrictness, { matchPct: number; endpoint: number }> = {
  relaxed: { matchPct: 50, endpoint: 300 },
  default: { matchPct: 55, endpoint: 250 },
  strict: { matchPct: 65, endpoint: 180 },
};

// The configuration the unified detector is validated at. Written in full so
// it cannot inherit a value another method left behind.
export const UNIFIED_CONFIG = {
  proximityThreshold: 200,
  minSectionLength: 150,
  maxSectionLength: 200000,
  minActivities: 2,
  divergenceThreshold: 0.15,
};

/**
 * Apply the route-grouping strictness, and the detector config it rides with,
 * to the Rust engine. The engine persists section_config to the settings table,
 * so the next load picks it up without help.
 */
export function applyDetectionStrictness(strictness: DetectionStrictness): void {
  const engine = getRouteEngine();
  if (!engine) return;

  const matchPreset = MATCH_PRESETS[strictness];
  engine.setMatchStrictness(matchPreset.matchPct, matchPreset.endpoint);

  const current = engine.getSectionConfig();
  if (!current) return;

  // Written in full, never merged over whatever the config already held.
  engine.setSectionConfig({
    ...current,
    detectionMethod: 'unified',
    preserveHierarchy: false,
    ...UNIFIED_CONFIG,
  });
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
