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
}

/** Progress state for route processing */
export interface RouteProcessingProgress {
  status: 'idle' | 'fetching' | 'processing' | 'matching' | 'complete' | 'error';
  current: number;
  total: number;
  message?: string;
}

/** Configuration for route matching algorithm */
export interface RouteMatchConfig {
  /** Tolerance for Douglas-Peucker simplification (meters) */
  simplificationTolerance: number;
  /** Target number of simplified points */
  targetPoints: number;
  /** Maximum distance between matched points (meters) */
  distanceThreshold: number;
  /** Minimum match percentage to consider a match */
  minMatchPercentage: number;
  /** Minimum bounds overlap required (0-1) */
  minBoundsOverlap: number;
  /** Maximum distance difference to consider (fraction, e.g., 0.2 = 20%) */
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
  minMatchPercentage: 60,
  minBoundsOverlap: 0.3,
  maxDistanceDifference: 0.2,
  loopThreshold: 100, // meters
  regionGridSize: 0.005, // ~500m
};
