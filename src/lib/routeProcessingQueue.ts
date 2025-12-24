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
} from '@/types';
import { DEFAULT_ROUTE_MATCH_CONFIG } from '@/types';
import { generateRouteSignature } from './routeSignature';
import { groupSignatures, matchRoutes, createRouteMatch, shouldGroupRoutes } from './routeMatching';
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
import type { ActivityBoundsItem } from '@/types';

// Storage key for processing checkpoint
const ROUTE_PROCESSING_CHECKPOINT_KEY = 'veloq_route_processing_checkpoint';

// Processing configuration
const BATCH_SIZE = 5; // Activities per batch
const INTER_BATCH_DELAY = 100; // ms between batches
const API_CONCURRENCY = 3; // Concurrent API requests (lower than default to preserve UX)

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
      // Process one at a time for better UI feedback
      for (let i = 0; i < activityIds.length; i++) {
        if (this.shouldCancel) break;

        const id = activityIds[i];
        const meta = metadata[id];

        // Update status to checking
        const activityStatus = processedActivities.find(a => a.id === id);
        if (activityStatus) {
          activityStatus.status = 'checking';
        }

        this.setProgress({
          status: 'processing',
          current: processed,
          total,
          message: `Checking: ${meta?.name || id}`,
          processedActivities: [...processedActivities],
          matchesFound,
          discoveredRoutes: routeUnion.getRoutes(),
          currentActivity: meta?.name,
          cachedSignatureCount: cachedSignatureCount + newSignatures.length,
        });

        // Wait for UI interactions to complete
        await new Promise<void>((resolve) => {
          InteractionManager.runAfterInteractions(() => resolve());
        });

        try {
          // Fetch GPS stream
          const streams = await intervalsApi.getActivityStreams(id, ['latlng']);
          const latlngs = streams.latlng;

          if (latlngs && latlngs.length > 0) {
            // Validate latlng data format
            const first = latlngs[0];
            if (first && (Math.abs(first[0]) > 90 || Math.abs(first[1]) > 180)) {
              console.warn(`[RouteProcessing] Activity ${id}: Invalid latlng values - lat=${first[0]}, lng=${first[1]}`);
            }

            // Generate signature
            const signature = generateRouteSignature(id, latlngs);
            newSignatures.push(signature);

            // Set preview for this activity
            const previewPoints = getPreviewPoints(signature);
            routeUnion.setRoutePreview(id, previewPoints, signature.distance);

            // Check if it matches any existing signature
            let foundMatch = false;
            let matchedWithName: string | undefined;

            if (this.cache) {
              const existingSignatures = Object.values(this.cache.signatures);
              for (const existing of existingSignatures) {
                if (existing.activityId === id) continue;
                const match = matchRoutes(signature, existing);
                if (match) {
                  foundMatch = true;
                  matchedWithName = metadata[existing.activityId]?.name;
                  matchesFound++;

                  // Set preview for existing signature if not set
                  const existingMeta = metadata[existing.activityId];
                  if (existingMeta) {
                    routeUnion.setActivityData(existing.activityId, existingMeta.name, existingMeta.type);
                    const existingPreview = getPreviewPoints(existing);
                    routeUnion.setRoutePreview(existing.activityId, existingPreview, existing.distance);
                  }

                  // Only GROUP if routes are truly the same (high match + similar endpoints)
                  // This prevents routes with shared sections from merging together
                  if (shouldGroupRoutes(signature, existing, match.matchPercentage, DEFAULT_ROUTE_MATCH_CONFIG)) {
                    routeUnion.union(id, existing.activityId, match.matchPercentage);
                  }

                  // Don't break - find ALL matches for this activity
                }
              }
            }

            // Update activity status
            if (activityStatus) {
              activityStatus.status = foundMatch ? 'matched' : 'no-match';
              activityStatus.matchedWith = matchedWithName;
            }
          } else {
            if (activityStatus) {
              activityStatus.status = 'no-match';
            }
          }
        } catch {
          if (activityStatus) {
            activityStatus.status = 'error';
          }
        }

        // Remove from pending
        const idx = pendingIds.indexOf(id);
        if (idx >= 0) pendingIds.splice(idx, 1);

        processed++;

        // Update progress with latest status
        this.setProgress({
          status: 'processing',
          current: processed,
          total,
          message: `Processed ${processed}/${total}`,
          processedActivities: [...processedActivities],
          matchesFound,
          discoveredRoutes: routeUnion.getRoutes(),
          currentActivity: meta?.name,
          cachedSignatureCount: cachedSignatureCount + newSignatures.length,
        });

        // Save signatures periodically
        if (newSignatures.length > 0 && processed % 5 === 0 && this.cache) {
          this.cache = addSignaturesToCache(this.cache, newSignatures);
          await saveRouteCache(this.cache);
          this.notifyCacheListeners();
        }

        // Update checkpoint periodically
        if (processed % 10 === 0) {
          await this.updateCheckpointPendingIds(pendingIds, metadata);
        }

        // Small delay for UI responsiveness
        await new Promise((resolve) => setTimeout(resolve, 50));
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
        const groups = groupSignatures(signaturesToGroup);

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
    for (let i = 0; i < activityIds.length; i += API_CONCURRENCY) {
      chunks.push(activityIds.slice(i, i + API_CONCURRENCY));
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
}

// Export singleton instance
export const routeProcessingQueue = RouteProcessingQueue.getInstance();
