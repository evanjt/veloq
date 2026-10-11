import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

import { useLocationServices } from '@/shared/app/permissions/locationServices';

import { resolveEntryGps, type EntryGpsState } from '../lib/recordEntry';

/** How long the first fix may take before the screen says the signal is weak. */
export const GPS_READINESS_TIMEOUT_MS = 15_000;

export interface EntryLocation {
  state: EntryGpsState;
  location: { latitude: number; longitude: number } | null;
  /** Metres, or null before the first fix. */
  accuracy: number | null;
  /**
   * Whether the location question is behind the athlete: answered, or not
   * asked because the sport needs no position. The next prompt waits for it,
   * because Android shows one dialog at a time.
   */
  promptSettled: boolean;
  /** Turns the device's location switch on where the platform allows it. */
  turnOnServices: () => Promise<void>;
}

type Permission = 'unknown' | 'granted' | 'denied';

async function askForegroundLocation(): Promise<Permission> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status === 'granted') return 'granted';
    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.status === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * The live position on the entry screen, so the armed map shows the dot and its
 * accuracy acquiring before Start.
 *
 * `active` is true while the chosen sport records GPS and no session is live:
 * the session runs its own watch, and an indoor or manual sport earns no
 * location prompt. The prompt is raised on arrival and never by the Start tap,
 * so the tap only navigates.
 *
 * The device's location switch is read before the watch starts and again on
 * every return to the app, so a switch that is off is named at once rather
 * than after the wait for a fix, and the watch starts when it comes on.
 */
export function useEntryLocation(active: boolean): EntryLocation {
  const services = useLocationServices(active);
  const servicesOn = services.enabled === true;
  const [permission, setPermission] = useState<Permission>('unknown');
  const [fix, setFix] = useState<{
    location: { latitude: number; longitude: number };
    accuracy: number | null;
  } | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!active || permission !== 'unknown') return undefined;
    let cancelled = false;
    void askForegroundLocation().then((answer) => {
      if (!cancelled) setPermission(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [active, permission]);

  useEffect(() => {
    if (!active || permission !== 'granted' || !servicesOn) return undefined;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    const timeout = setTimeout(() => {
      if (!cancelled) setTimedOut(true);
    }, GPS_READINESS_TIMEOUT_MS);

    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
      (position) => {
        if (cancelled) return;
        const { latitude, longitude, accuracy } = position.coords;
        setFix({ location: { latitude, longitude }, accuracy: accuracy ?? null });
      }
    )
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => {
        if (!cancelled) setTimedOut(true);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      subscription?.remove();
      // A watch that starts again, when the switch comes back on, waits for
      // its own first fix rather than showing the last one.
      setFix(null);
      setTimedOut(false);
    };
  }, [active, permission, servicesOn]);

  const state = resolveEntryGps({
    servicesEnabled: active ? services.enabled : null,
    permission,
    fix,
    timedOut,
  });
  const shown = state === 'servicesOff' || state === 'none' ? null : fix;
  return {
    state,
    location: shown?.location ?? null,
    accuracy: shown?.accuracy ?? null,
    promptSettled: !active || permission !== 'unknown',
    turnOnServices: services.turnOn,
  };
}
