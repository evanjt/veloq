/**
 * Route matching types for identifying activities on similar routes.
 */

import type { ActivityType } from './activity';

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

/** Match result when comparing two activities */
export interface RouteMatch {
  /** Activity ID being matched */
  activityId: string;
  /** Route group ID it matches */
  routeGroupId: string;
  /** Match percentage (0-100) */
  matchPercentage: number;
  /** Direction: 'same' | 'reverse' | 'partial' */
  direction: MatchDirection;
  /** For partial matches: overlap start (% along route) */
  overlapStart?: number;
  /** For partial matches: overlap end (% along route) */
  overlapEnd?: number;
  /** For partial matches: overlapping distance in meters */
  overlapDistance?: number;
  /** Confidence score (0-1) based on GPS quality and point density */
  confidence: number;
}

/** Performance data for a route completion */
export interface RoutePerformance {
  activityId: string;
  date: string;
  duration: number;
  movingTime: number;
  averageSpeed: number;
  averagePower?: number;
  averageHr?: number;
  elevationGain: number;
  matchQuality: number;
  direction: MatchDirection;
}

/** Cached route matching data */
export interface RouteMatchCache {
  /** Cache version for invalidation */
  version: number;
  /** Last update timestamp */
  lastUpdated: string;
  /** Route signatures by activity ID */
  signatures: Record<string, RouteSignature>;
  /** Route groups */
  groups: RouteGroup[];
  /** Matches mapping activity ID to match info */
  matches: Record<string, RouteMatch>;
  /** Activity IDs that have been processed */
  processedActivityIds: string[];
  /** Reverse index: activity ID → route group ID (for O(1) lookup) */
  activityToRouteId: Record<string, string>;
  /** Frequently traveled sections (auto-detected) */
  frequentSections?: FrequentSection[];
}

/** Status of an individual activity being processed */
export interface ProcessedActivityStatus {
  id: string;
  name: string;
  type: string;
  status: 'pending' | 'checking' | 'matched' | 'no-match' | 'error';
  matchedWith?: string; // Name of activity it matched with
}

/** A match discovered during processing (pair of activities) */
export interface DiscoveredMatchInfo {
  id: string;
  activity1: { id: string; name: string };
  activity2: { id: string; name: string };
  type: string;
  matchPercentage: number;
  /** Simplified preview points (normalized 0-1) */
  previewPoints?: { x: number; y: number }[];
  distance?: number;
  /** Whether this is the most recent match */
  isNew?: boolean;
}

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

/** Progress state for route processing */
export interface RouteProcessingProgress {
  status:
    | 'idle'
    | 'filtering'
    | 'fetching'
    | 'processing'
    | 'matching'
    | 'detecting-sections'
    | 'complete'
    | 'error';
  current: number;
  total: number;
  message?: string;
  /** For filtering phase: total activities being considered */
  totalActivities?: number;
  /** For filtering phase: number of candidates found */
  candidatesFound?: number;
  /** Individual activity statuses for live UI */
  processedActivities?: ProcessedActivityStatus[];
  /** Running count of matches found */
  matchesFound?: number;
  /** Routes discovered so far (grouped activities) */
  discoveredRoutes?: DiscoveredRouteInfo[];
  /** Currently processing activity name */
  currentActivity?: string;
  /** Number of cached signatures we're matching against */
  cachedSignatureCount?: number;
}

/** Configuration for route matching algorithm */
export interface RouteMatchConfig {
  /** Tolerance for Douglas-Peucker simplification (meters) */
  simplificationTolerance: number;
  /** Target number of simplified points */
  targetPoints: number;
  /** Maximum distance between matched points (meters) */
  distanceThreshold: number;
  /** Minimum match percentage to consider a match (for showing in activity view) */
  minMatchPercentage: number;
  /**
   * Minimum match percentage to GROUP activities into the same route.
   * This is intentionally much higher than minMatchPercentage because grouping
   * should only happen for truly identical journeys, not shared sections.
   */
  minGroupingPercentage: number;
  /** Minimum bounds overlap required (0-1) */
  minBoundsOverlap: number;
  /** Maximum distance difference to consider (fraction, e.g., 0.5 = 50%) for MATCHING */
  maxDistanceDifference: number;
  /** Distance threshold for loop detection (meters) */
  loopThreshold: number;
  /** Grid size for region hashing (degrees, ~500m at equator) */
  regionGridSize: number;
}

/** Default configuration values */
export const DEFAULT_ROUTE_MATCH_CONFIG: RouteMatchConfig = {
  simplificationTolerance: 15, // meters
  targetPoints: 100,
  distanceThreshold: 50, // meters
  minMatchPercentage: 20, // Lower threshold to discover partial matches (for display)
  minGroupingPercentage: 70, // High threshold - activities must share most of the route to group
  minBoundsOverlap: 0.2, // Lower overlap requirement
  maxDistanceDifference: 0.5, // Allow 50% distance difference for partial matches
  loopThreshold: 100, // meters
  regionGridSize: 0.005, // ~500m
};

// =============================================================================
// Frequent Sections
// =============================================================================

/**
 * Each activity's portion of a section (for pace comparison).
 */
export interface SectionPortion {
  /** Activity ID */
  activityId: string;
  /** Start index into the activity's FULL GPS track */
  startIndex: number;
  /** End index into the activity's FULL GPS track */
  endIndex: number;
  /** Distance of this portion in meters */
  distanceMeters: number;
  /** Direction relative to representative: "same" or "reverse" */
  direction: string;
}

/**
 * A frequently-traveled road section with adaptive consensus representation.
 * The polyline is refined from all overlapping GPS tracks using weighted averaging.
 * As more tracks are observed, the consensus polyline converges to the true path.
 */
export interface FrequentSection {
  /** Unique section ID */
  id: string;
  /** Sport type this section is for ("Run", "Ride", etc.) */
  sportType: string;
  /** The consensus polyline - refined from all overlapping tracks */
  polyline: RoutePoint[];
  /** Which activity provided the initial representative polyline (medoid) */
  representativeActivityId?: string;
  /** Activity IDs that traverse this section */
  activityIds: string[];
  /** Each activity's portion (start/end indices, distance, direction) for pace comparison */
  activityPortions?: SectionPortion[];
  /** Route group IDs that include this section */
  routeIds: string[];
  /** Total number of traversals */
  visitCount: number;
  /** Section length in meters */
  distanceMeters: number;
  /** Display name (auto-generated or user-set) */
  name?: string;
  /** Pre-computed GPS traces for each activity's overlapping portion
   * Key is activity ID, value is the GPS points within proximity of section */
  activityTraces?: Record<string, RoutePoint[]>;
  /** Confidence score (0.0-1.0) based on observation density and track alignment.
   * Higher confidence = more tracks observed with tighter consensus. */
  confidence?: number;
  /** Number of tracks used to compute the consensus polyline */
  observationCount?: number;
  /** Average spread (meters) of track observations from the consensus line.
   * Lower spread = more consistent track alignment. */
  averageSpread?: number;
  /** Per-point observation density (how many activities pass through each point).
   * Used for detecting high-traffic portions that may be split into separate sections. */
  pointDensity?: number[];
}

/** Configuration for section detection */
export interface SectionConfig {
  /** Maximum distance between tracks to consider overlapping (meters). Default: 30m */
  proximityThreshold: number;
  /** Minimum overlap length to consider a section (meters). Default: 200m */
  minSectionLength: number;
  /** Maximum section length (meters) - prevents sections from becoming full routes. Default: 5000m */
  maxSectionLength: number;
  /** Minimum number of activities that must share an overlap. Default: 3 */
  minActivities: number;
  /** Tolerance for clustering similar overlaps (meters). Default: 50m */
  clusterTolerance: number;
  /** Number of sample points for polyline normalization. Default: 50 */
  samplePoints: number;
}

/** Default section detection configuration */
export const DEFAULT_SECTION_CONFIG: SectionConfig = {
  proximityThreshold: 50, // 50m - handles GPS error + wide roads + opposite sides
  minSectionLength: 200,
  maxSectionLength: 5000,
  minActivities: 3,
  clusterTolerance: 80, // 80m for clustering similar overlaps
  samplePoints: 50,
};

// =============================================================================
// Custom Sections (User-Created)
// =============================================================================

/**
 * A user-created custom section.
 * Created by selecting a portion of an activity's GPS track.
 */
export interface CustomSection {
  /** Unique section ID */
  id: string;
  /** User-defined or auto-generated name */
  name: string;
  /** GPS points defining the section */
  polyline: RoutePoint[];
  /** Start index in the source activity's GPS track */
  startIndex: number;
  /** End index in the source activity's GPS track */
  endIndex: number;
  /** Activity ID this section was created from */
  sourceActivityId: string;
  /** Sport type (e.g., "Ride", "Run") */
  sportType: string;
  /** Section length in meters */
  distanceMeters: number;
  /** ISO timestamp when the section was created */
  createdAt: string;
}

/**
 * Match result for a custom section against an activity.
 */
export interface CustomSectionMatch {
  /** Activity ID that matches this section */
  activityId: string;
  /** Start index in the activity's GPS track where section starts */
  startIndex: number;
  /** End index in the activity's GPS track where section ends */
  endIndex: number;
  /** Direction: 'same' or 'reverse' relative to section definition */
  direction: 'same' | 'reverse';
  /** Distance of the matched portion in meters */
  distanceMeters: number;
  /**
   * Extracted GPS points that are actually near the section polyline.
   * Use this for visualization instead of slicing by indices to avoid
   * "straight line" artifacts from points that deviate from the section.
   * Optional for backward compatibility - will be populated when available.
   */
  trace?: RoutePoint[];
}

/**
 * Custom section with its activity matches pre-loaded.
 */
export interface CustomSectionWithMatches extends CustomSection {
  /** Activity matches for this section */
  matches: CustomSectionMatch[];
}

// =============================================================================
// Potential Sections (Auto-detected suggestions)
// =============================================================================

/**
 * A potential section detected from 1-2 activity overlaps.
 * These are suggestions that users can promote to full sections.
 */
export interface PotentialSection {
  /** Unique section ID */
  id: string;
  /** Sport type ("Run", "Ride", etc.) */
  sportType: string;
  /** GPS points defining the section */
  polyline: RoutePoint[];
  /** Activity IDs that traverse this potential section (1-2) */
  activityIds: string[];
  /** Number of times traversed (1-2) */
  visitCount: number;
  /** Section length in meters */
  distanceMeters: number;
  /** Confidence score (0.0-1.0), lower than FrequentSection */
  confidence: number;
  /** Scale at which this was detected: "short", "medium", "long" */
  scale: string;
}

// =============================================================================
// Unified Section (combines auto + custom + potential)
// =============================================================================

/**
 * A unified section combining auto-detected, custom, and potential sections.
 * Used by the UI to display all section types in one list.
 */
export interface UnifiedSection {
  /** Unique section ID */
  id: string;
  /** Section name */
  name: string;
  /** GPS points defining the section */
  polyline: RoutePoint[];
  /** Sport type */
  sportType: string;
  /** Section length in meters */
  distanceMeters: number;
  /** Number of times traversed */
  visitCount: number;
  /** Source type: where this section came from */
  source: 'auto' | 'custom' | 'potential';
  /** Whether this section is disabled (hidden from activity details) */
  isDisabled?: boolean;
  /** For custom sections: the full custom section data */
  customData?: CustomSectionWithMatches;
  /** For auto sections: the full engine section data */
  engineData?: FrequentSection;
  /** For potential sections: the potential section data */
  potentialData?: PotentialSection;
}

/**
 * Unified data point for performance charts.
 * Used by both route and section detail pages for consistent chart rendering.
 */
export interface PerformanceDataPoint {
  /** Unique ID for this data point */
  id: string;
  /** Activity ID this point belongs to */
  activityId: string;
  /** Speed in m/s */
  speed: number;
  /** Date of the activity */
  date: Date;
  /** Activity name */
  activityName: string;
  /** Direction (same/reverse) */
  direction: 'same' | 'reverse';
  /** Points for this lap/traversal (for map highlighting) */
  lapPoints?: RoutePoint[];

  // Route-specific fields
  /** Match percentage (0-100) - routes only */
  matchPercentage?: number;
  /** Lap number (1 if single lap per activity) - routes only */
  lapNumber?: number;
  /** Total laps in this activity - routes only */
  totalLaps?: number;

  // Section-specific fields
  /** Section time in seconds - sections only */
  sectionTime?: number;
  /** Section distance in meters - sections only */
  sectionDistance?: number;
  /** Number of laps/traversals - sections only */
  lapCount?: number;
}
