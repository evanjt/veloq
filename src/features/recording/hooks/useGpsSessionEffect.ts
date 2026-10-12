import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
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
import { openAppSettings } from '@/shared/app/permissions';
import type { LocationPrecision } from '@/shared/app/permissions/locationGrant';
import { GPS_WARNING_MS, GPS_ALERT_MS } from '../lib/constants';
import { locationServicesOffMessage } from '../lib/locationServicesCopy';
import type { RecordingMode, RecordingStatus } from '../types';
import type { SetGpsWarning } from './useRecordingScreenState';
import { chooseAction } from '@/shared/ui/dialog';

const log = debug.create('RecordingScreen');

/**
 * The screen's half of the GPS session: the permission prompt and the
 * signal-loss warnings. Under an approximate grant every fix is too coarse for
 * the session to keep, so the warnings name that instead of the signal. The
 * watch itself belongs to the recording session, so
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
  precision,
  requestPermission,
  upgradePrecision,
  setGpsWarning,
}: {
  mode: RecordingMode;
  status: RecordingStatus;
  hasPermission: boolean;
  precision: LocationPrecision;
  requestPermission: () => Promise<boolean>;
  upgradePrecision: () => Promise<void>;
  setGpsWarning: SetGpsWarning;
}) {
  const { t } = useTranslation();

  const gpsSessionActive = mode === 'gps' && (status === 'recording' || status === 'paused');
  const services = useLocationServices(gpsSessionActive);

  // The timers below outlive the render that armed them, so they read the
  // grant through a ref: an upgrade mid-ride changes what they say.
  const approximateRef = useRef(precision === 'approximate');

  /**
   * The line a ride with no fix shows: the switch when it is off, then an
   * approximate grant, else the wait.
   */
  const noFixWarning = async (): Promise<string> => {
    if (!(await readLocationServices())) return locationServicesOffMessage(t);
    return approximateRef.current
      ? t('recording.gpsApproximateWarning')
      : t('recording.gpsWaiting');
  };

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

  useEffect(() => {
    approximateRef.current = precision === 'approximate';
    // A switch that is off is the cause to name, so the grant waits for the
    // switch to read on, and is said again when it comes back on.
    if (gpsSessionActive && precision === 'approximate' && services.enabled === true) {
      setGpsWarning(t('recording.gpsApproximateWarning'));
    }
  }, [gpsSessionActive, precision, services.enabled]); // eslint-disable-line react-hooks/exhaustive-deps -- Said once per session, per change of grant and per change of switch.

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
              setGpsWarning(t('recording.gpsPermissionDenied'), { opensSettings: true });
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
                if (!on) showServicesOffAlert();
                else if (approximateRef.current) showApproximateAlert();
                else showNoFixAlert();
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

    // Stop goes first in each alert below so Android never makes it the
    // positive button: a tap meant for the primary slot must not end the ride.
    const stopAction = {
      label: t('recording.gpsAlertStop'),
      destructive: true,
      onPress: () => void endRecordingSession(),
    };

    function showNoFixAlert() {
      chooseAction({
        title: t('recording.gpsAlertTitle'),
        message: t('recording.gpsAlertMessage'),
        cancelLabel: t('recording.gpsAlertContinue'),
        onCancel: () => setGpsWarning(null),
        actions: [stopAction, { label: t('common.openSettings'), onPress: openAppSettings }],
      });
    }

    // Every fix under an approximate grant is dropped, so the cause is the
    // grant and not the sky. Android upgrades in place; iOS opens Settings.
    function showApproximateAlert() {
      chooseAction({
        title: t('recording.gpsApproximateAlertTitle'),
        message: t('recording.gpsApproximateAlertMessage'),
        cancelLabel: t('recording.gpsAlertContinue'),
        actions: [
          stopAction,
          {
            label: t(
              Platform.OS === 'android' ? 'recording.gpsApproximateAllow' : 'common.openSettings'
            ),
            onPress: () => void upgradePrecision(),
          },
        ],
      });
    }

    // The app's settings page does not hold the switch, so this alert never
    // offers it. Android turns the switch on from here; iOS names where it is.
    function showServicesOffAlert() {
      chooseAction({
        title: t('recording.gpsServicesOffTitle'),
        message: locationServicesOffMessage(t),
        cancelLabel: t('recording.gpsAlertContinue'),
        actions: canTurnOnLocationServices()
          ? [
              stopAction,
              { label: t('recording.gpsServicesTurnOn'), onPress: () => void services.turnOn() },
            ]
          : [stopAction],
      });
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
