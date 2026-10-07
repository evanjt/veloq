import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { UploadOutcome } from 'veloqrs';

import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import { rebaseLaps } from '@/features/recording/lib/savedLaps';
import { epochMsToStartDateLocal } from '@/shared/time/startDate';
import { queryKeys } from '@/shared/query/queryKeys';
import { debug } from '@/shared/debug/debug';
import { requestSyncRefresh } from '@/shared/native/syncRefresh';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import {
  attachEngineActivity,
  holdsRecordingStartingIn,
  saveRecording,
} from '@/features/recording/lib/storage/recordingLibrary';
import { writeProvisionalActivity } from '@/features/recording/lib/storage/provisionalActivity';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { isOAuthConfigured } from '@/features/auth';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import type { ActivityType, RecordingLibraryEntry } from '@/types';
import type { RecordingStreams, RecordingLap } from '@/features/recording/types';

const log = debug.create('Upload');

/**
 * Whether the library already holds this stopped ride. A library that cannot
 * be read holds nothing: the ride is saved rather than dropped on a failed read.
 */
function libraryHoldsStoppedRide(session: { startTime: number | null; stopTime: number | null }) {
  if (session.startTime === null) return false;
  try {
    return holdsRecordingStartingIn(session.startTime, session.stopTime ?? Date.now());
  } catch {
    return false;
  }
}

export interface UseReviewSaveArgs {
  isManual: boolean;
  type: ActivityType;
  name: string;
  summary: {
    duration: number;
    distance: number;
    avgHeartrate: number | null;
    elevationGain: number;
  };
  notes: string;
  /** The effort from 1 to 10, or null when the athlete never moved the slider. */
  rpe?: number | null;
  startTime: number | null;
  /** Paused seconds inside the window being saved, not the whole session. */
  pausedSecondsInWindow: number;
  laps: RecordingLap[];
  pairedEventId: number | null;
  getTrimmedStreams: () => RecordingStreams;
  /** Store index of the first sample `getTrimmedStreams` returns. */
  trimStartIndex: number;
  canTrim: boolean;
}

export interface UseReviewSave {
  handleSave: () => Promise<void>;
  isUploading: boolean;
  errorMessage: string | null;
  setErrorMessage: (message: string | null) => void;
  queuedMessage: string | null;
  showPermissionFix: boolean;
  setShowPermissionFix: (show: boolean) => void;
  isOAuthLoading: boolean;
  handleUpgradeToOAuth: () => Promise<void>;
  /**
   * True when the last failure left the recording safely in the library but
   * not uploaded - re-running `handleSave` retries the upload without
   * creating a duplicate entry.
   */
  canRetry: boolean;
}

/**
 * Orchestrates saving a recorded or manual activity - local-save-first.
 *
 * Manual: creates the activity upstream directly.
 * GPS: generates a FIT file, persists it to the recordings library FIRST
 * (the durable copy - a crash or failed upload can no longer lose data),
 * then uploads from there when auto-upload is on.
 *
 * Upload outcomes only change the library entry's status:
 *   - permissionBlocked → OAuth upgrade offered; entry waits in the library
 *   - rejected          → surfaced to the user; manual retry from here or the library
 *   - network/retriable → "saved, will upload later"; background processor retries
 */
export function useReviewSave({
  isManual,
  type,
  name,
  summary,
  notes,
  rpe = null,
  startTime,
  pausedSecondsInWindow,
  laps,
  pairedEventId,
  getTrimmedStreams,
  trimStartIndex,
  canTrim,
}: UseReviewSaveArgs): UseReviewSave {
  const { t } = useTranslation();
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<string | null>(null);
  const [showPermissionFix, setShowPermissionFix] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const { upgradePermissions, isUpgrading: isOAuthLoading } = usePermissionUpgrade();
  const queryClient = useQueryClient();
  // The library entry created on the first save attempt; retries reuse it so a
  // failed upload never produces a duplicate recording.
  const savedEntryRef = useRef<RecordingLibraryEntry | null>(null);
  const mountedRef = useRef(true);

  // A ride the library holds is settled once its review is left, whatever its
  // upload did: the library retries it from there, and a stopped store would
  // keep routing back to a review with nothing left to save.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = useRecordingStore.getState();
      if (session.status === 'stopped' && session.savedToLibrary) session.reset();
    };
  }, []);

  const finishAndGoHome = useCallback(
    (message: string | null, stillCurrent: () => boolean) => {
      if (!stillCurrent()) return;
      if (message) {
        setQueuedMessage(message);
        setIsUploading(false);
        setTimeout(() => {
          if (!stillCurrent()) return;
          useRecordingStore.getState().reset();
          router.replace('/');
        }, 1500);
      } else {
        useRecordingStore.getState().reset();
        router.replace('/');
      }
    },
    [setQueuedMessage]
  );

  const handleSave = useCallback(async () => {
    const session = useRecordingStore.getState();
    const owner = session.athleteId;
    const sessionStart = session.startTime;
    const requiredStatus = isManual ? 'recording' : 'stopped';
    const stillCurrent = () => {
      const current = useRecordingStore.getState();
      const auth = useAuthStore.getState();
      return (
        !!owner &&
        sessionStart !== null &&
        auth.isAuthenticated &&
        auth.athleteId === owner &&
        current.athleteId === owner &&
        current.startTime === sessionStart &&
        current.status === requiredStatus &&
        (isManual ? current.mode === 'manual' : !!current.mode && current.mode !== 'manual')
      );
    };
    if (!owner || sessionStart === null || !stillCurrent()) return;
    // A review opened on a ride the library already holds, where only this
    // screen's own entry may retry the upload. The ride is saved, so the review
    // settles it rather than offering a Save that does nothing.
    if (!savedEntryRef.current && session.savedToLibrary) {
      finishAndGoHome(
        t(
          'recording.savedLocally',
          'Activity saved on this device. Upload it any time from My Recordings.'
        ),
        stillCurrent
      );
      return;
    }
    // The library holds the ride from here, whatever became of the session
    // meanwhile. A sign-out that held it in the gap would otherwise leave a
    // backup that reopens it for a second save.
    const settleSaved = async (clearBackup: boolean) => {
      useRecordingStore.getState().markSavedToLibrary(owner, sessionStart);
      if (clearBackup)
        await clearRecordingBackup(owner, { athleteId: owner, startTime: sessionStart });
    };
    // A review left while this save was in flight has already run its unmount
    // settle, before the library held the ride, so the save settles it at the end.
    const settleIfLeft = () => {
      if (mountedRef.current) return;
      const current = useRecordingStore.getState();
      if (
        current.status === 'stopped' &&
        current.savedToLibrary &&
        current.athleteId === owner &&
        current.startTime === sessionStart
      )
        current.reset();
    };
    setIsUploading(true);
    setErrorMessage(null);
    setQueuedMessage(null);
    setCanRetry(false);
    try {
      const autoUpload = useRecordingPreferences.getState().autoUploadEnabled;
      // The athlete took this ride past the missing-scope warning, so the upload
      // it would be queued for cannot succeed. It stays on the device, whatever
      // auto-upload says, and the flag belongs to this ride alone.
      const withoutScope = useUploadPermissionStore.getState().recordingWithoutScope;
      const uploadable = autoUpload && !withoutScope;

      if (!savedEntryRef.current && isManual) {
        // A manual entry is a row like any other: saved first, posted second,
        // and drained by the same queue. It used to await the network and treat
        // the answer as the save, so offline it existed nowhere at all.
        const manualStart = startTime ?? Date.now();
        const entry = await saveRecording({
          manualBody: {
            type,
            name,
            start_date_local: epochMsToStartDateLocal(manualStart),
            elapsed_time: summary.duration,
            distance: summary.distance > 0 ? summary.distance : undefined,
            average_heartrate: summary.avgHeartrate ?? undefined,
            description: notes || undefined,
          },
          activityType: type,
          name,
          startTime: manualStart,
          durationSeconds: summary.duration,
          distanceMeters: summary.distance,
          elevationGain: summary.elevationGain,
          avgHeartrate: summary.avgHeartrate,
          pairedEventId: pairedEventId ?? undefined,
          notes,
          uploadStatus: uploadable ? 'pending' : 'localOnly',
          athleteId: owner,
        });
        if (entry) await settleSaved(false);
        if (!stillCurrent()) {
          setIsUploading(false);
          return;
        }
        if (!entry) {
          setErrorMessage(t('recording.saveError', 'Could not save activity. Please try again.'));
          setCanRetry(true);
          setIsUploading(false);
          return;
        }
        savedEntryRef.current = entry;
        // No streams, so no track and no detection: the row is the metadata the
        // feed and the week read.
        const engineActivityId = await writeProvisionalActivity(entry);
        if (!stillCurrent()) {
          setIsUploading(false);
          return;
        }
        if (engineActivityId) {
          savedEntryRef.current = (await attachEngineActivity(entry.id, engineActivityId)) ?? {
            ...entry,
            engineActivityId,
          };
        }
      }

      if (!savedEntryRef.current && startTime !== null && libraryHoldsStoppedRide(session)) {
        // A backup offered while the library could not be read, whose ride was
        // saved before the process died. Writing it again would duplicate it.
        await settleSaved(true);
        setIsUploading(false);
        finishAndGoHome(
          t(
            'recording.savedLocally',
            'Activity saved on this device. Upload it any time from My Recordings.'
          ),
          stillCurrent
        );
        return;
      }

      if (!savedEntryRef.current) {
        // Rebase trimmed time/distance to the trim window: the FIT start time
        // absorbs the offset, so record timestamps and cumulative distance
        // must start at zero or the offset would be double-counted.
        const sliced = getTrimmedStreams();
        const timeBase = canTrim ? (sliced.time[0] ?? 0) : 0;
        const distBase = canTrim ? (sliced.distance[0] ?? 0) : 0;
        const trimmedStreams =
          timeBase > 0 || distBase > 0
            ? {
                ...sliced,
                time: sliced.time.map((tv) => tv - timeBase),
                distance: sliced.distance.map((d) => d - distBase),
              }
            : sliced;
        // A recording with no start time is a state the FIT writer has no
        // answer for. Falling back to now keeps the file valid; the arithmetic
        // on a null would have dated it to 1970.
        const adjustedStart = new Date((startTime ?? Date.now()) + timeBase * 1000);
        const fitBuffer = await generateFitFile({
          activityType: type,
          startTime: adjustedStart,
          streams: trimmedStreams,
          // Laps are on the store's clock and indices, the records on the window's.
          laps: rebaseLaps(laps, trimmedStreams, timeBase, trimStartIndex, session.pauseIntervals),
          name,
          pausedTimeSeconds: pausedSecondsInWindow,
        });
        if (!stillCurrent()) {
          setIsUploading(false);
          return;
        }

        const entry = await saveRecording({
          fitBuffer,
          activityType: type,
          name,
          startTime: adjustedStart.getTime(),
          durationSeconds: summary.duration,
          distanceMeters: summary.distance,
          elevationGain: summary.elevationGain,
          avgHeartrate: summary.avgHeartrate,
          pairedEventId: pairedEventId ?? undefined,
          notes,
          rpe: rpe ?? undefined,
          uploadStatus: uploadable ? 'pending' : 'localOnly',
          athleteId: owner,
        });
        if (entry) await settleSaved(true);
        if (!stillCurrent()) {
          setIsUploading(false);
          return;
        }
        if (!entry) {
          setErrorMessage(t('recording.saveError', 'Could not save activity. Please try again.'));
          setCanRetry(true);
          setIsUploading(false);
          return;
        }
        savedEntryRef.current = entry;
        // The ride reaches the feed, the heatmap and the week from here. The
        // engine reads the track out of the FIT the save just wrote.
        const engineActivityId = await writeProvisionalActivity(entry);
        if (!stillCurrent()) {
          setIsUploading(false);
          return;
        }
        if (engineActivityId) {
          savedEntryRef.current = (await attachEngineActivity(entry.id, engineActivityId)) ?? {
            ...entry,
            engineActivityId,
          };
        }
      }

      if (!stillCurrent()) {
        setIsUploading(false);
        return;
      }

      if (!uploadable) {
        useUploadPermissionStore.getState().clearWithoutScope();
        log.log(
          withoutScope
            ? 'Recorded without the upload scope - recording saved to library only'
            : 'Auto-upload off - recording saved to library only'
        );
        finishAndGoHome(
          withoutScope
            ? t('recording.savedLocallyNoScope')
            : t(
                'recording.savedLocally',
                'Activity saved on this device. Upload it any time from My Recordings.'
              ),
          stillCurrent
        );
        return;
      }

      const result = await uploadRecordingNow(savedEntryRef.current.id);
      if (!stillCurrent()) {
        setIsUploading(false);
        return;
      }

      switch (result.outcome) {
        case UploadOutcome.Uploaded:
          queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
          queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
          // The feed reads the engine, so the new ride is absent until a sync brings it in.
          try {
            requestSyncRefresh();
          } catch (error) {
            log.warn('Post-upload sync request failed', error);
          }
          finishAndGoHome(null, stillCurrent);
          return;

        case UploadOutcome.PermissionBlocked:
          // The engine announces the refusal, which is what marks the grant.
          setErrorMessage(
            t(
              'recording.permissionExplanation',
              'Veloq needs your permission to upload activities to intervals.icu'
            )
          );
          if (isOAuthConfigured()) {
            setShowPermissionFix(true);
          }
          setIsUploading(false);
          return;

        case UploadOutcome.Rejected:
        case UploadOutcome.Missing:
          setErrorMessage(
            t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
              error: result.errorDetail ?? 'unknown',
            })
          );
          setCanRetry(true);
          setIsUploading(false);
          return;

        case UploadOutcome.AuthExpired:
        // Saved for an athlete no longer signed in: it waits for them.
        case UploadOutcome.OtherAthlete:
          finishAndGoHome(
            t(
              'recording.savedQueuedAuth',
              'Activity saved. It will upload when you sign in again.'
            ),
            stillCurrent
          );
          return;

        case UploadOutcome.Network:
        case UploadOutcome.Retriable:
        // The ride was not pending, or it was and its upload finished
        // before this call could join it, so the queue settles it.
        case UploadOutcome.NotStarted:
          log.log('Upload deferred, recording waits in the library');
          finishAndGoHome(
            t(
              'recording.savedQueued',
              'Activity saved. It will upload automatically when connectivity is restored.'
            ),
            stillCurrent
          );
          return;

        default: {
          const unhandled: never = result.outcome;
          throw new Error(`Unhandled upload outcome: ${unhandled}`);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setErrorMessage(
        t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
          error: message,
        })
      );
      setIsUploading(false);
    } finally {
      settleIfLeft();
    }
  }, [
    isManual,
    type,
    name,
    summary,
    notes,
    rpe,
    startTime,
    pausedSecondsInWindow,
    laps,
    pairedEventId,
    t,
    getTrimmedStreams,
    trimStartIndex,
    canTrim,
    queryClient,
    finishAndGoHome,
  ]);

  const handleUpgradeToOAuth = useCallback(async () => {
    setErrorMessage(null);
    const success = await upgradePermissions();
    if (success) {
      log.log('Upgraded to OAuth, retrying upload...');
      setShowPermissionFix(false);
      handleSave();
    }
  }, [upgradePermissions, handleSave]);

  return {
    handleSave,
    isUploading,
    errorMessage,
    setErrorMessage,
    queuedMessage,
    showPermissionFix,
    setShowPermissionFix,
    isOAuthLoading,
    handleUpgradeToOAuth,
    canRetry,
  };
}
