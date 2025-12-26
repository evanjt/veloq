import type { EventSubscription } from 'expo-modules-core';
import NativeModule from './RouteMatcherModule';

// Simple debug logging for native module - only in dev mode
const nativeLog = __DEV__ ? (...args: unknown[]) => console.log('[RouteMatcher]', ...args) : () => {};

/**
 * Progress event from Rust HTTP fetch operations.
 */
export interface FetchProgressEvent {
  completed: number;
  total: number;
}

// The native module is already an EventEmitter in SDK 52+
// We need to use type assertion to get the typed addListener method
interface NativeModuleWithEvents {
  addListener(eventName: 'onFetchProgress', listener: (event: FetchProgressEvent) => void): EventSubscription;
}

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

/**
 * Result from fetching activity map data via Rust HTTP client.
 * Returns bounds and GPS coordinates for an activity.
 */
export interface ActivityMapResult {
  activityId: string;
  /** Bounds as [ne_lat, ne_lng, sw_lat, sw_lng] or empty if unavailable */
  bounds: number[];
  /** GPS coordinates as flat array [lat1, lng1, lat2, lng2, ...] */
  latlngs: number[];
  success: boolean;
  error: string | null;
}

/**
 * Result from fetch_and_process_activities - includes both map data and signatures.
 */
export interface FetchAndProcessResult {
  mapResults: ActivityMapResult[];
  signatures: RouteSignature[];
}

// Verify native module is available on load
const config = NativeModule.getDefaultConfig();
if (config === null) {
  throw new Error('🦀 [RouteMatcher] Native Rust module failed to initialize!');
}
nativeLog('Native Rust module loaded successfully!');

/**
 * Result from verifyRustAvailable test.
 */
export interface RustVerificationResult {
  success: boolean;
  rustVersion?: string;
  error?: string;
  configValues?: {
    perfectThreshold: number;
    zeroThreshold: number;
    minMatchPercentage: number;
  };
  testSignature?: {
    pointCount: number;
    totalDistance: number;
  };
}

/**
 * Verify that the Rust library is properly linked and functional.
 * This runs a series of tests to ensure:
 * 1. FFI bridge is working (can call defaultConfig)
 * 2. Algorithm is working (can create a signature)
 * 3. Results are valid (signature has expected properties)
 *
 * Use this in CI/CD to verify the Rust build is working correctly.
 */
export function verifyRustAvailable(): RustVerificationResult {
  nativeLog('verifyRustAvailable: Running Rust verification tests');
  const result = NativeModule.verifyRustAvailable();
  if (result.success) {
    nativeLog('verifyRustAvailable: All tests passed!');
  } else {
    nativeLog(`verifyRustAvailable: FAILED - ${result.error}`);
  }
  return result;
}

/**
 * Create a route signature from GPS points.
 * Uses native Rust implementation.
 */
export function createSignature(
  activityId: string,
  points: GpsPoint[],
  config?: Partial<MatchConfig>
): RouteSignature | null {
  nativeLog(`createSignature called for ${activityId} with ${points.length} points`);
  const result = NativeModule.createSignature(activityId, points, config ?? null);
  if (result) {
    nativeLog(`createSignature returned ${result.points.length} simplified points`);
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
  nativeLog(`compareRoutes: ${sig1.activityId} vs ${sig2.activityId}`);
  const result = NativeModule.compareRoutes(sig1, sig2, config ?? null);
  if (result) {
    nativeLog(`compareRoutes: ${result.matchPercentage.toFixed(1)}% match (${result.direction})`);
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
  nativeLog(`RUST groupSignatures called with ${signatures.length} signatures`);
  const startTime = Date.now();
  const result = NativeModule.groupSignatures(signatures, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`RUST groupSignatures returned ${result?.length || 0} groups in ${elapsed}ms`);
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
  nativeLog(`BATCH createSignatures called with ${tracks.length} tracks`);
  const startTime = Date.now();
  const result = NativeModule.createSignaturesBatch(tracks, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`BATCH createSignatures returned ${result?.length || 0} signatures in ${elapsed}ms`);
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
  nativeLog(`FULL BATCH processRoutes called with ${tracks.length} tracks`);
  const startTime = Date.now();
  const result = NativeModule.processRoutesBatch(tracks, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`FULL BATCH processRoutes returned ${result?.length || 0} groups in ${elapsed}ms`);
  return result || [];
}

/**
 * OPTIMIZED: Process routes using flat coordinate arrays.
 * Avoids the overhead of serializing GpsPoint objects.
 *
 * @param activityIds - Array of activity IDs
 * @param coordArrays - Array of flat coordinate arrays [lat1, lng1, lat2, lng2, ...]
 * @param config - Optional match configuration
 */
export function processRoutesFlat(
  activityIds: string[],
  coordArrays: number[][],
  config?: Partial<MatchConfig>
): RouteGroup[] {
  nativeLog(`FLAT processRoutes called with ${activityIds.length} tracks`);
  const startTime = Date.now();
  const result = NativeModule.processRoutesFlat(activityIds, coordArrays, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`FLAT processRoutes returned ${result?.length || 0} groups in ${elapsed}ms`);
  return result || [];
}

/**
 * OPTIMIZED: Create signatures using a single flat buffer with offsets.
 * Returns signatures (not groups) for incremental caching.
 * All coordinates in one contiguous array, with offsets marking track boundaries.
 *
 * @param activityIds - Array of activity IDs
 * @param coords - Single flat array of ALL coordinates [lat1, lng1, lat2, lng2, ...]
 * @param offsets - Index offsets where each track starts in the coords array
 * @param config - Optional match configuration
 */
export function createSignaturesFlatBuffer(
  activityIds: string[],
  coords: number[],
  offsets: number[],
  config?: Partial<MatchConfig>
): RouteSignature[] {
  nativeLog(`FLAT BUFFER createSignatures: ${activityIds.length} tracks, ${coords.length} coords`);
  const startTime = Date.now();
  const result = NativeModule.createSignaturesFlatBuffer(activityIds, coords, offsets, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`FLAT BUFFER returned ${result?.length || 0} signatures in ${elapsed}ms`);
  return result || [];
}

/**
 * MOST OPTIMIZED: Process routes using a single flat buffer with offsets.
 * All coordinates in one contiguous array, with offsets marking track boundaries.
 * Minimizes memory allocations and serialization overhead.
 *
 * @param activityIds - Array of activity IDs
 * @param coords - Single flat array of ALL coordinates [lat1, lng1, lat2, lng2, ...]
 * @param offsets - Index offsets where each track starts in the coords array
 * @param config - Optional match configuration
 */
export function processRoutesFlatBuffer(
  activityIds: string[],
  coords: number[],
  offsets: number[],
  config?: Partial<MatchConfig>
): RouteGroup[] {
  nativeLog(`FLAT BUFFER processRoutes: ${activityIds.length} tracks, ${coords.length} coords`);
  const startTime = Date.now();
  const result = NativeModule.processRoutesFlatBuffer(activityIds, coords, offsets, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`FLAT BUFFER returned ${result?.length || 0} groups in ${elapsed}ms`);
  return result || [];
}

/**
 * Helper to convert GpsTrack[] to flat buffer format.
 * Use with processRoutesFlatBuffer for maximum performance.
 */
export function tracksToFlatBuffer(tracks: GpsTrack[]): {
  activityIds: string[];
  coords: number[];
  offsets: number[];
} {
  const activityIds: string[] = [];
  const coords: number[] = [];
  const offsets: number[] = [];

  for (const track of tracks) {
    activityIds.push(track.activityId);
    offsets.push(coords.length);
    for (const point of track.points) {
      coords.push(point.latitude, point.longitude);
    }
  }

  return { activityIds, coords, offsets };
}

/**
 * Always returns true - we only use native Rust implementation.
 */
export function isNative(): boolean {
  return true;
}

// =============================================================================
// Activity Fetching (Rust HTTP Client)
// =============================================================================

/**
 * Fetch activity map data for multiple activities using Rust HTTP client.
 * Uses connection pooling and parallel fetching for maximum performance.
 * Respects intervals.icu rate limits (30 req/s burst, 131 req/10s sustained).
 *
 * @param apiKey - intervals.icu API key
 * @param activityIds - Array of activity IDs to fetch
 * @returns Array of ActivityMapResult with bounds and GPS coordinates
 */
export function fetchActivityMaps(
  apiKey: string,
  activityIds: string[]
): ActivityMapResult[] {
  nativeLog(`RUST fetchActivityMaps [v6-sustained] called for ${activityIds.length} activities`);
  const startTime = Date.now();
  const result = NativeModule.fetchActivityMaps(apiKey, activityIds);
  const elapsed = Date.now() - startTime;
  const successCount = result?.filter((r: ActivityMapResult) => r.success).length || 0;
  const errorCount = result?.filter((r: ActivityMapResult) => !r.success).length || 0;
  const totalPoints = result?.reduce((sum: number, r: ActivityMapResult) => sum + (r.latlngs?.length || 0) / 2, 0) || 0;
  const rate = (activityIds.length / (elapsed / 1000)).toFixed(1);
  nativeLog(`RUST fetchActivityMaps [v6-sustained]: ${successCount}/${activityIds.length} (${errorCount} errors) in ${elapsed}ms (${rate} req/s, ${totalPoints} points)`);
  return result || [];
}

/**
 * Fetch activity map data with real-time progress updates.
 * Emits "onFetchProgress" events as each activity is fetched.
 *
 * Use addFetchProgressListener to receive progress updates.
 *
 * @param apiKey - intervals.icu API key
 * @param activityIds - Array of activity IDs to fetch
 * @returns Promise of ActivityMapResult array with bounds and GPS coordinates
 */
export async function fetchActivityMapsWithProgress(
  apiKey: string,
  activityIds: string[]
): Promise<ActivityMapResult[]> {
  nativeLog(`RUST fetchActivityMapsWithProgress called for ${activityIds.length} activities`);
  const startTime = Date.now();
  // AsyncFunction returns a Promise - await it so JS thread is free to process events
  const result = await NativeModule.fetchActivityMapsWithProgress(apiKey, activityIds);
  const elapsed = Date.now() - startTime;
  const successCount = result?.filter((r: ActivityMapResult) => r.success).length || 0;
  const errorCount = result?.filter((r: ActivityMapResult) => !r.success).length || 0;
  const rate = (activityIds.length / (elapsed / 1000)).toFixed(1);
  nativeLog(`RUST fetchActivityMapsWithProgress: ${successCount}/${activityIds.length} (${errorCount} errors) in ${elapsed}ms (${rate} req/s)`);
  return result || [];
}

/**
 * Subscribe to fetch progress events.
 * Returns a subscription that should be removed when no longer needed.
 *
 * @param listener - Callback function receiving progress events
 * @returns Subscription to remove when done
 *
 * @example
 * ```ts
 * const subscription = addFetchProgressListener(({ completed, total }) => {
 *   console.log(`Progress: ${completed}/${total}`);
 * });
 *
 * // When done:
 * subscription.remove();
 * ```
 */
export function addFetchProgressListener(
  listener: (event: FetchProgressEvent) => void
): EventSubscription {
  return (NativeModule as unknown as NativeModuleWithEvents).addListener('onFetchProgress', listener);
}

/**
 * Fetch activity map data AND create route signatures in one call.
 * Most efficient for initial sync - combines fetching and processing.
 *
 * @param apiKey - intervals.icu API key
 * @param activityIds - Array of activity IDs to fetch
 * @param config - Optional match configuration for signature creation
 * @returns FetchAndProcessResult with map results and signatures
 */
export function fetchAndProcessActivities(
  apiKey: string,
  activityIds: string[],
  config?: Partial<MatchConfig>
): FetchAndProcessResult {
  nativeLog(`RUST fetchAndProcessActivities called for ${activityIds.length} activities`);
  const startTime = Date.now();
  const result = NativeModule.fetchAndProcessActivities(apiKey, activityIds, config ?? null);
  const elapsed = Date.now() - startTime;
  nativeLog(`RUST fetchAndProcessActivities: ${result?.mapResults?.length || 0} maps, ${result?.signatures?.length || 0} signatures in ${elapsed}ms`);
  return result || { mapResults: [], signatures: [] };
}

/**
 * Convert flat coordinate array from fetchActivityMaps to GpsPoint array.
 * Use this to convert latlngs from ActivityMapResult.
 *
 * @param flatCoords - Flat array [lat1, lng1, lat2, lng2, ...]
 * @returns Array of GpsPoint objects
 */
export function flatCoordsToPoints(flatCoords: number[]): GpsPoint[] {
  const points: GpsPoint[] = [];
  for (let i = 0; i < flatCoords.length; i += 2) {
    points.push({ latitude: flatCoords[i], longitude: flatCoords[i + 1] });
  }
  return points;
}

/**
 * Convert ActivityMapResult bounds array to a structured bounds object.
 *
 * @param bounds - Array [ne_lat, ne_lng, sw_lat, sw_lng]
 * @returns Bounds object or null if empty
 */
export function parseBounds(bounds: number[]): { ne: [number, number]; sw: [number, number] } | null {
  if (bounds.length !== 4) return null;
  return {
    ne: [bounds[0], bounds[1]],
    sw: [bounds[2], bounds[3]],
  };
}

export default {
  createSignature,
  createSignaturesBatch,
  createSignaturesFlatBuffer,
  compareRoutes,
  groupSignatures,
  processRoutesBatch,
  processRoutesFlat,
  processRoutesFlatBuffer,
  tracksToFlatBuffer,
  getDefaultConfig,
  isNative,
  verifyRustAvailable,
  // Activity fetching (Rust HTTP client)
  fetchActivityMaps,
  fetchActivityMapsWithProgress,
  fetchAndProcessActivities,
  addFetchProgressListener,
  flatCoordsToPoints,
  parseBounds,
};
