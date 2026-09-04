import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';

import { debug } from '@/shared/debug/debug';

const log = debug.create('LocationPermission');

/**
 * The foreground location permission. The recording session never prompts,
 * because a denial needs a banner and an alert, so the screen owns the prompt
 * and tells the session once it is granted.
 */
export function useLocationPermission(): {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
} {
  const [hasPermission, setHasPermission] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      log.warn('Foreground location permission denied');
      setHasPermission(false);
      return false;
    }
    setHasPermission(true);
    return true;
  }, []);

  return { hasPermission, requestPermission };
}
