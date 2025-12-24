/**
 * Zustand store for route matching state.
 * Provides reactive access to route cache, groups, and processing status.
 *
 * Auto-triggers route processing when bounds sync completes.
 */

import { create } from 'zustand';
import type { RouteMatchCache, RouteProcessingProgress, RouteGroup, RouteMatch, ActivityType } from '@/types';
import { routeProcessingQueue } from '@/lib/routeProcessingQueue';
import { activitySyncManager } from '@/lib/activitySyncManager';
import { isRouteMatchingEnabled } from './RouteSettingsStore';

interface RouteMatchState {
  // State
  cache: RouteMatchCache | null;
  progress: RouteProcessingProgress;
  isInitialized: boolean;

  // Actions
  initialize: () => Promise<void>;
  getRouteGroups: () => RouteGroup[];
  getRouteGroupById: (groupId: string) => RouteGroup | null;
  getRouteGroupForActivity: (activityId: string) => RouteGroup | null;
  getMatchForActivity: (activityId: string) => RouteMatch | null;
  clearCache: () => Promise<void>;
}

export const useRouteMatchStore = create<RouteMatchState>((set, get) => ({
  cache: null,
  progress: { status: 'idle', current: 0, total: 0 },
  isInitialized: false,

  initialize: async () => {
    if (get().isInitialized) return;

    // Subscribe to cache updates
    routeProcessingQueue.onCacheUpdate((cache) => {
      set({ cache });
    });

    // Subscribe to progress updates
    routeProcessingQueue.onProgress((progress) => {
      set({ progress });
    });

    // Subscribe to bounds sync completion to auto-trigger route processing
    activitySyncManager.onInitialSyncComplete(() => {
      // Check if route matching is enabled
      if (!isRouteMatchingEnabled()) {
        console.log('[RouteMatchStore] Route matching disabled, skipping auto-processing');
        return;
      }

      // Get the bounds cache
      const boundsCache = activitySyncManager.getCache();
      if (!boundsCache) return;

      const activities = Object.values(boundsCache.activities);
      if (activities.length === 0) return;

      // Build metadata from bounds cache
      const activityIds = activities.map((a) => a.id);
      const metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }> = {};
      for (const a of activities) {
        metadata[a.id] = {
          name: a.name,
          date: a.date,
          type: a.type,
          hasGps: true, // Bounds cache only contains GPS activities
        };
      }

      console.log(`[RouteMatchStore] Bounds sync complete, triggering route processing for ${activities.length} activities`);

      // Trigger route processing with bounds data for pre-filtering
      routeProcessingQueue.queueActivities(activityIds, metadata, activities);
    });

    // Initialize the queue (loads cache from storage)
    await routeProcessingQueue.initialize();

    const routeCache = routeProcessingQueue.getCache();

    set({
      cache: routeCache,
      progress: routeProcessingQueue.getProgress(),
      isInitialized: true,
    });

    // Auto-resume: Check for unprocessed activities in bounds cache
    // This handles the case where the app was closed before processing completed
    // Only if route matching is enabled
    if (isRouteMatchingEnabled()) {
      const boundsCache = activitySyncManager.getCache();
      if (boundsCache && routeCache) {
        const allBoundsActivities = Object.values(boundsCache.activities);
        const processedSet = new Set(routeCache.processedActivityIds);

        // Find activities that have bounds cached but haven't been route-processed
        const unprocessedActivities = allBoundsActivities.filter(a => !processedSet.has(a.id));

        if (unprocessedActivities.length > 0) {
          console.log(`[RouteMatchStore] Found ${unprocessedActivities.length} unprocessed activities, auto-resuming route analysis`);

          // Build metadata for unprocessed activities
          const activityIds = unprocessedActivities.map((a) => a.id);
          const metadata: Record<string, { name: string; date: string; type: ActivityType; hasGps: boolean }> = {};
          for (const a of unprocessedActivities) {
            metadata[a.id] = {
              name: a.name,
              date: a.date,
              type: a.type,
              hasGps: true,
            };
          }

          // Queue unprocessed activities for analysis
          routeProcessingQueue.queueActivities(activityIds, metadata, unprocessedActivities);
        } else {
          console.log(`[RouteMatchStore] All ${allBoundsActivities.length} cached activities already processed`);
        }
      }
    } else {
      console.log('[RouteMatchStore] Route matching disabled, skipping auto-resume');
    }
  },

  getRouteGroups: () => {
    const { cache } = get();
    if (!cache) return [];
    // Sort by activity count (most used routes first)
    return [...cache.groups].sort((a, b) => b.activityCount - a.activityCount);
  },

  getRouteGroupById: (groupId: string) => {
    const { cache } = get();
    if (!cache) return null;
    return cache.groups.find((g) => g.id === groupId) || null;
  },

  getRouteGroupForActivity: (activityId: string) => {
    const { cache } = get();
    if (!cache) return null;

    const match = cache.matches[activityId];
    if (!match) return null;

    return cache.groups.find((g) => g.id === match.routeGroupId) || null;
  },

  getMatchForActivity: (activityId: string) => {
    const { cache } = get();
    if (!cache) return null;
    return cache.matches[activityId] || null;
  },

  clearCache: async () => {
    await routeProcessingQueue.clearCache();
    set({ cache: routeProcessingQueue.getCache() });
  },
}));

// Initialize route matching (call during app startup)
export async function initializeRouteMatching(): Promise<void> {
  await useRouteMatchStore.getState().initialize();
}

// Helper for synchronous access
export function getRouteMatchCache(): RouteMatchCache | null {
  return useRouteMatchStore.getState().cache;
}
