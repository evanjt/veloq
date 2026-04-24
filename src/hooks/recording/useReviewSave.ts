import { useState, useCallback } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { generateFitFile } from '@/lib/recording/fitGenerator';
import { intervalsApi } from '@/api';
import { debug } from '@/lib/utils/debug';
import { useRecordingStore } from '@/providers/RecordingStore';
import { useUploadPermissionStore } from '@/providers/UploadPermissionStore';
import { isOAuthConfigured } from '@/services/oauth';
import { usePermissionUpgrade } from '@/hooks/recording/usePermissionUpgrade';
import { useUploadQueue } from '@/hooks/recording/useUploadQueue';
import { classifyUploadError } from '@/lib/upload/classifyUploadError';
import type { ActivityType } from '@/types';
import type { RecordingStreams, RecordingLap } from '@/types/recording';

const log = debug.create('Upload');

export interface UseReviewSaveArgs {
  isManual: boolean;
  type: ActivityType;
  name: string;
  summary: {
    duration: number;
    distance: number;
    avgHeartrate: number | null;
  };
  notes: string;
  startTime: number | null;
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
}

/**
 * Orchestrates saving/uploading a recorded or manual activity.
 *
 * Manual: calls `intervalsApi.createManualActivity` directly.
 * GPS: generates a FIT file and uploads via `intervalsApi.uploadActivity`.
 *
 * On upload failure the outcome depends on the classified error type
 * (see `classifyUploadError`):
 *   - `http403`   → permission store flipped, OAuth upgrade offered
 *   - `apiError`  → surfaced to the user, not queued
 *   - `network`   → FIT persisted + enqueued via `useUploadQueue`
 *
 * On success (or successful queue) the recording store is reset and the
 * user navigates back to `/`.
 */
export function useReviewSave({
  isManual,
  type,
  name,
  summary,
  notes,
  startTime,
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
  const { upgradePermissions, isUpgrading: isOAuthLoading } = usePermissionUpgrade();
  const { queueUpload } = useUploadQueue();

  const handleSave = useCallback(async () => {
    setIsUploading(true);
    setErrorMessage(null);
    setQueuedMessage(null);
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
      } else {
        const trimmedStreams = getTrimmedStreams();
        const adjustedStart =
          canTrim && trimmedStreams.time.length > 0
            ? new Date(startTime! + trimmedStreams.time[0] * 1000)
            : new Date(startTime!);
        const fitBuffer = await generateFitFile({
          activityType: type,
          startTime: adjustedStart,
          streams: trimmedStreams,
          laps,
          name,
        });

        try {
          log.log(`Uploading ${name}.fit...`);
          await intervalsApi.uploadActivity(fitBuffer, `${name}.fit`, {
            name,
            pairedEventId: pairedEventId ?? undefined,
          });
          log.log('Upload succeeded');
        } catch (uploadErr) {
          const err = classifyUploadError(uploadErr);
          log.warn(
            `Upload failed (${err.type}, status=${err.httpStatus ?? 'n/a'}): ${err.apiDetail ?? err.errMsg}`
          );

          if (err.type === 'http403') {
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
          }

          if (err.type === 'apiError') {
            setErrorMessage(
              t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
                error: err.apiDetail ?? err.errMsg,
              })
            );
            setIsUploading(false);
            return;
          }

          // err.type === 'network' → queue for later
          log.log(`Network error, queueing for later: ${err.errMsg}`);
          const queued = await queueUpload({
            fitBuffer,
            activityType: type,
            name,
            pairedEventId,
          });
          if (!queued) {
            log.warn('Failed to queue upload');
            setErrorMessage(t('recording.saveError', 'Could not save activity. Please try again.'));
            setIsUploading(false);
            return;
          }

          log.log('Queued successfully');
          setQueuedMessage(
            t(
              'recording.savedQueued',
              'Activity saved. It will upload automatically when connectivity is restored.'
            )
          );
          setIsUploading(false);
          setTimeout(() => {
            useRecordingStore.getState().reset();
            router.replace('/');
          }, 1500);
          return;
        }
      }

      useRecordingStore.getState().reset();
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setErrorMessage(
        t('recording.uploadErrorMessage', 'Could not upload activity: {{error}}', {
          error: message,
        })
      );
    } finally {
      if (!queuedMessage) setIsUploading(false);
    }
  }, [
    isManual,
    type,
    name,
    summary,
    notes,
    startTime,
    laps,
    pairedEventId,
    t,
    getTrimmedStreams,
    canTrim,
    queuedMessage,
    queueUpload,
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
  };
}
