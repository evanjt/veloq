/**
 * Global GPS data sync component (headless).
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * Posts native OS notifications for sync progress instead of rendering an in-app banner.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  useActivities,
  useRouteDataSync,
  useActivityBoundsCache,
  isInfiniteActivitiesStale,
} from '@/hooks';
import { onSyncComplete } from '@/lib/backup';
import { intervalsApi } from '@/api';
import { getRouteEngine } from '@/lib/native/routeEngine';
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
    if (isAuthenticated && routeSettings.enabled) {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      if (isInfiniteActivitiesStale(queryClient)) {
        queryClient.resetQueries({ queryKey: ['activities-infinite'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['activities-infinite'] });
      }
      queryClient.invalidateQueries({ queryKey: ['wellness'] });
      queryClient.invalidateQueries({ queryKey: ['athlete-summary'] });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch activities for GPS sync using dynamic date range
  const { data: activities, isFetching } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: false,
    enabled: isAuthenticated && routeSettings.enabled,
  });

  // Fetch activities with stats for fitness tab cache warming.
  // Uses the same sync date range as the GPS fetch to respect the 90-day default.
  // Also updates the engine with training load and FTP data — the GPS sync
  // fetch (above) uses includeStats: false for speed, so the engine initially has
  // NULL training_load/ftp. This fetch fills in those fields.
  const { data: statsActivities } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    includeStats: true,
    enabled: isAuthenticated,
  });

  // Update engine with enhanced metrics (TSS, FTP) when stats-enriched data arrives.
  // The GPS sync stores metrics with includeStats: false (NULL training_load/ftp).
  // This backfills the engine so period comparisons use TSS and FTP trend works.
  const statsSeededRef = useRef(false);
  useEffect(() => {
    if (!statsActivities?.length || statsSeededRef.current) return;
    const engine = getRouteEngine();
    if (!engine) return;

    const enhanced = statsActivities
      .filter((a) => a.icu_training_load != null || a.icu_ftp != null)
      .map(toActivityMetrics);

    if (enhanced.length > 0) {
      engine.setActivityMetrics(enhanced);
      engine.triggerRefresh('activities');
      statsSeededRef.current = true;
    }
  }, [statsActivities]);

  // Update fetching state in store
  useEffect(() => {
    setFetchingExtended(isFetching);
  }, [isFetching, setFetchingExtended]);

  // Use the route data sync hook to automatically sync GPS data
  const { progress, isSyncing } = useRouteDataSync(activities, routeSettings.enabled);

  // Invalidate caches when sync completes so data refreshes
  useEffect(() => {
    if (progress.status === 'complete') {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['activities-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['wellness'] });
      queryClient.invalidateQueries({ queryKey: ['athlete-summary'] });
      queryClient.invalidateQueries({ queryKey: ['powerCurve'] });
      queryClient.invalidateQueries({ queryKey: ['paceCurve'] });
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

  // Pick which info to show — GPS sync > bounds sync > terrain snapshots
  const displayInfo = gpsDisplayInfo ?? boundsDisplayInfo ?? terrainDisplayInfo;

  // Post/update/dismiss native notification immediately — no artificial delay.
  useEffect(() => {
    if (displayInfo !== null) {
      const body = displayInfo.countText
        ? `${displayInfo.text}... ${displayInfo.countText}`
        : `${displayInfo.text}...`;
      updateSyncNotification(body);
    } else {
      dismissSyncNotification();
    }
  }, [displayInfo]);

  // Dismiss notification on unmount
  useEffect(() => {
    return () => {
      dismissSyncNotification();
    };
  }, []);

  return null;
}
