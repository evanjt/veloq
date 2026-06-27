import { useEffect } from 'react';

type CurrentLocation = { latitude: number; longitude: number } | null;

// Clear GPS warning once we get a valid location
export function useGpsWarningClearEffect(
  currentLocation: CurrentLocation,
  gpsWarning: string | null,
  setGpsWarning: (warning: string | null) => void
) {
  useEffect(() => {
    if (currentLocation && gpsWarning) {
      setGpsWarning(null);
    }
  }, [currentLocation, gpsWarning, setGpsWarning]);
}
