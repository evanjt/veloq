/**
 * Scenario: the inline surface is unmounted while fullscreen covers it, then a new
 * surface mounts when it goes away.
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
    })
  );
}

describe('useMapCamera surface readiness', () => {
  it('clears ready when the surface is dropped', async () => {
    const { result } = await renderCamera();
    await act(() => result.current.handleMapReady());
    expect(result.current.mapReady).toBe(true);

    await act(() => result.current.resetSurface());

    expect(result.current.mapReady).toBe(false);
  });

  it('clears a reported failure when the surface is dropped', async () => {
    const { result } = await renderCamera();
    await act(() => result.current.handleMapFailed());
    expect(result.current.mapFailed).toBe(true);

    await act(() => result.current.resetSurface());

    expect(result.current.mapFailed).toBe(false);
  });

  it('lets the next surface report ready again', async () => {
    const { result } = await renderCamera();
    await act(() => result.current.handleMapReady());
    await act(() => result.current.resetSurface());
    await act(() => result.current.handleMapReady());

    expect(result.current.mapReady).toBe(true);
  });
});
