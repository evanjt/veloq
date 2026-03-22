/**
 * Hook to get the user's current location for proximity sorting.
 * Uses cached/last-known position first, falls back to a balanced GPS fix.
 * Does not prompt for permission — degrades silently if denied.
 */

import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLng } from '@/lib/geo/distance';

let cachedLocation: LatLng | null = null;

export function useUserLocation(): { location: LatLng | null; isLoading: boolean } {
  const [location, setLocation] = useState<LatLng | null>(cachedLocation);
  const [isLoading, setIsLoading] = useState(cachedLocation === null);

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

        // Try instant last-known position first
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled) {
          cachedLocation = { lat: last.coords.latitude, lng: last.coords.longitude };
          setLocation(cachedLocation);
          setIsLoading(false);
          return;
        }

        // Fall back to a fresh GPS fix
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          cachedLocation = { lat: current.coords.latitude, lng: current.coords.longitude };
          setLocation(cachedLocation);
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

  return { location, isLoading };
}
