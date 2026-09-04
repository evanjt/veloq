import { useEffect, useRef } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { createAutoPauseDetector } from '@/features/recording/lib/autoPause';
import type { AutoPauseConfig } from '@/features/recording/lib/autoPause';
import { getSportCategory } from '../lib/sportCategoryDetector';
import type { ActivityType } from '@/features/activity/types';
import type { RecordingMode, RecordingStatus } from '../types';

export function useAutoPauseEffect({
  activityType,
  mode,
  status,
  autoPaused,
  setAutoPaused,
}: {
  activityType: ActivityType;
  mode: RecordingMode;
  status: RecordingStatus;
  autoPaused: boolean;
  setAutoPaused: (paused: boolean) => void;
}) {
  const autoPauseEnabled = useRecordingPreferences((s) => s.autoPauseEnabled);
  const autoPauseThresholds = useRecordingPreferences((s) => s.autoPauseThresholds);
  const autoPauseDurationMs = useRecordingPreferences((s) => s.autoPauseDurationMs);

  const sportCategory = getSportCategory(activityType);

  const autoPauseDetectorRef = useRef(
    createAutoPauseDetector({
      enabled: autoPauseEnabled,
      speedThreshold: (autoPauseThresholds[sportCategory] ?? 2) / 3.6, // km/h to m/s
      durationThreshold: autoPauseDurationMs,
    } as AutoPauseConfig)
  );

  // Update detector config when preferences change
  useEffect(() => {
    autoPauseDetectorRef.current = createAutoPauseDetector({
      enabled: autoPauseEnabled,
      speedThreshold: (autoPauseThresholds[sportCategory] ?? 2) / 3.6,
      durationThreshold: autoPauseDurationMs,
    } as AutoPauseConfig);
  }, [autoPauseEnabled, autoPauseThresholds, autoPauseDurationMs, sportCategory]);

  // Raw fixes, not `streams.speed`: the stream stops growing while paused,
  // which left the resume branch below unreachable.
  const rawSpeed = useRecordingStore((s) => s.rawSpeed);

  // Auto-pause: check speed on each location update
  useEffect(() => {
    if (mode !== 'gps' || !autoPauseEnabled) return;
    if (status !== 'recording' && status !== 'paused') return;
    if (!rawSpeed) return;

    const result = autoPauseDetectorRef.current.update(rawSpeed.value, rawSpeed.at);
    if (result === 'pause' && status === 'recording') {
      useRecordingStore.getState().pauseRecording();
      setAutoPaused(true);
    } else if (result === 'resume' && status === 'paused' && autoPaused) {
      useRecordingStore.getState().resumeRecording();
      setAutoPaused(false);
    }
  }, [rawSpeed]); // eslint-disable-line react-hooks/exhaustive-deps

  return autoPauseDetectorRef;
}
