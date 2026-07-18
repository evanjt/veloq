import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

const TAG = 'veloq-recording';

/** Keep the screen awake during recording, honouring the user preference. */
export function useRecordingKeepAwake() {
  const keepAwakeEnabled = useRecordingPreferences((s) => s.keepAwakeEnabled);

  useEffect(() => {
    if (!keepAwakeEnabled) return;
    activateKeepAwakeAsync(TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(TAG).catch(() => {});
    };
  }, [keepAwakeEnabled]);
}
