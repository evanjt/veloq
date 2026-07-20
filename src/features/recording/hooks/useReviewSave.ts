import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import { queryKeys } from '@/shared/query/queryKeys';
import { intervalsApi } from '@/api';
import { debug } from '@/shared/debug/debug';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { clearRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useUploadPermissionStore } from '@/features/recording/stores/UploadPermissionStore';
import { isOAuthConfigured } from '@/features/auth';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import type { ActivityType, RecordingLibraryEntry } from '@/types';
import type { RecordingStreams, RecordingLap } from '@/features/recording/types';

const log = debug.create('Upload');

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
  startTime: number | null;
  pausedDuration: number;
  laps: RecordingLap[];
  pairedEventId: number | null;
  getTrimmedStreams: () => RecordingStreams;
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
 * Manual: calls `intervalsApi.createManualActivity` directly.
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
  startTime,
  pausedDuration,
  laps,
  pairedEventId,
  getTrimmedStreams,
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
  const fitBufferRef = useRef<ArrayBuffer | null>(null);

  const finishAndGoHome = useCallback(
    (message: string | null) => {
      if (message) {
        setQueuedMessage(message);
        setIsUploading(false);
        setTimeout(() => {
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
    setIsUploading(true);
    setErrorMessage(null);
    setQueuedMessage(null);
    setCanRetry(false);
    try {
      if (isManual) {
        await intervalsApi.createManualActivity({
          type,
          name,
          start_date_local: new Date().toISOString(),
          elapsed_time: summary.duration,
          distance: summary.distance > 0 ? summary.distance : undefined,
          average_heartrate: summary.avgHeartrate ?? undefined,
          description: notes || undefined,
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
        await clearRecordingBackup();
        setIsUploading(false);
        finishAndGoHome(null);
        return;
      }

      const autoUpload = useRecordingPreferences.getState().autoUploadEnabled;

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
        const adjustedStart = new Date(startTime! + timeBase * 1000);
        const fitBuffer = await generateFitFile({
          activityType: type,
          startTime: adjustedStart,
          streams: trimmedStreams,
          laps,
          name,
          pausedTimeSeconds: pausedDuration / 1000,
        });

        const entry = await saveRecording({
          fitBuffer,
          streams: trimmedStreams,
          activityType: type,
          name,
          startTime: adjustedStart.getTime(),
          durationSeconds: summary.duration,
          distanceMeters: summary.distance,
          elevationGain: summary.elevationGain,
          avgHeartrate: summary.avgHeartrate,
          pairedEventId: pairedEventId ?? undefined,
          uploadStatus: autoUpload ? 'pending' : 'localOnly',
        });
        if (!entry) {
          setErrorMessage(t('recording.saveError', 'Could not save activity. Please try again.'));
          setCanRetry(true);
          setIsUploading(false);
          return;
        }
        savedEntryRef.current = entry;
        fitBufferRef.current = fitBuffer;
        // The recording is durable now - the crash backup has done its job
        await clearRecordingBackup();
      }

      if (!autoUpload) {
        log.log('Auto-upload off - recording saved to library only');
        finishAndGoHome(
          t(
            'recording.savedLocally',
            'Activity saved on this device. Upload it any time from My Recordings.'
          )
        );
        return;
      }

      const result = await uploadRecording(
        savedEntryRef.current,
        fitBufferRef.current ?? undefined
      );

      switch (result.outcome) {
        case 'uploaded':
          queryClient.invalidateQueries({ queryKey: queryKeys.activities.all });
          queryClient.invalidateQueries({ queryKey: queryKeys.activities.infinite.all });
          setIsUploading(false);
          finishAndGoHome(null);
          return;

        case 'permissionBlocked':
          useUploadPermissionStore.getState().setHasWritePermission(false);
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

        case 'rejected':
        case 'missing':
          setErrorMessage(
            t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
              error: result.errorDetail ?? 'unknown',
            })
          );
          setCanRetry(true);
          setIsUploading(false);
          return;

        case 'network':
        case 'retriable':
          log.log('Upload deferred, recording waits in the library');
          finishAndGoHome(
            t(
              'recording.savedQueued',
              'Activity saved. It will upload automatically when connectivity is restored.'
            )
          );
          return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setErrorMessage(
        t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
          error: message,
        })
      );
      setIsUploading(false);
    }
  }, [
    isManual,
    type,
    name,
    summary,
    notes,
    startTime,
    pausedDuration,
    laps,
    pairedEventId,
    t,
    getTrimmedStreams,
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
