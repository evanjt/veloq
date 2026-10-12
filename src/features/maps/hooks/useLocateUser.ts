/**
 * The locate button: ask for a foreground fix, hold it for the dot and ease the
 * camera onto it. The caller chooses the camera that is on screen.
 */
import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { askForegroundLocation } from '@/shared/app/permissions';

/** A fix younger than this is reused rather than asking the GPS again. */
export const LOCATION_CACHE_MAX_AGE_MS = 30000;

export const LOCATE_ZOOM = 13;
export const LOCATE_EASE_MS = 500;

export interface LocationFix {
  coords: [number, number]; // [lng, lat]
  timestamp: number;
}

/** The part of a map surface the locate flow drives. */
export interface LocateCameraTarget {
  setCamera: (camera: { center: [number, number]; zoom: number }, durationMs: number) => void;
}

export function fixIsFresh(fix: LocationFix | null, now: number): fix is LocationFix {
  return fix !== null && now - fix.timestamp < LOCATION_CACHE_MAX_AGE_MS;
}

interface UseLocateUserResult {
  userLocation: [number, number] | null;
  locationLoading: boolean;
  locate: (target: LocateCameraTarget | null | undefined) => Promise<void>;
}

export function useLocateUser(): UseLocateUserResult {
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const lastFixRef = useRef<LocationFix | null>(null);

  const locate = useCallback(async (target: LocateCameraTarget | null | undefined) => {
    try {
      setLocationLoading(true);

      // An approximate grant is enough to centre the map on.
      if ((await askForegroundLocation()) !== 'granted') {
        setLocationLoading(false);
        return;
      }

      const now = Date.now();
      let coords: [number, number];
      if (fixIsFresh(lastFixRef.current, now)) {
        coords = lastFixRef.current.coords;
      } else {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = [location.coords.longitude, location.coords.latitude];
        lastFixRef.current = { coords, timestamp: now };
      }

      setUserLocation(coords);
      setLocationLoading(false);

      target?.setCamera({ center: coords, zoom: LOCATE_ZOOM }, LOCATE_EASE_MS);
    } catch {
      // Location is optional: a failed fix leaves the map where it was.
      setLocationLoading(false);
    }
  }, []);

  return { userLocation, locationLoading, locate };
}
