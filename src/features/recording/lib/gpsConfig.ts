import * as Location from 'expo-location';

import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import type { GpsAccuracyMode } from '@/features/recording/stores/RecordingPreferencesStore';

export interface GpsWatchOptions {
  accuracy: Location.Accuracy;
  timeInterval: number;
  distanceInterval: number;
}

/** Sampling presets: accuracy and rate vs battery cost. */
const GPS_MODE_OPTIONS: Record<GpsAccuracyMode, GpsWatchOptions> = {
  high: {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 1000,
    distanceInterval: 5,
  },
  balanced: {
    accuracy: Location.Accuracy.High,
    timeInterval: 2000,
    distanceInterval: 10,
  },
  batterySaver: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5000,
    distanceInterval: 20,
  },
};

export function getGpsWatchOptions(): GpsWatchOptions {
  const mode = useRecordingPreferences.getState().gpsAccuracyMode;
  return GPS_MODE_OPTIONS[mode] ?? GPS_MODE_OPTIONS.high;
}

/** GPS points less accurate than this (metres) are discarded at ingestion. */
export function getAccuracyRejectThreshold(): number {
  return useRecordingPreferences.getState().accuracyRejectThreshold;
}

/**
 * A fix's altitude, or null when it has none. Core Location reports an invalid
 * altitude as a number beside a negative vertical accuracy, so the number alone
 * would record sea level for a reading that does not exist.
 */
export function fixAltitude(coords: {
  altitude: number | null;
  altitudeAccuracy?: number | null;
}): number | null {
  if (coords.altitudeAccuracy != null && coords.altitudeAccuracy < 0) return null;
  return coords.altitude;
}
