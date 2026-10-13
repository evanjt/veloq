/**
 * Global GPS data sync component (headless).
 * Runs in the background to automatically sync activity GPS data to the Rust engine.
 * Posts native OS notifications for sync progress instead of rendering an in-app banner.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActivityWindowRequest } from '@/features/activity/hooks';
import { useRouteDataSync } from '@/features/routes/hooks/useRouteDataSync';
import { useSectionHealthCheck } from '@/features/routes/hooks/useSectionHealthCheck';
import { useStrengthReconnect } from '@/features/strength/hooks/useExerciseSets';
import {
  useMutatedPreviewTracks,
  useStoredPreviewTracks,
} from '@/features/activity/hooks/useMapPreviewCoordinates';
import { queryKeys } from '@/shared/query/queryKeys';
import { onBackupReconnect, onSyncComplete } from '@/features/settings/lib/autobackup';

import { SyncState } from 'veloqrs';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useEngineSync } from '@/shared/native/useEngineSync';
import { useSyncAuthExpiry } from '@/shared/native/useSyncAuthExpiry';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { useSyncState } from '@/shared/native/useSyncStatus';
import { usePushedWritesOnForeground } from '@/shared/native/usePushedWritesOnForeground';
import { usePickupDeadline } from '@/shared/app/usePickupDeadline';
import { useReconnect } from '@/shared/app/useRetryTriggers';
import { syncSettledForExpansion } from '@/shared/app/expansionLock';

export function GlobalDataSync() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Get sync date range from global store (can be extended by timeline sliders)
  const syncOldest = useSyncDateRange((s) => s.oldest);
  const syncNewest = useSyncDateRange((s) => s.newest);
  const syncStateChanged = useSyncDateRange((s) => s.syncStateChanged);
  const isExpansionLocked = useSyncDateRange((s) => s.isExpansionLocked);
  const delayedUnlockExpansion = useSyncDateRange((s) => s.delayedUnlockExpansion);
  const syncGeneration = useSyncDateRange((s) => s.syncGeneration);

  // Log the user out when the Rust transport reports an expired OAuth session.
  useSyncAuthExpiry();

  // Fill the engine-backed tables and wake their readers when the sync lands.
  useEngineSync();

  // A FIT download the radio refused announces nothing, so the reconnect edge
  // is the only thing that can wake the sets a strength card cached as empty.
  useStrengthReconnect();

  // A backup copy a carrier could not take while offline goes on the way back.
  useReconnect(onBackupReconnect);

  // A re-ingest that replaced a stored track moved the preview line cut from
  // it. The engine names those activities, and only their cards re-read.
  useMutatedPreviewTracks();
  useStoredPreviewTracks();

  // Ask the engine for the selected window. Nothing here reads it: the route
  // sync takes its candidates and its count from the engine.
  useActivityWindowRequest(syncOldest, syncNewest, isAuthenticated);

  // The widened-range download is the engine holding its sync slot, so that is
  // what the flag follows. It used to follow `isFetching` above, which is a
  // SQLite read settling in milliseconds against a download taking seconds.
  const isEngineSyncing = useSyncState() === SyncState.Syncing;
  useEffect(() => {
    syncStateChanged(isEngineSyncing);
  }, [isEngineSyncing, syncStateChanged]);

  // A window the engine accepted but never reports the slot for ends in a
  // named state, or the banner stays up for the rest of the session.
  usePickupDeadline();

  // Use the route data sync hook to automatically sync GPS data, on every
  // `activities` announcement while signed in. Route matching does not gate it:
  // GPS tracks are needed for the heatmap even when route matching is off.
  // Section detection is gated separately in useGpsDataFetcher.
  const { progress, activityCount } = useRouteDataSync(isAuthenticated);

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
      queryClient.invalidateQueries({
        queryKey: queryKeys.charts.bestEfforts.all,
      });
      onSyncComplete();
    }
  }, [progress.status, queryClient]);

  // Unlock expansion once the sync has stopped, however it stopped (with a
  // delay to let the UI stabilise). A pass that errors, and an athlete with
  // nothing stored, both have to release the latch: neither ever reaches
  // 'complete', and the slider would stay locked for the session. Only a run
  // started after the reset that set the latch counts.
  useEffect(() => {
    if (isExpansionLocked && syncSettledForExpansion(progress, activityCount, syncGeneration)) {
      delayedUnlockExpansion();
    }
  }, [progress, activityCount, isExpansionLocked, syncGeneration, delayedUnlockExpansion]);

  return null;
}
