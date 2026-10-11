import { useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { ensureLocationWatch } from '@/features/recording/lib/recordingSession';
import { endRecordingSession } from '@/features/recording/lib/endRecordingSession';
import { isPositioned } from '@/shared/geo/routePreview';
import { debug } from '@/shared/debug/debug';
import {
  canTurnOnLocationServices,
  readLocationServices,
  useLocationServices,
} from '@/shared/app/permissions/locationServices';
import { GPS_WARNING_MS, GPS_ALERT_MS } from '../lib/constants';
import { locationServicesOffMessage } from '../lib/locationServicesCopy';
import type { RecordingMode, RecordingStatus } from '../types';

const log = debug.create('RecordingScreen');

/**
 * The screen's half of the GPS session: the permission prompt and the
 * signal-loss warnings. The watch itself belongs to the recording session, so
 * leaving the screen does not end the ride. The one thing here that does is the
 * no-fix alert's stop, which is the stop every surface uses, so it reaches
 * review with the ride and its backup intact.
 *
 * The device's location switch is read before either and again whenever the
 * app comes back, so a switch that is off is named at once, and the no-fix
 * alert offers the switch rather than the app's settings page.
 */
export function useGpsSessionEffect({
  mode,
  status,
  hasPermission,
  requestPermission,
  setGpsWarning,
}: {
  mode: RecordingMode;
  status: RecordingStatus;
  hasPermission: boolean;
  requestPermission: () => Promise<boolean>;
  setGpsWarning: (warning: string | null) => void;
}) {
  const { t } = useTranslation();

  const gpsSessionActive = mode === 'gps' && (status === 'recording' || status === 'paused');
  const services = useLocationServices(gpsSessionActive);

  /** The line a ride with no fix shows: the switch when it is off, else the wait. */
  const noFixWarning = async (): Promise<string> =>
    (await readLocationServices()) ? t('recording.gpsWaiting') : locationServicesOffMessage(t);

  // The switch turned off or back on during the ride, read on each return to
  // the app. Off is named at once. Back on clears that line and only that
  // one, so the ride goes back to waiting for its fix.
  const servicesWereOff = useRef(false);
  useEffect(() => {
    if (!gpsSessionActive || services.enabled == null) return;
    if (!services.enabled) {
      servicesWereOff.current = true;
      setGpsWarning(locationServicesOffMessage(t));
    } else if (servicesWereOff.current) {
      servicesWereOff.current = false;
      setGpsWarning(null);
    }
  }, [gpsSessionActive, services.enabled]); // eslint-disable-line react-hooks/exhaustive-deps -- Only the switch moving changes the line.

  // Mid-session signal-loss watchdog. The one-shot timers below only cover a
  // missing FIRST fix; this covers the signal dropping later (tunnel, canyon,
  // indoors). Cleared automatically by useGpsWarningClearEffect on regain.
  useEffect(() => {
    if (!gpsSessionActive) return undefined;
    const interval = setInterval(() => {
      const last = useRecordingLiveStore.getState().lastFixAt;
      if (last != null && Date.now() - last > GPS_WARNING_MS) {
        void noFixWarning().then(setGpsWarning);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [gpsSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps -- Only session activation starts the watchdog.

  useEffect(() => {
    if (!gpsSessionActive) return undefined;
    let cancelled = false;
    let gpsWarningTimer: ReturnType<typeof setTimeout> | null = null;
    let gpsAlertTimer: ReturnType<typeof setTimeout> | null = null;
    let gpsAlertShown = false;

    (async () => {
      try {
        // With the switch off iOS reports the permission denied and Android
        // sends no fix, so the switch is the cause to name, and asking for the
        // permission again would only name the wrong one. The ride carries on:
        // its watch starts when the switch comes back on.
        if (!(await readLocationServices())) {
          if (!cancelled) {
            log.warn('Location services are off');
            setGpsWarning(locationServicesOffMessage(t));
          }
        } else if (!hasPermission) {
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
            if (!loc.some(([lat, lng]) => isPositioned(lat, lng))) {
              void noFixWarning().then((warning) => {
                if (!cancelled) setGpsWarning(warning);
              });
            }
          }, GPS_WARNING_MS);
        }

        // Stage 2: Alert dialog after 60s without GPS
        if (!cancelled) {
          gpsAlertTimer = setTimeout(() => {
            const loc = useRecordingStore.getState().streams.latlng;
            if (!loc.some(([lat, lng]) => isPositioned(lat, lng)) && !gpsAlertShown) {
              gpsAlertShown = true;
              void readLocationServices().then((on) => {
                if (cancelled) return;
                if (on) showNoFixAlert();
                else showServicesOffAlert();
              });
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

    function showNoFixAlert() {
      Alert.alert(t('recording.gpsAlertTitle'), t('recording.gpsAlertMessage'), [
        {
          text: t('recording.gpsAlertContinue'),
          style: 'cancel',
          onPress: () => setGpsWarning(null),
        },
        {
          text: t('recording.gpsAlertSettings'),
          onPress: () => Linking.openSettings(),
        },
        {
          text: t('recording.gpsAlertStop'),
          style: 'destructive',
          onPress: () => void endRecordingSession(),
        },
      ]);
    }

    // The app's settings page does not hold the switch, so this alert never
    // offers it. Android turns the switch on from here; iOS names where it is.
    function showServicesOffAlert() {
      Alert.alert(t('recording.gpsServicesOffTitle'), locationServicesOffMessage(t), [
        {
          text: t('recording.gpsAlertContinue'),
          style: 'cancel',
        },
        ...(canTurnOnLocationServices()
          ? [
              {
                text: t('recording.gpsServicesTurnOn'),
                onPress: () => void services.turnOn(),
              },
            ]
          : []),
        {
          text: t('recording.gpsAlertStop'),
          style: 'destructive' as const,
          onPress: () => void endRecordingSession(),
        },
      ]);
    }

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
  }, [gpsSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps -- One warning sequence belongs to each active session.
}
