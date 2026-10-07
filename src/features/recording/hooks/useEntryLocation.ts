import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

import { entryGpsState, type EntryGpsState } from '../lib/recordEntry';

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
 */
export function useEntryLocation(active: boolean): EntryLocation {
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
    if (!active || permission !== 'granted') return undefined;
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
    };
  }, [active, permission]);

  const promptSettled = !active || permission !== 'unknown';
  if (permission === 'denied')
    return { state: 'none', location: null, accuracy: null, promptSettled };
  if (fix) return { state: entryGpsState(fix.accuracy), ...fix, promptSettled };
  return { state: timedOut ? 'weak' : 'checking', location: null, accuracy: null, promptSettled };
}
