/**
 * Singleton manager for activity bounds syncing.
 * Handles:
 * - Single sync queue (prevents overlapping syncs)
 * - Checkpoint persistence (resume after app close)
 * - Debounced timeline syncs
 * - Progress events for UI
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { intervalsApi } from '@/api';
import { formatLocalDate, SYNC, RATE_LIMIT } from '@/lib';
import {
  buildCacheEntry,
  filterGpsActivities,
  filterUncachedActivities,
  mergeCacheEntries,
  sortActivitiesByDateDesc,
} from '@/lib/activityBoundsUtils';
import type { Activity, ActivityBoundsCache, ActivityBoundsItem } from '@/types';

// Storage keys
const CACHE_KEY = 'activity_bounds_cache';
const OLDEST_DATE_KEY = 'oldest_activity_date';
const SYNC_CHECKPOINT_KEY = 'activity_sync_checkpoint';

// Debounce delay for timeline-triggered syncs
const DEBOUNCE_MS = 300;

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

class ActivitySyncManager {
  private static instance: ActivitySyncManager;

  private cache: ActivityBoundsCache | null = null;
  private oldestActivityDate: string | null = null;
  private progress: SyncProgress = { completed: 0, total: 0, status: 'idle' };
  private isInitialized = false;

  // Sync state
  private currentSyncId = 0;
  private abortController: AbortController | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Listeners
  private progressListeners: Set<ProgressListener> = new Set();
  private cacheListeners: Set<CacheListener> = new Set();

  private constructor() {}

  static getInstance(): ActivitySyncManager {
    if (!ActivitySyncManager.instance) {
      ActivitySyncManager.instance = new ActivitySyncManager();
    }
    return ActivitySyncManager.instance;
  }

  // --- Public API ---

  /** Initialize the manager and load cached data */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.setProgress({ completed: 0, total: 0, status: 'loading', message: 'Loading cached data...' });

    try {
      // Load oldest activity date
      const cachedOldestDate = await AsyncStorage.getItem(OLDEST_DATE_KEY);
      if (cachedOldestDate) {
        this.oldestActivityDate = cachedOldestDate;
      } else {
        try {
          const oldest = await intervalsApi.getOldestActivityDate();
          if (oldest) {
            this.oldestActivityDate = oldest;
            await AsyncStorage.setItem(OLDEST_DATE_KEY, oldest);
          }
        } catch {
          // Silently fail - oldest date is optional
        }
      }

      // Load cache
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        this.cache = JSON.parse(cached);
        this.notifyCacheListeners();
      }

      this.isInitialized = true;
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
    this.setProgress({ completed: 0, total: 0, status: 'idle' });
  }

  /** Clear all cached data */
  async clearCache(): Promise<void> {
    this.cancelSync();
    await AsyncStorage.multiRemove([CACHE_KEY, OLDEST_DATE_KEY, SYNC_CHECKPOINT_KEY]);
    this.cache = null;
    this.oldestActivityDate = null;
    this.notifyCacheListeners();
    this.setProgress({ completed: 0, total: 0, status: 'idle' });
  }

  /** Trigger sync for all history */
  syncAllHistory(): void {
    const today = new Date();
    const yearsAgo = new Date(today);
    yearsAgo.setFullYear(yearsAgo.getFullYear() - SYNC.MAX_HISTORY_YEARS);
    this.syncDateRange(formatLocalDate(yearsAgo), formatLocalDate(today), false);
  }

  // --- Private methods ---

  private async executeSyncDateRange(oldest: string, newest: string): Promise<void> {
    // Cancel any existing sync
    if (this.abortController) {
      this.abortController.abort();
    }

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
          this.setProgress({ completed: 0, total: 0, status: 'complete', message: 'No GPS activities found' });
        }
        return;
      }

      // Filter out already cached
      const uncachedActivities = filterUncachedActivities(gpsActivities, this.cache);

      if (uncachedActivities.length === 0) {
        if (!isCancelled()) {
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
        this.setProgress({
          completed: newActivities.length,
          total: newActivities.length,
          status: 'complete',
          message: 'Sync complete',
        });
      }
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (isAbortError || isCancelled()) {
        this.setProgress({ completed: 0, total: 0, status: 'idle' });
        return;
      }
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
    const concurrency = RATE_LIMIT.DEFAULT_CONCURRENCY;
    const newEntries: Record<string, ActivityBoundsItem> = {};
    let completed = 0;
    const pendingIds = activities.map(a => a.id);

    for (let i = 0; i < activities.length; i += concurrency) {
      if (isCancelled()) break;

      const batch = activities.slice(i, i + concurrency);
      const batchIds = batch.map(a => a.id);

      try {
        const batchResults = await intervalsApi.getActivityMapBounds(
          batchIds,
          concurrency,
          undefined,
          abortController.signal
        );

        for (const activity of batch) {
          const mapData = batchResults.get(activity.id);
          if (mapData?.bounds) {
            newEntries[activity.id] = buildCacheEntry(activity, mapData.bounds);
          }
          // Remove from pending
          const idx = pendingIds.indexOf(activity.id);
          if (idx >= 0) pendingIds.splice(idx, 1);
        }

        completed += batchIds.length;

        // Save partial results and checkpoint after each batch
        if (Object.keys(newEntries).length > 0 && !isCancelled()) {
          await this.savePartialResults(newEntries, oldestDate);
          await this.updateCheckpointPendingIds(pendingIds);

          this.setProgress({
            completed,
            total: activities.length,
            status: 'syncing',
            message: `Syncing ${completed}/${activities.length} activities...`,
          });
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
        // Non-abort error - continue with next batch
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
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(updatedCache));
    this.cache = updatedCache;
    this.notifyCacheListeners();
  }

  private async saveCheckpoint(checkpoint: SyncCheckpoint): Promise<void> {
    await AsyncStorage.setItem(SYNC_CHECKPOINT_KEY, JSON.stringify(checkpoint));
  }

  private async updateCheckpointPendingIds(pendingIds: string[]): Promise<void> {
    const checkpointStr = await AsyncStorage.getItem(SYNC_CHECKPOINT_KEY);
    if (checkpointStr) {
      const checkpoint: SyncCheckpoint = JSON.parse(checkpointStr);
      checkpoint.pendingIds = pendingIds;
      checkpoint.timestamp = new Date().toISOString();
      await AsyncStorage.setItem(SYNC_CHECKPOINT_KEY, JSON.stringify(checkpoint));
    }
  }

  private async clearCheckpoint(): Promise<void> {
    await AsyncStorage.removeItem(SYNC_CHECKPOINT_KEY);
  }

  private async resumeFromCheckpoint(): Promise<void> {
    try {
      const checkpointStr = await AsyncStorage.getItem(SYNC_CHECKPOINT_KEY);
      if (!checkpointStr) return;

      const checkpoint: SyncCheckpoint = JSON.parse(checkpointStr);

      // Only resume if there are pending items
      if (checkpoint.pendingIds.length === 0) {
        await this.clearCheckpoint();
        return;
      }

      // Resume sync - fetch pending activities and process them
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
        this.setProgress({ completed: 0, total: 0, status: 'idle' });
        return;
      }

      await this.processBatches(pendingActivities, checkpoint.oldest, abortController, syncId);

      if (!isCancelled()) {
        await this.clearCheckpoint();
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
