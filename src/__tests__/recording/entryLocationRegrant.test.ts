/**
 * Scenario: the athlete refuses location on the record screen, takes Open
 * settings, allows it there, and comes back to the app.
 *
 * Expected behaviour: the grant is read again on the return, so the line stops
 * saying location is denied and the watch starts without leaving the screen.
 * A grant taken away while the app was away is read the same way.
 */

import { AppState, Platform, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useEntryLocation } from '@/features/recording/hooks/useEntryLocation';

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

function permission(status: 'granted' | 'denied', canAskAgain = true) {
  return { status, granted: status === 'granted', canAskAgain, expires: 'never' } as never;
}

function emitAppState(state: AppStateStatus) {
  for (const listener of appStateListeners.change ?? []) listener(state);
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Platform.OS = 'android';
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
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.watchPositionAsync.mockResolvedValue({ remove: jest.fn() } as never);
});

afterEach(() => {
  Platform.OS = originalOS;
  jest.useRealTimers();
});

describe('a refusal fixed in system settings', () => {
  beforeEach(() => {
    location.getForegroundPermissionsAsync.mockResolvedValue(permission('denied', false));
    location.requestForegroundPermissionsAsync.mockResolvedValue(permission('denied', false));
  });

  it('reads the grant again on the return and starts the watch', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();
    expect(result.current.state).toBe('none');
    expect(location.watchPositionAsync).not.toHaveBeenCalled();

    location.getForegroundPermissionsAsync.mockResolvedValue(permission('granted'));
    emitAppState('background');
    emitAppState('active');
    await flush();

    expect(result.current.state).toBe('checking');
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('raises no second dialog on the return', async () => {
    await renderHook(() => useEntryLocation(true));
    await flush();
    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);

    emitAppState('active');
    await flush();
    emitAppState('active');
    await flush();

    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('stays denied when the athlete came back without allowing it', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    emitAppState('active');
    await flush();

    expect(result.current.state).toBe('none');
    expect(location.watchPositionAsync).not.toHaveBeenCalled();
  });
});

describe('a grant taken away while the app was away', () => {
  it('stops the watch and names the refusal', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(permission('granted'));
    const remove = jest.fn();
    location.watchPositionAsync.mockResolvedValue({ remove } as never);

    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();
    expect(location.watchPositionAsync).toHaveBeenCalledTimes(1);

    location.getForegroundPermissionsAsync.mockResolvedValue(permission('denied'));
    emitAppState('active');
    await flush();

    expect(result.current.state).toBe('none');
    expect(remove).toHaveBeenCalled();
  });
});

describe('an inactive screen', () => {
  it('reads nothing on the return', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValue(permission('denied'));
    await renderHook(() => useEntryLocation(false));
    await flush();

    emitAppState('active');
    await flush();

    expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });
});
