/**
 * Scenario: a GPS ride starts indoors on a trainer, or with the phone in a
 * jersey pocket. After 60 s with no fix the alert opens and the ride keeps
 * recording under it. Forty minutes later the athlete takes "Stop Recording".
 *
 * Expected behaviour: the ride stops and goes to review with its streams and
 * its crash backup intact, exactly as the screen's own stop does. Nothing is
 * discarded.
 */

import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';
import { GPS_ALERT_MS } from '@/features/recording/lib/constants';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockSaveBackup = jest.fn();
const mockClearBackup = jest.fn();
const mockNavigateTo = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  saveRecordingBackup: (...args: unknown[]) => mockSaveBackup(...args),
  clearRecordingBackup: (...args: unknown[]) => mockClearBackup(...args),
}));

jest.mock('@/features/recording/lib/recordingSession', () => ({
  ensureLocationWatch: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/shared/app/permissions/locationServices', () => ({
  ...jest.requireActual('@/shared/app/permissions/locationServices'),
  readLocationServices: jest.fn().mockResolvedValue(true),
  useLocationServices: () => ({ enabled: true, turnOn: jest.fn() }),
}));

jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
}));

/** The recording screen's GPS session, as it mounts it for a GPS ride. */
function useRecordingScreenGps() {
  const status = useRecordingStore((s) => s.status);
  useGpsSessionEffect({
    mode: 'gps',
    status,
    hasPermission: true,
    precision: 'precise',
    requestPermission: async () => true,
    upgradePrecision: async () => {},
    setGpsWarning: () => {},
  });
}

type AlertButton = { text?: string; style?: string; onPress?: () => void };

function destructiveOption(): AlertButton {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  expect(calls).toHaveLength(1);
  const buttons = calls[0][2] as AlertButton[];
  const option = buttons.find((b) => b.style === 'destructive');
  expect(option).toBeDefined();
  return option as AlertButton;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  // A trainer ride: sensors write every second, the GPS never fixes.
  useRecordingStore.setState((s) => ({
    streams: {
      ...s.streams,
      time: [0, 1, 2],
      heartrate: [120, 121, 122],
      power: [200, 210, 220],
      cadence: [85, 86, 87],
    },
  }));
});

afterEach(() => {
  jest.useRealTimers();
});

async function openNoFixAlert() {
  await renderHook(() => useRecordingScreenGps());
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
    jest.advanceTimersByTime(GPS_ALERT_MS);
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

describe('the no-GPS alert', () => {
  it('opens after the alert delay while no fix has arrived', async () => {
    await openNoFixAlert();

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(useRecordingStore.getState().streams.latlng).toHaveLength(0);
  });

  // Android shows the last button as the positive one and the second last as
  // the negative, whatever their style says.
  it('never puts Stop in the positive slot, and can be dismissed as Continue', async () => {
    await openNoFixAlert();

    const [, , buttons, options] = (Alert.alert as jest.Mock).mock.calls[0] as [
      string,
      string,
      AlertButton[],
      { cancelable?: boolean; onDismiss?: () => void },
    ];
    expect(buttons.at(-1)?.style).not.toBe('destructive');
    expect(buttons.at(-2)?.style).toBe('cancel');
    expect(options.cancelable).toBe(true);
    act(() => options.onDismiss?.());
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('keeps every stream when its stop option is taken', async () => {
    await openNoFixAlert();

    await act(async () => {
      destructiveOption().onPress?.();
      await Promise.resolve();
    });

    const { streams, status } = useRecordingStore.getState();
    expect(status).toBe('stopped');
    expect(streams.heartrate).toEqual([120, 121, 122]);
    expect(streams.power).toEqual([200, 210, 220]);
    expect(streams.cadence).toEqual([85, 86, 87]);
  });

  it('writes the stopped ride to the crash backup rather than clearing it', async () => {
    await openNoFixAlert();

    await act(async () => {
      destructiveOption().onPress?.();
      await Promise.resolve();
    });

    expect(mockClearBackup).not.toHaveBeenCalled();
    expect(mockSaveBackup).toHaveBeenCalledTimes(1);
    expect(mockSaveBackup.mock.calls[0][0]).toMatchObject({ status: 'stopped' });
  });

  it('goes to review, not home', async () => {
    await openNoFixAlert();

    await act(async () => {
      destructiveOption().onPress?.();
      await Promise.resolve();
    });

    expect(mockNavigateTo).toHaveBeenCalledWith('/recording/review');
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});
