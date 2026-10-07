/**
 * Scenario: an athlete opens the app in one city, flies to another, and comes
 * back to the routes screen. The first fix was cached in a module variable and
 * returned forever, so proximity sorting used the city they left until the
 * process was killed.
 *
 * Expected behaviour: a fix carries the time it was taken, goes stale, and is
 * asked again when the app comes to the foreground. The OS last-known position
 * counts only when it was itself taken inside the window, and keeps its own
 * timestamp rather than the time it was read.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import * as Location from 'expo-location';

import {
  LOCATION_TTL_MS,
  fixIsStale,
  forgetCachedLocation,
  useUserLocation,
} from '@/shared/app/useUserLocation';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const granted = { status: 'granted' } as never;

function fixAt(lat: number, lng: number, timestamp: number = Date.now()) {
  return { coords: { latitude: lat, longitude: lng }, timestamp } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  forgetCachedLocation();
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue(granted);
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(fixAt(0, 0));
});

describe('fixIsStale', () => {
  const now = 1_000_000;

  it('treats a missing fix as stale', () => {
    expect(fixIsStale(null, now)).toBe(true);
  });

  it('holds a fix inside the window and drops it on the boundary', () => {
    expect(fixIsStale({ value: { lat: 1, lng: 2 }, at: now - 1 }, now)).toBe(false);
    expect(fixIsStale({ value: { lat: 1, lng: 2 }, at: now - LOCATION_TTL_MS }, now)).toBe(true);
  });
});

it('asks again when the app foregrounds with a stale fix', async () => {
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce(fixAt(46.5, 6.6));
  const { result } = renderHook(() => useUserLocation());
  await waitFor(() => expect(result.current.location).toEqual({ lat: 46.5, lng: 6.6 }));

  const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
  expect(typeof listener).toBe('function');

  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + LOCATION_TTL_MS + 1);
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce(fixAt(-33.9, 151.2));
  await act(async () => {
    listener('active');
  });

  await waitFor(() => expect(result.current.location).toEqual({ lat: -33.9, lng: 151.2 }));
  jest.spyOn(Date, 'now').mockRestore();
});

it('does not ask again when the fix is still fresh', async () => {
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(fixAt(46.5, 6.6));
  const { result } = renderHook(() => useUserLocation());
  await waitFor(() => expect(result.current.location).toEqual({ lat: 46.5, lng: 6.6 }));
  expect(Location.getLastKnownPositionAsync).toHaveBeenCalledTimes(1);

  const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
  await act(async () => {
    listener('active');
  });

  expect(Location.getLastKnownPositionAsync).toHaveBeenCalledTimes(1);
});

it('stops loading when permission was never granted', async () => {
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
  const { result } = renderHook(() => useUserLocation());

  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.location).toBeNull();
});

describe('OS last-known position', () => {
  it('asks for a current fix when the last-known one is older than the window', async () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(
      fixAt(46.5, 6.6, yesterday)
    );
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(fixAt(47.4, 8.5));

    const { result } = renderHook(() => useUserLocation());

    await waitFor(() => expect(result.current.location).toEqual({ lat: 47.4, lng: 8.5 }));
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith(
      expect.objectContaining({ maxAge: LOCATION_TTL_MS })
    );
    expect(Location.getCurrentPositionAsync).toHaveBeenCalledTimes(1);
  });

  it('uses a last-known position taken inside the window without a current fix', async () => {
    const recent = Date.now() - LOCATION_TTL_MS / 2;
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(fixAt(46.5, 6.6, recent));

    const { result } = renderHook(() => useUserLocation());

    await waitFor(() => expect(result.current.location).toEqual({ lat: 46.5, lng: 6.6 }));
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('stamps the fix with the time the OS took it, so it expires with it', async () => {
    const takenAt = Date.now() - LOCATION_TTL_MS + 1000;
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce(
      fixAt(46.5, 6.6, takenAt)
    );
    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.location).toEqual({ lat: 46.5, lng: 6.6 }));

    const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
    const now = jest.spyOn(Date, 'now').mockReturnValue(takenAt + LOCATION_TTL_MS + 1);
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce(null);
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValueOnce(fixAt(-33.9, 151.2));
    await act(async () => {
      listener('active');
    });

    await waitFor(() => expect(result.current.location).toEqual({ lat: -33.9, lng: 151.2 }));
    now.mockRestore();
  });

  it('applies the same rule when permission is requested', async () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(granted);
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(
      fixAt(46.5, 6.6, yesterday)
    );
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(fixAt(47.4, 8.5));

    const { result } = renderHook(() => useUserLocation());
    let got: unknown;
    await act(async () => {
      got = await result.current.requestPermission();
    });

    expect(got).toEqual({ lat: 47.4, lng: 8.5 });
  });
});
