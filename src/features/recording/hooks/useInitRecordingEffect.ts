import { useEffect } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import type { ActivityType } from '@/features/activity/types';
import type { RecordingMode, RecordingStatus } from '../types';

// Initialize recording on mount
export function useInitRecordingEffect(
  status: RecordingStatus,
  activityType: ActivityType,
  mode: RecordingMode,
  pairedEventId?: string
) {
  useEffect(() => {
    if (status === 'idle') {
      useRecordingStore
        .getState()
        .startRecording(activityType, mode, pairedEventId ? Number(pairedEventId) : undefined);
      useRecordingPreferences.getState().addRecentType(activityType);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
