/**
 * Hook to get the user's current location for proximity sorting.
 * Uses cached/last-known position first, falls back to a balanced GPS fix.
 * Does not prompt for permission — degrades silently if denied.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '@/lib/geo/distance';

let cachedLocation: LatLng | null = null;
let requestInFlight = false;

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
  const [location, setLocation] = useState<LatLng | null>(cachedLocation);
  const [isLoading, setIsLoading] = useState(cachedLocation === null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (cachedLocation) return;

    let cancelled = false;

    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setIsLoading(false);
          return;
        }

        const loc = await fetchLocation();
        if (loc && !cancelled) {
          cachedLocation = loc;
          setLocation(loc);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<LatLng | null> => {
    if (cachedLocation) return cachedLocation;
    if (requestInFlight) return null;

    requestInFlight = true;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;

      const loc = await fetchLocation();
      if (loc) {
        cachedLocation = loc;
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
