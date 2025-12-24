/**
 * Route matching types for identifying activities on similar routes.
 */

import type { ActivityType } from './activity';

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
  /** Representative route signature (from the first/best activity) */
  signature: RouteSignature;
  /** Consensus route - the common core that 80%+ of activities share */
  consensusPoints?: RoutePoint[];
  /** Activity IDs in this group */
  activityIds: string[];
  /** Total count of activities */
  activityCount: number;
  /** Date of first activity on this route */
  firstDate: string;
  /** Date of most recent activity */
  lastDate: string;
  /** Activity type (Ride, Run, etc.) */
  type: ActivityType;
  /** Average match quality for grouped activities (0-100) */
  averageMatchQuality: number;
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
  status: 'idle' | 'filtering' | 'fetching' | 'processing' | 'matching' | 'complete' | 'error';
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
