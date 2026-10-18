import { useEffect } from 'react';

import { useSensorStore } from '../store';
import { holdSensors, releaseSensors } from '../lib/sensorManager';
import { connectPairedSensorsWhenAllowed } from './useSensorSession';

/**
 * Holds the paired sensors connected while the record entry screen is open,
 * so their state and values show before Start. The recording screen takes the
 * hold over on Start, and leaving without starting disconnects them.
 *
 * `allowed` waits for the entry screen's location question to be behind the
 * athlete, because Android shows one permission dialog at a time.
 */
export function useEntrySensors(allowed: boolean): void {
  const isLoaded = useSensorStore((s) => s.isLoaded);

  useEffect(() => {
    if (!isLoaded) void useSensorStore.getState().initialise();
  }, [isLoaded]);

  useEffect(() => {
    if (!allowed || !isLoaded) return undefined;
    holdSensors('entry');
    connectPairedSensorsWhenAllowed('entry');
    return () => releaseSensors('entry');
  }, [allowed, isLoaded]);
}
