import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

/**
 * The device's own location switch, which is not the app's permission. Android
 * grants the permission with the switch off and sends no fix, and iOS reports
 * the permission denied, so a reader that checks only the permission either
 * waits for a fix that never comes or sends the athlete to the app's settings
 * page, where the switch is not.
 */

/**
 * Whether the switch is on. Only a read that says off counts as off: one that
 * fails or answers nothing falls back to waiting for a fix, rather than
 * claiming a cause nobody saw.
 */
export async function readLocationServices(): Promise<boolean> {
  try {
    return (await Location.hasServicesEnabledAsync()) !== false;
  } catch {
    return true;
  }
}

/**
 * Whether the app can turn the switch on itself. Android offers a system
 * dialog from inside the app; iOS has no way in to the switch, so the copy
 * names where it is instead.
 */
export function canTurnOnLocationServices(): boolean {
  return Platform.OS === 'android';
}

/**
 * Raises Android's dialog that turns location on, and answers whether the
 * switch is on afterwards. A refused dialog rejects, which is an answer, not a
 * failure.
 */
export async function turnOnLocationServices(): Promise<boolean> {
  if (canTurnOnLocationServices()) {
    await Location.enableNetworkProviderAsync().catch(() => undefined);
  }
  return readLocationServices();
}

/**
 * The switch, read while `active` and again each time the app comes back to
 * the front: from the system settings, or on Android from the quick settings
 * shade, which takes window focus but leaves the app active. Null until the
 * first read lands.
 */
export function useLocationServices(active: boolean): {
  enabled: boolean | null;
  turnOn: () => Promise<void>;
} {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const read = () => {
      void readLocationServices().then((on) => {
        if (!cancelled) setEnabled(on);
      });
    };
    read();
    const change = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', read) : null;
    return () => {
      cancelled = true;
      change.remove();
      focus?.remove();
    };
  }, [active]);

  const turnOn = useCallback(async () => {
    setEnabled(await turnOnLocationServices());
  }, []);

  return { enabled, turnOn };
}
