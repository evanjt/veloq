/**
 * Route matching types for identifying activities on similar routes.
 */

import type { ActivityType } from '@/features/activity/types';

/**
 * Valid activity types for type checking.
 * Keep in sync with ActivityType union in src/types/activity.ts
 */
const VALID_ACTIVITY_TYPES = new Set<string>([
  // Cycling
  'Ride',
  'VirtualRide',
  'EBikeRide',
  'MountainBikeRide',
  'GravelRide',
  'Velomobile',
  'Handcycle',
  // Running
  'Run',
  'VirtualRun',
  'TrailRun',
  'Treadmill',
  // Walking/Hiking
  'Walk',
  'Hike',
  // Swimming
  'Swim',
  'OpenWaterSwim',
  // Snow sports
  'AlpineSki',
  'NordicSki',
  'BackcountrySki',
  'Snowboard',
  'Snowshoe',
  'RollerSki',
  // Water sports
  'Rowing',
  'VirtualRow',
  'Kayaking',
  'Canoeing',
  'Surfing',
  'Kitesurf',
  'Windsurf',
  'StandUpPaddling',
  'Sail',
  // Skating
  'IceSkate',
  'InlineSkate',
  'Skateboard',
  // Gym/Fitness
  'Workout',
  'WeightTraining',
  'Yoga',
  'Pilates',
  'Crossfit',
  'Elliptical',
  'StairStepper',
  'HighIntensityIntervalTraining',
  // Racket sports
  'Tennis',
  'Badminton',
  'Pickleball',
  'Racquetball',
  'Squash',
  'TableTennis',
  // Other sports
  'Soccer',
  'Golf',
  'RockClimbing',
  'Wheelchair',
  // Catch-all
  'Other',
]);

/**
 * Type guard to check if a string is a valid ActivityType.
 */
export function isActivityType(value: string): value is ActivityType {
  return VALID_ACTIVITY_TYPES.has(value);
}

/**
 * Safely convert a string to ActivityType with fallback to 'Other'.
 * Use this instead of `as ActivityType` casts.
 */
export function toActivityType(value: string | undefined | null): ActivityType {
  if (value && isActivityType(value)) {
    return value;
  }
  return 'Other';
}

/** GPS point for route representation */
export interface RoutePoint {
  lat: number;
  lng: number;
}

/**
 * Compact route representation for efficient storage and comparison.
 * Uses Douglas-Peucker simplification to reduce points.
 */
export interface RouteSignature {
  /** Activity ID this signature belongs to */
  activityId: string;
  /** Simplified route points (typically 50-100 points) */
  points: RoutePoint[];
  /** Total route distance in meters */
  distance: number;
  /** Route bounding box for quick filtering */
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  /** Pre-computed center point for 120Hz map rendering */
  center: RoutePoint;
  /** Geohash of start region (~500m grid) for fast matching */
  startRegionHash: string;
  /** Geohash of end region (~500m grid) for fast matching */
  endRegionHash: string;
  /** Is this a loop (start/end close together) */
  isLoop: boolean;
  /** Total elevation gain in meters */
  elevationGain?: number;
}

/** Route group - a collection of activities on the same/similar route */
export interface RouteGroup {
  /** Unique route group ID */
  id: string;
  /** Display name (auto-generated or user-set) */
  name: string;
  /** Representative route signature (from the first/best activity) - optional for engine groups */
  signature?: RouteSignature | null;
  /** Consensus route - the common core that 80%+ of activities share */
  consensusPoints?: RoutePoint[];
  /** Activity IDs in this group */
  activityIds: string[];
  /** Total count of activities */
  activityCount: number;
  /** Date of first activity on this route - optional for engine groups */
  firstDate?: string;
  /** Date of most recent activity - optional for engine groups */
  lastDate?: string;
  /** Activity type (Ride, Run, etc.) */
  type: ActivityType;
  /** All sport types present in this group's activities */
  sportTypes?: string[];
  /** Distance in meters (from representative activity) */
  distance?: number;
  /** Pre-computed center point for proximity sorting */
  center?: { lat: number; lng: number };
  /** Average match quality for grouped activities (0-100) - optional for engine groups */
  averageMatchQuality?: number;
  /** Best moving time in seconds (fastest completion) */
  bestTime?: number;
  /** Average moving time in seconds */
  avgTime?: number;
  /** Best pace/speed in m/s (from fastest activity) */
  bestPace?: number;
  /** Activity ID with the best performance */
  bestActivityId?: string;
}

/** Direction of route match */
export type MatchDirection = 'same' | 'reverse' | 'partial';

/** A route discovered during processing (group of matching activities) */
export interface DiscoveredRouteInfo {
  id: string;
  /** Name from the first/primary activity */
  name: string;
  /** Activity type (Ride, Run, etc.) */
  type: string;
  /** IDs of all activities in this route */
  activityIds: string[];
  /** Names of activities for display */
  activityNames: string[];
  /** Number of activities grouped */
  activityCount: number;
  /** Average match percentage across all pairs */
  avgMatchPercentage: number;
  /** Route preview points */
  previewPoints?: { x: number; y: number }[];
  /** Route distance in meters */
  distance?: number;
}

// =============================================================================
// Sections (Unified auto-detected + custom sections)
// =============================================================================

/** Section type discriminator */
export type SectionType = 'auto' | 'custom';

/**
 * A unified section (auto-detected or custom).
 * Replaces FrequentSection and CustomSection with a single type.
 */
export interface Section {
  /** Unique section ID */
  id: string;
  /** Section type: 'auto' for detected sections, 'custom' for user-created */
  sectionType: SectionType;
  /** Section name */
  name?: string;
  /** Sport type (e.g., "Ride", "Run") */
  sportType: string;
  /** GPS points defining the section */
  polyline: RoutePoint[];
  /** Section length in meters */
  distanceMeters: number;
  /** Activity that provides the representative polyline */
  representativeActivityId?: string;
  /** Activity IDs that traverse this section */
  activityIds: string[];
  /** Number of times traversed */
  visitCount: number;

  // Auto-specific metadata (null for custom sections)
  /** Confidence score (0.0-1.0) based on observation density */
  confidence?: number;
  /** Number of tracks used to compute consensus */
  observationCount?: number;
  /** Average spread from consensus line (meters) */
  averageSpread?: number;
  /** Per-point observation density */
  pointDensity?: number[];
  /** Detection scale: "short", "medium", "long" */
  scale?: string;

  /** Whether reference is user-defined */
  isUserDefined?: boolean;

  /** How well the reference trace aligns with the consensus (0.0-1.0) */
  stability?: number;
  /** Elevation gain in metres over the representative slice, absent when unknown */
  elevationGainM?: number;
  /** Elevation loss in metres over the representative slice, absent when unknown */
  elevationLossM?: number;
  /** Net grade percent over the representative slice, absent when unknown */
  avgGradePercent?: number;
  /** Steepest grade percent held over 300 m of the slice, absent when unknown */
  maxGradePercent?: number;
  /** climb, descent, rolling, flat or loop, absent when nothing says */
  klass?: string;
  /** The detector read most of this ground as a lift rather than a ride */
  isLift?: boolean;
  /** Interestingness percentile across the catalogue, 0 to 1 */
  rankScore?: number;
  /** Interestingness percentile within the section's sport, 0 to 1 */
  sportRankScore?: number;
  /** Number of times this section has been recalibrated */
  version?: number;
  /** ISO timestamp of last recalibration */
  updatedAt?: string;

  /** ISO timestamp when section was created */
  createdAt: string;

  // Associations
  /** Route group IDs that include this section */
  routeIds?: string[];

  // Custom-specific fields (null for auto sections)
  /** Activity ID this custom section was created from */
  sourceActivityId?: string;
  /** Start index in source activity's GPS track */
  startIndex?: number;
  /** End index in source activity's GPS track */
  endIndex?: number;

  // On-demand data (loaded separately, not part of persisted section)
  /** Portion data for each activity (loaded from junction table) */
  activityPortions?: ActivitySectionRecord[];
  /** Activity traces (loaded on-demand for section detail) */
  activityTraces?: Record<string, RoutePoint[]>;
  /** All sport types present in this section's activities */
  sportTypes?: string[];
  /** Pre-computed center point for proximity sorting */
  center?: { lat: number; lng: number };
  /** Whether the user has disabled (hidden) this section */
  disabled?: boolean;
  /** If superseded by a custom section, stores its ID */
  supersededBy?: string | null;
}

/** Backward compatibility aliases */
export type FrequentSection = Section;
export type CustomSection = Section;

/**
 * Lightweight section summary (no polyline).
 */
export interface SectionSummary {
  id: string;
  sectionType: SectionType;
  name?: string;
  sportType: string;
  distanceMeters: number;
  visitCount: number;
  representativeActivityId?: string;
  createdAt: string;
  /** Elevation gain in metres over the representative slice, absent when unknown */
  elevationGainM?: number;
  /** Elevation loss in metres over the representative slice, absent when unknown */
  elevationLossM?: number;
  /** Net grade percent over the representative slice, absent when unknown */
  avgGradePercent?: number;
  /** Steepest grade percent held over 300 m of the slice, absent when unknown */
  maxGradePercent?: number;
  /** climb, descent, rolling, flat or loop, absent when nothing says */
  klass?: string;
  /** Interestingness percentile across the catalogue, 0 to 1 */
  rankScore?: number;
  /** Interestingness percentile within the section's sport, 0 to 1 */
  sportRankScore?: number;
}

/**
 * Each activity's portion of a section (for pace comparison).
 */
export interface ActivitySectionRecord {
  /** Activity ID */
  activityId: string;
  /** Start index into the activity's GPS track */
  startIndex: number;
  /** End index into the activity's GPS track */
  endIndex: number;
  /** Distance of this portion in meters */
  distanceMeters: number;
  /** Direction relative to representative: "same" or "reverse" */
  direction: 'same' | 'reverse';
}

/** Parameters for creating a section */
export interface CreateSectionParams {
  sportType: string;
  polyline: RoutePoint[];
  distanceMeters: number;
  name?: string;
  sourceActivityId?: string;
  startIndex?: number;
  endIndex?: number;
}

/**
 * Unified data point for performance charts.
 */
export interface PerformanceDataPoint {
  id: string;
  activityId: string;
  speed: number;
  date: Date;
  activityName: string;
  direction: 'same' | 'reverse';
  lapPoints?: RoutePoint[];
  matchPercentage?: number;
  lapNumber?: number;
  totalLaps?: number;
  sectionTime?: number;
  sectionDistance?: number;
  lapCount?: number;
  isExcluded?: boolean;
  bestTime?: number;
  bestSpeed?: number;
  isBest?: boolean;
}

/**
 * Per-direction summary statistics from Rust engine.
 * Used by both section and route performance hooks.
 */
export interface DirectionStats {
  avgTime: number | null;
  lastActivity: Date | null;
  count: number;
  /** Average speed across traversals (m/s). Populated for route stats; null for section. */
  avgSpeed: number | null;
}
