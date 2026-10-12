/**
 * Scenario: the locate button asks for a fix, shows the dot and eases the camera
 * onto it, and a fix younger than the cache window is reused.
 *
 * Expected behaviour: one owner hook runs the flow for any camera target, and
 * a refusal or a thrown fix leaves the map where it was.
 */

import { renderHook, act } from '@testing-library/react-native';
import { Alert, Linking, type AlertButton } from 'react-native';
import * as Location from 'expo-location';

import {
  useLocateUser,
  fixIsFresh,
  LOCATION_CACHE_MAX_AGE_MS,
} from '@/features/maps/hooks/useLocateUser';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const readPermission = Location.getForegroundPermissionsAsync as jest.Mock;
const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const getPosition = Location.getCurrentPositionAsync as jest.Mock;

function fakeTarget() {
  return { setCamera: jest.fn() };
}

let now = 1_000_000;

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  readPermission.mockReset().mockResolvedValue({ status: 'undetermined', canAskAgain: true });
  requestPermission.mockReset().mockResolvedValue({ status: 'granted' });
  getPosition.mockReset().mockResolvedValue({ coords: { longitude: 7.5, latitude: 46.5 } });
});

afterEach(() => jest.restoreAllMocks());

describe('fixIsFresh', () => {
  const fix = { coords: [7.5, 46.5] as [number, number], timestamp: 1000 };

  it('holds for a fix under the window and not at it', () => {
    expect(fixIsFresh(fix, 1000)).toBe(true);
    expect(fixIsFresh(fix, 1000 + LOCATION_CACHE_MAX_AGE_MS - 1)).toBe(true);
    expect(fixIsFresh(fix, 1000 + LOCATION_CACHE_MAX_AGE_MS)).toBe(false);
  });

  it('is false with no fix held', () => {
    expect(fixIsFresh(null, 1000)).toBe(false);
  });
});

describe('useLocateUser', () => {
  it('starts with no location and not loading', async () => {
    const { result } = await renderHook(() => useLocateUser());
    expect(result.current.userLocation).toBeNull();
    expect(result.current.locationLoading).toBe(false);
  });

  it('asks for a fix once, shows the dot and eases the camera onto it', async () => {
    const target = fakeTarget();
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(target);
    });
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(target.setCamera).toHaveBeenCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
    expect(result.current.userLocation).toEqual([7.5, 46.5]);
    expect(result.current.locationLoading).toBe(false);
  });

  it('reuses a fix 29 s old and lands on the same centre', async () => {
    const target = fakeTarget();
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(target);
    });
    now += 29_000;
    getPosition.mockResolvedValue({ coords: { longitude: 8, latitude: 47 } });
    await act(async () => {
      await result.current.locate(target);
    });
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(target.setCamera).toHaveBeenLastCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
  });

  it('asks again at 30 s', async () => {
    const target = fakeTarget();
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(target);
    });
    now += 30_000;
    getPosition.mockResolvedValue({ coords: { longitude: 8, latitude: 47 } });
    await act(async () => {
      await result.current.locate(target);
    });
    expect(getPosition).toHaveBeenCalledTimes(2);
    expect(target.setCamera).toHaveBeenLastCalledWith({ center: [8, 47], zoom: 13 }, 500);
    expect(result.current.userLocation).toEqual([8, 47]);
  });

  it('leaves the map alone when permission is refused', async () => {
    requestPermission.mockResolvedValue({ status: 'denied' });
    const target = fakeTarget();
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(target);
    });
    expect(getPosition).not.toHaveBeenCalled();
    expect(target.setCamera).not.toHaveBeenCalled();
    expect(result.current.userLocation).toBeNull();
    expect(result.current.locationLoading).toBe(false);
  });

  it('offers the settings page when the system will not ask, and asks nothing', async () => {
    readPermission.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const target = fakeTarget();
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(target);
    });

    expect(requestPermission).not.toHaveBeenCalled();
    expect(target.setCamera).not.toHaveBeenCalled();
    expect(result.current.locationLoading).toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    buttons.find((b) => b.style !== 'cancel')?.onPress?.();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('adds no notice on top of a dialog the athlete has just answered', async () => {
    requestPermission.mockResolvedValue({ status: 'denied', canAskAgain: false });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(fakeTarget());
    });

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('asks nothing when location is already allowed', async () => {
    readPermission.mockResolvedValue({ status: 'granted', canAskAgain: true });
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(fakeTarget());
    });

    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.current.userLocation).toEqual([7.5, 46.5]);
  });

  it('stops loading when the fix throws', async () => {
    getPosition.mockRejectedValue(new Error('no fix'));
    const target = fakeTarget();
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(target);
    });
    expect(target.setCamera).not.toHaveBeenCalled();
    expect(result.current.userLocation).toBeNull();
    expect(result.current.locationLoading).toBe(false);
  });

  it('still shows the dot when no camera target is mounted', async () => {
    const { result } = await renderHook(() => useLocateUser());
    await act(async () => {
      await result.current.locate(null);
    });
    expect(result.current.userLocation).toEqual([7.5, 46.5]);
  });

  it('reports loading while the fix is pending', async () => {
    let resolveFix: (value: unknown) => void = () => {};
    getPosition.mockReturnValue(new Promise((resolve) => (resolveFix = resolve)));
    const { result } = await renderHook(() => useLocateUser());
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.locate(fakeTarget());
      await Promise.resolve();
    });
    expect(result.current.locationLoading).toBe(true);
    await act(async () => {
      resolveFix({ coords: { longitude: 7.5, latitude: 46.5 } });
      await pending;
    });
    expect(result.current.locationLoading).toBe(false);
  });
});
