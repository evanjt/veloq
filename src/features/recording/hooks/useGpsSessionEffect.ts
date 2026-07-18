import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { debug } from '@/shared/debug/debug';
import { GPS_WARNING_MS, GPS_ALERT_MS } from '../lib/constants';
import type { RecordingMode, RecordingStatus } from '../types';

const log = debug.create('RecordingScreen');

type LocationTracking = {
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  lastFixAtRef: { current: number | null };
};

// Start location tracking for GPS mode. Keyed on the session being active
// (recording or paused) rather than `status` directly, so auto-pause does not
// tear down and restart the location watcher. Points received while paused are
// dropped at ingestion by the recording store's addGpsPoint guard.
export function useGpsSessionEffect({
  mode,
  status,
  location,
  setGpsWarning,
  onDiscard,
}: {
  mode: RecordingMode;
  status: RecordingStatus;
  location: LocationTracking;
  setGpsWarning: (warning: string | null) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const { startTracking, stopTracking, hasPermission, requestPermission, lastFixAtRef } = location;

  const gpsSessionActive = mode === 'gps' && (status === 'recording' || status === 'paused');

  // Mid-session signal-loss watchdog. The one-shot timers below only cover a
  // missing FIRST fix; this covers the signal dropping later (tunnel, canyon,
  // indoors). Cleared automatically by useGpsWarningClearEffect on regain.
  useEffect(() => {
    if (!gpsSessionActive) return;
    const interval = setInterval(() => {
      const last = lastFixAtRef.current;
      if (last != null && Date.now() - last > GPS_WARNING_MS) {
        setGpsWarning(t('recording.gpsWaiting'));
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [gpsSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gpsSessionActive) return;
    let cancelled = false;
    let gpsWarningTimer: ReturnType<typeof setTimeout> | null = null;
    let gpsAlertTimer: ReturnType<typeof setTimeout> | null = null;
    let gpsAlertShown = false;

    (async () => {
      try {
        if (!hasPermission) {
          const granted = await requestPermission();
          if (!granted) {
            if (!cancelled) {
              log.warn('Location permission denied — pausing recording');
              setGpsWarning(t('recording.gpsPermissionDenied'));
              useRecordingStore.getState().pauseRecording();
            }
            return;
          }
        }
        await startTracking();

        // Stage 1: Warning banner after 20s without GPS
        if (!cancelled) {
          gpsWarningTimer = setTimeout(() => {
            const loc = useRecordingStore.getState().streams.latlng;
            if (loc.length === 0) {
              setGpsWarning(t('recording.gpsWaiting'));
            }
          }, GPS_WARNING_MS);
        }

        // Stage 2: Alert dialog after 60s without GPS
        if (!cancelled) {
          gpsAlertTimer = setTimeout(() => {
            const loc = useRecordingStore.getState().streams.latlng;
            if (loc.length === 0 && !gpsAlertShown) {
              gpsAlertShown = true;
              Alert.alert(
                t('recording.gpsAlertTitle', 'GPS Signal Not Found'),
                t(
                  'recording.gpsAlertMessage',
                  'Unable to get a GPS fix. Check that location services are enabled and you have a clear view of the sky.'
                ),
                [
                  {
                    text: t('recording.gpsAlertContinue', 'Continue Without GPS'),
                    style: 'cancel',
                    onPress: () => setGpsWarning(null),
                  },
                  {
                    text: t('recording.gpsAlertSettings', 'Open Settings'),
                    onPress: () => Linking.openSettings(),
                  },
                  {
                    text: t('recording.gpsAlertStop', 'Stop Recording'),
                    style: 'destructive',
                    onPress: () => onDiscard(),
                  },
                ]
              );
            }
          }, GPS_ALERT_MS);
        }
      } catch (e) {
        log.error('Failed to start location tracking:', e);
        if (!cancelled) {
          setGpsWarning(t('recording.gpsTrackingError'));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (gpsWarningTimer) {
        clearTimeout(gpsWarningTimer);
        gpsWarningTimer = null;
      }
      if (gpsAlertTimer) {
        clearTimeout(gpsAlertTimer);
        gpsAlertTimer = null;
      }
      stopTracking();
    };
  }, [gpsSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps
}
