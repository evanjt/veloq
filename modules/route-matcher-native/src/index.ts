import type { EventSubscription } from 'expo-modules-core';
import NativeModule from './RouteMatcherModule';

// Debug logging disabled - uncomment for development debugging
// const nativeLog = __DEV__ ? (...args: unknown[]) => console.log('[RouteMatcher]', ...args) : () => {};
const nativeLog = (..._args: unknown[]) => {};

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

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface RouteSignature {
  activityId: string;
  points: GpsPoint[];
  totalDistance: number;
  startPoint: GpsPoint;
  endPoint: GpsPoint;
  /** Pre-computed bounding box (normalized, ready for use) */
  bounds: Bounds;
  /** Pre-computed center point (for map rendering without JS calculation) */
  center: GpsPoint;
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
  representativeId: string;
  activityIds: string[];
  sportType: string;
  bounds: Bounds | null;
  /** User-defined custom name (empty string if not set) */
  customName: string;
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

// ============================================================================
// Performance Types
// ============================================================================

/**
 * Activity metadata for performance calculations.
 * Stores non-GPS data needed for performance comparison.
 */
export interface ActivityMetrics {
  activityId: string;
  name: string;
  /** Unix timestamp (seconds since epoch) */
  date: number;
  /** Distance in meters */
  distance: number;
  /** Moving time in seconds */
  movingTime: number;
  /** Elapsed time in seconds */
  elapsedTime: number;
  /** Total elevation gain in meters */
  elevationGain: number;
  /** Average heart rate (optional) */
  avgHr?: number;
  /** Average power in watts (optional) */
  avgPower?: number;
  /** Sport type (e.g., "Ride", "Run") */
  sportType: string;
}

/**
 * A single performance point for route comparison.
 */
export interface RoutePerformance {
  activityId: string;
  name: string;
  /** Unix timestamp */
  date: number;
  /** Speed in m/s (distance / movingTime) */
  speed: number;
  /** Elapsed time in seconds */
  duration: number;
  /** Moving time in seconds */
  movingTime: number;
  /** Distance in meters */
  distance: number;
  /** Elevation gain in meters */
  elevationGain: number;
  /** Average heart rate (optional) */
  avgHr?: number;
  /** Average power in watts (optional) */
  avgPower?: number;
  /** Is this the current activity being viewed */
  isCurrent: boolean;
  /** Match direction: "same", "reverse", or "partial" */
  direction: string;
  /** Match percentage (0-100) */
  matchPercentage: number;
}

/**
 * Complete route performance result.
 */
export interface RoutePerformanceResult {
  /** Performances sorted by date (oldest first) */
  performances: RoutePerformance[];
  /** Best performance (fastest speed), null if none */
  best: RoutePerformance | null;
  /** Current activity's rank (1 = fastest), null if not provided */
  currentRank: number | null;
}

/**
 * A single lap of a section.
 */
export interface SectionLap {
  id: string;
  activityId: string;
  /** Lap time in seconds */
  time: number;
  /** Pace in m/s */
  pace: number;
  /** Distance in meters */
  distance: number;
  /** Direction: "forward" or "backward" */
  direction: string;
  /** Start index in the activity's GPS track */
  startIndex: number;
  /** End index in the activity's GPS track */
  endIndex: number;
}

/**
 * Section performance record for an activity.
 */
export interface SectionPerformanceRecord {
  activityId: string;
  activityName: string;
  /** Unix timestamp */
  activityDate: number;
  /** All laps for this activity on this section */
  laps: SectionLap[];
  /** Number of times this section was traversed */
  lapCount: number;
  /** Best (fastest) lap time in seconds */
  bestTime: number;
  /** Best pace in m/s */
  bestPace: number;
  /** Average lap time in seconds */
  avgTime: number;
  /** Average pace in m/s */
  avgPace: number;
  /** Primary direction: "forward" or "backward" */
  direction: string;
  /** Section distance in meters */
  sectionDistance: number;
}

/**
 * Complete section performance result.
 */
export interface SectionPerformanceResult {
  /** Performance records sorted by date (oldest first) */
  records: SectionPerformanceRecord[];
  /** Best record (fastest time), null if none */
  bestRecord: SectionPerformanceRecord | null;
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
 * Incremental grouping: efficiently add new signatures to existing groups.
 * Only compares new vs existing and new vs new - O(n×m) instead of O(n²).
 *
 * Use this when adding new activities to avoid re-comparing all existing signatures.
 */
export function groupIncremental(
  newSignatures: RouteSignature[],
  existingGroups: RouteGroup[],
  existingSignatures: RouteSignature[],
  config?: Partial<MatchConfig>
): RouteGroup[] {
  nativeLog(`INCREMENTAL grouping: ${newSignatures.length} new + ${existingSignatures.length} existing`);
  const startTime = Date.now();
  const result = NativeModule.groupIncremental(
    newSignatures,
    existingGroups,
    existingSignatures,
    config ?? null
  );
  const elapsed = Date.now() - startTime;
  nativeLog(`INCREMENTAL returned ${result?.length || 0} groups in ${elapsed}ms`);
  return result || [];
}

/**
 * Get default configuration values from Rust.
 */
export function getDefaultConfig(): MatchConfig {
  return NativeModule.getDefaultConfig();
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

// =============================================================================
// Frequent Sections Detection
// =============================================================================

/**
 * Configuration for section detection.
 * Uses vector-first approach for smooth, natural section polylines.
 */
export interface ScalePreset {
  /** Scale name: "short", "medium", "long" */
  name: string;
  /** Minimum section length for this scale (meters) */
  minLength: number;
  /** Maximum section length for this scale (meters) */
  maxLength: number;
  /** Minimum activities required at this scale */
  minActivities: number;
}

export interface SectionConfig {
  /** Maximum distance between tracks to consider overlapping (meters). Default: 30m */
  proximityThreshold: number;
  /** Minimum overlap length to consider a section (meters). Default: 200m */
  minSectionLength: number;
  /** Minimum number of activities that must share an overlap. Default: 3 */
  minActivities: number;
  /** Tolerance for clustering similar overlaps (meters). Default: 50m */
  clusterTolerance: number;
  /** Number of sample points for polyline normalization. Default: 50 */
  samplePoints: number;
  /** Maximum section length (meters). Default: 5000m */
  maxSectionLength?: number;
  /** Detection mode: "discovery" (lower thresholds) or "conservative" */
  detectionMode?: string;
  /** Include potential sections with only 1-2 activities as suggestions */
  includePotentials?: boolean;
  /** Scale presets for multi-scale detection */
  scalePresets?: ScalePreset[];
  /** Preserve hierarchical sections (don't deduplicate short sections inside longer ones) */
  preserveHierarchy?: boolean;
}

/**
 * Statistics from multi-scale section detection.
 */
export interface DetectionStats {
  /** Total activities processed */
  activitiesProcessed: number;
  /** Total overlaps found across all scales */
  overlapsFound: number;
  /** Sections detected per scale */
  sectionsByScale: Record<string, number>;
  /** Potential sections per scale */
  potentialsByScale: Record<string, number>;
}

/**
 * A potential section detected from 1-2 activities.
 * These are suggestions that users can promote to full sections.
 */
export interface PotentialSection {
  /** Unique section ID */
  id: string;
  /** Sport type ("Run", "Ride", etc.) */
  sportType: string;
  /** The polyline from the representative activity */
  polyline: RoutePoint[];
  /** Activity IDs that traverse this potential section (1-2) */
  activityIds: string[];
  /** Number of times traversed (1-2) */
  visitCount: number;
  /** Section length in meters */
  distanceMeters: number;
  /** Confidence score (0.0-1.0), lower than FrequentSection */
  confidence: number;
  /** Scale at which this was detected ("short", "medium", "long") */
  scale: string;
}

/**
 * Result of multi-scale section detection.
 */
export interface MultiScaleSectionResult {
  /** Confirmed sections (min_activities met) */
  sections: FrequentSection[];
  /** Potential sections (1-2 activities, suggestions for user) */
  potentials: PotentialSection[];
  /** Statistics about detection */
  stats: DetectionStats;
}

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
 * A frequently-traveled section with medoid representation.
 * The polyline is an ACTUAL GPS trace (medoid), not artificial interpolation.
 */
/** Point with lat/lng format (matches app's RoutePoint type) */
export interface RoutePoint {
  lat: number;
  lng: number;
}

export interface FrequentSection {
  /** Unique section ID */
  id: string;
  /** Sport type this section is for ("Run", "Ride", etc.) */
  sportType: string;
  /** The consensus polyline - refined from all overlapping GPS tracks */
  polyline: RoutePoint[];
  /** Which activity provided the initial representative polyline (medoid) */
  representativeActivityId: string;
  /** Activity IDs that traverse this section */
  activityIds: string[];
  /** Each activity's portion (start/end indices, distance, direction) */
  activityPortions: SectionPortion[];
  /** Route group IDs that include this section */
  routeIds: string[];
  /** Total number of traversals */
  visitCount: number;
  /** Section length in meters */
  distanceMeters: number;
  /** Pre-computed GPS traces for each activity's overlapping portion
   * Key is activity ID, value is the GPS points within proximity of section */
  activityTraces: Record<string, RoutePoint[]>;
  /** Confidence score (0.0-1.0) based on observation density and track alignment */
  confidence: number;
  /** Number of tracks used to compute the consensus polyline */
  observationCount: number;
  /** Average spread (meters) of track observations from the consensus line */
  averageSpread: number;
  /** Per-point observation density (how many activities pass through each point) */
  pointDensity?: number[];
}

/**
 * Input mapping activity IDs to sport types.
 */
export interface ActivitySportType {
  activityId: string;
  sportType: string;
}

/**
 * Helper to convert activity traces from native format
 */
function convertActivityTraces(traces: Record<string, GpsPoint[]> | undefined): Record<string, RoutePoint[]> {
  if (!traces) return {};
  const result: Record<string, RoutePoint[]> = {};
  for (const [activityId, points] of Object.entries(traces)) {
    result[activityId] = (points || []).map(p => ({ lat: p.latitude, lng: p.longitude }));
  }
  return result;
}

/**
 * Get default section detection configuration from Rust.
 */
export function getDefaultSectionConfig(): SectionConfig {
  const config = NativeModule.defaultSectionConfig();
  return {
    proximityThreshold: config.proximity_threshold,
    minSectionLength: config.min_section_length,
    minActivities: config.min_activities,
    clusterTolerance: config.cluster_tolerance,
    samplePoints: config.sample_points,
    maxSectionLength: config.max_section_length,
    detectionMode: config.detection_mode,
    includePotentials: config.include_potentials,
    scalePresets: config.scale_presets,
    preserveHierarchy: config.preserve_hierarchy,
  };
}

/**
 * Get default scale presets for multi-scale detection.
 */
export function getDefaultScalePresets(): ScalePreset[] {
  return NativeModule.defaultScalePresets();
}

/**
 * Detect frequent sections from FULL GPS tracks.
 * Uses medoid-based algorithm to select actual GPS traces as representative polylines.
 * This produces smooth, natural section shapes that follow real roads.
 *
 * @param tracks - Array of { activityId, points } with FULL GPS tracks
 * @param sportTypes - Map of activity_id -> sport_type
 * @param groups - Route groups (for linking sections to routes)
 * @param config - Optional section detection configuration
 * @returns Array of detected frequent sections with medoid polylines
 */
export function detectSectionsFromTracks(
  tracks: Array<{ activityId: string; points: GpsPoint[] }>,
  sportTypes: ActivitySportType[],
  groups: RouteGroup[],
  config?: Partial<SectionConfig>
): FrequentSection[] {
  const totalPoints = tracks.reduce((sum, t) => sum + t.points.length, 0);
  nativeLog(`detectSectionsFromTracks: ${tracks.length} tracks, ${totalPoints} total points`);
  const startTime = Date.now();

  // Convert to native format (flat arrays for efficiency)
  const activityIds: string[] = [];
  const allCoords: number[] = [];
  const offsets: number[] = [0];

  for (const track of tracks) {
    activityIds.push(track.activityId);
    for (const point of track.points) {
      allCoords.push(point.latitude, point.longitude);
    }
    offsets.push(allCoords.length / 2);
  }

  // Convert to native format
  const nativeConfig = config ? {
    proximity_threshold: config.proximityThreshold ?? 30.0,
    min_section_length: config.minSectionLength ?? 200.0,
    min_activities: config.minActivities ?? 3,
    cluster_tolerance: config.clusterTolerance ?? 50.0,
    sample_points: config.samplePoints ?? 50,
  } : NativeModule.defaultSectionConfig();

  // Native returns JSON string for efficient bridge transfer
  const jsonResult = NativeModule.detectSectionsFromTracks(
    activityIds,
    allCoords,
    offsets,
    sportTypes.map(st => ({
      activity_id: st.activityId,
      sport_type: st.sportType,
    })),
    groups,
    nativeConfig
  ) as string;

  // Parse JSON in TypeScript (fast)
  const parseStart = Date.now();
  const result = JSON.parse(jsonResult || '[]') as Array<Record<string, unknown>>;
  const parseElapsed = Date.now() - parseStart;

  const elapsed = Date.now() - startTime;
  nativeLog(`detectSectionsFromTracks: ${result.length} sections in ${elapsed}ms (JSON parse: ${parseElapsed}ms)`);

  // Convert from snake_case to camelCase
  return result.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    sportType: s.sport_type as string,
    polyline: ((s.polyline as GpsPoint[]) || []).map(p => ({ lat: p.latitude, lng: p.longitude })),
    representativeActivityId: (s.representative_activity_id as string) || '',
    activityIds: s.activity_ids as string[],
    activityPortions: ((s.activity_portions as Array<Record<string, unknown>>) || []).map(p => ({
      activityId: p.activity_id as string,
      startIndex: p.start_index as number,
      endIndex: p.end_index as number,
      distanceMeters: p.distance_meters as number,
      direction: p.direction as string,
    })),
    routeIds: s.route_ids as string[],
    visitCount: s.visit_count as number,
    distanceMeters: s.distance_meters as number,
    // Pre-computed activity traces (converted from native format)
    activityTraces: convertActivityTraces(s.activity_traces as Record<string, GpsPoint[]>),
    // Consensus polyline metrics
    confidence: (s.confidence as number) ?? 0.0,
    observationCount: (s.observation_count as number) ?? 0,
    averageSpread: (s.average_spread as number) ?? 0.0,
    // Per-point density for section splitting
    pointDensity: s.point_density as number[] | undefined,
  }));
}

/**
 * Detect sections at multiple scales with potential section suggestions.
 * This is the flagship entry point for section detection.
 *
 * Uses multi-scale detection to find sections at different lengths (short/medium/long).
 * Returns both confirmed sections (meeting min_activities threshold) and
 * potential sections (1-2 activities, suggestions for user to promote).
 *
 * @param tracks - Array of { activityId, points } with FULL GPS tracks
 * @param sportTypes - Map of activity_id -> sport_type
 * @param groups - Route groups (for linking sections to routes)
 * @param config - Optional section detection configuration (uses multi-scale defaults if not provided)
 * @returns MultiScaleSectionResult with confirmed sections, potential sections, and statistics
 */
export function detectSectionsMultiscale(
  tracks: Array<{ activityId: string; points: GpsPoint[] }>,
  sportTypes: ActivitySportType[],
  groups: RouteGroup[],
  config?: Partial<SectionConfig>
): MultiScaleSectionResult {
  const totalPoints = tracks.reduce((sum, t) => sum + t.points.length, 0);
  nativeLog(`detectSectionsMultiscale: ${tracks.length} tracks, ${totalPoints} total points`);
  const startTime = Date.now();

  // Convert to native format (flat arrays for efficiency)
  const activityIds: string[] = [];
  const allCoords: number[] = [];
  const offsets: number[] = [0];

  for (const track of tracks) {
    activityIds.push(track.activityId);
    for (const point of track.points) {
      allCoords.push(point.latitude, point.longitude);
    }
    offsets.push(allCoords.length / 2);
  }

  // Get default config and merge with overrides
  const defaultConfig = getDefaultSectionConfig();
  const fullConfig = { ...defaultConfig, ...config };

  // Convert to native format
  const nativeConfig = {
    proximity_threshold: fullConfig.proximityThreshold,
    min_section_length: fullConfig.minSectionLength,
    min_activities: fullConfig.minActivities,
    cluster_tolerance: fullConfig.clusterTolerance,
    sample_points: fullConfig.samplePoints,
    max_section_length: fullConfig.maxSectionLength ?? 5000.0,
    detection_mode: fullConfig.detectionMode ?? 'discovery',
    include_potentials: fullConfig.includePotentials ?? true,
    scale_presets: fullConfig.scalePresets ?? getDefaultScalePresets(),
    preserve_hierarchy: fullConfig.preserveHierarchy ?? true,
  };

  // Native returns MultiScaleSectionResult
  const result = NativeModule.detectSectionsMultiscale(
    activityIds,
    allCoords,
    offsets,
    sportTypes.map(st => ({
      activity_id: st.activityId,
      sport_type: st.sportType,
    })),
    groups,
    nativeConfig
  ) as MultiScaleSectionResult;

  const elapsed = Date.now() - startTime;
  nativeLog(`detectSectionsMultiscale: ${result.sections.length} sections, ${result.potentials.length} potentials in ${elapsed}ms`);

  // Convert sections from snake_case to camelCase
  result.sections = result.sections.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    sportType: s.sport_type as string,
    polyline: ((s.polyline as GpsPoint[]) || []).map(p => ({ lat: p.latitude, lng: p.longitude })),
    representativeActivityId: (s.representative_activity_id as string) || '',
    activityIds: s.activity_ids as string[],
    activityPortions: ((s.activity_portions as Array<Record<string, unknown>>) || []).map(p => ({
      activityId: p.activity_id as string,
      startIndex: p.start_index as number,
      endIndex: p.end_index as number,
      distanceMeters: p.distance_meters as number,
      direction: p.direction as string,
    })),
    routeIds: s.route_ids as string[],
    visitCount: s.visit_count as number,
    distanceMeters: s.distance_meters as number,
    activityTraces: convertActivityTraces(s.activity_traces as Record<string, GpsPoint[]>),
    confidence: (s.confidence as number) ?? 0.0,
    observationCount: (s.observation_count as number) ?? 0,
    averageSpread: (s.average_spread as number) ?? 0.0,
    pointDensity: s.point_density as number[] | undefined,
  }));

  // Convert potentials from snake_case to camelCase
  result.potentials = result.potentials.map((p: Record<string, unknown>) => ({
    id: p.id as string,
    sportType: p.sport_type as string,
    polyline: ((p.polyline as GpsPoint[]) || []).map(pt => ({ lat: pt.latitude, lng: pt.longitude })),
    activityIds: p.activity_ids as string[],
    visitCount: p.visit_count as number,
    distanceMeters: p.distance_meters as number,
    confidence: (p.confidence as number) ?? 0.0,
    scale: p.scale as string,
  }));

  // Convert stats from snake_case to camelCase
  const stats = result.stats as Record<string, unknown>;
  result.stats = {
    activitiesProcessed: stats.activities_processed as number,
    overlapsFound: stats.overlaps_found as number,
    sectionsByScale: stats.sections_by_scale as Record<string, number>,
    potentialsByScale: stats.potentials_by_scale as Record<string, number>,
  };

  return result;
}


// =============================================================================
// Heatmap Generation
// =============================================================================

/**
 * Configuration for heatmap generation.
 */
export interface HeatmapConfig {
  /** Grid cell size in meters (default: 100m) */
  cellSizeMeters: number;
  /** Optional bounds to limit computation */
  bounds?: HeatmapBounds;
}

/**
 * Bounding box for heatmap computation.
 */
export interface HeatmapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/**
 * Reference to a route group passing through a cell.
 */
export interface RouteRef {
  /** Route group ID */
  routeId: string;
  /** How many activities from this route pass through this cell */
  activityCount: number;
  /** User-defined or auto-generated route name */
  name: string | null;
}

/**
 * A single cell in the heatmap grid.
 */
export interface HeatmapCell {
  /** Grid row index */
  row: number;
  /** Grid column index */
  col: number;
  /** Cell center latitude */
  centerLat: number;
  /** Cell center longitude */
  centerLng: number;
  /** Normalized density (0.0-1.0) for color mapping */
  density: number;
  /** Total visit count (sum of all point traversals) */
  visitCount: number;
  /** Routes passing through this cell */
  routeRefs: RouteRef[];
  /** Number of unique routes */
  uniqueRouteCount: number;
  /** All activity IDs that pass through */
  activityIds: string[];
  /** Earliest visit (Unix timestamp, null if unknown) */
  firstVisit: number | null;
  /** Most recent visit (Unix timestamp, null if unknown) */
  lastVisit: number | null;
  /** True if 2+ routes share this cell (intersection/common path) */
  isCommonPath: boolean;
}

/**
 * Complete heatmap result.
 */
export interface HeatmapResult {
  /** Non-empty cells only (sparse representation) */
  cells: HeatmapCell[];
  /** Computed bounds */
  bounds: HeatmapBounds;
  /** Cell size used */
  cellSizeMeters: number;
  /** Grid dimensions */
  gridRows: number;
  gridCols: number;
  /** Maximum density for normalization */
  maxDensity: number;
  /** Summary stats */
  totalRoutes: number;
  totalActivities: number;
}

/**
 * Query result when user taps a location.
 */
export interface CellQueryResult {
  /** The cell at the queried location */
  cell: HeatmapCell;
  /** Suggested label based on patterns */
  suggestedLabel: string;
}

/**
 * Activity metadata for heatmap generation.
 */
export interface ActivityHeatmapData {
  activityId: string;
  routeId: string | null;
  routeName: string | null;
  timestamp: number | null;
}

/**
 * Input signature format - accepts both app format (lat/lng, distance)
 * and native format (latitude/longitude, totalDistance)
 */
interface InputSignature {
  activityId: string;
  // App format uses lat/lng, native uses latitude/longitude
  points: Array<{ lat?: number; lng?: number; latitude?: number; longitude?: number }>;
  // App format uses 'distance', native uses 'totalDistance'
  distance?: number;
  totalDistance?: number;
  // App format uses center with lat/lng
  center?: { lat?: number; lng?: number; latitude?: number; longitude?: number };
  startPoint?: GpsPoint;
  endPoint?: GpsPoint;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

/**
 * Normalize a point from either format to native format (latitude/longitude)
 */
function normalizePoint(p: { lat?: number; lng?: number; latitude?: number; longitude?: number }): GpsPoint {
  return {
    latitude: p.latitude ?? p.lat ?? 0,
    longitude: p.longitude ?? p.lng ?? 0,
  };
}

/**
 * Normalize signature from app format to native format expected by Kotlin
 */
function normalizeSignature(sig: InputSignature): RouteSignature {
  const points = sig.points.map(normalizePoint);
  const startPoint = sig.startPoint ?? (points.length > 0 ? points[0] : { latitude: 0, longitude: 0 });
  const endPoint = sig.endPoint ?? (points.length > 0 ? points[points.length - 1] : { latitude: 0, longitude: 0 });
  const center = sig.center ? normalizePoint(sig.center) : startPoint;

  return {
    activityId: sig.activityId,
    points,
    totalDistance: sig.totalDistance ?? sig.distance ?? 0,
    startPoint,
    endPoint,
    bounds: sig.bounds,
    center,
  };
}

/**
 * Generate a heatmap from route signatures.
 * Uses the simplified GPS traces (~100 points each) for efficient generation.
 *
 * @param signatures - Route signatures with GPS points (accepts app or native format)
 * @param activityData - Activity metadata (route association, timestamps)
 * @param config - Optional heatmap configuration
 * @returns Heatmap result with cells and metadata
 */
export function generateHeatmap(
  signatures: InputSignature[] | RouteSignature[],
  activityData: ActivityHeatmapData[],
  config?: Partial<HeatmapConfig>
): HeatmapResult {
  nativeLog(`RUST generateHeatmap called with ${signatures.length} signatures`);
  const startTime = Date.now();

  const nativeConfig = {
    cell_size_meters: config?.cellSizeMeters ?? 100,
    bounds: config?.bounds ? {
      min_lat: config.bounds.minLat,
      max_lat: config.bounds.maxLat,
      min_lng: config.bounds.minLng,
      max_lng: config.bounds.maxLng,
    } : null,
  };

  const nativeActivityData = activityData.map(d => ({
    activity_id: d.activityId,
    route_id: d.routeId,
    route_name: d.routeName,
    timestamp: d.timestamp,
  }));

  // Normalize signatures to native format and serialize to JSON string
  // This handles both app format (lat/lng, distance) and native format (latitude/longitude, totalDistance)
  const normalizedSignatures = (signatures as InputSignature[]).map(normalizeSignature);
  const signaturesJson = JSON.stringify(normalizedSignatures);
  // Serialize all parameters to JSON to avoid Expo Modules bridge serialization issues with nulls
  const activityDataJson = JSON.stringify(nativeActivityData);
  const configJson = JSON.stringify(nativeConfig);

  const result = NativeModule.generateHeatmap(signaturesJson, activityDataJson, configJson);

  const elapsed = Date.now() - startTime;
  nativeLog(`RUST generateHeatmap returned ${result?.cells?.length || 0} cells in ${elapsed}ms`);

  // Convert from snake_case to camelCase
  return {
    cells: (result?.cells || []).map((c: Record<string, unknown>) => ({
      row: c.row as number,
      col: c.col as number,
      centerLat: c.center_lat as number,
      centerLng: c.center_lng as number,
      density: c.density as number,
      visitCount: c.visit_count as number,
      routeRefs: (c.route_refs as Array<Record<string, unknown>>).map(r => ({
        routeId: r.route_id as string,
        activityCount: r.activity_count as number,
        name: r.name as string | null,
      })),
      uniqueRouteCount: c.unique_route_count as number,
      activityIds: c.activity_ids as string[],
      firstVisit: c.first_visit as number | null,
      lastVisit: c.last_visit as number | null,
      isCommonPath: c.is_common_path as boolean,
    })),
    bounds: {
      minLat: result?.bounds?.min_lat ?? 0,
      maxLat: result?.bounds?.max_lat ?? 0,
      minLng: result?.bounds?.min_lng ?? 0,
      maxLng: result?.bounds?.max_lng ?? 0,
    },
    cellSizeMeters: result?.cell_size_meters ?? 100,
    gridRows: result?.grid_rows ?? 0,
    gridCols: result?.grid_cols ?? 0,
    maxDensity: result?.max_density ?? 0,
    totalRoutes: result?.total_routes ?? 0,
    totalActivities: result?.total_activities ?? 0,
  };
}

/**
 * Query the heatmap at a specific location.
 *
 * @param heatmap - Heatmap result from generateHeatmap
 * @param lat - Latitude to query
 * @param lng - Longitude to query
 * @returns Cell query result or null if no cell at that location
 */
export function queryHeatmapCell(
  heatmap: HeatmapResult,
  lat: number,
  lng: number
): CellQueryResult | null {
  // Convert to native format and serialize to JSON to avoid Expo Modules bridge issues with nulls
  const nativeHeatmap = {
    cells: heatmap.cells.map(c => ({
      row: c.row,
      col: c.col,
      center_lat: c.centerLat,
      center_lng: c.centerLng,
      density: c.density,
      visit_count: c.visitCount,
      route_refs: c.routeRefs.map(r => ({
        route_id: r.routeId,
        activity_count: r.activityCount,
        name: r.name,
      })),
      unique_route_count: c.uniqueRouteCount,
      activity_ids: c.activityIds,
      first_visit: c.firstVisit,
      last_visit: c.lastVisit,
      is_common_path: c.isCommonPath,
    })),
    bounds: {
      min_lat: heatmap.bounds.minLat,
      max_lat: heatmap.bounds.maxLat,
      min_lng: heatmap.bounds.minLng,
      max_lng: heatmap.bounds.maxLng,
    },
    cell_size_meters: heatmap.cellSizeMeters,
    grid_rows: heatmap.gridRows,
    grid_cols: heatmap.gridCols,
    max_density: heatmap.maxDensity,
    total_routes: heatmap.totalRoutes,
    total_activities: heatmap.totalActivities,
  };
  const heatmapJson = JSON.stringify(nativeHeatmap);

  const result = NativeModule.queryHeatmapCell(heatmapJson, lat, lng);
  if (!result) return null;

  const cell = result.cell;
  return {
    cell: {
      row: cell.row,
      col: cell.col,
      centerLat: cell.center_lat,
      centerLng: cell.center_lng,
      density: cell.density,
      visitCount: cell.visit_count,
      routeRefs: (cell.route_refs || []).map((r: Record<string, unknown>) => ({
        routeId: r.route_id as string,
        activityCount: r.activity_count as number,
        name: r.name as string | null,
      })),
      uniqueRouteCount: cell.unique_route_count,
      activityIds: cell.activity_ids,
      firstVisit: cell.first_visit,
      lastVisit: cell.last_visit,
      isCommonPath: cell.is_common_path,
    },
    suggestedLabel: result.suggested_label,
  };
}

/**
 * Get default heatmap configuration from Rust.
 */
export function getDefaultHeatmapConfig(): HeatmapConfig {
  const config = NativeModule.defaultHeatmapConfig();
  return {
    cellSizeMeters: config.cell_size_meters,
    bounds: config.bounds ? {
      minLat: config.bounds.min_lat,
      maxLat: config.bounds.max_lat,
      minLng: config.bounds.min_lng,
      maxLng: config.bounds.max_lng,
    } : undefined,
  };
}

// =============================================================================
// Route Engine (Stateful Rust Backend)
// =============================================================================

/**
 * Engine statistics for monitoring.
 */
export interface EngineStats {
  activityCount: number;
  signatureCount: number;
  groupCount: number;
  sectionCount: number;
  cachedConsensusCount: number;
}

/**
 * Route Engine Client - wraps the stateful Rust engine.
 *
 * This is the recommended way to use route matching for most cases.
 * Instead of passing all data through FFI on every call, the engine
 * keeps state in Rust and only returns results.
 *
 * Benefits:
 * - Minimal FFI overhead (only transfer what's needed)
 * - Automatic signature computation
 * - Automatic grouping and section detection
 * - Spatial queries without data transfer
 */
class RouteEngineClient {
  private static instance: RouteEngineClient;
  private listeners: Map<string, Set<() => void>> = new Map();
  private initialized = false;
  private dbPath: string | null = null;

  private constructor() {}

  static getInstance(): RouteEngineClient {
    if (!this.instance) {
      this.instance = new RouteEngineClient();
    }
    return this.instance;
  }

  /**
   * Initialize the engine with a database path for persistent storage.
   * Call once at app startup with a path to the SQLite database file.
   * Data persists across app restarts - GPS tracks, routes, sections are all cached.
   *
   * @param dbPath - Path to the SQLite database file (e.g., `${FileSystem.documentDirectory}routes.db`)
   */
  initWithPath(dbPath: string): boolean {
    if (this.initialized && this.dbPath === dbPath) return true;
    const result = NativeModule.persistentEngineInit(dbPath);
    if (result) {
      this.initialized = true;
      this.dbPath = dbPath;
      nativeLog(`[Engine] Initialized with persistent storage at ${dbPath}`);
    } else {
      nativeLog('[Engine] Failed to initialize persistent storage');
    }
    return result;
  }

  /**
   * Initialize the engine (legacy - uses in-memory storage).
   * @deprecated Use initWithPath() for persistent storage
   */
  init(): void {
    if (this.initialized) return;
    NativeModule.engineInit();
    this.initialized = true;
    nativeLog('[Engine] Initialized (in-memory mode - data will not persist)');
  }

  /**
   * Check if the engine is initialized.
   */
  isInitialized(): boolean {
    return this.initialized || NativeModule.persistentEngineIsInitialized();
  }

  /**
   * Clear all engine state.
   * Notifies all subscribers that a full reset has occurred.
   */
  clear(): void {
    if (this.dbPath) {
      NativeModule.persistentEngineClear();
    } else {
      NativeModule.engineClear();
    }
    this.notify('activities');
    this.notify('groups');
    this.notify('sections');
    this.notify('syncReset'); // Signal that a full resync is needed
    nativeLog('[Engine] Cleared');
  }

  /**
   * Remove activities older than the specified retention period.
   * This prevents unbounded database growth.
   * Only works in persistent mode (when dbPath is set).
   *
   * @param retentionDays - Number of days to retain (0 = keep all, 30-365 for cleanup)
   * @returns Number of activities deleted
   */
  cleanupOldActivities(retentionDays: number): number {
    if (!this.dbPath) {
      nativeLog('[Engine] Cleanup skipped: not in persistent mode');
      return 0;
    }

    const deleted = NativeModule.persistentEngineCleanupOldActivities(retentionDays);

    // Notify subscribers if activities were deleted
    if (deleted > 0) {
      this.notify('activities');
      this.notify('groups');
      this.notify('sections');
    }

    nativeLog(
      `[Engine] Cleanup completed: ${deleted} activities removed (${retentionDays === 0 ? 'keep all' : `${retentionDays} days`})`
    );
    return deleted;
  }

  /**
   * Mark the engine for route re-computation.
   *
   * Call this when historical activities are added (e.g., cache expansion)
   * to trigger re-computation of route groups and sections with the new data.
   * The next access to groups/sections will re-compute with improved quality.
   *
   * Only works in persistent mode (when dbPath is set).
   */
  markForRecomputation(): void {
    if (!this.dbPath) {
      nativeLog('[Engine] Re-computation skipped: not in persistent mode');
      return;
    }

    NativeModule.persistentEngineMarkForRecomputation();

    // Note: We don't notify subscribers here - the notification will happen
    // when groups/sections are actually recomputed on next access
    nativeLog('[Engine] Marked for re-computation');
  }

  /**
   * Add activities from flat coordinate buffers.
   * Runs asynchronously to avoid blocking the UI thread.
   * In persistent mode, data is stored in SQLite and survives app restarts.
   *
   * @param activityIds - Array of activity IDs
   * @param allCoords - Single flat array of ALL coordinates [lat1, lng1, lat2, lng2, ...]
   * @param offsets - Index offsets where each track starts
   * @param sportTypes - Sport type for each activity
   */
  async addActivities(
    activityIds: string[],
    allCoords: number[],
    offsets: number[],
    sportTypes: string[]
  ): Promise<void> {
    nativeLog(`[Engine] Adding ${activityIds.length} activities (${this.dbPath ? 'persistent' : 'memory'})`);
    if (this.dbPath) {
      NativeModule.persistentEngineAddActivities(activityIds, allCoords, offsets, sportTypes);
    } else {
      await NativeModule.engineAddActivities(activityIds, allCoords, offsets, sportTypes);
    }
    this.notify('activities');
    this.notify('groups');
    this.notify('sections');
  }

  /**
   * Add activities from GpsTrack format (convenience method).
   */
  async addActivitiesFromTracks(tracks: Array<{ activityId: string; points: GpsPoint[]; sportType: string }>): Promise<void> {
    const activityIds: string[] = [];
    const allCoords: number[] = [];
    const offsets: number[] = [];
    const sportTypes: string[] = [];

    for (const track of tracks) {
      activityIds.push(track.activityId);
      offsets.push(allCoords.length / 2);
      sportTypes.push(track.sportType);
      for (const point of track.points) {
        allCoords.push(point.latitude, point.longitude);
      }
    }

    await this.addActivities(activityIds, allCoords, offsets, sportTypes);
  }

  /**
   * Remove activities.
   */
  removeActivities(activityIds: string[]): void {
    nativeLog(`[Engine] Removing ${activityIds.length} activities`);
    if (this.dbPath) {
      NativeModule.persistentEngineRemoveActivities(activityIds);
    } else {
      NativeModule.engineRemoveActivities(activityIds);
    }
    this.notify('activities');
    this.notify('groups');
    this.notify('sections');
  }

  /**
   * Get all activity IDs.
   */
  getActivityIds(): string[] {
    if (this.dbPath) {
      return NativeModule.persistentEngineGetActivityIds();
    }
    return NativeModule.engineGetActivityIds();
  }

  /**
   * Get activity count.
   */
  getActivityCount(): number {
    if (this.dbPath) {
      return NativeModule.persistentEngineGetActivityCount();
    }
    return NativeModule.engineGetActivityCount();
  }

  /**
   * Get GPS track for an activity as flat coordinates.
   * Only available in persistent mode.
   * Returns [lat1, lng1, lat2, lng2, ...] or empty array if not found.
   */
  getGpsTrack(activityId: string): number[] {
    if (!this.dbPath) return [];
    return NativeModule.persistentEngineGetGpsTrack(activityId);
  }

  /**
   * Check if using persistent storage.
   */
  isPersistent(): boolean {
    return this.dbPath !== null;
  }

  /**
   * Get route groups.
   * Groups are computed lazily and cached.
   * In persistent mode, groups are loaded from SQLite (instant).
   */
  getGroups(): RouteGroup[] {
    const json = this.dbPath
      ? NativeModule.persistentEngineGetGroupsJson()
      : NativeModule.engineGetGroupsJson();
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>;
    // Convert from snake_case to camelCase
    return parsed.map(g => {
      const rawBounds = g.bounds as Record<string, number> | null;
      return {
        groupId: (g.group_id as string) || '',
        representativeId: (g.representative_id as string) || '',
        activityIds: (g.activity_ids as string[]) || [],
        sportType: (g.sport_type as string) || 'Ride',
        bounds: rawBounds ? {
          minLat: rawBounds.min_lat,
          maxLat: rawBounds.max_lat,
          minLng: rawBounds.min_lng,
          maxLng: rawBounds.max_lng,
        } : null,
        customName: (g.custom_name as string) || '',
      };
    });
  }

  /**
   * Get detected sections.
   * Sections are computed lazily and cached.
   * In persistent mode, sections are loaded from SQLite (instant).
   */
  getSections(): FrequentSection[] {
    const json = this.dbPath
      ? NativeModule.persistentEngineGetSectionsJson()
      : NativeModule.engineGetSectionsJson();
    const result = JSON.parse(json) as Array<Record<string, unknown>>;

    // Convert from snake_case to camelCase
    return result.map((s: Record<string, unknown>) => ({
      id: s.id as string,
      sportType: s.sport_type as string,
      polyline: ((s.polyline as GpsPoint[]) || []).map(p => ({ lat: p.latitude, lng: p.longitude })),
      representativeActivityId: (s.representative_activity_id as string) || '',
      activityIds: s.activity_ids as string[],
      activityPortions: ((s.activity_portions as Array<Record<string, unknown>>) || []).map(p => ({
        activityId: p.activity_id as string,
        startIndex: p.start_index as number,
        endIndex: p.end_index as number,
        distanceMeters: p.distance_meters as number,
        direction: p.direction as string,
      })),
      routeIds: s.route_ids as string[],
      visitCount: s.visit_count as number,
      distanceMeters: s.distance_meters as number,
      activityTraces: convertActivityTraces(s.activity_traces as Record<string, GpsPoint[]>),
      confidence: (s.confidence as number) ?? 0.0,
      observationCount: (s.observation_count as number) ?? 0,
      averageSpread: (s.average_spread as number) ?? 0.0,
      pointDensity: s.point_density as number[] | undefined,
    }));
  }

  /**
   * Start section detection in the background.
   * Only available in persistent mode.
   * Sections are detected from GPS tracks and stored in SQLite.
   *
   * @param sportFilter - Optional sport type to filter (e.g., "Run", "Ride")
   * @returns true if detection started, false if already running or not in persistent mode
   */
  startSectionDetection(sportFilter?: string): boolean {
    if (!this.dbPath) {
      // In-memory mode doesn't need explicit detection - it's lazy
      nativeLog('[Engine] Section detection skipped (in-memory mode uses lazy detection)');
      return false;
    }
    const started = NativeModule.persistentEngineStartSectionDetection(sportFilter ?? null);
    if (started) {
      nativeLog('[Engine] Section detection started');
    }
    return started;
  }

  /**
   * Poll for section detection completion.
   * Call this periodically after starting detection.
   *
   * @returns "running" | "complete" | "idle" | "error"
   */
  pollSectionDetection(): 'running' | 'complete' | 'idle' | 'error' {
    if (!this.dbPath) return 'idle';
    const status = NativeModule.persistentEnginePollSections() as string;
    if (status === 'complete') {
      this.notify('sections');
    }
    return status as 'running' | 'complete' | 'idle' | 'error';
  }

  /**
   * Detect sections and wait for completion.
   * Convenience method that starts detection and polls until complete.
   *
   * @param sportFilter - Optional sport type filter
   * @param pollIntervalMs - Polling interval in milliseconds (default: 100)
   * @param timeoutMs - Timeout in milliseconds (default: 60000)
   */
  async detectSectionsAsync(
    sportFilter?: string,
    pollIntervalMs = 100,
    timeoutMs = 60000
  ): Promise<boolean> {
    if (!this.dbPath) {
      // In-memory mode - sections are computed lazily
      return true;
    }

    if (!this.startSectionDetection(sportFilter)) {
      // Already running or failed to start - check current status
      const status = this.pollSectionDetection();
      if (status === 'running') {
        // Wait for existing detection to complete
      } else {
        return status === 'complete' || status === 'idle';
      }
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      const status = this.pollSectionDetection();
      if (status === 'complete' || status === 'idle') {
        return true;
      }
      if (status === 'error') {
        return false;
      }
    }

    nativeLog('[Engine] Section detection timed out');
    return false;
  }

  /**
   * Query activities in a viewport.
   * Returns activity IDs that intersect the given bounds.
   */
  queryViewport(minLat: number, maxLat: number, minLng: number, maxLng: number): string[] {
    if (this.dbPath) {
      return NativeModule.persistentEngineQueryViewport(minLat, maxLat, minLng, maxLng);
    }
    return NativeModule.engineQueryViewport(minLat, maxLat, minLng, maxLng);
  }

  /**
   * Find activities near a point.
   */
  findNearby(lat: number, lng: number, radiusDegrees: number): string[] {
    return NativeModule.engineFindNearby(lat, lng, radiusDegrees);
  }

  /**
   * Get consensus route for a group as flat coordinates.
   * Returns [lat1, lng1, lat2, lng2, ...] or empty array if not found.
   */
  getConsensusRoute(groupId: string): number[] {
    if (this.dbPath) {
      return NativeModule.persistentEngineGetConsensusRoute(groupId);
    }
    return NativeModule.engineGetConsensusRoute(groupId);
  }

  /**
   * Get consensus route as GpsPoint array.
   */
  getConsensusRoutePoints(groupId: string): GpsPoint[] {
    const flat = this.getConsensusRoute(groupId);
    return flatCoordsToPoints(flat);
  }

  /**
   * Get engine statistics.
   */
  getStats(): EngineStats {
    if (this.dbPath) {
      const stats = NativeModule.persistentEngineGetStats();
      if (!stats) {
        return { activityCount: 0, signatureCount: 0, groupCount: 0, sectionCount: 0, cachedConsensusCount: 0 };
      }
      return {
        activityCount: stats.activity_count,
        signatureCount: stats.signature_cache_size,
        groupCount: stats.group_count,
        sectionCount: stats.section_count,
        cachedConsensusCount: stats.consensus_cache_size,
      };
    }
    const stats = NativeModule.engineGetStats();
    return {
      activityCount: stats.activity_count,
      signatureCount: stats.signature_count,
      groupCount: stats.group_count,
      sectionCount: stats.section_count,
      cachedConsensusCount: stats.cached_consensus_count,
    };
  }

  /**
   * Set match configuration.
   * This invalidates all computed state (signatures, groups, sections).
   */
  setMatchConfig(config: Partial<MatchConfig>): void {
    const fullConfig = { ...getDefaultConfig(), ...config };
    NativeModule.engineSetMatchConfig({
      perfect_threshold: fullConfig.perfectThreshold,
      zero_threshold: fullConfig.zeroThreshold,
      min_match_percentage: fullConfig.minMatchPercentage,
      min_route_distance: fullConfig.minRouteDistance,
      max_distance_diff_ratio: fullConfig.maxDistanceDiffRatio,
      endpoint_threshold: fullConfig.endpointThreshold,
      resample_count: fullConfig.resampleCount,
      simplification_tolerance: fullConfig.simplificationTolerance,
      max_simplified_points: fullConfig.maxSimplifiedPoints,
    });
    this.notify('groups');
    this.notify('sections');
  }

  /**
   * Set section detection configuration.
   */
  setSectionConfig(config: Partial<SectionConfig>): void {
    const fullConfig = { ...getDefaultSectionConfig(), ...config };
    NativeModule.engineSetSectionConfig({
      proximity_threshold: fullConfig.proximityThreshold,
      min_section_length: fullConfig.minSectionLength,
      min_activities: fullConfig.minActivities,
      cluster_tolerance: fullConfig.clusterTolerance,
      sample_points: fullConfig.samplePoints,
    });
    this.notify('sections');
  }

  /**
   * Set a custom name for a route.
   * Pass empty string to clear the custom name.
   * Uses persistent engine for durability across app restarts.
   */
  setRouteName(routeId: string, name: string): void {
    NativeModule.persistentEngineSetRouteName(routeId, name);
    this.notify('groups');
  }

  /**
   * Get the custom name for a route.
   * Returns empty string if no custom name is set.
   * Uses persistent engine for consistency with setRouteName.
   */
  getRouteName(routeId: string): string {
    return NativeModule.persistentEngineGetRouteName(routeId) || '';
  }

  /**
   * Get all custom route names.
   * Returns a map of routeId -> customName.
   */
  getAllRouteNames(): Record<string, string> {
    const json = NativeModule.persistentEngineGetAllRouteNamesJson();
    return JSON.parse(json) as Record<string, string>;
  }

  /**
   * Set a custom name for a section.
   * Pass empty string to clear the custom name.
   * Uses persistent engine for durability across app restarts.
   */
  setSectionName(sectionId: string, name: string): void {
    NativeModule.persistentEngineSetSectionName(sectionId, name);
    this.notify('sections');
  }

  /**
   * Get the custom name for a section.
   * Returns empty string if no custom name is set.
   * Uses persistent engine for consistency with setSectionName.
   */
  getSectionName(sectionId: string): string {
    return NativeModule.persistentEngineGetSectionName(sectionId) || '';
  }

  /**
   * Get all custom section names.
   * Returns a map of sectionId -> customName.
   */
  getAllSectionNames(): Record<string, string> {
    const json = NativeModule.persistentEngineGetAllSectionNamesJson();
    return JSON.parse(json) as Record<string, string>;
  }

  /**
   * Get all activity bounds info for map display.
   * Returns array of { id, bounds, type, distance }.
   */
  getAllActivityBounds(): Array<{
    id: string;
    bounds: [[number, number], [number, number]];  // [[minLat, minLng], [maxLat, maxLng]]
    type: string;
    distance: number;
  }> {
    const json = NativeModule.engineGetAllActivityBoundsJson();
    const raw = JSON.parse(json) as Array<{
      id: string;
      bounds: [[number, number], [number, number]];
      activity_type: string;
      distance: number;
    }>;
    // Convert from Rust format (snake_case) to JS format (camelCase)
    return raw.map(item => ({
      id: item.id,
      bounds: item.bounds,
      type: item.activity_type,
      distance: item.distance,
    }));
  }

  /**
   * Get all route signatures for trace rendering.
   * Returns a map of activityId -> { points: [{lat, lng}], center: {lat, lng} }.
   */
  getAllSignatures(): Record<string, { points: Array<{ lat: number; lng: number }>; center: { lat: number; lng: number } }> {
    const json = NativeModule.engineGetAllSignaturesJson();
    const raw = JSON.parse(json) as Record<string, {
      points: Array<{ latitude: number; longitude: number }>;
      center: { latitude: number; longitude: number };
    }>;
    // Convert from Rust format {latitude, longitude} to JS format {lat, lng}
    const result: Record<string, { points: Array<{ lat: number; lng: number }>; center: { lat: number; lng: number } }> = {};
    for (const [activityId, sig] of Object.entries(raw)) {
      result[activityId] = {
        points: sig.points.map(p => ({ lat: p.latitude, lng: p.longitude })),
        center: { lat: sig.center.latitude, lng: sig.center.longitude },
      };
    }
    return result;
  }

  /**
   * Get signature points for all activities in a group.
   * Returns a map of activityId -> array of {lat, lng} points.
   */
  getSignaturesForGroup(groupId: string): Record<string, Array<{ lat: number; lng: number }>> {
    const json = NativeModule.engineGetSignaturesForGroupJson(groupId);
    const raw = JSON.parse(json) as Record<string, Array<{ latitude: number; longitude: number }>>;
    // Convert from rust format {latitude, longitude} to JS format {lat, lng}
    const result: Record<string, Array<{ lat: number; lng: number }>> = {};
    for (const [activityId, points] of Object.entries(raw)) {
      result[activityId] = points.map(p => ({ lat: p.latitude, lng: p.longitude }));
    }
    return result;
  }

  // ========================================================================
  // Performance Methods
  // ========================================================================

  /**
   * Set activity metrics for performance calculations.
   * Call after activities are loaded with metadata from API.
   * In persistent mode, metrics are stored in SQLite for instant access on next launch.
   */
  setActivityMetrics(metrics: ActivityMetrics[]): void {
    const nativeMetrics = metrics.map(m => ({
      activity_id: m.activityId,
      name: m.name,
      date: m.date,
      distance: m.distance,
      moving_time: m.movingTime,
      elapsed_time: m.elapsedTime,
      elevation_gain: m.elevationGain,
      avg_hr: m.avgHr ?? null,
      avg_power: m.avgPower ?? null,
      sport_type: m.sportType,
    }));
    if (this.dbPath) {
      NativeModule.persistentEngineSetActivityMetrics(nativeMetrics);
    } else {
      NativeModule.engineSetActivityMetrics(nativeMetrics);
    }
    nativeLog(`[Engine] Set metrics for ${metrics.length} activities (${this.dbPath ? 'persistent' : 'memory'})`);
  }

  /**
   * Get route performances for a group.
   * Returns sorted performances with best and current rank.
   * In persistent mode, uses stored match percentages instead of hardcoded 100%.
   */
  getRoutePerformances(
    routeGroupId: string,
    currentActivityId?: string
  ): RoutePerformanceResult {
    const json = this.dbPath
      ? NativeModule.persistentEngineGetRoutePerformancesJson(
          routeGroupId,
          currentActivityId ?? null
        )
      : NativeModule.engineGetRoutePerformancesJson(
          routeGroupId,
          currentActivityId ?? null
        );
    const raw = JSON.parse(json) as {
      performances: Array<Record<string, unknown>>;
      best: Record<string, unknown> | null;
      current_rank: number | null;
    };

    const convertPerformance = (p: Record<string, unknown>): RoutePerformance => ({
      activityId: p.activity_id as string,
      name: p.name as string,
      date: p.date as number,
      speed: p.speed as number,
      duration: p.duration as number,
      movingTime: p.moving_time as number,
      distance: p.distance as number,
      elevationGain: p.elevation_gain as number,
      avgHr: p.avg_hr as number | undefined,
      avgPower: p.avg_power as number | undefined,
      isCurrent: p.is_current as boolean,
      direction: p.direction as string,
      matchPercentage: p.match_percentage as number,
    });

    return {
      performances: (raw.performances || []).map(convertPerformance),
      best: raw.best ? convertPerformance(raw.best) : null,
      currentRank: raw.current_rank ?? null,
    };
  }

  /**
   * Set time streams for section calculations.
   * Only stores time arrays (not full stream data).
   */
  setTimeStreams(streams: Array<{ activityId: string; times: number[] }>): void {
    const activityIds: string[] = [];
    const allTimes: number[] = [];
    const offsets: number[] = [];

    for (const stream of streams) {
      activityIds.push(stream.activityId);
      offsets.push(allTimes.length);
      allTimes.push(...stream.times);
    }

    NativeModule.engineSetTimeStreams(activityIds, allTimes, offsets);
    nativeLog(`[Engine] Set time streams for ${streams.length} activities`);
  }

  /**
   * Get section performances.
   * Returns performance records sorted by date with best record.
   */
  getSectionPerformances(sectionId: string): SectionPerformanceResult {
    const json = NativeModule.engineGetSectionPerformancesJson(sectionId);
    const raw = JSON.parse(json) as {
      records: Array<Record<string, unknown>>;
      best_record: Record<string, unknown> | null;
    };

    const convertLap = (l: Record<string, unknown>): SectionLap => ({
      id: l.id as string,
      activityId: l.activity_id as string,
      time: l.time as number,
      pace: l.pace as number,
      distance: l.distance as number,
      direction: l.direction as string,
      startIndex: l.start_index as number,
      endIndex: l.end_index as number,
    });

    const convertRecord = (r: Record<string, unknown>): SectionPerformanceRecord => ({
      activityId: r.activity_id as string,
      activityName: r.activity_name as string,
      activityDate: r.activity_date as number,
      laps: ((r.laps as Array<Record<string, unknown>>) || []).map(convertLap),
      lapCount: r.lap_count as number,
      bestTime: r.best_time as number,
      bestPace: r.best_pace as number,
      avgTime: r.avg_time as number,
      avgPace: r.avg_pace as number,
      direction: r.direction as string,
      sectionDistance: r.section_distance as number,
    });

    return {
      records: (raw.records || []).map(convertRecord),
      bestRecord: raw.best_record ? convertRecord(raw.best_record) : null,
    };
  }

  /**
   * Subscribe to engine events.
   *
   * @param event - Event type: 'activities', 'groups', 'sections', 'syncReset'
   * @param callback - Called when the event occurs
   * @returns Unsubscribe function
   */
  subscribe(event: 'activities' | 'groups' | 'sections' | 'syncReset', callback: () => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)!.delete(callback);
  }

  private notify(event: string) {
    this.listeners.get(event)?.forEach(cb => cb());
  }
}

/**
 * Get the singleton Route Engine instance.
 * Use this for stateful route management with minimal FFI overhead.
 */
export const routeEngine = RouteEngineClient.getInstance();

export default {
  createSignature,
  createSignaturesFlatBuffer,
  compareRoutes,
  groupSignatures,
  groupIncremental,
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
  // Frequent sections detection
  detectSectionsFromTracks,
  detectSectionsMultiscale,
  getDefaultSectionConfig,
  getDefaultScalePresets,
  // Type exports
  ScalePreset,
  SectionConfig,
  DetectionStats,
  PotentialSection,
  MultiScaleSectionResult,
  // Heatmap generation
  generateHeatmap,
  queryHeatmapCell,
  getDefaultHeatmapConfig,
  // Route Engine (stateful)
  routeEngine,
};
