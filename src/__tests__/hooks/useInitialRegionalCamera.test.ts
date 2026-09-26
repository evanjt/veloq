/**
 * Scenario: the regional map surface captures its camera on the first render,
 * so whatever this hook answers at mount is where the map opens.
 *
 * Expected behaviour: the camera the tab was left on wins, then the one a
 * previous launch stored, then the world view.
 */

import { renderHook } from '@testing-library/react-native';

import {
  WORLD_CAMERA,
  surfaceIsLeaving,
  useInitialRegionalCamera,
  type RegionalCamera,
} from '@/features/maps/hooks/useInitialRegionalCamera';
import { getMapCameraState } from '@/features/maps/lib/storage/mapCameraState';

jest.mock('@/features/maps/lib/storage/mapCameraState', () => ({
  getMapCameraState: jest.fn(),
}));

const BERN = { center: [7.44, 46.95] as [number, number], zoom: 11 };
const ZURICH = { center: [8.54, 47.37] as [number, number], zoom: 13 };

describe('useInitialRegionalCamera', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens on the camera a previous launch stored', () => {
    (getMapCameraState as jest.Mock).mockReturnValue(BERN);

    const { result } = renderHook(() => useInitialRegionalCamera(null));

    expect(result.current).toEqual(BERN);
  });

  it('opens on the world view when nothing was stored', () => {
    (getMapCameraState as jest.Mock).mockReturnValue(null);

    const { result } = renderHook(() => useInitialRegionalCamera(null));

    expect(result.current).toEqual(WORLD_CAMERA);
  });

  it('prefers where the tab was left over what a previous launch stored', () => {
    (getMapCameraState as jest.Mock).mockReturnValue(BERN);

    const { result } = renderHook(() => useInitialRegionalCamera(ZURICH));

    expect(result.current).toEqual(ZURICH);
  });

  it('reads storage once, however many times it re-renders', () => {
    (getMapCameraState as jest.Mock).mockReturnValue(BERN);

    const { rerender } = renderHook(
      ({ blur }: { blur: RegionalCamera | null }) => useInitialRegionalCamera(blur),
      { initialProps: { blur: null as RegionalCamera | null } }
    );
    rerender({ blur: ZURICH });
    rerender({ blur: null });

    expect(getMapCameraState).toHaveBeenCalledTimes(1);
  });

  it('falls back to the stored camera again once the tab blur value clears', () => {
    (getMapCameraState as jest.Mock).mockReturnValue(BERN);

    const { result, rerender } = renderHook(
      ({ blur }: { blur: RegionalCamera | null }) => useInitialRegionalCamera(blur),
      { initialProps: { blur: ZURICH as RegionalCamera | null } }
    );
    expect(result.current).toEqual(ZURICH);

    rerender({ blur: null });
    expect(result.current).toEqual(BERN);
  });
});

/**
 * Scenario: the camera was only snapshotted when the tab lost focus, but
 * entering 3D unmounts the 2D surface just as surely. Leaving 3D then opened
 * the surface on the camera saved at the last tab blur, and saved that as the
 * new one.
 *
 * Expected behaviour: both ways of the surface going away keep where it was.
 */
describe('when the 2D surface is worth snapshotting', () => {
  it('keeps the camera when the tab loses focus', () => {
    expect(surfaceIsLeaving(false, false)).toBe(true);
  });

  it('keeps it when 3D takes over, which unmounts the surface too', () => {
    expect(surfaceIsLeaving(true, true)).toBe(true);
  });

  it('keeps nothing while the surface is on screen', () => {
    expect(surfaceIsLeaving(true, false)).toBe(false);
  });
});
