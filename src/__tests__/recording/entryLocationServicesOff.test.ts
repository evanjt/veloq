/**
 * Scenario: the athlete opens Record for a GPS sport with the phone's location
 * switch off. Android grants the permission anyway and sends no fix; iOS
 * reports the permission denied.
 *
 * Expected behaviour: the entry screen names the switch at once, on both
 * platforms, rather than waiting out the fix timeout and calling the signal
 * weak. When the athlete turns it on and comes back, the watch starts.
 */

import { AppState, Platform, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import {
  GPS_READINESS_TIMEOUT_MS,
  useEntryLocation,
} from '@/features/recording/hooks/useEntryLocation';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  hasServicesEnabledAsync: jest.fn(),
  enableNetworkProviderAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

const location = Location as jest.Mocked<typeof Location>;
const appStateListeners: Record<string, ((state?: AppStateStatus) => void)[]> = {};
const originalOS = Platform.OS;

function permission(status: 'granted' | 'denied') {
  return { status, granted: status === 'granted', canAskAgain: true, expires: 'never' } as never;
}

function emitAppState(event: 'change' | 'focus', state?: AppStateStatus) {
  for (const listener of appStateListeners[event] ?? []) listener(state);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  for (const key of Object.keys(appStateListeners)) delete appStateListeners[key];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    event: string,
    listener: (state?: AppStateStatus) => void
  ) => {
    (appStateListeners[event] ??= []).push(listener);
    return {
      remove: () => {
        appStateListeners[event] = appStateListeners[event].filter((l) => l !== listener);
      },
    };
  }) as never);
  location.watchPositionAsync.mockResolvedValue({ remove: jest.fn() } as never);
  location.enableNetworkProviderAsync.mockResolvedValue(undefined);
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
});

describe('Android with the location switch off', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    location.hasServicesEnabledAsync.mockResolvedValue(false);
    location.getForegroundPermissionsAsync.mockResolvedValue(permission('granted'));
  });

  it('names the switch at once and starts no watch', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    expect(result.current.state).toBe('servicesOff');
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('still names the switch once the wait for a fix has run out', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(GPS_READINESS_TIMEOUT_MS + 1);
    });

    expect(result.current.state).toBe('servicesOff');
  });

  it('turns the switch on from the app and starts the watch', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    location.hasServicesEnabledAsync.mockResolvedValue(true);
    await act(async () => {
      await result.current.turnOnServices();
    });
    await flush();

    expect(location.enableNetworkProviderAsync).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('checking');
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps naming the switch when the dialog is refused', async () => {
    location.enableNetworkProviderAsync.mockRejectedValue(new Error('refused'));
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    await act(async () => {
      await result.current.turnOnServices();
    });
    await flush();

    expect(result.current.state).toBe('servicesOff');
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
  });

  it('reads the switch again when the quick settings shade gives focus back', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    location.hasServicesEnabledAsync.mockResolvedValue(true);
    emitAppState('focus');
    await flush();

    expect(result.current.state).toBe('checking');
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('iOS with Location Services off', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
    location.hasServicesEnabledAsync.mockResolvedValue(false);
    location.getForegroundPermissionsAsync.mockResolvedValue(permission('denied'));
    location.requestForegroundPermissionsAsync.mockResolvedValue(permission('denied'));
  });

  it('names the switch rather than a denied permission', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    expect(result.current.state).toBe('servicesOff');
  });

  it('never raises the dialog, which iOS does not have', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    await act(async () => {
      await result.current.turnOnServices();
    });

    expect(location.enableNetworkProviderAsync).not.toHaveBeenCalled();
    expect(result.current.state).toBe('servicesOff');
  });

  it('reads the switch again on the way back from Settings', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    location.hasServicesEnabledAsync.mockResolvedValue(true);
    emitAppState('change', 'active');
    await flush();

    expect(result.current.state).toBe('none');
  });
});

describe('the switch on', () => {
  beforeEach(() => {
    location.hasServicesEnabledAsync.mockResolvedValue(true);
    location.getForegroundPermissionsAsync.mockResolvedValue(permission('granted'));
  });

  it('waits for a fix, then calls the signal weak once the wait runs out', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();
    expect(result.current.state).toBe('checking');

    await act(async () => {
      jest.advanceTimersByTime(GPS_READINESS_TIMEOUT_MS + 1);
    });
    expect(result.current.state).toBe('weak');
  });

  it('counts a switch that cannot be read as on', async () => {
    location.hasServicesEnabledAsync.mockRejectedValue(new Error('unavailable'));
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    expect(result.current.state).toBe('checking');
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for a sport that records no position', async () => {
    await renderHook(() => useEntryLocation(false));
    await flush();

    expect(location.hasServicesEnabledAsync).not.toHaveBeenCalled();
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
  });
});
