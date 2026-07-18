import { useEffect } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { RecordingMode, RecordingStatus } from '../types';

/**
 * Indoor mode has no GPS points to carry sensor values, so a 1 Hz tick
 * appends aligned samples (time + heart rate + power + cadence) instead.
 */
export function useIndoorSampleEffect(mode: RecordingMode, status: RecordingStatus) {
  useEffect(() => {
    if (mode !== 'indoor' || status !== 'recording') return;
    const interval = setInterval(() => {
      useRecordingStore.getState().addIndoorSample();
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, status]);
}
