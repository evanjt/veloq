import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { useRecordingStore } from '@/providers/RecordingStore';
import {
  startBackgroundLocation,
  stopBackgroundLocation,
} from '@/lib/recording/backgroundLocation';
import { debug } from '@/lib';

const log = debug.create('LocationTracking');

export function useLocationTracking(): {
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  currentLocation: { latitude: number; longitude: number } | null;
  accuracy: number | null;
} {
  const { t } = useTranslation();
  const [hasPermission, setHasPermission] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const isTrackingRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const bgNotificationRef = useRef({
    notificationTitle: t('recording.backgroundNotificationTitle', 'Recording activity'),
    notificationBody: t('recording.backgroundNotificationBody', 'Veloq is tracking your location'),
  });

  // Check permission on mount
  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const requestPermission = useCallback(async (): Promise<boolean> => {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      log.warn('Foreground location permission denied');
      setHasPermission(false);
      return false;
    }

    try {
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        log.warn('Background location permission denied (foreground granted)');
      }
    } catch (e) {
      log.warn('Background location not available:', e);
    }

    setHasPermission(true);
    return true;
  }, []);

  const startForegroundWatch = useCallback(async () => {
    if (watchRef.current) return;

    log.log('Starting foreground location watch');
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 5,
      },
      (location) => {
        const { latitude, longitude, altitude, accuracy: acc, speed, heading } = location.coords;
        setCurrentLocation({ latitude, longitude });
        setAccuracy(acc);

        // Drop low-accuracy points (>30m) to reduce GPS noise
        if (acc != null && acc > 30) return;

        const { addGpsPoint, status } = useRecordingStore.getState();
        if (status === 'recording') {
          addGpsPoint({
            latitude,
            longitude,
            altitude,
            accuracy: acc,
            speed,
            heading,
            timestamp: location.timestamp,
          });
        }
      }
    );
  }, []);

  const stopForegroundWatch = useCallback(() => {
    if (watchRef.current) {
      log.log('Stopping foreground location watch');
      watchRef.current.remove();
      watchRef.current = null;
    }
  }, []);

  // Handle app state transitions for background/foreground location
  useEffect(() => {
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (!isTrackingRef.current) return;

      if (prevState === 'active' && nextState.match(/inactive|background/)) {
        // App going to background — switch to background location
        log.log('App backgrounded, switching to background location');
        stopForegroundWatch();
        try {
          await startBackgroundLocation(bgNotificationRef.current);
        } catch (e) {
          log.error('Failed to start background location:', e);
        }
      } else if (prevState.match(/inactive|background/) && nextState === 'active') {
        // App coming to foreground — switch back to foreground watch
        log.log('App foregrounded, switching to foreground location');
        try {
          await stopBackgroundLocation();
        } catch (e) {
          log.error('Failed to stop background location:', e);
        }
        await startForegroundWatch();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [startForegroundWatch, stopForegroundWatch]);

  const startTracking = useCallback(async () => {
    if (isTrackingRef.current) return;
    isTrackingRef.current = true;
    log.log('Starting location tracking');
    await startForegroundWatch();
  }, [startForegroundWatch]);

  const stopTracking = useCallback(async () => {
    if (!isTrackingRef.current) return;
    isTrackingRef.current = false;
    log.log('Stopping location tracking');
    stopForegroundWatch();
    try {
      await stopBackgroundLocation();
    } catch (e) {
      log.error('Failed to stop background location:', e);
    }
    setCurrentLocation(null);
    setAccuracy(null);
  }, [stopForegroundWatch]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isTrackingRef.current) {
        isTrackingRef.current = false;
        if (watchRef.current) {
          watchRef.current.remove();
          watchRef.current = null;
        }
        stopBackgroundLocation().catch(() => {});
      }
    };
  }, []);

  return {
    hasPermission,
    requestPermission,
    startTracking,
    stopTracking,
    currentLocation,
    accuracy,
  };
}
