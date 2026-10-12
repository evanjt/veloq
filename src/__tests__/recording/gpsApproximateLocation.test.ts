/**
 * Scenario: the athlete granted location as approximate. The status reads
 * granted, every fix reports hundreds of metres, and the session drops each one
 * against its accuracy threshold, so the ride records no track.
 *
 * Expected behaviour: the recording screen says the location is approximate
 * from the start rather than blaming the signal, a coarse fix does not clear
 * that, and the no-fix alert names approximate location and offers precise.
 */

import { Alert, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';
import { useGpsWarningClearEffect } from '@/features/recording/hooks/useGpsWarningClearEffect';
import { GPS_ALERT_MS, GPS_WARNING_MS } from '@/features/recording/lib/constants';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { LocationPrecision } from '@/shared/app/permissions/locationGrant';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  hasServicesEnabledAsync: jest.fn(),
}));

jest.mock('@/features/recording/lib/recordingSession', () => ({
  ensureLocationWatch: jest.fn().mockResolvedValue(true),
}));

const location = Location as jest.Mocked<typeof Location>;

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function mountGps(precision: LocationPrecision, upgradePrecision = jest.fn()) {
  const setGpsWarning = jest.fn();
  renderHook(() =>
    useGpsSessionEffect({
      mode: 'gps',
      status: useRecordingStore((s) => s.status),
      hasPermission: true,
      precision,
      requestPermission: async () => true,
      upgradePrecision,
      setGpsWarning,
    })
  );
  return setGpsWarning;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await flush();
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('a ride under an approximate location grant', () => {
  it('says the location is approximate as the ride starts, not after the signal wait', async () => {
    const setGpsWarning = mountGps('approximate');
    await flush();
    expect(setGpsWarning).toHaveBeenCalledWith('recording.gpsApproximateWarning');
  });

  it('never tells the athlete to wait for the signal', async () => {
    const setGpsWarning = mountGps('approximate');
    await advance(GPS_WARNING_MS);
    expect(setGpsWarning).toHaveBeenCalledWith('recording.gpsApproximateWarning');
    expect(setGpsWarning).not.toHaveBeenCalledWith('recording.gpsWaiting');
  });

  it.each([
    ['android', 'recording.gpsApproximateAllow'],
    ['ios', 'common.openSettings'],
  ] as const)(
    'names approximate location in the no-fix alert and offers precise on %s',
    async (os, action) => {
      jest.replaceProperty(Platform, 'OS', os);
      const upgradePrecision = jest.fn().mockResolvedValue(undefined);
      mountGps('approximate', upgradePrecision);
      await advance(GPS_ALERT_MS);

      const calls = (Alert.alert as jest.Mock).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('recording.gpsApproximateAlertTitle');
      expect(calls[0][1]).toBe('recording.gpsApproximateAlertMessage');
      const buttons = calls[0][2] as AlertButton[];
      const offer = buttons.find((b) => b.text === action);
      expect(offer).toBeDefined();
      offer?.onPress?.();
      expect(upgradePrecision).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps the signal advice for a precise grant', async () => {
    const setGpsWarning = mountGps('precise');
    await advance(GPS_ALERT_MS);
    expect(setGpsWarning).not.toHaveBeenCalledWith('recording.gpsApproximateWarning');
    expect(setGpsWarning).toHaveBeenCalledWith('recording.gpsWaiting');
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('recording.gpsAlertTitle');
  });

  it('names the location switch over the grant when the switch is off', async () => {
    location.hasServicesEnabledAsync.mockResolvedValue(false);
    const setGpsWarning = mountGps('approximate');
    await advance(GPS_ALERT_MS);
    expect(setGpsWarning).not.toHaveBeenCalledWith('recording.gpsApproximateWarning');
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('recording.gpsServicesOffTitle');
  });
});

describe('the GPS warning on a new fix', () => {
  function mountClear(precision: LocationPrecision) {
    const setGpsWarning = jest.fn();
    const { rerender } = renderHook(
      ({ location }: { location: { latitude: number; longitude: number } | null }) =>
        useGpsWarningClearEffect(location, 'shown', setGpsWarning, precision),
      { initialProps: { location: null as { latitude: number; longitude: number } | null } }
    );
    rerender({ location: { latitude: 46.5, longitude: 6.6 } });
    return setGpsWarning;
  }

  it('stays while the grant is approximate, since the session drops that fix', () => {
    expect(mountClear('approximate')).not.toHaveBeenCalled();
  });

  it('clears under a precise grant', () => {
    expect(mountClear('precise')).toHaveBeenCalledWith(null);
  });
});
