/**
 * Shared native module loader for veloqrs.
 *
 * Lazy loads the native module to avoid bundler errors when the
 * native module is not available (e.g., in web or Expo Go).
 */

// Use legacy API for SDK 54 compatibility (new API uses File/Directory classes)
import * as FileSystem from 'expo-file-system/legacy';

// Cached module reference
let _module: typeof import('veloqrs') | null = null;
let _loadAttempted = false;

/**
 * Get the full veloqrs module.
 * Returns null if module is not available.
 */
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

/**
 * Get the route engine from the native module.
 * Returns null if module is not available.
 */
export function getRouteEngine(): typeof import('veloqrs').routeEngine | null {
  const mod = getNativeModule();
  return mod?.routeEngine ?? null;
}

/**
 * Detection sensitivity preset. Bundles all 6 detection parameters:
 *   - MatchConfig (route grouping): matchPct, endpoint
 *   - SectionConfig (section detection): proximityThreshold, minSectionLength,
 *     minActivities, minRoutes
 *
 * `minRoutes` is the alphabet-overlap threshold for the density-grid pass:
 * how many distinct route groups must share a corridor for it to qualify
 * as a section. `minActivities` then filters the expanded activity set
 * (post-route-expansion) so a 2-route corridor visited by 1 person each
 * still gets pruned at the popularity stage.
 *
 * `value` is the slider position (0-100) used to snap UI controls and to
 * derive `preserveHierarchy` (more relaxed → preserve scale hierarchy).
 */
export type DetectionPreset = {
  key: 'detectionRelaxed' | 'default' | 'detectionStrict';
  value: number;
  matchPct: number;
  endpoint: number;
  proximityThreshold: number;
  minSectionLength: number;
  minActivities: number;
  minRoutes: number;
};

export const DETECTION_PRESETS: readonly DetectionPreset[] = [
  {
    key: 'detectionRelaxed',
    value: 20,
    matchPct: 50,
    endpoint: 300,
    proximityThreshold: 200,
    minSectionLength: 150,
    minActivities: 2,
    minRoutes: 2,
  },
  {
    key: 'default',
    value: 60,
    matchPct: 55,
    endpoint: 250,
    proximityThreshold: 150,
    minSectionLength: 200,
    minActivities: 3,
    minRoutes: 3,
  },
  {
    key: 'detectionStrict',
    value: 90,
    matchPct: 65,
    endpoint: 180,
    proximityThreshold: 75,
    minSectionLength: 300,
    minActivities: 4,
    minRoutes: 4,
  },
] as const;

/**
 * Snap a 0-100 strictness slider value to the nearest preset. Used by
 * startup callers that have only the persisted strictness number.
 */
export function getDetectionPresetByValue(value: number): DetectionPreset {
  let closest = DETECTION_PRESETS[0];
  let closestDist = Math.abs(closest.value - value);
  for (let i = 1; i < DETECTION_PRESETS.length; i++) {
    const dist = Math.abs(DETECTION_PRESETS[i].value - value);
    if (dist < closestDist) {
      closest = DETECTION_PRESETS[i];
      closestDist = dist;
    }
  }
  return closest;
}

/**
 * Apply a detection-strictness preset to the Rust engine.
 *
 * Writes ALL 6 detection parameters: 2 MatchConfig (min_match_pct,
 * endpoint_threshold) + 4 SectionConfig (proximity_threshold,
 * min_section_length, min_activities, min_routes). Both Rust setters
 * persist to the settings table so the next engine load picks them up
 * automatically.
 *
 * `preserveHierarchy` is derived from the slider position (more relaxed
 * → preserve scale hierarchy, more strict → flatten).
 */
export function applyDetectionPreset(preset: DetectionPreset): void {
  const engine = getRouteEngine();
  if (!engine) return;

  engine.setMatchStrictness(preset.matchPct, preset.endpoint);

  const current = engine.getSectionConfig();
  if (current) {
    engine.setSectionConfig({
      ...current,
      proximityThreshold: preset.proximityThreshold,
      minSectionLength: preset.minSectionLength,
      minActivities: preset.minActivities,
      minRoutes: preset.minRoutes,
      preserveHierarchy: preset.value <= 40,
    });
  }
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
