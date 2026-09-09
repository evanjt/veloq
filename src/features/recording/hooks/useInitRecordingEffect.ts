import { useEffect } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import type { ActivityType } from '@/features/activity/types';
import type { RecordingMode, RecordingStatus } from '../types';

/**
 * Start the recording on mount. `canRecord` is not a courtesy: every one-tap
 * surface deep-links straight to this screen, so this effect is the only thing
 * between a signed-out tap and a full ride recorded against no account.
 */
export function useInitRecordingEffect(
  status: RecordingStatus,
  activityType: ActivityType,
  mode: RecordingMode,
  pairedEventId?: string,
  canRecord: boolean = true
) {
  useEffect(() => {
    if (canRecord && status === 'idle') {
      useRecordingStore
        .getState()
        .startRecording(activityType, mode, pairedEventId ? Number(pairedEventId) : undefined);
      useRecordingPreferences.getState().addRecentType(activityType);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
