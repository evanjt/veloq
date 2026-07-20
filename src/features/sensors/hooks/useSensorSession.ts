import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
// Deep store import to keep the recording barrel's UI out of this module graph
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useSensorStore } from '../store';
import {
  connectKnownSensors,
  disconnectAllSensors,
  requestBlePermissions,
} from '../lib/sensorManager';
import { startSimulatedSensors, stopSimulatedSensors } from '../lib/simulatedSensors';

/**
 * Ties sensor connections to the recording session. On mount (the live
 * recording screen) paired sensors auto-connect; they stay connected across
 * navigation while the session is active and disconnect when the session
 * ends (store resets to idle after save or discard). Demo mode runs the
 * simulated driver instead of BLE.
 */
export function useSensorSession(): void {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const isDemo = useAuthStore.getState().isDemoMode;
    if (isDemo) {
      startSimulatedSensors();
    } else {
      (async () => {
        if (useSensorStore.getState().knownSensors.length === 0) return;
        const granted = await requestBlePermissions();
        if (granted) connectKnownSensors();
      })();
    }

    // Disconnect when the session actually ends, not when the screen unmounts
    // - the user can navigate away mid-recording and return via the pill.
    const unsubscribe = useRecordingStore.subscribe((state, prev) => {
      if (state.status === 'idle' && prev.status !== 'idle') {
        stopSimulatedSensors();
        disconnectAllSensors();
        unsubscribe();
      }
    });

    return () => {
      // Screen unmount with the session already over (stopped→saved happens
      // off this screen, handled by the subscription above)
      if (useRecordingStore.getState().status === 'idle') {
        stopSimulatedSensors();
        disconnectAllSensors();
        unsubscribe();
        startedRef.current = false;
      }
    };
  }, []);
}
