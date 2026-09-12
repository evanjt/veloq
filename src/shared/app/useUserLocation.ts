/**
 * Hook to get the user's current location for proximity sorting.
 * Uses cached/last-known position first, falls back to a balanced GPS fix.
 * Does not prompt for permission - degrades silently if denied.
 *
 * The fix carries the time it was taken. A fix held for the life of the process
 * sorted a travelling athlete's routes against the city they left, and only a
 * force-quit cleared it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import type { LatLng } from '@/shared/geo/distance';

/**
 * How long a fix stands. Proximity sorting is coarse, so a fix is worth reusing
 * across a session's screens, but not across the ride that moved the athlete.
 */
export const LOCATION_TTL_MS = 10 * 60 * 1000;

interface Fix {
  value: LatLng;
  at: number;
}

let cachedFix: Fix | null = null;
let requestInFlight = false;

/** A fix nobody has taken, or one older than the window, has to be asked again. */
export function fixIsStale(fix: Fix | null, now: number): boolean {
  return fix === null || now - fix.at >= LOCATION_TTL_MS;
}

/** Test seam: the module cache outlives a render, so a test has to clear it. */
export function forgetCachedLocation(): void {
  cachedFix = null;
}

async function fetchLocation(): Promise<LatLng | null> {
  const last = await Location.getLastKnownPositionAsync();
  if (last) {
    return { lat: last.coords.latitude, lng: last.coords.longitude };
  }
  const current = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  return { lat: current.coords.latitude, lng: current.coords.longitude };
}

export function useUserLocation(): {
  location: LatLng | null;
  isLoading: boolean;
  requestPermission: () => Promise<LatLng | null>;
} {
  const [location, setLocation] = useState<LatLng | null>(cachedFix?.value ?? null);
  const [isLoading, setIsLoading] = useState(cachedFix === null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (isCancelled: () => boolean) => {
    if (!fixIsStale(cachedFix, Date.now())) return;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (!isCancelled()) setIsLoading(false);
        return;
      }

      const loc = await fetchLocation();
      if (loc && !isCancelled()) {
        cachedFix = { value: loc, at: Date.now() };
        setLocation(loc);
        setIsLoading(false);
      }
    } catch {
      if (!isCancelled()) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    // Deferred so the first fix does not set state inside the effect body.
    const initial = setTimeout(() => void refresh(isCancelled), 0);

    // The screen stays mounted across a backgrounding, so foreground is the one
    // moment a stale fix can be noticed without a timer.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(isCancelled);
    });

    return () => {
      cancelled = true;
      clearTimeout(initial);
      sub.remove();
    };
  }, [refresh]);

  const requestPermission = useCallback(async (): Promise<LatLng | null> => {
    const held = cachedFix;
    if (held && !fixIsStale(held, Date.now())) return held.value;
    if (requestInFlight) return null;

    requestInFlight = true;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;

      const loc = await fetchLocation();
      if (loc) {
        cachedFix = { value: loc, at: Date.now() };
        if (mountedRef.current) {
          setLocation(loc);
          setIsLoading(false);
        }
      }
      return loc;
    } catch {
      return null;
    } finally {
      requestInFlight = false;
    }
  }, []);

  return { location, isLoading, requestPermission };
}
