/**
 * Shared types used by delegate modules and re-exported from RouteEngineClient
 * for public consumption (via `export { type Foo } from '...'`).
 *
 * These are the JS-side shapes for FFI methods whose auto-generated UniFFI
 * types are not yet available in `./generated/veloqrs.ts`. Once a type IS
 * generated, re-export the generated truth here instead of hand-maintaining
 * a shadow copy that drifts.
 */

export type {
  FfiMergeCandidate,
  FfiNearbySectionSummary,
  FfiSectionMatch,
} from '../generated/veloqrs';

/** Pre-computed daily activity intensity from Rust heatmap cache. */
export interface HeatmapDay {
  date: string;
  intensity: number;
  maxDuration: bigint;
  activityCount: number;
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
  /** Seconds vs the route PR. Negative = ahead of PR. */
  timeDeltaSeconds?: number;
  /** When isPr: seconds faster than the previous best attempt. */
  prImprovementSeconds?: number;
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
