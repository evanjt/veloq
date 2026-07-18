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
  speedLength,
  autoPaused,
  setAutoPaused,
}: {
  activityType: ActivityType;
  mode: RecordingMode;
  status: RecordingStatus;
  speedLength: number;
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

  // Auto-pause: check speed on each location update
  useEffect(() => {
    if (mode !== 'gps' || !autoPauseEnabled) return;
    if (status !== 'recording' && status !== 'paused') return;

    const speed = useRecordingStore.getState().streams.speed;
    const lastSpeed = speed[speed.length - 1];
    if (lastSpeed == null) return;

    const result = autoPauseDetectorRef.current.update(lastSpeed, Date.now());
    if (result === 'pause' && status === 'recording') {
      useRecordingStore.getState().pauseRecording();
      setAutoPaused(true);
    } else if (result === 'resume' && status === 'paused' && autoPaused) {
      useRecordingStore.getState().resumeRecording();
      setAutoPaused(false);
    }
  }, [speedLength]); // eslint-disable-line react-hooks/exhaustive-deps

  return autoPauseDetectorRef;
}
