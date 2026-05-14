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

export type DetectionMethod = 'corridor' | 'density' | 'flow';
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

export interface CorridorPreset {
  proximityThreshold: number;
  minSectionLength: number;
  minActivities: number;
  minCorridorTracks: number;
}

export interface DensityGridPreset {
  proximityThreshold: number;
  minSectionLength: number;
  minActivities: number;
  minRoutes: number;
  jaccardThreshold: number;
}

export interface FlowGraphPreset {
  proximityThreshold: number;
  minSectionLength: number;
  minActivities: number;
  minCellVisits: number;
  divergenceThreshold: number;
}

export const CORRIDOR_PRESETS: Record<DetectionStrictness, CorridorPreset> = {
  relaxed: {
    proximityThreshold: 200,
    minSectionLength: 150,
    minActivities: 2,
    minCorridorTracks: 2,
  },
  default: {
    proximityThreshold: 150,
    minSectionLength: 200,
    minActivities: 3,
    minCorridorTracks: 3,
  },
  strict: {
    proximityThreshold: 75,
    minSectionLength: 300,
    minActivities: 4,
    minCorridorTracks: 4,
  },
};

export const DENSITY_GRID_PRESETS: Record<DetectionStrictness, DensityGridPreset> = {
  relaxed: {
    proximityThreshold: 200,
    minSectionLength: 150,
    minActivities: 2,
    minRoutes: 2,
    jaccardThreshold: 0.35,
  },
  default: {
    proximityThreshold: 150,
    minSectionLength: 200,
    minActivities: 3,
    minRoutes: 3,
    jaccardThreshold: 0.5,
  },
  strict: {
    proximityThreshold: 75,
    minSectionLength: 300,
    minActivities: 4,
    minRoutes: 4,
    jaccardThreshold: 0.65,
  },
};

export const FLOW_GRAPH_PRESETS: Record<DetectionStrictness, FlowGraphPreset> = {
  relaxed: {
    proximityThreshold: 200,
    minSectionLength: 150,
    minActivities: 2,
    minCellVisits: 30,
    divergenceThreshold: 0.1,
  },
  default: {
    proximityThreshold: 150,
    minSectionLength: 200,
    minActivities: 3,
    minCellVisits: 50,
    divergenceThreshold: 0.15,
  },
  strict: {
    proximityThreshold: 75,
    minSectionLength: 300,
    minActivities: 4,
    minCellVisits: 80,
    divergenceThreshold: 0.25,
  },
};

const METHOD_FFI_KEY: Record<DetectionMethod, 'corridor' | 'density_grid' | 'flow_graph'> = {
  corridor: 'corridor',
  density: 'density_grid',
  flow: 'flow_graph',
};

/**
 * Apply a detection preset to the Rust engine for the given method.
 *
 * Writes the method-specific param set plus the shared route-grouping
 * strictness. The Rust engine persists section_config to the settings
 * table so the next engine load picks it up automatically.
 *
 * `preserveHierarchy` is derived from the strictness level (more relaxed
 * → preserve scale hierarchy, more strict → flatten).
 */
export function applyDetectionPresetForMethod(
  method: DetectionMethod,
  strictness: DetectionStrictness
): void {
  const engine = getRouteEngine();
  if (!engine) return;

  const matchPreset = MATCH_PRESETS[strictness];
  engine.setMatchStrictness(matchPreset.matchPct, matchPreset.endpoint);

  const current = engine.getSectionConfig();
  if (!current) return;

  const ffiMethod = METHOD_FFI_KEY[method];
  const preserveHierarchy = strictness === 'relaxed';

  if (method === 'corridor') {
    const p = CORRIDOR_PRESETS[strictness];
    engine.setSectionConfig({
      ...current,
      detectionMethod: ffiMethod,
      preserveHierarchy,
      proximityThreshold: p.proximityThreshold,
      minSectionLength: p.minSectionLength,
      minActivities: p.minActivities,
      minCorridorTracks: p.minCorridorTracks,
    });
  } else if (method === 'density') {
    const p = DENSITY_GRID_PRESETS[strictness];
    engine.setSectionConfig({
      ...current,
      detectionMethod: ffiMethod,
      preserveHierarchy,
      proximityThreshold: p.proximityThreshold,
      minSectionLength: p.minSectionLength,
      minActivities: p.minActivities,
      minRoutes: p.minRoutes,
      jaccardThreshold: p.jaccardThreshold,
    });
  } else {
    const p = FLOW_GRAPH_PRESETS[strictness];
    engine.setSectionConfig({
      ...current,
      detectionMethod: ffiMethod,
      preserveHierarchy,
      proximityThreshold: p.proximityThreshold,
      minSectionLength: p.minSectionLength,
      minActivities: p.minActivities,
      minCellVisits: p.minCellVisits,
      divergenceThreshold: p.divergenceThreshold,
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
