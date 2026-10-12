/**
 * Scenario: the inline activity map's locate button asks for a fix, shows the
 * dot and eases the camera onto it.
 *
 * Expected behaviour: it behaves as every other map's locate button: zoom 13,
 * a fix younger than 30 s reused, and the 3D map moved when it is showing.
 */

import { act, renderHook } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useMapCamera } from '@/features/maps/hooks/useMapCamera';

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest
    .fn()
    .mockResolvedValue({ status: 'undetermined', canAskAgain: true }),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const getPosition = Location.getCurrentPositionAsync as jest.Mock;
let now = 1_000_000;

async function mount(is3D = false) {
  const surface = { setCamera: jest.fn() };
  const map3D = { setCamera: jest.fn() };
  const rendered = await renderHook(() =>
    useMapCamera({
      validCoordinates: [
        { latitude: 46.948, longitude: 7.447 },
        { latitude: 46.951, longitude: 7.45 },
      ],
      is3DMode: is3D,
      is3DReady: is3D,
      map3DRef: { current: map3D as never },
    })
  );
  (rendered.result.current.surfaceRef as { current: unknown }).current = surface;
  return { rendered, surface, map3D };
}

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  (Location.requestForegroundPermissionsAsync as jest.Mock)
    .mockReset()
    .mockResolvedValue({ status: 'granted' });
  getPosition.mockReset().mockResolvedValue({ coords: { longitude: 7.5, latitude: 46.5 } });
});

afterEach(() => jest.restoreAllMocks());

describe('useMapCamera locate', () => {
  it('eases onto the fix at the shared locate zoom and holds it for the dot', async () => {
    const { rendered, surface } = await mount();
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(surface.setCamera).toHaveBeenCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
    expect(rendered.result.current.userLocation).toEqual([7.5, 46.5]);
    expect(rendered.result.current.locationLoading).toBe(false);
  });

  it('reuses a fix 29 s old and asks again at 30 s', async () => {
    const { rendered } = await mount();
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    now += 29_000;
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(getPosition).toHaveBeenCalledTimes(1);
    now += 1_000;
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(getPosition).toHaveBeenCalledTimes(2);
  });

  it('moves the 3D map, not the hidden surface, while 3D is showing', async () => {
    const { rendered, surface, map3D } = await mount(true);
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(map3D.setCamera).toHaveBeenCalledWith({ center: [7.5, 46.5], zoom: 13 }, 500);
    expect(surface.setCamera).not.toHaveBeenCalled();
  });

  it('leaves the map and the dot alone when permission is refused', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
    });
    const { rendered, surface } = await mount();
    await act(async () => {
      await rendered.result.current.handleGetLocation();
    });
    expect(surface.setCamera).not.toHaveBeenCalled();
    expect(rendered.result.current.userLocation).toBeNull();
    expect(rendered.result.current.locationLoading).toBe(false);
  });
});
