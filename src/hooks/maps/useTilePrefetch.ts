/**
 * Lifecycle hook for offline tile prefetching.
 *
 * Listens for GPS sync completion, then clusters activity regions and
 * downloads tiles for both native 2D maps and WebView 3D maps.
 * Runs daily cleanup of stale tile packs (90-day window).
 *
 * Mount in tab layout so it runs while the app is active.
 */

import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useSyncDateRange, useNetwork, useMapPreferences } from '@/providers';
import { useTileCacheStore } from '@/providers/TileCacheStore';
import { getRouteEngine } from '@/lib/native/routeEngine';
import * as TileCacheService from '@/lib/maps/tileCacheService';
import { debug } from '@/lib';
import type { Bounds } from '@/lib/maps/tileGeometry';

const log = debug.create('TilePrefetch');

/** Delay after sync completion before starting prefetch (ms) */
const PREFETCH_DELAY_MS = 5000;

/** Minimum interval between cleanup runs (24 hours in ms) */
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Get activity bounds from the last 90 days via the Rust engine.
 */
function getRecentActivityBounds(): Array<{ bounds: Bounds }> {
  const engine = getRouteEngine();
  if (!engine) return [];

  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  try {
    const activities = engine.getMapActivitiesFiltered(ninetyDaysAgo, now, []);
    return activities.map((a) => ({
      bounds: {
        minLat: a.bounds.minLat,
        maxLat: a.bounds.maxLat,
        minLng: a.bounds.minLng,
        maxLng: a.bounds.maxLng,
      },
    }));
  } catch {
    return [];
  }
}

export function useTilePrefetch(): void {
  const { gpsSyncProgress } = useSyncDateRange();
  const { isOnline, connectionType } = useNetwork();
  const { preferences } = useMapPreferences();
  const { settings, lastCleanupDate, prefetchStatus } = useTileCacheStore();
  const lastSyncStatusRef = useRef(gpsSyncProgress.status);
  const lastCacheModeRef = useRef(settings.cacheMode);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize ambient cache size on mount
  useEffect(() => {
    TileCacheService.initializeAmbientCache();
  }, []);

  // Watch for sync completion → trigger prefetch
  useEffect(() => {
    const prevStatus = lastSyncStatusRef.current;
    lastSyncStatusRef.current = gpsSyncProgress.status;

    // Only trigger when transitioning to 'complete'
    if (gpsSyncProgress.status !== 'complete' || prevStatus === 'complete') return;
    if (!settings.enabled) return;
    if (!isOnline) return;

    // Wi-Fi only check
    if (settings.wifiOnly && connectionType !== 'WIFI' && connectionType !== 'wifi') return;

    // Clear any pending prefetch
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
    }

    // Delay prefetch to avoid competing with UI rendering
    prefetchTimerRef.current = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        const activities = getRecentActivityBounds();
        if (activities.length === 0) return;

        log.log(`Starting prefetch for ${activities.length} activities`);
        TileCacheService.prefetch(
          activities,
          preferences.defaultStyle,
          preferences.activityTypeStyles
        ).catch((error) => {
          log.error('Prefetch failed:', error);
        });
      });
    }, PREFETCH_DELAY_MS);

    return () => {
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
      }
    };
  }, [
    gpsSyncProgress.status,
    settings.enabled,
    settings.wifiOnly,
    isOnline,
    connectionType,
    preferences.defaultStyle,
    preferences.activityTypeStyles,
  ]);

  // Watch for cache mode change → trigger immediate prefetch
  useEffect(() => {
    const prevMode = lastCacheModeRef.current;
    lastCacheModeRef.current = settings.cacheMode;

    if (prevMode === settings.cacheMode) return;
    if (!settings.enabled) return;
    if (!isOnline) return;
    if (settings.wifiOnly && connectionType !== 'WIFI' && connectionType !== 'wifi') return;
    if (prefetchStatus === 'downloading' || prefetchStatus === 'computing') return;

    // Trigger immediately (no delay) since user explicitly changed mode
    InteractionManager.runAfterInteractions(() => {
      const activities = getRecentActivityBounds();
      if (activities.length === 0) return;

      log.log(`Cache mode changed to ${settings.cacheMode}, starting prefetch`);
      TileCacheService.prefetch(
        activities,
        preferences.defaultStyle,
        preferences.activityTypeStyles
      ).catch((error) => {
        log.error('Mode-change prefetch failed:', error);
      });
    });
  }, [
    settings.cacheMode,
    settings.enabled,
    settings.wifiOnly,
    isOnline,
    connectionType,
    prefetchStatus,
    preferences.defaultStyle,
    preferences.activityTypeStyles,
  ]);

  // Daily cleanup check
  useEffect(() => {
    if (!settings.enabled) return;

    const shouldCleanup =
      !lastCleanupDate || Date.now() - new Date(lastCleanupDate).getTime() > CLEANUP_INTERVAL_MS;

    if (!shouldCleanup) return;

    // Run cleanup after a delay to avoid blocking startup
    const timer = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        const activities = getRecentActivityBounds();
        TileCacheService.cleanup(activities).catch((error) => {
          log.error('Cleanup failed:', error);
        });
      });
    }, 10000);

    return () => clearTimeout(timer);
  }, [settings.enabled, lastCleanupDate]);
}
