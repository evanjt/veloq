import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { ensureLocationWatch } from '@/features/recording/lib/recordingSession';
import { debug } from '@/shared/debug/debug';
import { GPS_WARNING_MS, GPS_ALERT_MS } from '../lib/constants';
import type { RecordingMode, RecordingStatus } from '../types';

const log = debug.create('RecordingScreen');

/**
 * The screen's half of the GPS session: the permission prompt and the
 * signal-loss warnings. The watch itself belongs to the recording session, so
 * nothing here starts or stops it and leaving the screen does not end the ride.
 */
export function useGpsSessionEffect({
  mode,
  status,
  hasPermission,
  requestPermission,
  setGpsWarning,
  onDiscard,
}: {
  mode: RecordingMode;
  status: RecordingStatus;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  setGpsWarning: (warning: string | null) => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();

  const gpsSessionActive = mode === 'gps' && (status === 'recording' || status === 'paused');

  // Mid-session signal-loss watchdog. The one-shot timers below only cover a
  // missing FIRST fix; this covers the signal dropping later (tunnel, canyon,
  // indoors). Cleared automatically by useGpsWarningClearEffect on regain.
  useEffect(() => {
    if (!gpsSessionActive) return;
    const interval = setInterval(() => {
      const last = useRecordingLiveStore.getState().lastFixAt;
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
              log.warn('Location permission denied - pausing recording');
              setGpsWarning(t('recording.gpsPermissionDenied'));
              useRecordingStore.getState().pauseRecording();
            }
            return;
          }
        }
        // The session starts the watch itself when the permission was already
        // granted; this covers the run where the rider has just granted it.
        await ensureLocationWatch();

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
    };
  }, [gpsSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps
}
