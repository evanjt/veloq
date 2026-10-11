/**
 * Scenario: a GPS ride starts with the phone's location switch off. Android
 * holds the permission and sends no fix; iOS reports the permission denied.
 *
 * Expected behaviour: the ride names the switch at once and keeps recording,
 * rather than waiting 20 s to call the signal weak or pausing on a denial. The
 * no-fix alert names the switch and never offers the app's settings page,
 * which does not hold it: Android turns it on from the alert, iOS says where
 * it is.
 */

import { Alert, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';
import { GPS_ALERT_MS, GPS_WARNING_MS } from '@/features/recording/lib/constants';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  hasServicesEnabledAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
}));

jest.mock('@/features/recording/lib/recordingSession', () => ({
  ensureLocationWatch: jest.fn().mockResolvedValue(false),
}));

const location = Location as jest.Mocked<typeof Location>;
const originalOS = Platform.OS;
const requestPermission = jest.fn();
const setGpsWarning = jest.fn();

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function mountRide(hasPermission: boolean) {
  return renderHook(() =>
    useGpsSessionEffect({
      mode: 'gps',
      status: useRecordingStore((s) => s.status),
      hasPermission,
      requestPermission,
      setGpsWarning,
    })
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

function lastWarning(): string | null {
  const calls = setGpsWarning.mock.calls;
  return calls.length ? (calls[calls.length - 1][0] as string | null) : null;
}

function alertButtons(): AlertButton[] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][2] as AlertButton[];
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  location.hasServicesEnabledAsync.mockResolvedValue(false);
  location.enableNetworkProviderAsync.mockResolvedValue(undefined);
  requestPermission.mockResolvedValue(false);
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
});

describe('a ride on Android with location off', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('names the switch at once and keeps recording', async () => {
    mountRide(true);
    await flush();

    expect(lastWarning()).toBe('recording.gpsServicesOffAndroid');
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('still names the switch, not the wait, once the warning delay has passed', async () => {
    mountRide(true);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(GPS_WARNING_MS);
    });
    await flush();

    expect(lastWarning()).toBe('recording.gpsServicesOffAndroid');
  });

  it('offers to turn the switch on from the no-fix alert, and not the app settings', async () => {
    mountRide(true);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(GPS_ALERT_MS);
    });
    await flush();

    const calls = (Alert.alert as jest.Mock).mock.calls;
    expect(calls[0][0]).toBe('recording.gpsServicesOffTitle');
    expect(calls[0][1]).toBe('recording.gpsServicesOffAndroid');
    const texts = alertButtons().map((b) => b.text);
    expect(texts).not.toContain('recording.gpsAlertSettings');

    location.hasServicesEnabledAsync.mockResolvedValue(true);
    await act(async () => {
      alertButtons()
        .find((b) => b.text === 'recording.gpsServicesTurnOn')
        ?.onPress?.();
    });
    await flush();

    expect(location.enableNetworkProviderAsync).toHaveBeenCalledTimes(1);
    expect(lastWarning()).toBeNull();
  });
});

describe('a ride on iOS with Location Services off', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('names the switch rather than the permission, and does not pause the ride', async () => {
    mountRide(false);
    await flush();

    expect(lastWarning()).toBe('recording.gpsServicesOffIos');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('says where the switch is in the no-fix alert, with no button that cannot reach it', async () => {
    mountRide(false);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(GPS_ALERT_MS);
    });
    await flush();

    const calls = (Alert.alert as jest.Mock).mock.calls;
    expect(calls[0][1]).toBe('recording.gpsServicesOffIos');
    expect(alertButtons().map((b) => b.text)).toEqual([
      'recording.gpsAlertContinue',
      'recording.gpsAlertStop',
    ]);
  });
});

describe('a ride with location on', () => {
  beforeEach(() => {
    location.hasServicesEnabledAsync.mockResolvedValue(true);
  });

  it('pauses on a refused permission, as before', async () => {
    mountRide(false);
    await flush();

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(lastWarning()).toBe('recording.gpsPermissionDenied');
    expect(useRecordingStore.getState().status).toBe('paused');
  });

  it('opens the no-fix alert with the sky as the cause', async () => {
    mountRide(true);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(GPS_ALERT_MS);
    });
    await flush();

    const calls = (Alert.alert as jest.Mock).mock.calls;
    expect(calls[0][0]).toBe('recording.gpsAlertTitle');
    expect(calls[0][1]).toBe('recording.gpsAlertMessage');
  });
});
