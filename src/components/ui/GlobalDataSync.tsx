/**
 * Global GPS data sync component (headless).
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * Posts native OS notifications for sync progress instead of rendering an in-app banner.
 */

import { useEffect, useMemo, useState, useRef } from 'react';
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

  // Prefetch 1 year of activities with stats for fitness tab cache warming
  useActivities({ days: 365, includeStats: true, enabled: isAuthenticated });

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

  // Suppress notification for fast syncs (<1s)
  const [delayPassed, setDelayPassed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (displayInfo !== null && !delayPassed) {
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => setDelayPassed(true), 1000);
      }
    } else if (displayInfo === null) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setDelayPassed(false);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [displayInfo, delayPassed]);

  // Post/update/dismiss native notification based on sync state
  useEffect(() => {
    if (displayInfo !== null && delayPassed) {
      const body = displayInfo.countText
        ? `${displayInfo.text}... ${displayInfo.countText}`
        : `${displayInfo.text}...`;
      updateSyncNotification(body);
    } else if (displayInfo === null) {
      dismissSyncNotification();
    }
  }, [displayInfo, delayPassed]);

  // Dismiss notification on unmount
  useEffect(() => {
    return () => {
      dismissSyncNotification();
    };
  }, []);

  return null;
}
