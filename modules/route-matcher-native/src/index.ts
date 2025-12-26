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

// =============================================================================
// Frequent Sections Detection
// =============================================================================

/**
 * Configuration for section detection.
 */
export interface SectionConfig {
  /** Grid cell size in meters (default: 100m) */
  cellSizeMeters: number;
  /** Minimum visits to a cell to be considered frequent (default: 3) */
  minVisits: number;
  /** Minimum cells in a cluster to form a section (default: 5, ~500m) */
  minCells: number;
  /** Whether to use 8-directional (true) or 4-directional (false) flood-fill */
  diagonalConnect: boolean;
}

/**
 * Grid cell coordinate.
 */
export interface CellCoord {
  row: number;
  col: number;
}

/**
 * A frequently-traveled section (~100m grid cells).
 */
export interface FrequentSection {
  /** Unique section ID */
  id: string;
  /** Sport type this section is for ("Run", "Ride", etc.) */
  sportType: string;
  /** Grid cell coordinates that make up this section */
  cells: CellCoord[];
  /** Simplified polyline for rendering (ordered path through cells) */
  polyline: GpsPoint[];
  /** Activity IDs that traverse this section */
  activityIds: string[];
  /** Route group IDs that include this section */
  routeIds: string[];
  /** Total number of traversals */
  visitCount: number;
  /** Estimated section length in meters */
  distanceMeters: number;
  /** Timestamp of first visit (Unix seconds, 0 if unknown) */
  firstVisit: number;
  /** Timestamp of last visit (Unix seconds, 0 if unknown) */
  lastVisit: number;
}

/**
 * Input mapping activity IDs to sport types.
 */
export interface ActivitySportType {
  activityId: string;
  sportType: string;
}

/**
 * Detect frequent sections from route signatures.
 * Uses a grid-based algorithm to find road sections that are frequently traveled,
 * even when full routes differ.
 *
 * @param signatures - Route signatures with GPS points
 * @param groups - Route groups (for linking sections to routes)
 * @param sportTypes - Map of activity_id -> sport_type
 * @param config - Optional section detection configuration
 * @returns Array of detected frequent sections, sorted by visit count (descending)
 */
export function detectFrequentSections(
  signatures: RouteSignature[],
  groups: RouteGroup[],
  sportTypes: ActivitySportType[],
  config?: Partial<SectionConfig>
): FrequentSection[] {
  nativeLog(`RUST detectFrequentSections called with ${signatures.length} signatures`);
  const startTime = Date.now();

  // Convert to native format
  const nativeConfig = config ? {
    cell_size_meters: config.cellSizeMeters ?? 100,
    min_visits: config.minVisits ?? 3,
    min_cells: config.minCells ?? 5,
    diagonal_connect: config.diagonalConnect ?? true,
  } : NativeModule.defaultSectionConfig();

  const result = NativeModule.detectFrequentSections(
    signatures,
    groups,
    sportTypes.map(st => ({
      activity_id: st.activityId,
      sport_type: st.sportType,
    })),
    nativeConfig
  );

  const elapsed = Date.now() - startTime;
  nativeLog(`RUST detectFrequentSections returned ${result?.length || 0} sections in ${elapsed}ms`);

  // Convert from snake_case to camelCase
  return (result || []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    sportType: s.sport_type as string,
    cells: (s.cells as Array<{ row: number; col: number }>).map(c => ({ row: c.row, col: c.col })),
    polyline: (s.polyline as GpsPoint[]),
    activityIds: s.activity_ids as string[],
    routeIds: s.route_ids as string[],
    visitCount: s.visit_count as number,
    distanceMeters: s.distance_meters as number,
    firstVisit: s.first_visit as number,
    lastVisit: s.last_visit as number,
  }));
}

/**
 * Get default section detection configuration from Rust.
 */
export function getDefaultSectionConfig(): SectionConfig {
  const config = NativeModule.defaultSectionConfig();
  return {
    cellSizeMeters: config.cell_size_meters,
    minVisits: config.min_visits,
    minCells: config.min_cells,
    diagonalConnect: config.diagonal_connect,
  };
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
 * Generate a heatmap from route signatures.
 * Uses the simplified GPS traces (~100 points each) for efficient generation.
 *
 * @param signatures - Route signatures with GPS points
 * @param activityData - Activity metadata (route association, timestamps)
 * @param config - Optional heatmap configuration
 * @returns Heatmap result with cells and metadata
 */
export function generateHeatmap(
  signatures: RouteSignature[],
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

  const result = NativeModule.generateHeatmap(signatures, nativeActivityData, nativeConfig);

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
  // Convert to native format
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

  const result = NativeModule.queryHeatmapCell(nativeHeatmap, lat, lng);
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

export default {
  createSignature,
  createSignaturesBatch,
  createSignaturesFlatBuffer,
  compareRoutes,
  groupSignatures,
  groupIncremental,
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
  // Frequent sections detection
  detectFrequentSections,
  getDefaultSectionConfig,
  // Heatmap generation
  generateHeatmap,
  queryHeatmapCell,
  getDefaultHeatmapConfig,
};
