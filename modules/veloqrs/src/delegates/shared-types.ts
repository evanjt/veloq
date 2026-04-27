/**
 * Shared types used by delegate modules and re-exported from RouteEngineClient
 * for public consumption (via `export { type Foo } from '...'`).
 *
 * These are the JS-side shapes for FFI methods whose auto-generated UniFFI
 * types are not yet available in `./generated/veloqrs.ts`. When the Rust
 * bindings are regenerated, these may be replaced by the generated types.
 */

/** Pre-computed daily activity intensity from Rust heatmap cache. */
export interface HeatmapDay {
  date: string;
  intensity: number;
  maxDuration: bigint;
  activityCount: number;
}

export interface FfiSectionMatch {
  sectionId: string;
  sectionName: string | undefined;
  sportType: string;
  startIndex: bigint;
  endIndex: bigint;
  matchQuality: number;
  sameDirection: boolean;
  distanceMeters: number;
}

export interface FfiMergeCandidate {
  sectionId: string;
  name: string | undefined;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  overlapPct: number;
  centerDistanceMeters: number;
}

export interface FfiNearbySectionSummary {
  id: string;
  sectionType: string;
  name: string | undefined;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  centerDistanceMeters: number;
  encodedPolyline: ArrayBuffer;
}

export interface FfiActivitySectionHighlight {
  activityId: string;
  sectionId: string;
  sectionName: string;
  lapTime: number;
  isPr: boolean;
  trend: number;
  startIndex: number;
  endIndex: number;
}

export interface FfiActivityRouteHighlight {
  activityId: string;
  routeId: string;
  routeName: string;
  isPr: boolean;
  trend: number;
}

export interface FfiActivityIndicator {
  activityId: string;
  indicatorType: string; // "section_pr", "route_pr", "section_trend", "route_trend"
  targetId: string;
  targetName: string;
  direction: string;
  lapTime: number;
  trend: number; // -1=declining, 0=stable, 1=improving
}

/** A section encounter: one (section, direction) pair for a given activity. */
export interface SectionEncounter {
  sectionId: string;
  sectionName: string;
  direction: string;
  distanceMeters: number;
  lapTime: number;
  lapPace: number;
  isPr: boolean;
  visitCount: number;
  historyTimes: number[];
  historyActivityIds: string[];
}
