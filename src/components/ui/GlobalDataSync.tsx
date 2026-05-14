/**
 * Global GPS data sync component (headless).
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * Posts native OS notifications for sync progress instead of rendering an in-app banner.
 */

import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  useActivities,
  useRouteDataSync,
  useActivityBoundsCache,
  isInfiniteActivitiesStale,
} from '@/hooks';
import { queryKeys } from '@/lib/queryKeys';
import { onSyncComplete } from '@/lib/backup';
import { intervalsApi } from '@/api';
import {
  getRouteEngine,
  applyDetectionPreset,
  getDetectionPresetByValue,
} from '@/lib/native/routeEngine';
import { toActivityMetrics } from '@/lib/utils/activityMetrics';
import { useAuthStore, useRouteSettings, useSyncDateRange } from '@/providers';
import {
  formatGpsSyncProgress,
  formatBoundsSyncProgress,
  formatTerrainSnapshotProgress,
} from '@/lib/utils/syncProgressFormat';
import {
  updateSyncNotification,
  dismissSyncNotification,
} from '@/lib/notifications/notificationService';

export function GlobalDataSync() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { settings: routeSettings } = useRouteSettings();

  // Get sync date range from global store (can be extended by timeline sliders)
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const setFetchingExtended = useSyncDateRange((s) => s.setFetchingExtended);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);
  const delayedUnlockExpansion = useSyncDateRange((s) => s.delayedUnlockExpansion);

  // Startup alignment: invalidate activities on mount to force a fresh API fetch.
  useEffect(() => {
    if (isAuthenticated) {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      if (isInfiniteActivitiesStale(queryClient)) {
        queryClient.resetQueries({ queryKey: queryKeys.activities.infinite.all });
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.wellness.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Single fetch with stats included — provides both GPS sync data and
  // TSS/FTP metrics for the engine. Previously two separate fetches were made
  // (one without stats, one with), doubling the API calls on every launch.
  const { data: activities, isFetching } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: true,
    enabled: isAuthenticated,
  });

  // Update engine with enhanced metrics (TSS, FTP) when stats-enriched data arrives.
  // The GPS sync stores basic metrics; this backfills the engine so period
  // comparisons use TSS and FTP trend works.
  const statsSeededRef = useRef(false);
  useEffect(() => {
    if (!activities?.length || statsSeededRef.current) return;
    const engine = getRouteEngine();
    if (!engine) return;

    const enhanced = activities
      .filter((a) => a.icu_training_load != null || a.icu_ftp != null)
      .map(toActivityMetrics);

    if (enhanced.length > 0) {
      engine.setActivityMetrics(enhanced);
      engine.triggerRefresh('activities');
      statsSeededRef.current = true;
    }
  }, [activities]);

  // Apply persisted detection strictness to the Rust engine on first mount.
  const strictnessAppliedRef = useRef(false);
  useEffect(() => {
    if (strictnessAppliedRef.current) return;
    const engine = getRouteEngine();
    if (!engine) return;
    const { detectionStrictness } = routeSettings;
    if (detectionStrictness !== 60) {
      applyDetectionPreset(getDetectionPresetByValue(detectionStrictness));
    }
    strictnessAppliedRef.current = true;
  }, [routeSettings]);

  // Update fetching state in store
  useEffect(() => {
    setFetchingExtended(isFetching);
  }, [isFetching, setFetchingExtended]);

  // Use the route data sync hook to automatically sync GPS data.
  // Always enabled — GPS tracks are needed for heatmap even when route matching is off.
  // Section detection is gated separately in useGpsDataFetcher.
  const { progress, isSyncing } = useRouteDataSync(activities, true);

  // Invalidate caches when sync completes so data refreshes
  useEffect(() => {
    if (progress.status === 'complete') {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.wellness.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.powerCurve.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.paceCurve.all });
      onSyncComplete();

      // Seed pace snapshots for trend tracking (fire-and-forget).
      // pace_history is normally only populated when viewing the pace curve screen.
      // Seeding here ensures a baseline exists after first sync so pace milestones
      // can appear once critical speed changes.
      (async () => {
        try {
          const engine = getRouteEngine();
          if (!engine) return;
          const sportTypes = engine.getAvailableSportTypes?.() ?? [];
          const todayTs = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

          for (const sport of ['Run', 'Swim'] as const) {
            if (!sportTypes.includes(sport)) continue;
            const curve = await intervalsApi.getPaceCurve({ sport, days: 42 });
            if (curve?.criticalSpeed && curve.criticalSpeed > 0) {
              engine.savePaceSnapshot(
                sport,
                curve.criticalSpeed,
                curve.dPrime ?? undefined,
                curve.r2 ?? undefined,
                todayTs
              );
            }
          }
        } catch {
          // best-effort — pace milestone will still work when user visits pace curve
        }
      })();
    }
  }, [progress.status, queryClient]);

  // Unlock expansion after sync completes (with delay to let UI stabilize)
  useEffect(() => {
    if (progress.status === 'complete' && isExpansionLocked) {
      delayedUnlockExpansion();
    }
  }, [progress.status, isExpansionLocked, delayedUnlockExpansion]);

  // Bounds sync progress
  const { progress: boundsProgress } = useActivityBoundsCache();

  // Terrain snapshot rendering progress
  const terrainSnapshotProgress = useSyncDateRange((s) => s.terrainSnapshotProgress);

  // GPS sync display info
  const gpsDisplayInfo = useMemo(
    () => formatGpsSyncProgress(progress, isFetching && !isSyncing, t),
    [progress, isFetching, isSyncing, t]
  );

  // Bounds sync display info
  const boundsDisplayInfo = useMemo(
    () => formatBoundsSyncProgress(boundsProgress, t),
    [boundsProgress, t]
  );

  // Terrain snapshot display info
  const terrainDisplayInfo = useMemo(
    () => formatTerrainSnapshotProgress(terrainSnapshotProgress, t),
    [terrainSnapshotProgress, t]
  );

  // Pick which info to show — GPS sync > bounds sync > terrain
  const displayInfo = gpsDisplayInfo ?? boundsDisplayInfo ?? terrainDisplayInfo;

  // Debounce sync notification: indeterminate states (like "Loading activities..."
  // during a background refetch) only post after 1.5s — if the fetch completes
  // within that window the notification never shows. Determinate states (with real
  // progress) post immediately so the user sees forward motion.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postNotification = useCallback((body: string) => {
    updateSyncNotification(body);
  }, []);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (displayInfo !== null) {
      const body = displayInfo.countText
        ? `${displayInfo.text}... ${displayInfo.countText}`
        : `${displayInfo.text}...`;

      if (displayInfo.indeterminate) {
        debounceTimerRef.current = setTimeout(() => {
          postNotification(body);
        }, 1500);
      } else {
        postNotification(body);
      }
    } else {
      dismissSyncNotification();
    }

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [displayInfo, postNotification]);

  // Dismiss notification on unmount
  useEffect(() => {
    return () => {
      dismissSyncNotification();
    };
  }, []);

  return null;
}
