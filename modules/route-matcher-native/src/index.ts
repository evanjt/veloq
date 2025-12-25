import NativeModule from './RouteMatcherModule';

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

export interface RouteSignature {
  activityId: string;
  points: GpsPoint[];
  totalDistance: number;
  startPoint: GpsPoint;
  endPoint: GpsPoint;
}

export interface MatchResult {
  activityId1: string;
  activityId2: string;
  matchPercentage: number;
  direction: 'same' | 'reverse' | 'partial';
  amd: number; // Average Minimum Distance in meters
}

export interface MatchConfig {
  /** AMD threshold for perfect match (100%). Default: 30m */
  perfectThreshold: number;
  /** AMD threshold for no match (0%). Default: 250m */
  zeroThreshold: number;
  /** Minimum match percentage to consider similar. Default: 65% */
  minMatchPercentage: number;
  /** Minimum route distance to be grouped. Default: 500m */
  minRouteDistance: number;
  /** Max distance difference ratio for grouping. Default: 0.20 */
  maxDistanceDiffRatio: number;
  /** Endpoint threshold for matching start/end. Default: 200m */
  endpointThreshold: number;
  /** Points to resample to for comparison. Default: 50 */
  resampleCount: number;
  /** Douglas-Peucker simplification tolerance in degrees */
  simplificationTolerance: number;
  /** Max points after simplification */
  maxSimplifiedPoints: number;
}

export interface RouteGroup {
  groupId: string;
  activityIds: string[];
}

/**
 * Input for batch signature creation.
 * More efficient than individual createSignature calls.
 */
export interface GpsTrack {
  activityId: string;
  points: GpsPoint[];
}

// Verify native module is available on load
const config = NativeModule.getDefaultConfig();
if (config === null) {
  throw new Error('🦀 [RouteMatcher] Native Rust module failed to initialize!');
}
console.log('🦀🦀🦀 [RouteMatcher] Native Rust module loaded successfully! 🦀🦀🦀');

/**
 * Create a route signature from GPS points.
 * Uses native Rust implementation.
 */
export function createSignature(
  activityId: string,
  points: GpsPoint[],
  config?: Partial<MatchConfig>
): RouteSignature | null {
  console.log(`🦀 [RouteMatcher] createSignature called for ${activityId} with ${points.length} points`);
  const result = NativeModule.createSignature(activityId, points, config ?? null);
  if (result) {
    console.log(`🦀 [RouteMatcher] createSignature returned ${result.points.length} simplified points`);
  }
  return result;
}

/**
 * Compare two route signatures and return match result.
 * Uses native Rust implementation.
 */
export function compareRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config?: Partial<MatchConfig>
): MatchResult | null {
  console.log(`🦀 [RouteMatcher] compareRoutes: ${sig1.activityId} vs ${sig2.activityId}`);
  const result = NativeModule.compareRoutes(sig1, sig2, config ?? null);
  if (result) {
    console.log(`🦀 [RouteMatcher] compareRoutes: ${result.matchPercentage.toFixed(1)}% match (${result.direction})`);
  }
  return result;
}

/**
 * Group similar routes together.
 * Uses native Rust implementation with parallel processing.
 */
export function groupSignatures(
  signatures: RouteSignature[],
  config?: Partial<MatchConfig>
): RouteGroup[] {
  console.log(`🦀🦀🦀 [RouteMatcher] RUST groupSignatures called with ${signatures.length} signatures 🦀🦀🦀`);
  const startTime = Date.now();
  const result = NativeModule.groupSignatures(signatures, config ?? null);
  const elapsed = Date.now() - startTime;
  console.log(`🦀 [RouteMatcher] RUST groupSignatures returned ${result?.length || 0} groups in ${elapsed}ms`);
  return result || [];
}

/**
 * Get default configuration values from Rust.
 */
export function getDefaultConfig(): MatchConfig {
  return NativeModule.getDefaultConfig();
}

/**
 * Create multiple route signatures in parallel (batch processing).
 * MUCH faster than calling createSignature repeatedly:
 * - Single FFI call instead of N calls
 * - Parallel processing with rayon in Rust
 */
export function createSignaturesBatch(
  tracks: GpsTrack[],
  config?: Partial<MatchConfig>
): RouteSignature[] {
  console.log(`🦀🦀🦀 [RouteMatcher] BATCH createSignatures called with ${tracks.length} tracks 🦀🦀🦀`);
  const startTime = Date.now();
  const result = NativeModule.createSignaturesBatch(tracks, config ?? null);
  const elapsed = Date.now() - startTime;
  console.log(`🦀 [RouteMatcher] BATCH createSignatures returned ${result?.length || 0} signatures in ${elapsed}ms`);
  return result || [];
}

/**
 * Process routes end-to-end: create signatures AND group them in one call.
 * This is the MOST efficient way to process many activities:
 * - Single FFI call for everything
 * - Parallel signature creation
 * - Parallel grouping with spatial indexing
 */
export function processRoutesBatch(
  tracks: GpsTrack[],
  config?: Partial<MatchConfig>
): RouteGroup[] {
  console.log(`🦀🦀🦀 [RouteMatcher] FULL BATCH processRoutes called with ${tracks.length} tracks 🦀🦀🦀`);
  const startTime = Date.now();
  const result = NativeModule.processRoutesBatch(tracks, config ?? null);
  const elapsed = Date.now() - startTime;
  console.log(`🦀 [RouteMatcher] FULL BATCH processRoutes returned ${result?.length || 0} groups in ${elapsed}ms`);
  return result || [];
}

/**
 * Always returns true - we only use native Rust implementation.
 */
export function isNative(): boolean {
  return true;
}

export default {
  createSignature,
  createSignaturesBatch,
  compareRoutes,
  groupSignatures,
  processRoutesBatch,
  getDefaultConfig,
  isNative,
};
