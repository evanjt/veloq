/**
 * Background processing queue for route matching.
 * Handles fetching GPS streams, generating signatures, and finding matches
 * without blocking the UI.
 */

import { InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { intervalsApi } from '@/api';
import type {
  RouteSignature,
  RouteMatchCache,
  RouteProcessingProgress,
  ProcessedActivityStatus,
  DiscoveredRouteInfo,
  ActivityType,
  ActivityBoundsItem,
} from '@/types';
import { DEFAULT_ROUTE_MATCH_CONFIG, RouteMatch, MatchDirection } from '@/types';

/** Internal match result from Rust comparison */
interface MatchResult {
  matchPercentage: number;
  direction: MatchDirection;
  overlapStart: number;
  overlapEnd: number;
  overlapDistance: number;
  confidence: number;
}
import {
  loadRouteCache,
  saveRouteCache,
  createEmptyCache,
  addSignaturesToCache,
  updateRouteGroups,
  addMatchToCache,
  getUnprocessedActivityIds,
} from './routeStorage';
import { findActivitiesWithPotentialMatchesFast } from './activityBoundsUtils';
import { activitySpatialIndex } from './spatialIndex';
import { generateRouteName } from './geocoding';
import NativeRouteMatcher from 'route-matcher-native';
import type { RouteSignature as NativeRouteSignature, RouteGroup as NativeRouteGroup, GpsPoint, GpsTrack } from 'route-matcher-native';

/** Batch size for parallel processing */
const BATCH_SIZE = 30;
/** Max concurrent API requests (API allows 30/s, use 10 for better throughput) */
const MAX_CONCURRENT = 10;

/**
 * Process items in parallel with concurrency limit and progress callback.
 * Returns results in same order as input.
 */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  // Start `concurrency` workers
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

/**
 * Encode lat/lng to a simple geohash (~500m precision).
 */
function encodeGeohash(lat: number, lng: number): string {
  // Simple geohash approximation using grid cells
  const latCell = Math.floor((lat + 90) * 200); // ~500m resolution
  const lngCell = Math.floor((lng + 180) * 200);
  return `${latCell.toString(36)}_${lngCell.toString(36)}`;
}

/**
 * Calculate haversine distance between two points in meters.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Generate a route signature using native Rust implementation.
 * Rust handles: point simplification, distance calculation.
 * JS computes: bounds, hashes, loop detection (from Rust output).
 */
function generateRouteSignature(
  activityId: string,
  latlngs: [number, number][],
  config: Record<string, unknown> = {}
): RouteSignature | null {
  // Convert raw arrays to GpsPoint format, filtering invalid points
  const points: GpsPoint[] = latlngs
    .filter(([lat, lng]) => {
      const validLat = typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
      const validLng = typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
      return validLat && validLng;
    })
    .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));

  if (points.length < 2) {
    console.warn(`🦀 [RouteMatcher] Not enough valid points for ${activityId}: ${points.length}`);
    return null;
  }

  // Call native Rust createSignature
  const nativeSig = NativeRouteMatcher.createSignature(activityId, points, config);

  if (!nativeSig) {
    console.warn(`🦀 [RouteMatcher] Rust createSignature returned null for ${activityId}`);
    return null;
  }

  // Convert to app format and compute additional metadata
  const routePoints = nativeSig.points.map(p => ({ lat: p.latitude, lng: p.longitude }));

  // Compute bounds from simplified points
  const lats = routePoints.map(p => p.lat);
  const lngs = routePoints.map(p => p.lng);
  const bounds = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };

  // Compute start/end region hashes
  const startPoint = routePoints[0];
  const endPoint = routePoints[routePoints.length - 1];
  const startRegionHash = encodeGeohash(startPoint.lat, startPoint.lng);
  const endRegionHash = encodeGeohash(endPoint.lat, endPoint.lng);

  // Detect if loop (start/end within 200m)
  const startEndDistance = haversineDistance(
    startPoint.lat, startPoint.lng,
    endPoint.lat, endPoint.lng
  );
  const isLoop = startEndDistance < 200;

  return {
    activityId: nativeSig.activityId,
    points: routePoints,
    distance: nativeSig.totalDistance,
    bounds,
    startRegionHash,
    endRegionHash,
    isLoop,
  };
}

/**
 * GPS data to be processed in batch.
 */
interface GpsData {
  activityId: string;
  latlngs: [number, number][];
}

/**
 * Generate route signatures in batch using native Rust parallel processing.
 * MUCH faster than calling generateRouteSignature repeatedly:
 * - Single FFI call instead of N calls
 * - Parallel processing in Rust using rayon
 */
function generateRouteSignaturesBatch(
  gpsDataList: GpsData[],
  config: Record<string, unknown> = {}
): RouteSignature[] {
  // Convert to GpsTracks for Rust
  const tracks: GpsTrack[] = gpsDataList.map(({ activityId, latlngs }) => ({
    activityId,
    points: latlngs
      .filter(([lat, lng]) => {
        const validLat = typeof lat === 'number' && !isNaN(lat) && lat >= -90 && lat <= 90;
        const validLng = typeof lng === 'number' && !isNaN(lng) && lng >= -180 && lng <= 180;
        return validLat && validLng;
      })
      .map(([lat, lng]) => ({ latitude: lat, longitude: lng })),
  })).filter(track => track.points.length >= 2);

  if (tracks.length === 0) return [];

  console.log(`🦀🦀🦀 [RouteMatcher] Batch processing ${tracks.length} tracks...`);

  // Call Rust batch processing - parallel in Rust!
  const nativeSignatures = NativeRouteMatcher.createSignaturesBatch(tracks, config);

  // Convert to app format with computed metadata
  return nativeSignatures.map(nativeSig => {
    const routePoints = nativeSig.points.map(p => ({ lat: p.latitude, lng: p.longitude }));

    // Compute bounds
    const lats = routePoints.map(p => p.lat);
    const lngs = routePoints.map(p => p.lng);
    const bounds = {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };

    // Compute hashes
    const startPoint = routePoints[0];
    const endPoint = routePoints[routePoints.length - 1];
    const startRegionHash = encodeGeohash(startPoint.lat, startPoint.lng);
    const endRegionHash = encodeGeohash(endPoint.lat, endPoint.lng);

    // Detect loop
    const startEndDistance = haversineDistance(
      startPoint.lat, startPoint.lng,
      endPoint.lat, endPoint.lng
    );
    const isLoop = startEndDistance < 200;

    return {
      activityId: nativeSig.activityId,
      points: routePoints,
      distance: nativeSig.totalDistance,
      bounds,
      startRegionHash,
      endRegionHash,
      isLoop,
    };
  });
}

/**
 * Convert app RouteSignature format (lat/lng) to native format (latitude/longitude)
 */
function toNativeSignature(sig: RouteSignature): NativeRouteSignature {
  return {
    activityId: sig.activityId,
    points: sig.points.map(p => ({ latitude: p.lat, longitude: p.lng })),
    totalDistance: sig.distance,
    startPoint: { latitude: sig.points[0]?.lat || 0, longitude: sig.points[0]?.lng || 0 },
    endPoint: { latitude: sig.points[sig.points.length - 1]?.lat || 0, longitude: sig.points[sig.points.length - 1]?.lng || 0 },
  };
}

/**
 * Match two routes using native Rust implementation.
 */
function matchRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  config: Record<string, unknown> = {}
): MatchResult | null {
  const nativeSig1 = toNativeSignature(sig1);
  const nativeSig2 = toNativeSignature(sig2);

  const result = NativeRouteMatcher.compareRoutes(nativeSig1, nativeSig2, config);

  if (!result) {
    return null;
  }

  // Map Rust direction to app direction ('forward' -> 'same')
  const direction: MatchDirection = result.direction === 'forward' ? 'same' : result.direction as MatchDirection;

  return {
    matchPercentage: result.matchPercentage,
    direction,
    overlapStart: 0,
    overlapEnd: 1,
    overlapDistance: Math.min(sig1.distance, sig2.distance),
    confidence: result.matchPercentage / 100,
  };
}

/**
 * Determine if two routes should be grouped together.
 */
function shouldGroupRoutes(
  sig1: RouteSignature,
  sig2: RouteSignature,
  matchPercentage: number,
  config: { minMatchPercentage: number; loopThreshold?: number }
): boolean {
  const MIN_ROUTE_DISTANCE = 500; // meters
  if (sig1.distance < MIN_ROUTE_DISTANCE || sig2.distance < MIN_ROUTE_DISTANCE) {
    return false;
  }
  return matchPercentage >= config.minMatchPercentage;
}

/**
 * Create a RouteMatch object from match result.
 */
function createRouteMatch(
  activityId: string,
  routeGroupId: string,
  result: MatchResult
): RouteMatch {
  return {
    activityId,
    routeGroupId,
    matchPercentage: result.matchPercentage,
    direction: result.direction,
    overlapStart: result.direction === 'partial' ? result.overlapStart : undefined,
    overlapEnd: result.direction === 'partial' ? result.overlapEnd : undefined,
    confidence: result.confidence,
  };
}

/**
 * Group signatures using native Rust implementation.
 * No JS fallback - Rust is required.
 */
async function groupSignatures(
  signatures: RouteSignature[],
  config: Record<string, unknown>,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, string[]>> {
  // Convert to native format
  const nativeSignatures = signatures.map(toNativeSignature);

  // Use native Rust implementation (no fallback)
  const nativeGroups: NativeRouteGroup[] = NativeRouteMatcher.groupSignatures(nativeSignatures, config);

  // Convert to Map format expected by the rest of the app
  const result = new Map<string, string[]>();
  for (const group of nativeGroups) {
    result.set(group.groupId, group.activityIds);
  }

  if (onProgress) {
    onProgress(signatures.length, signatures.length);
  }

  return result;
}

// Storage key for processing checkpoint
const ROUTE_PROCESSING_CHECKPOINT_KEY = 'veloq_route_processing_checkpoint';

/**
 * Union-Find helper for grouping activities into routes.
 * When a match is found between A and B, they get merged into the same route.
 */
class RouteUnionFind {
  private parent: Map<string, string> = new Map();
  private activityData: Map<string, { name: string; type: string }> = new Map();
  private routeData: Map<string, {
    previewPoints?: { x: number; y: number }[];
    distance?: number;
    matchPercentages: number[];
  }> = new Map();

  find(id: string): string {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
    }
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // Path compression
    let current = id;
    while (current !== root) {
      const next = this.parent.get(current)!;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  union(id1: string, id2: string, matchPercentage: number): void {
    const root1 = this.find(id1);
    const root2 = this.find(id2);
    if (root1 !== root2) {
      this.parent.set(root2, root1);
      // Merge route data
      const data1 = this.routeData.get(root1) || { matchPercentages: [] };
      const data2 = this.routeData.get(root2) || { matchPercentages: [] };
      data1.matchPercentages.push(...data2.matchPercentages, matchPercentage);
      // Preserve previewPoints and distance from either route
      if (!data1.previewPoints && data2.previewPoints) {
        data1.previewPoints = data2.previewPoints;
      }
      if (!data1.distance && data2.distance) {
        data1.distance = data2.distance;
      }
      this.routeData.set(root1, data1);
    } else {
      // Same route, just add the match percentage
      const data = this.routeData.get(root1) || { matchPercentages: [] };
      data.matchPercentages.push(matchPercentage);
      this.routeData.set(root1, data);
    }
  }

  setActivityData(id: string, name: string, type: string): void {
    this.activityData.set(id, { name, type });
  }

  setRoutePreview(id: string, previewPoints: { x: number; y: number }[], distance: number): void {
    const root = this.find(id);
    const data = this.routeData.get(root) || { matchPercentages: [] };
    if (!data.previewPoints) {
      data.previewPoints = previewPoints;
      data.distance = distance;
    }
    this.routeData.set(root, data);
  }

  getRoutes(): DiscoveredRouteInfo[] {
    // Group all activities by their root
    const groups = new Map<string, string[]>();
    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(id);
    }

    // Convert to DiscoveredRouteInfo
    const routes: DiscoveredRouteInfo[] = [];
    for (const [root, activityIds] of groups) {
      if (activityIds.length < 2) continue; // Skip solo activities

      const data = this.routeData.get(root);
      const firstActivity = this.activityData.get(activityIds[0]);
      const avgMatch = data?.matchPercentages.length
        ? data.matchPercentages.reduce((a, b) => a + b, 0) / data.matchPercentages.length
        : 0;

      routes.push({
        id: root,
        name: firstActivity?.name || 'Unknown Route',
        type: firstActivity?.type || 'Ride',
        activityIds,
        activityNames: activityIds.map(id => this.activityData.get(id)?.name || id),
        activityCount: activityIds.length,
        avgMatchPercentage: avgMatch,
        previewPoints: data?.previewPoints,
        distance: data?.distance,
      });
    }

    // Sort by activity count descending
    return routes.sort((a, b) => b.activityCount - a.activityCount);
  }
}

/** Extract preview points from a signature (normalized to 0-1 range) */
function getPreviewPoints(signature: RouteSignature): { x: number; y: number }[] {
  if (!signature.points || signature.points.length < 2) return [];

  const { minLat, maxLat, minLng, maxLng } = signature.bounds;
  const latRange = maxLat - minLat || 1;
  const lngRange = maxLng - minLng || 1;

  // Sample ~20 points for preview
  const step = Math.max(1, Math.floor(signature.points.length / 20));
  const points: { x: number; y: number }[] = [];

  for (let i = 0; i < signature.points.length; i += step) {
    const pt = signature.points[i];
    points.push({
      x: (pt.lng - minLng) / lngRange,
      y: 1 - (pt.lat - minLat) / latRange, // Flip Y for screen coords
    });
  }

  return points;
}

interface ProcessingCheckpoint {
  pendingIds: string[];
  metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>;
  timestamp: string;
}

type ProgressListener = (progress: RouteProcessingProgress) => void;
type CacheListener = (cache: RouteMatchCache) => void;

class RouteProcessingQueue {
  private static instance: RouteProcessingQueue;

  private cache: RouteMatchCache | null = null;
  private isProcessing = false;
  private shouldCancel = false;
  private progress: RouteProcessingProgress = {
    status: 'idle',
    current: 0,
    total: 0,
  };

  private progressListeners: Set<ProgressListener> = new Set();
  private cacheListeners: Set<CacheListener> = new Set();

  // Throttling for progress updates
  private lastProgressNotify = 0;
  private pendingProgressNotify: ReturnType<typeof setTimeout> | null = null;
  private lastRouteCount = 0;

  // Pending queue for activities that arrive while processing
  private pendingQueue: {
    activityIds: string[];
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>;
    boundsData?: ActivityBoundsItem[];
  } | null = null;

  private constructor() {}

  static getInstance(): RouteProcessingQueue {
    if (!RouteProcessingQueue.instance) {
      RouteProcessingQueue.instance = new RouteProcessingQueue();
    }
    return RouteProcessingQueue.instance;
  }

  // --- Public API ---

  /** Initialize and load existing cache */
  async initialize(): Promise<void> {
    this.cache = await loadRouteCache();
    if (!this.cache) {
      this.cache = createEmptyCache();
    }
    this.notifyCacheListeners();

    // Check for interrupted processing
    await this.resumeFromCheckpoint();
  }

  /** Get current cache */
  getCache(): RouteMatchCache | null {
    return this.cache;
  }

  /** Get current progress */
  getProgress(): RouteProcessingProgress {
    return this.progress;
  }

  /** Subscribe to progress updates */
  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    listener(this.progress);
    return () => this.progressListeners.delete(listener);
  }

  /** Subscribe to cache updates */
  onCacheUpdate(listener: CacheListener): () => void {
    this.cacheListeners.add(listener);
    if (this.cache) listener(this.cache);
    return () => this.cacheListeners.delete(listener);
  }

  /**
   * Queue activities for processing.
   * Uses bounding box pre-filter to only fetch GPS for potential matches.
   *
   * If processing is already in progress, the request is queued and will be
   * processed after the current batch completes.
   *
   * @param activityIds - Activity IDs to process
   * @param metadata - Activity metadata (name, date, type) for grouping
   * @param boundsData - Cached bounds for quick pre-filtering (avoids API calls for isolated routes)
   */
  async queueActivities(
    activityIds: string[],
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>,
    boundsData?: ActivityBoundsItem[]
  ): Promise<void> {
    // If already processing, queue this request for later
    if (this.isProcessing) {
      console.log(`[RouteProcessing] Already processing, queuing ${activityIds.length} activities for later`);
      this.pendingQueue = { activityIds, metadata, boundsData };
      return;
    }

    if (!this.cache) {
      this.cache = createEmptyCache();
    }

    // Filter to GPS activities that haven't been processed
    const gpsActivityIds = activityIds.filter((id) => metadata[id]?.hasGps);
    const unprocessedIds = getUnprocessedActivityIds(this.cache, gpsActivityIds);

    if (unprocessedIds.length === 0) {
      this.setProgress({ status: 'complete', current: 0, total: 0, message: 'All activities processed' });
      // Check if there's a pending queue
      await this.processPendingQueue();
      return;
    }

    // Pre-filter using bounding boxes to identify potential matches
    let candidateIds: string[] = [];
    if (boundsData && boundsData.length > 0) {
      this.setProgress({
        status: 'filtering',
        current: 0,
        total: unprocessedIds.length,
        totalActivities: unprocessedIds.length,
        message: `Checking ${unprocessedIds.length} activities for potential matches...`,
      });

      // Build spatial index if not ready (ensures O(n log n) instead of O(n²))
      if (!activitySpatialIndex.ready) {
        console.log(`[RouteProcessing] Building spatial index from ${boundsData.length} bounds`);
        activitySpatialIndex.buildFromActivities(boundsData);
      }

      // Only consider activities that have cached bounds
      const boundsById = new Map(boundsData.map(b => [b.id, b]));
      const unprocessedWithBounds = unprocessedIds.filter(id => boundsById.has(id));

      console.log(`[RouteProcessing] Total unprocessed: ${unprocessedIds.length}, with bounds: ${unprocessedWithBounds.length}`);

      // Find activities with overlapping bounds (potential route matches)
      // Uses spatial index for O(n log n) instead of O(n²)
      const unprocessedSet = new Set(unprocessedWithBounds);
      const candidateSet = findActivitiesWithPotentialMatchesFast(unprocessedSet, boundsData);
      candidateIds = unprocessedWithBounds.filter((id) => candidateSet.has(id));

      console.log(`[RouteProcessing] Candidates after filtering: ${candidateIds.length}`);

      this.setProgress({
        status: 'filtering',
        current: unprocessedWithBounds.length,
        total: unprocessedWithBounds.length,
        totalActivities: unprocessedWithBounds.length,
        candidatesFound: candidateIds.length,
        message: `Found ${candidateIds.length} candidates from ${unprocessedWithBounds.length} activities with cached bounds`,
      });

      // NOTE: Don't mark non-candidates as "processed" here!
      // They might match with activities from future syncs.
      // Only mark activities as processed AFTER we've analyzed them.

      if (candidateIds.length === 0) {
        this.setProgress({
          status: 'complete',
          current: unprocessedWithBounds.length,
          total: unprocessedWithBounds.length,
          message: 'No matching routes found (no overlapping activities)',
        });
        // Check if there's a pending queue
        await this.processPendingQueue();
        return;
      }
    } else {
      // No bounds data - can't pre-filter, skip processing
      console.log(`[RouteProcessing] No bounds data available, skipping processing`);
      this.setProgress({
        status: 'complete',
        current: 0,
        total: 0,
        message: 'No cached bounds - visit World Map to cache activity bounds first',
      });
      return;
    }

    // Save checkpoint for resume (include metadata for pending activities)
    const pendingMetadata: typeof metadata = {};
    for (const id of candidateIds) {
      if (metadata[id]) {
        pendingMetadata[id] = metadata[id];
      }
    }
    await this.saveCheckpoint({ pendingIds: candidateIds, metadata: pendingMetadata, timestamp: new Date().toISOString() });

    // Start processing only the candidates
    await this.processActivities(candidateIds, metadata);

    // After processing completes, check if there's a pending queue
    await this.processPendingQueue();
  }

  /** Process any pending queue that accumulated while we were busy */
  private async processPendingQueue(): Promise<void> {
    if (this.pendingQueue) {
      const { activityIds, metadata, boundsData } = this.pendingQueue;
      this.pendingQueue = null;
      console.log(`[RouteProcessing] Processing pending queue of ${activityIds.length} activities`);
      await this.queueActivities(activityIds, metadata, boundsData);
    }
  }

  /** Process a single new activity immediately */
  async processActivity(
    activityId: string,
    metadata: { name: string; date: string; type: ActivityType }
  ): Promise<void> {
    if (!this.cache) {
      this.cache = createEmptyCache();
    }

    // Check if already processed
    if (this.cache.processedActivityIds.includes(activityId)) {
      return;
    }

    this.setProgress({ status: 'fetching', current: 0, total: 1, message: 'Fetching GPS data...' });

    try {
      // Fetch GPS stream
      const streams = await intervalsApi.getActivityStreams(activityId, ['latlng']);
      const latlngs = streams.latlng;

      if (!latlngs || latlngs.length === 0) {
        this.setProgress({ status: 'complete', current: 1, total: 1 });
        return;
      }

      this.setProgress({ status: 'processing', current: 0, total: 1, message: 'Generating signature...' });

      // Generate signature
      const signature = generateRouteSignature(activityId, latlngs);

      if (!signature) {
        console.warn(`🦀 [RouteMatcher] Failed to generate signature for ${activityId}`);
        return;
      }

      // Add to cache
      this.cache = addSignaturesToCache(this.cache, [signature]);

      // Find matches against existing signatures
      this.setProgress({ status: 'matching', current: 0, total: 1, message: 'Finding matches...' });

      const existingSignatures = Object.values(this.cache.signatures).filter(
        (s) => s.activityId !== activityId
      );

      for (const existing of existingSignatures) {
        const match = matchRoutes(signature, existing);
        if (match) {
          // Find which group this existing activity belongs to
          const existingMatch = this.cache.matches[existing.activityId];
          if (existingMatch) {
            // Add to existing group
            const routeMatch = createRouteMatch(activityId, existingMatch.routeGroupId, match);
            this.cache = addMatchToCache(this.cache, routeMatch);

            // Update group
            const group = this.cache.groups.find((g) => g.id === existingMatch.routeGroupId);
            if (group && !group.activityIds.includes(activityId)) {
              group.activityIds.push(activityId);
              group.activityCount = group.activityIds.length;
              if (metadata.date > group.lastDate) {
                group.lastDate = metadata.date;
              }
            }
            break;
          }
        }
      }

      // Save cache
      await saveRouteCache(this.cache);
      this.notifyCacheListeners();

      this.setProgress({ status: 'complete', current: 1, total: 1 });
    } catch (error) {
      this.setProgress({
        status: 'error',
        current: 0,
        total: 1,
        message: error instanceof Error ? error.message : 'Failed to process activity',
      });
    }
  }

  /** Cancel current processing */
  cancel(): void {
    this.shouldCancel = true;
  }

  /** Clear all route data */
  async clearCache(): Promise<void> {
    this.cancel();
    this.cache = createEmptyCache();
    await saveRouteCache(this.cache);
    await this.clearCheckpoint();
    this.notifyCacheListeners();
    this.setProgress({ status: 'idle', current: 0, total: 0 });
  }

  /** Re-analyze all activities */
  async reanalyzeAll(
    activityIds: string[],
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>
  ): Promise<void> {
    await this.clearCache();
    await this.queueActivities(activityIds, metadata);
  }

  // --- Private methods ---

  private async processActivities(
    activityIds: string[],
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>
  ): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.shouldCancel = false;

    const total = activityIds.length;
    let processed = 0;
    let matchesFound = 0;
    const newSignatures: RouteSignature[] = [];
    const pendingIds = [...activityIds];
    const processedActivities: ProcessedActivityStatus[] = [];

    // Union-Find for grouping matches into routes
    const routeUnion = new RouteUnionFind();

    // Count existing cached signatures we'll match against
    const cachedSignatureCount = this.cache ? Object.keys(this.cache.signatures).length : 0;

    // Pre-populate activity data for cached signatures
    if (this.cache) {
      for (const sig of Object.values(this.cache.signatures)) {
        const meta = metadata[sig.activityId];
        if (meta) {
          routeUnion.setActivityData(sig.activityId, meta.name, meta.type);
        }
      }
    }

    // Initialize all activities as pending
    for (const id of activityIds) {
      const meta = metadata[id];
      if (meta) {
        processedActivities.push({
          id,
          name: meta.name,
          type: meta.type,
          status: 'pending',
        });
        routeUnion.setActivityData(id, meta.name, meta.type);
      }
    }

    this.setProgress({
      status: 'fetching',
      current: 0,
      total,
      message: `Fetching GPS for ${total} candidates...`,
      processedActivities: processedActivities.slice(-10),
      matchesFound: 0,
      discoveredRoutes: [],
      cachedSignatureCount,
    });

    try {
      // Process in batches for much faster throughput
      // - Parallel API fetching (5 concurrent)
      // - Batch signature creation in Rust (parallel with rayon)
      console.log(`🚀 [RouteProcessing] Starting batch processing: ${activityIds.length} activities, batch size ${BATCH_SIZE}, ${MAX_CONCURRENT} concurrent fetches`);

      for (let batchStart = 0; batchStart < activityIds.length && !this.shouldCancel; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, activityIds.length);
        const batchIds = activityIds.slice(batchStart, batchEnd);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(activityIds.length / BATCH_SIZE);

        // Mark batch as checking
        for (const id of batchIds) {
          const activityStatus = processedActivities.find(a => a.id === id);
          if (activityStatus) {
            activityStatus.status = 'checking';
          }
        }

        this.setProgress({
          status: 'processing',
          current: processed,
          total,
          message: `Batch ${batchNum}/${totalBatches}: Fetching ${batchIds.length} GPS streams...`,
          processedActivities: [...processedActivities],
          matchesFound,
          discoveredRoutes: routeUnion.getRoutes(),
          cachedSignatureCount: cachedSignatureCount + newSignatures.length,
        });

        // Wait for UI before heavy work
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });

        // Fetch GPS streams in parallel (5 concurrent) with real-time progress
        const gpsDataList: GpsData[] = [];
        let batchFetched = 0;
        const fetchResults = await parallelMap(
          batchIds,
          async (id) => {
            try {
              const streams = await intervalsApi.getActivityStreams(id, ['latlng']);
              const latlngs = streams.latlng;
              if (latlngs && latlngs.length > 0) {
                return { activityId: id, latlngs };
              }
              return null;
            } catch {
              return null;
            }
          },
          MAX_CONCURRENT,
          (completedInBatch) => {
            // Real-time progress update within batch
            batchFetched = completedInBatch;
            this.setProgress({
              status: 'processing',
              current: processed + batchFetched,
              total,
              message: `Fetching GPS: ${processed + batchFetched}/${total}`,
              processedActivities: [...processedActivities],
              matchesFound,
              discoveredRoutes: routeUnion.getRoutes(),
              cachedSignatureCount: cachedSignatureCount + newSignatures.length,
            });
          }
        );

        // Collect successful fetches
        for (let i = 0; i < batchIds.length; i++) {
          const id = batchIds[i];
          const result = fetchResults[i];
          const activityStatus = processedActivities.find(a => a.id === id);

          if (result) {
            gpsDataList.push(result);
          } else if (activityStatus) {
            activityStatus.status = 'error';
          }
        }

        // Create signatures in batch using Rust parallel processing
        if (gpsDataList.length > 0) {
          const batchSignatures = generateRouteSignaturesBatch(gpsDataList);

          for (const signature of batchSignatures) {
            newSignatures.push(signature);

            // Set preview for this activity
            const previewPoints = getPreviewPoints(signature);
            routeUnion.setRoutePreview(signature.activityId, previewPoints, signature.distance);

            // Mark as processed
            const activityStatus = processedActivities.find(a => a.id === signature.activityId);
            if (activityStatus) {
              activityStatus.status = 'no-match'; // Will be updated after batch matching
            }
          }

          // Track which activities had no GPS or failed signature creation
          const signatureIds = new Set(batchSignatures.map(s => s.activityId));
          for (const gpsData of gpsDataList) {
            if (!signatureIds.has(gpsData.activityId)) {
              const activityStatus = processedActivities.find(a => a.id === gpsData.activityId);
              if (activityStatus && activityStatus.status === 'checking') {
                activityStatus.status = 'error';
              }
            }
          }
        }

        // Update pending list and counters
        for (const id of batchIds) {
          const idx = pendingIds.indexOf(id);
          if (idx >= 0) pendingIds.splice(idx, 1);
        }
        processed += batchIds.length;

        // Update progress
        this.setProgress({
          status: 'processing',
          current: processed,
          total,
          message: `Batch ${batchNum}/${totalBatches} complete (${gpsDataList.length} signatures created)`,
          processedActivities: [...processedActivities],
          matchesFound,
          discoveredRoutes: routeUnion.getRoutes(),
          cachedSignatureCount: cachedSignatureCount + newSignatures.length,
        });

        // Save signatures after each batch
        if (newSignatures.length > 0 && this.cache) {
          this.cache = addSignaturesToCache(this.cache, newSignatures);
          await saveRouteCache(this.cache);
          this.notifyCacheListeners();
        }

        // Update checkpoint
        await this.updateCheckpointPendingIds(pendingIds, metadata);

        // Small delay for UI responsiveness between batches
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Save remaining signatures
      if (newSignatures.length > 0 && this.cache) {
        this.cache = addSignaturesToCache(this.cache, newSignatures);
        await saveRouteCache(this.cache);
        this.notifyCacheListeners();
      }

      if (this.shouldCancel) {
        this.setProgress({ status: 'idle', current: processed, total });
        return;
      }

      // Now group ONLY the new signatures with existing ones
      // This is incremental - we don't rebuild everything from scratch
      const signatureCount = this.cache ? Object.keys(this.cache.signatures).length : 0;
      this.setProgress({
        status: 'matching',
        current: processed,
        total,
        message: `Grouping ${newSignatures.length} new signatures...`,
        processedActivities: [...processedActivities],
        matchesFound,
        discoveredRoutes: routeUnion.getRoutes(),
        cachedSignatureCount: cachedSignatureCount + newSignatures.length,
      });

      // Allow UI to update before heavy computation
      await new Promise(resolve => setTimeout(resolve, 50));

      if (this.cache && newSignatures.length > 0) {
        // Get existing signatures (already processed before this batch)
        const existingSignatures = Object.values(this.cache.signatures).filter(
          sig => !newSignatures.some(newSig => newSig.activityId === sig.activityId)
        );

        // Only group new signatures with each other AND with existing ones
        // This avoids O(n²) on the entire dataset when adding a few new activities
        const signaturesToGroup = [...existingSignatures, ...newSignatures];
        const groups = await groupSignatures(signaturesToGroup, {}, (completed, total) => {
          // Update progress during grouping to show the UI is responsive
          if (completed % 1000 === 0 || completed === total) {
            const percent = Math.round((completed / total) * 100);
            this.setProgress({
              status: 'matching',
              current: processed,
              total,
              message: `Matching routes... ${percent}%`,
              processedActivities: [...processedActivities],
              matchesFound,
              discoveredRoutes: routeUnion.getRoutes(),
              cachedSignatureCount: cachedSignatureCount + newSignatures.length,
            });
          }
        });

        this.setProgress({
          status: 'matching',
          current: processed,
          total,
          message: `Saving ${groups.size} route groups...`,
          processedActivities: [...processedActivities],
          matchesFound,
          discoveredRoutes: routeUnion.getRoutes(),
          cachedSignatureCount: cachedSignatureCount + newSignatures.length,
        });

        // Allow UI to update
        await new Promise(resolve => setTimeout(resolve, 50));

        // Update cache with groups
        const metadataForGroups: Record<string, { name: string; date: string; type: ActivityType }> = {};
        for (const [id, meta] of Object.entries(metadata)) {
          metadataForGroups[id] = { name: meta.name, date: meta.date, type: meta.type };
        }

        this.cache = updateRouteGroups(this.cache, groups, metadataForGroups);
        await saveRouteCache(this.cache);
        this.notifyCacheListeners();

        // Geocode routes with "Unknown Route" names in background (non-blocking)
        // This runs after cache is saved so UI updates immediately
        this.geocodeUnknownRoutes().catch(() => {
          // Ignore geocoding errors - it's a nice-to-have
        });
      } else if (this.cache && newSignatures.length === 0) {
        // No new signatures, but we still need to ensure groups are up to date
        // This can happen when all candidates were already in cache
        this.notifyCacheListeners();
      }

      // Clear checkpoint on success
      await this.clearCheckpoint();

      const routeCount = this.cache?.groups?.length || 0;
      const finalSignatureCount = this.cache ? Object.keys(this.cache.signatures).length : 0;
      this.setProgress({
        status: 'complete',
        current: total,
        total,
        message: `Found ${routeCount} routes from ${matchesFound} matches`,
        processedActivities: [...processedActivities],
        matchesFound,
        discoveredRoutes: routeUnion.getRoutes(),
        cachedSignatureCount: finalSignatureCount,
      });
    } catch (error) {
      this.setProgress({
        status: 'error',
        current: processed,
        total,
        message: error instanceof Error ? error.message : 'Processing failed',
        processedActivities: [...processedActivities],
        matchesFound,
        discoveredRoutes: routeUnion.getRoutes(),
        cachedSignatureCount: cachedSignatureCount + newSignatures.length,
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async processBatch(
    activityIds: string[],
    metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>
  ): Promise<RouteSignature[]> {
    const signatures: RouteSignature[] = [];

    // Process with limited concurrency
    const chunks: string[][] = [];
    for (let i = 0; i < activityIds.length; i += MAX_CONCURRENT) {
      chunks.push(activityIds.slice(i, i + MAX_CONCURRENT));
    }

    for (const chunk of chunks) {
      if (this.shouldCancel) break;

      const promises = chunk.map(async (id) => {
        try {
          const streams = await intervalsApi.getActivityStreams(id, ['latlng']);
          const latlngs = streams.latlng;

          if (latlngs && latlngs.length > 0) {
            return generateRouteSignature(id, latlngs);
          }
        } catch {
          // Skip failed fetches
        }
        return null;
      });

      const results = await Promise.all(promises);
      for (const sig of results) {
        if (sig) signatures.push(sig);
      }
    }

    return signatures;
  }

  private async saveCheckpoint(checkpoint: ProcessingCheckpoint): Promise<void> {
    try {
      await AsyncStorage.setItem(ROUTE_PROCESSING_CHECKPOINT_KEY, JSON.stringify(checkpoint));
    } catch {
      // Silently fail
    }
  }

  private async updateCheckpointPendingIds(pendingIds: string[], metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }>): Promise<void> {
    try {
      const checkpointStr = await AsyncStorage.getItem(ROUTE_PROCESSING_CHECKPOINT_KEY);
      if (checkpointStr) {
        const checkpoint: ProcessingCheckpoint = JSON.parse(checkpointStr);
        checkpoint.pendingIds = pendingIds;
        // Update metadata for remaining pending IDs
        const updatedMetadata: typeof metadata = {};
        for (const id of pendingIds) {
          if (metadata[id]) {
            updatedMetadata[id] = metadata[id];
          } else if (checkpoint.metadata[id]) {
            updatedMetadata[id] = checkpoint.metadata[id];
          }
        }
        checkpoint.metadata = updatedMetadata;
        checkpoint.timestamp = new Date().toISOString();
        await AsyncStorage.setItem(ROUTE_PROCESSING_CHECKPOINT_KEY, JSON.stringify(checkpoint));
      }
    } catch {
      // Silently fail
    }
  }

  private async clearCheckpoint(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ROUTE_PROCESSING_CHECKPOINT_KEY);
    } catch {
      // Silently fail
    }
  }

  private async resumeFromCheckpoint(): Promise<void> {
    try {
      const checkpointStr = await AsyncStorage.getItem(ROUTE_PROCESSING_CHECKPOINT_KEY);
      if (!checkpointStr) return;

      const checkpoint: ProcessingCheckpoint = JSON.parse(checkpointStr);

      // Clear old checkpoints from before the pre-filter optimization
      // (they would have too many activities)
      if (checkpoint.pendingIds.length > 200) {
        console.log(`[RouteProcessing] Clearing stale checkpoint with ${checkpoint.pendingIds.length} activities (pre-filter not applied)`);
        await this.clearCheckpoint();
        return;
      }

      if (checkpoint.pendingIds.length > 0 && checkpoint.metadata) {
        // Filter to only IDs that still have metadata and haven't been processed
        const stillPending = checkpoint.pendingIds.filter(
          (id) => checkpoint.metadata[id] && !this.cache?.processedActivityIds.includes(id)
        );

        console.log(`[RouteProcessing] Resuming from checkpoint: ${stillPending.length} of ${checkpoint.pendingIds.length} still pending`);

        if (stillPending.length > 0) {
          this.setProgress({
            status: 'idle',
            current: 0,
            total: stillPending.length,
            message: `Resuming: ${stillPending.length} activities pending`,
          });

          // Auto-resume processing after a short delay
          setTimeout(() => {
            this.processActivities(stillPending, checkpoint.metadata);
          }, 1000);
        }
      }
    } catch {
      // Silently fail - clear invalid checkpoint
      await this.clearCheckpoint();
    }
  }

  private setProgress(progress: RouteProcessingProgress, immediate = false): void {
    this.progress = progress;

    const now = Date.now();
    const routeCount = progress.discoveredRoutes?.length || 0;
    const hasNewRoute = routeCount > this.lastRouteCount;
    const isStatusChange = progress.status !== 'processing';

    // Update immediately for: new routes, status changes, or if forced
    if (immediate || hasNewRoute || isStatusChange) {
      this.lastRouteCount = routeCount;
      this.lastProgressNotify = now;
      if (this.pendingProgressNotify) {
        clearTimeout(this.pendingProgressNotify);
        this.pendingProgressNotify = null;
      }
      this.notifyProgressListeners();
      return;
    }

    // Throttle regular progress updates to every 300ms
    const THROTTLE_MS = 300;
    if (now - this.lastProgressNotify < THROTTLE_MS) {
      // Schedule a delayed update if not already scheduled
      if (!this.pendingProgressNotify) {
        this.pendingProgressNotify = setTimeout(() => {
          this.pendingProgressNotify = null;
          this.lastProgressNotify = Date.now();
          this.notifyProgressListeners();
        }, THROTTLE_MS - (now - this.lastProgressNotify));
      }
      return;
    }

    this.lastProgressNotify = now;
    this.notifyProgressListeners();
  }

  private notifyProgressListeners(): void {
    Array.from(this.progressListeners).forEach((listener) => {
      try {
        listener(this.progress);
      } catch {
        // Ignore listener errors
      }
    });
  }

  private notifyCacheListeners(): void {
    Array.from(this.cacheListeners).forEach((listener) => {
      try {
        if (this.cache) listener(this.cache);
      } catch {
        // Ignore listener errors
      }
    });
  }

  /**
   * Geocode routes that have "Unknown Route" as their name.
   * Uses the start and end points of the route to generate a meaningful name.
   * Runs in background and saves after each successful geocode.
   */
  private async geocodeUnknownRoutes(): Promise<void> {
    if (!this.cache) return;

    const routesToGeocode = this.cache.groups.filter(
      (g) => g.name === 'Unknown Route' || g.name.toLowerCase().includes('unknown')
    );

    if (routesToGeocode.length === 0) return;

    // Limit to 5 routes per batch to avoid long delays
    const maxToGeocode = 5;
    const routesBatch = routesToGeocode.slice(0, maxToGeocode);

    console.log(`[RouteProcessing] Geocoding ${routesBatch.length} of ${routesToGeocode.length} routes with unknown names`);

    let geocodedCount = 0;

    // Process one at a time to respect Nominatim rate limits (1 req/sec)
    for (const group of routesBatch) {
      if (this.shouldCancel) break;

      const sig = group.signature;
      if (!sig || !sig.points || sig.points.length < 2) continue;

      const startPoint = sig.points[0];
      const endPoint = sig.points[sig.points.length - 1];

      try {
        const name = await generateRouteName(
          startPoint.lat,
          startPoint.lng,
          endPoint.lat,
          endPoint.lng,
          sig.isLoop ?? false
        );

        if (name) {
          // Update the group name
          group.name = name;
          geocodedCount++;
          console.log(`[RouteProcessing] Geocoded route: "${name}"`);

          // Save cache after each successful geocode
          await saveRouteCache(this.cache);
          this.notifyCacheListeners();
        }

        // Small delay to respect Nominatim rate limits (reduced to 500ms for responsiveness)
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        console.warn(`[RouteProcessing] Failed to geocode route ${group.id}:`, error);
      }
    }

    if (geocodedCount > 0) {
      console.log(`[RouteProcessing] Geocoded ${geocodedCount} routes`);
    }
  }
}

// Export singleton instance
export const routeProcessingQueue = RouteProcessingQueue.getInstance();
