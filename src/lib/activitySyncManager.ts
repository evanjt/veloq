/**
 * Singleton manager for activity bounds syncing.
 * Handles:
 * - Single sync queue (prevents overlapping syncs)
 * - Checkpoint persistence (resume after app close)
 * - Debounced timeline syncs
 * - Progress events for UI
 * - Spatial index maintenance for O(log n) queries
 *
 * State Machine:
 * ```
 * UNINITIALIZED ─────► INITIALIZING ─────► IDLE ◄──────► SYNCING
 *                            │               │              │
 *                            └───────► ERROR ◄──────────────┘
 * ```
 * - UNINITIALIZED: Initial state, hasn't loaded from storage
 * - INITIALIZING: Loading cached data from AsyncStorage
 * - IDLE: Ready, no sync in progress
 * - SYNCING: Actively fetching activity bounds
 * - ERROR: A recoverable error occurred (can retry)
 */

import { intervalsApi } from '@/api';
import { getStoredCredentials } from '@/providers';
import { formatLocalDate } from '@/lib/format';
import { SYNC } from '@/lib/constants';
import { debug } from '@/lib/debug';
import {
  buildCacheEntry,
  filterGpsActivities,
  filterUncachedActivities,
  mergeCacheEntries,
  sortActivitiesByDateDesc,
} from '@/lib/activityBoundsUtils';
import {
  storeGpsTracks,
  clearAllGpsTracks,
  storeBoundsCache,
  loadBoundsCache,
  storeOldestDate,
  loadOldestDate,
  storeCheckpoint,
  loadCheckpoint,
  clearCheckpoint as clearCheckpointFile,
  clearBoundsCache,
} from '@/lib/gpsStorage';
import { clearRouteCache } from '@/lib/routeStorage';
import { activitySpatialIndex } from '@/lib/spatialIndex';
import {
  fetchActivityMapsWithProgress,
  addFetchProgressListener,
  type FetchProgressEvent,
} from 'route-matcher-native';
import type { Activity, ActivityBoundsCache, ActivityBoundsItem } from '@/types';

const log = debug.create('SyncManager');

// Debounce delay for timeline-triggered syncs
const DEBOUNCE_MS = 300;

/**
 * Sync manager state machine states.
 * Each state has clear entry/exit conditions and valid transitions.
 */
export type SyncState = 'uninitialized' | 'initializing' | 'idle' | 'syncing' | 'error';

/**
 * Valid state transitions - used to validate and log state changes.
 */
const VALID_TRANSITIONS: Record<SyncState, SyncState[]> = {
  uninitialized: ['initializing'],
  initializing: ['idle', 'error'],
  idle: ['syncing', 'uninitialized'], // uninitialized for reset()
  syncing: ['idle', 'error', 'syncing'], // syncing→syncing for new sync cancelling old
  error: ['idle', 'syncing', 'uninitialized'], // can retry or reset
};

export interface SyncProgress {
  completed: number;
  total: number;
  status: 'idle' | 'loading' | 'syncing' | 'complete' | 'error';
  message?: string;
}

interface SyncCheckpoint {
  /** Date range being synced */
  oldest: string;
  newest: string;
  /** Activity IDs that still need to be processed */
  pendingIds: string[];
  /** Last update timestamp */
  timestamp: string;
}

type ProgressListener = (progress: SyncProgress) => void;
type CacheListener = (cache: ActivityBoundsCache | null) => void;
type CompletionListener = () => void;
/** Called when new activities are synced (with their IDs) */
type NewActivitiesListener = (activityIds: string[]) => void;

class ActivitySyncManager {
  private static instance: ActivitySyncManager;

  private cache: ActivityBoundsCache | null = null;
  private oldestActivityDate: string | null = null;
  private progress: SyncProgress = { completed: 0, total: 0, status: 'idle' };

  // State machine - single source of truth for manager state
  private state: SyncState = 'uninitialized';
  private hasCompletedInitialSync = false;

  // Sync operation tracking
  private currentSyncId = 0;
  private abortController: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Listeners
  private progressListeners: Set<ProgressListener> = new Set();
  private cacheListeners: Set<CacheListener> = new Set();
  private completionListeners: Set<CompletionListener> = new Set();
  private newActivitiesListeners: Set<NewActivitiesListener> = new Set();

  private constructor() {}

  /**
   * Transition to a new state with validation.
   * Logs invalid transitions in dev mode for debugging.
   */
  private transition(newState: SyncState): boolean {
    const validNextStates = VALID_TRANSITIONS[this.state];
    if (!validNextStates.includes(newState)) {
      log.warn(`Invalid state transition: ${this.state} → ${newState}`);
      return false;
    }
    log.log(`State: ${this.state} → ${newState}`);
    this.state = newState;
    return true;
  }

  /** Get current state machine state */
  getState(): SyncState {
    return this.state;
  }

  static getInstance(): ActivitySyncManager {
    if (!ActivitySyncManager.instance) {
      ActivitySyncManager.instance = new ActivitySyncManager();
    }
    return ActivitySyncManager.instance;
  }

  // --- Public API ---

  /** Initialize the manager and load cached data */
  async initialize(): Promise<void> {
    // Prevent concurrent initialization - only proceed from uninitialized state
    if (this.state !== 'uninitialized') {
      return;
    }

    if (!this.transition('initializing')) {
      return;
    }
    this.setProgress({ completed: 0, total: 0, status: 'loading', message: 'Loading cached data...' });

    try {
      // Load oldest activity date
      const cachedOldestDate = await loadOldestDate();
      if (cachedOldestDate) {
        this.oldestActivityDate = cachedOldestDate;
      } else {
        try {
          const oldest = await intervalsApi.getOldestActivityDate();
          if (oldest) {
            this.oldestActivityDate = oldest;
            await storeOldestDate(oldest);
          }
        } catch {
          // Silently fail - oldest date is optional
        }
      }

      // Load cache from FileSystem
      const parsedCache = await loadBoundsCache<ActivityBoundsCache>();
      if (parsedCache) {
        this.cache = parsedCache;
        this.notifyCacheListeners();

        // Build spatial index from cached activities
        const activities = Object.values(parsedCache.activities);
        if (activities.length > 0) {
          activitySpatialIndex.buildFromActivities(activities);
        }
      }

      this.transition('idle');
      this.setProgress({ completed: 0, total: 0, status: 'idle' });

      // Check for interrupted sync and resume
      await this.resumeFromCheckpoint();

      // If we have cache, sync new activities since last sync
      if (this.cache) {
        const lastSync = new Date(this.cache.lastSync);
        const now = new Date();
        const daysSinceSync = Math.floor((now.getTime() - lastSync.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceSync > 0) {
          this.syncDateRange(this.cache.lastSync, formatLocalDate(now), false);
        }
      } else {
        // No cache - do initial sync
        const today = new Date();
        const daysAgo = new Date(today);
        daysAgo.setDate(daysAgo.getDate() - SYNC.INITIAL_DAYS);
        await this.syncDateRange(formatLocalDate(daysAgo), formatLocalDate(today), false);
      }
    } catch {
      this.transition('error');
      this.setProgress({ completed: 0, total: 0, status: 'error', message: 'Failed to initialize' });
    }
  }

  /** Get current cache */
  getCache(): ActivityBoundsCache | null {
    return this.cache;
  }

  /** Get oldest activity date from API */
  getOldestActivityDate(): string | null {
    return this.oldestActivityDate;
  }

  /** Get current progress */
  getProgress(): SyncProgress {
    return this.progress;
  }

  /** Subscribe to progress updates */
  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    // Immediately call with current state
    listener(this.progress);
    return () => this.progressListeners.delete(listener);
  }

  /** Subscribe to cache updates */
  onCacheUpdate(listener: CacheListener): () => void {
    this.cacheListeners.add(listener);
    // Immediately call with current state
    listener(this.cache);
    return () => this.cacheListeners.delete(listener);
  }

  /** Subscribe to initial sync completion (for triggering route processing) */
  onInitialSyncComplete(listener: CompletionListener): () => void {
    this.completionListeners.add(listener);
    // If already completed, call immediately
    if (this.hasCompletedInitialSync) {
      listener();
    }
    return () => this.completionListeners.delete(listener);
  }

  /** Subscribe to new activities being synced (fires after each sync with new activities) */
  onNewActivitiesSynced(listener: NewActivitiesListener): () => void {
    this.newActivitiesListeners.add(listener);
    return () => this.newActivitiesListeners.delete(listener);
  }

  /** Check if initial sync has completed */
  hasInitialSyncCompleted(): boolean {
    return this.hasCompletedInitialSync;
  }

  private notifyCompletionListeners(): void {
    this.hasCompletedInitialSync = true;
    for (const listener of this.completionListeners) {
      listener();
    }
  }

  /** Notify listeners of newly synced activities (triggers route processing for new activities) */
  private notifyNewActivitiesListeners(activityIds: string[]): void {
    if (activityIds.length === 0) return;
    log.log(`Notifying ${this.newActivitiesListeners.size} listeners of ${activityIds.length} new activities`);
    for (const listener of this.newActivitiesListeners) {
      listener(activityIds);
    }
  }

  /**
   * Sync a date range. Debounced by default for timeline scrubbing.
   * @param oldest - Start date (YYYY-MM-DD)
   * @param newest - End date (YYYY-MM-DD)
   * @param debounce - Whether to debounce (default true for UI calls)
   */
  syncDateRange(oldest: string, newest: string, debounce = true): void {
    if (debounce) {
      // Clear existing debounce timer
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.executeSyncDateRange(oldest, newest);
      }, DEBOUNCE_MS);
    } else {
      this.executeSyncDateRange(oldest, newest);
    }
  }

  /** Cancel current sync */
  cancelSync(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // Only transition if we were syncing
    if (this.state === 'syncing') {
      this.transition('idle');
    }
    this.setProgress({ completed: 0, total: 0, status: 'idle' });
  }

  /** Clear all cached data (preserves oldest activity date for timeline) */
  async clearCache(): Promise<void> {
    this.cancelSync();
    // Clear bounds cache and checkpoint (keep oldest date for timeline extent)
    await clearBoundsCache();
    await clearCheckpointFile();
    // Also clear GPS tracks stored separately
    await clearAllGpsTracks();
    // Clear route cache too - GPS data is needed for route signatures
    // If GPS is cleared but routes remain, signatures can't restore their points
    await clearRouteCache();
    this.cache = null;
    activitySpatialIndex.clear();
    this.notifyCacheListeners();
    this.setProgress({ completed: 0, total: 0, status: 'idle' });
  }

  /** Reset initialization state (call on logout to allow re-initialization on next login) */
  reset(): void {
    this.cancelSync();
    this.transition('uninitialized');
    this.hasCompletedInitialSync = false;
    this.setProgress({ completed: 0, total: 0, status: 'idle' });
  }

  /** Trigger sync for all history (10 years) */
  syncAllHistory(): void {
    const today = new Date();
    const yearsAgo = new Date(today);
    yearsAgo.setFullYear(yearsAgo.getFullYear() - SYNC.MAX_HISTORY_YEARS);
    this.syncDateRange(formatLocalDate(yearsAgo), formatLocalDate(today), false);
  }

  /** Trigger sync for the last year only */
  syncOneYear(): void {
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    this.syncDateRange(formatLocalDate(oneYearAgo), formatLocalDate(today), false);
  }

  /** Trigger sync for the last 90 days (used for cache reload) */
  sync90Days(): void {
    const today = new Date();
    const daysAgo = new Date(today);
    daysAgo.setDate(daysAgo.getDate() - 90);
    this.syncDateRange(formatLocalDate(daysAgo), formatLocalDate(today), false);
  }

  // --- Private methods ---

  private async executeSyncDateRange(oldest: string, newest: string): Promise<void> {
    // Cancel any existing sync
    if (this.abortController) {
      this.abortController.abort();
    }

    // Transition to syncing state
    this.transition('syncing');

    const abortController = new AbortController();
    this.abortController = abortController;
    this.currentSyncId += 1;
    const syncId = this.currentSyncId;

    const isCancelled = () => abortController.signal.aborted || syncId !== this.currentSyncId;

    try {
      this.setProgress({ completed: 0, total: 0, status: 'syncing', message: 'Fetching activities...' });

      // Get activities for date range
      const activities = await intervalsApi.getActivities({ oldest, newest });

      if (isCancelled()) return;

      // Filter to GPS-enabled activities
      const gpsActivities = filterGpsActivities(activities);

      if (gpsActivities.length === 0) {
        if (!isCancelled()) {
          this.transition('idle');
          this.setProgress({ completed: 0, total: 0, status: 'complete', message: 'No GPS activities found' });
        }
        return;
      }

      // Filter out already cached
      const uncachedActivities = filterUncachedActivities(gpsActivities, this.cache);

      if (uncachedActivities.length === 0) {
        if (!isCancelled()) {
          this.transition('idle');
          this.setProgress({ completed: 0, total: 0, status: 'complete', message: 'All activities already cached' });
        }
        return;
      }

      // Sort by date (newest first) for coherent partial syncs
      const newActivities = sortActivitiesByDateDesc(uncachedActivities);
      const pendingIds = newActivities.map(a => a.id);

      // Save checkpoint for resume
      await this.saveCheckpoint({ oldest, newest, pendingIds, timestamp: new Date().toISOString() });

      if (!isCancelled()) {
        this.setProgress({
          completed: 0,
          total: newActivities.length,
          status: 'syncing',
          message: `Syncing ${newActivities.length} activities...`,
        });
      }

      // Process in batches
      await this.processBatches(newActivities, oldest, abortController, syncId);

      // Clear checkpoint on successful completion
      if (!isCancelled()) {
        await this.clearCheckpoint();
        this.transition('idle');
        this.setProgress({
          completed: newActivities.length,
          total: newActivities.length,
          status: 'complete',
          message: 'Sync complete',
        });
        // Notify listeners that initial sync is complete (triggers route processing)
        this.notifyCompletionListeners();
      }
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (isAbortError || isCancelled()) {
        this.transition('idle');
        this.setProgress({ completed: 0, total: 0, status: 'idle' });
        return;
      }
      this.transition('error');
      this.setProgress({ completed: 0, total: 0, status: 'error', message: 'Failed to sync activities' });
    }
  }

  private async processBatches(
    activities: Activity[],
    oldestDate: string,
    abortController: AbortController,
    syncId: number
  ): Promise<void> {
    const isCancelled = () => abortController.signal.aborted || syncId !== this.currentSyncId;
    const newEntries: Record<string, ActivityBoundsItem> = {};
    const pendingIds = activities.map(a => a.id);
    const activityMap = new Map(activities.map(a => [a.id, a]));

    try {
      // Get API key for Rust HTTP client
      const { apiKey } = getStoredCredentials();
      if (!apiKey) {
        throw new Error('No API key available');
      }

      // Fetch ALL activities using Rust HTTP client with real-time progress
      const allIds = activities.map(a => a.id);
      log.log(`Fetching ${allIds.length} activities via Rust HTTP client...`);
      const startTime = Date.now();

      // Set up progress listener for real-time updates during fetch
      const progressSubscription = addFetchProgressListener((event: FetchProgressEvent) => {
        this.setProgress({
          completed: event.completed,
          total: event.total,
          status: 'syncing',
          message: `Downloading ${event.completed}/${event.total} activities...`,
        });
      });

      // Call Rust with progress - this handles rate limiting and parallel fetching internally
      // Note: This is async so JS thread is free to process progress events
      let results;
      try {
        results = await fetchActivityMapsWithProgress(apiKey, allIds);
      } finally {
        // Always clean up the listener
        progressSubscription.remove();
      }

      const elapsed = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;
      log.log(`Rust fetch complete: ${successCount}/${allIds.length} in ${elapsed}ms (${(allIds.length / (elapsed / 1000)).toFixed(1)} req/s)`);

      if (isCancelled()) return;

      // Process all results - store GPS tracks separately to avoid size limits
      const gpsTracks = new Map<string, [number, number][]>();

      for (const result of results) {
        const activity = activityMap.get(result.activityId);
        if (!activity) continue;

        if (result.success && result.bounds.length === 4) {
          // Convert flat bounds [ne_lat, ne_lng, sw_lat, sw_lng] to [[minLat, minLng], [maxLat, maxLng]]
          const [neLat, neLng, swLat, swLng] = result.bounds;
          // Compute actual min/max (API might have ne/sw swapped for southern hemisphere)
          const minLat = Math.min(neLat, swLat);
          const maxLat = Math.max(neLat, swLat);
          const minLng = Math.min(neLng, swLng);
          const maxLng = Math.max(neLng, swLng);
          const bounds: [[number, number], [number, number]] = [
            [minLat, minLng],
            [maxLat, maxLng],
          ];

          // Store bounds/metadata in main cache (small)
          newEntries[activity.id] = buildCacheEntry(activity, bounds);

          // Collect GPS tracks for separate storage (large)
          if (result.latlngs.length > 0) {
            const latlngs: [number, number][] = [];
            for (let i = 0; i < result.latlngs.length; i += 2) {
              latlngs.push([result.latlngs[i], result.latlngs[i + 1]]);
            }
            if (latlngs.length > 0) {
              gpsTracks.set(activity.id, latlngs);
            }
          }
        }

        const idx = pendingIds.indexOf(activity.id);
        if (idx >= 0) pendingIds.splice(idx, 1);

        // Update progress
        this.setProgress({
          completed: activities.length - pendingIds.length,
          total: activities.length,
          status: 'syncing',
          message: `Processing ${activities.length - pendingIds.length}/${activities.length} activities...`,
        });
      }

      // Final save - GPS tracks stored separately to avoid AsyncStorage size limits
      if (Object.keys(newEntries).length > 0 && !isCancelled()) {
        // Store GPS tracks first (in batches, won't exceed size limit)
        if (gpsTracks.size > 0) {
          await storeGpsTracks(gpsTracks);
        }

        // Store metadata cache (small, fast)
        await this.savePartialResults(newEntries, oldestDate);
        await this.updateCheckpointPendingIds(pendingIds);

        // Notify listeners of newly synced activities (for route processing)
        const newActivityIds = Object.keys(newEntries);
        this.notifyNewActivitiesListeners(newActivityIds);
      }
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (isAbortError || isCancelled()) {
        // Save what we have before exiting
        if (Object.keys(newEntries).length > 0) {
          await this.savePartialResults(newEntries, oldestDate);
        }
        throw error;
      }
      log.error('Sync error:', error);
      // Non-abort error - save partial and continue
      if (Object.keys(newEntries).length > 0) {
        await this.savePartialResults(newEntries, oldestDate);
      }
    }
  }

  private async savePartialResults(entries: Record<string, ActivityBoundsItem>, oldest: string): Promise<void> {
    const updatedCache = mergeCacheEntries(
      this.cache,
      entries,
      formatLocalDate(new Date()),
      oldest
    );
    await storeBoundsCache(updatedCache);
    this.cache = updatedCache;
    this.notifyCacheListeners();

    // Update spatial index incrementally with new entries
    const newActivities = Object.values(entries);
    if (newActivities.length > 0) {
      activitySpatialIndex.bulkInsert(newActivities);
    }
  }

  private async saveCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
    await storeCheckpoint(checkpoint);
  }

  private async updateCheckpointPendingIds(pendingIds: string[]): Promise<void> {
    const checkpoint = await loadCheckpoint<SyncCheckpoint>();
    if (checkpoint) {
      checkpoint.pendingIds = pendingIds;
      checkpoint.timestamp = new Date().toISOString();
      await storeCheckpoint(checkpoint);
    }
  }

  private async clearCheckpoint(): Promise<void> {
    await clearCheckpointFile();
  }

  private async resumeFromCheckpoint(): Promise<void> {
    try {
      const checkpoint = await loadCheckpoint<SyncCheckpoint>();
      if (!checkpoint) return;

      // Only resume if there are pending items
      if (checkpoint.pendingIds.length === 0) {
        await this.clearCheckpoint();
        return;
      }

      // Transition to syncing for resume
      this.transition('syncing');
      this.setProgress({
        completed: 0,
        total: checkpoint.pendingIds.length,
        status: 'syncing',
        message: `Resuming sync: ${checkpoint.pendingIds.length} remaining...`,
      });

      const abortController = new AbortController();
      this.abortController = abortController;
      this.currentSyncId += 1;
      const syncId = this.currentSyncId;

      const isCancelled = () => abortController.signal.aborted || syncId !== this.currentSyncId;

      // We need activity data for the pending IDs
      // Fetch activities in the date range to get their metadata
      const activities = await intervalsApi.getActivities({
        oldest: checkpoint.oldest,
        newest: checkpoint.newest,
      });

      if (isCancelled()) return;

      // Filter to only pending IDs
      const pendingSet = new Set(checkpoint.pendingIds);
      const pendingActivities = activities.filter(a => pendingSet.has(a.id));

      if (pendingActivities.length === 0) {
        await this.clearCheckpoint();
        this.transition('idle');
        this.setProgress({ completed: 0, total: 0, status: 'idle' });
        return;
      }

      await this.processBatches(pendingActivities, checkpoint.oldest, abortController, syncId);

      if (!isCancelled()) {
        await this.clearCheckpoint();
        this.transition('idle');
        this.setProgress({
          completed: pendingActivities.length,
          total: pendingActivities.length,
          status: 'complete',
          message: 'Resume complete',
        });
      }
    } catch {
      // Failed to resume - clear checkpoint and continue
      await this.clearCheckpoint();
      this.transition('idle');
      this.setProgress({ completed: 0, total: 0, status: 'idle' });
    }
  }

  private setProgress(progress: SyncProgress): void {
    this.progress = progress;
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
        listener(this.cache);
      } catch {
        // Ignore listener errors
      }
    });
  }
}

// Export singleton instance
export const activitySyncManager = ActivitySyncManager.getInstance();
