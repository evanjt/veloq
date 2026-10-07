/**
 * Scenario: the inline 2D surface is unmounted while a ready 3D layer or
 * fullscreen covers it, then a new surface mounts when they go away.
 *
 * Expected behaviour: the readiness of the old surface does not carry over, so
 * the new one stays hidden behind the poster until it reports ready itself.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useMapCamera } from '@/features/maps/hooks/useMapCamera';

function renderCamera() {
  return renderHook(() =>
    useMapCamera({
      validCoordinates: [
        { latitude: 46.948, longitude: 7.447 },
        { latitude: 46.951, longitude: 7.45 },
      ],
      is3DMode: false,
      is3DReady: false,
      map3DRef: { current: null },
    })
  );
}

describe('useMapCamera surface readiness', () => {
  it('clears ready when the surface is dropped', () => {
    const { result } = renderCamera();
    act(() => result.current.handleMapReady());
    expect(result.current.mapReady).toBe(true);

    act(() => result.current.resetSurface());

    expect(result.current.mapReady).toBe(false);
  });

  it('clears a reported failure when the surface is dropped', () => {
    const { result } = renderCamera();
    act(() => result.current.handleMapFailed());
    expect(result.current.mapFailed).toBe(true);

    act(() => result.current.resetSurface());

    expect(result.current.mapFailed).toBe(false);
  });

  it('lets the next surface report ready again', () => {
    const { result } = renderCamera();
    act(() => result.current.handleMapReady());
    act(() => result.current.resetSurface());
    act(() => result.current.handleMapReady());

    expect(result.current.mapReady).toBe(true);
  });
});
