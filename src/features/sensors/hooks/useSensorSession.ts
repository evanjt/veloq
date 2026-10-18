import { useEffect, useRef } from 'react';

import { useAuthStore } from '@/shared/app/AuthStore';
// Deep store import to keep the recording barrel's UI out of this module graph
import { useRecordingStore } from '@/features/recording';
import { useSensorStore } from '../store';
import {
  connectKnownSensors,
  disconnectAllSensors,
  holdSensors,
  holdsSensors,
  releaseSensors,
  type SensorHolder,
  requestBlePermissions,
} from '../lib/sensorManager';
import { startSimulatedSensors, stopSimulatedSensors } from '../lib/simulatedSensors';

/**
 * Ties sensor connections to the recording session. On mount (the live
 * recording screen) it takes the hold on the paired sensors, over the entry
 * screen's when the athlete came from there, and connects any not yet
 * connected; they stay connected across navigation while the session is
 * active and disconnect when the session ends (store resets to idle after
 * save or discard). Demo mode runs the simulated driver instead of BLE.
 */
export function useSensorSession(): void {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return undefined;
    startedRef.current = true;
    holdSensors('session');
    connectPairedSensorsWhenAllowed('session');

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
        releaseSensors('session', { immediate: true });
        unsubscribe();
        startedRef.current = false;
      }
    };
  }, []);
}

/**
 * Connect the paired sensors, or start the simulated driver in demo mode. A
 * refusal is recorded as the sensors' availability, which the recording
 * screens report. Location services off below Android 12 stops a scan, not a
 * connect to a known address. A screen left while the permission was being
 * asked connects nothing.
 */
export function connectPairedSensorsWhenAllowed(holder: SensorHolder): void {
  if (useAuthStore.getState().isDemoMode) {
    startSimulatedSensors();
    return;
  }
  void (async () => {
    if (useSensorStore.getState().knownSensors.length === 0) return;
    const access = await requestBlePermissions();
    if (!holdsSensors(holder)) return;
    if (access === 'granted' || access === 'needsLocation') void connectKnownSensors();
  })();
}
