/**
 * Scenario: the platform's location watch delivers a cached position taken somewhere else, minutes
 * or hours before, as its first callback, and the entry screen reads saved routes around it.
 *
 * Expected behaviour: a fix older than the freshness window is not used, so no route is offered
 * until a fix taken this session arrives; a fresh one is used.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import {
  ENTRY_FIX_MAX_AGE_MS,
  useEntryLocation,
} from '@/features/recording/hooks/useEntryLocation';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

const location = Location as jest.Mocked<typeof Location>;
let deliver: (position: unknown) => void = () => {};

const position = (latitude: number, ageMs: number) => ({
  coords: { latitude, longitude: 6.6, accuracy: 5 },
  timestamp: Date.now() - ageMs,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  location.hasServicesEnabledAsync.mockResolvedValue(true);
  location.getForegroundPermissionsAsync.mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
    expires: 'never',
  } as never);
  location.watchPositionAsync.mockImplementation((async (_options: unknown, cb: never) => {
    deliver = cb;
    return { remove: jest.fn() };
  }) as never);
});

describe('the entry fix', () => {
  it('ignores a cached position older than the window and takes the first fresh one', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();

    act(() => deliver(position(47.4, ENTRY_FIX_MAX_AGE_MS + 1_000)));
    expect(result.current.location).toBeNull();

    act(() => deliver(position(46.5, 2_000)));
    expect(result.current.location).toEqual({ latitude: 46.5, longitude: 6.6 });
  });

  it('uses a position exactly inside the window', async () => {
    const { result } = await renderHook(() => useEntryLocation(true));
    await flush();
    act(() => deliver(position(46.5, ENTRY_FIX_MAX_AGE_MS - 1_000)));
    expect(result.current.location).toEqual({ latitude: 46.5, longitude: 6.6 });
  });
});
