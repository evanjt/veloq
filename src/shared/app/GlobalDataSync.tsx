/**
 * Global GPS data sync component (headless).
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * Posts native OS notifications for sync progress instead of rendering an in-app banner.
 */

import { useEffect, useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useActivities } from '@/features/activity/hooks';
import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { useSectionHealthCheck } from '@/features/routes/hooks/useSectionHealthCheck';
import { queryKeys } from '@/shared/query/queryKeys';
import { onSyncComplete } from '@/features/settings/lib/autobackup';
import { parsePaceCurveBody } from '@/features/stats/lib/curveBodies';
import { getEngine } from '@/shared/native/engine';
import { SyncState } from 'veloqrs';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineSync } from '@/shared/native/useEngineSync';
import { useSyncAuthExpiry } from '@/shared/native/useSyncAuthExpiry';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { PICKUP_DEADLINE_MS } from '@/shared/app/extendedFetch';
import { formatGpsSyncProgress } from '@/features/routes/lib/syncProgressFormat';
import {
  updateSyncNotification,
  dismissSyncNotification,
} from '@/features/settings/lib/notificationService';

export function GlobalDataSync() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Get sync date range from global store (can be extended by timeline sliders)
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const syncStateChanged = useSyncDateRange((s) => s.syncStateChanged);
  const expirePickup = useSyncDateRange((s) => s.expirePickup);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);
  const delayedUnlockExpansion = useSyncDateRange((s) => s.delayedUnlockExpansion);

  // Log the user out when the Rust transport reports an expired OAuth session.
  useSyncAuthExpiry();

  // Fill the engine-backed tables and wake their readers when the sync lands.
  useEngineSync();

  // The window every other reader shares. Rust's engine event is what wakes
  // it, so nothing is invalidated here at mount.
  const { data: activities, isFetching } = useActivities({
    oldest: syncOldest,
    newest: syncNewest,
    enabled: isAuthenticated,
  });

  // The widened-range download is the engine holding its sync slot, so that is
  // what the flag follows. It used to follow `isFetching` above, which is a
  // SQLite read settling in milliseconds against a download taking seconds.
  const syncStatus = useSyncStatus();
  const isEngineSyncing = syncStatus?.state === SyncState.Syncing;
  useEffect(() => {
    syncStateChanged(isEngineSyncing);
  }, [isEngineSyncing, syncStateChanged]);

  // A window the engine accepted but never reports the slot for ends in a
  // named state, or the banner stays up for the rest of the session.
  useEffect(() => {
    const timer = setInterval(expirePickup, PICKUP_DEADLINE_MS);
    return () => clearInterval(timer);
  }, [expirePickup]);

  // Use the route data sync hook to automatically sync GPS data.
  // Always enabled - GPS tracks are needed for heatmap even when route matching is off.
  // Section detection is gated separately in useGpsDataFetcher.
  const { progress, isSyncing } = useRouteDataSync(activities, true);

  // One-shot self-heal for upgrades across the corridor-detection regression.
  // Triggers a forced redetect when sync completes against an empty section
  // store while activities exist.
  useSectionHealthCheck(progress.status === 'complete');

  // Invalidate caches when sync completes so data refreshes
  useEffect(() => {
    if (progress.status === 'complete') {
      queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
      queryClient.invalidateQueries({
        queryKey: queryKeys.activities.infinite.all,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.wellness.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.strength.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.athleteSummary.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.athlete });
      queryClient.invalidateQueries({ queryKey: queryKeys.profile.sportSettings });
      queryClient.invalidateQueries({
        queryKey: queryKeys.charts.powerCurve.all,
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.charts.paceCurve.all,
      });
      onSyncComplete();

      // Seed pace snapshots for trend tracking (fire-and-forget).
      // pace_history is normally only populated when viewing the pace curve screen.
      // Seeding here ensures a baseline exists after first sync so pace milestones
      // can appear once critical speed changes.
      try {
        const engine = getEngine();
        if (engine) {
          const sportTypes = engine.getAvailableSportTypes?.() ?? [];
          const todayTs = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);

          for (const sport of ['Run', 'Swim'] as const) {
            if (!sportTypes.includes(sport)) continue;
            const stored = engine.getPaceCurveBody(sport, 42, false);
            if (!stored) {
              // Not fetched yet. Ask for it; the next sync-complete pass seeds
              // the snapshot, and the pace curve screen would anyway.
              engine.syncPaceCurve(sport, 42, false);
              continue;
            }
            const curve = parsePaceCurveBody(stored, sport);
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
        }
      } catch {
        // best-effort - pace milestone will still work when user visits pace curve
      }
    }
  }, [progress.status, queryClient]);

  // Unlock expansion after sync completes (with delay to let UI stabilize)
  useEffect(() => {
    if (progress.status === 'complete' && isExpansionLocked) {
      delayedUnlockExpansion();
    }
  }, [progress.status, isExpansionLocked, delayedUnlockExpansion]);

  // GPS sync display info
  const gpsDisplayInfo = useMemo(
    () => formatGpsSyncProgress(progress, isFetching && !isSyncing, t),
    [progress, isFetching, isSyncing, t]
  );

  const displayInfo = gpsDisplayInfo;

  // Debounce sync notification: indeterminate states (like "Loading activities..."
  // during a background refetch) only post after 1.5s - if the fetch completes
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
