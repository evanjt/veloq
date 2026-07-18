import { useEffect, useRef } from 'react';

type CurrentLocation = { latitude: number; longitude: number } | null;

// Clear the GPS warning when a NEW fix arrives. Each location callback creates
// a fresh currentLocation object, so identity change = new fix. Comparing
// identity (not truthiness) matters: after a mid-session signal loss the stale
// location is still truthy, and clearing on it would wipe the warning the
// moment it was set.
export function useGpsWarningClearEffect(
  currentLocation: CurrentLocation,
  gpsWarning: string | null,
  setGpsWarning: (warning: string | null) => void
) {
  const prevLocationRef = useRef<CurrentLocation>(null);

  useEffect(() => {
    const isNewFix = currentLocation != null && currentLocation !== prevLocationRef.current;
    prevLocationRef.current = currentLocation;
    if (isNewFix && gpsWarning) {
      setGpsWarning(null);
    }
  }, [currentLocation, gpsWarning, setGpsWarning]);
}
