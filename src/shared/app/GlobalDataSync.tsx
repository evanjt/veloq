/**
 * Global GPS data sync component (headless).
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * Posts native OS notifications for sync progress instead of rendering an in-app banner.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActivities } from '@/features/activity/hooks';
import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { useSectionHealthCheck } from '@/features/routes/hooks/useSectionHealthCheck';
import { useStrengthReconnect } from '@/features/strength/hooks/useExerciseSets';
import {
  useMutatedPreviewTracks,
  useStoredPreviewTracks,
} from '@/features/activity/hooks/useMapPreviewCoordinates';
import { queryKeys } from '@/shared/query/queryKeys';
import { onSyncComplete } from '@/features/settings/lib/autobackup';

import { PACE_SNAPSHOT_WINDOW_DAYS } from './constants';
import { getEngine } from '@/shared/native/engine';
import { SyncState } from 'veloqrs';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineSync } from '@/shared/native/useEngineSync';
import { useSyncAuthExpiry } from '@/shared/native/useSyncAuthExpiry';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useSyncStatus } from '@/shared/native/useSyncStatus';
import { usePushedWritesOnForeground } from '@/shared/native/usePushedWritesOnForeground';
import { PICKUP_DEADLINE_MS } from '@/shared/app/extendedFetch';
import { syncSettledForExpansion } from '@/shared/app/expansionLock';

export function GlobalDataSync() {
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

  // A FIT download the radio refused announces nothing, so the reconnect edge
  // is the only thing that can wake the sets a strength card cached as empty.
  useStrengthReconnect();

  // A re-ingest that replaced a stored track moved the preview line cut from
  // it. The engine names those activities, and only their cards re-read.
  useMutatedPreviewTracks();
  useStoredPreviewTracks();

  // The window every other reader shares. Rust's engine event is what wakes
  // it, so nothing is invalidated here at mount.
  const { data: activities } = useActivities({
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
  const { progress } = useRouteDataSync(activities, true);

  // A push handler can have written to the database from another process while
  // the app was away, which leaves the engine's in-memory tiers behind the file
  // with nothing to say so.
  usePushedWritesOnForeground();

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
            const curve = engine.getPaceCurve(sport, PACE_SNAPSHOT_WINDOW_DAYS, false);
            if (!curve) {
              // Not fetched yet. Ask for it; the next sync-complete pass seeds
              // the snapshot, and the pace curve screen would anyway.
              engine.syncPaceCurve(sport, PACE_SNAPSHOT_WINDOW_DAYS, false);
              continue;
            }
            if (curve.criticalSpeed && curve.criticalSpeed > 0) {
              engine.savePaceSnapshot(
                sport,
                curve.criticalSpeed,
                PACE_SNAPSHOT_WINDOW_DAYS,
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

  // Unlock expansion once the sync has stopped, however it stopped (with a
  // delay to let the UI stabilise). A pass that errors, and an athlete with
  // nothing in the window, both have to release the latch: neither ever
  // reaches 'complete', and the slider would stay locked for the session.
  const activityCount = activities ? activities.length : null;
  useEffect(() => {
    if (isExpansionLocked && syncSettledForExpansion(progress.status, activityCount)) {
      delayedUnlockExpansion();
    }
  }, [progress.status, activityCount, isExpansionLocked, delayedUnlockExpansion]);

  return null;
}
