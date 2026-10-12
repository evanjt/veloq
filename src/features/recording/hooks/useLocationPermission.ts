import { useState, useEffect, useCallback } from 'react';
import { AppState } from 'react-native';

import {
  readLocationGrant,
  requestLocationGrant,
  upgradeLocationPrecision,
  type LocationPrecision,
} from '@/shared/app/permissions/locationGrant';
import { debug } from '@/shared/debug/debug';

const log = debug.create('LocationPermission');

/**
 * The foreground location permission and how precise it is. The recording
 * session never prompts, because a denial needs a banner and an alert, so the
 * screen owns the prompt and tells the session once it is granted.
 */
export function useLocationPermission(): {
  hasPermission: boolean;
  precision: LocationPrecision;
  requestPermission: () => Promise<boolean>;
  upgradePrecision: () => Promise<void>;
} {
  const [hasPermission, setHasPermission] = useState(false);
  const [precision, setPrecision] = useState<LocationPrecision>('precise');

  useEffect(() => {
    let cancelled = false;
    const read = () =>
      readLocationGrant()
        .then((grant) => {
          if (cancelled) return;
          setHasPermission(grant.granted);
          setPrecision(grant.precision);
        })
        .catch(() => {});
    void read();
    // iOS offers the Precise switch only in Settings, so the grant is read
    // again when the athlete comes back.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void read();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const grant = await requestLocationGrant();
    setPrecision(grant.precision);
    if (!grant.granted) {
      log.warn('Foreground location permission denied');
      setHasPermission(false);
      return false;
    }
    setHasPermission(true);
    return true;
  }, []);

  const upgradePrecision = useCallback(async (): Promise<void> => {
    const grant = await upgradeLocationPrecision();
    if (grant?.granted) setPrecision(grant.precision);
  }, []);

  return { hasPermission, precision, requestPermission, upgradePrecision };
}
