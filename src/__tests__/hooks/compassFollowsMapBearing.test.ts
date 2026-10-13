/**
 * Scenario: the compass button resets the map to north. The map eases there
 * itself and reports its bearing on every frame of the ease.
 *
 * Expected behaviour: the compass has one owner, the bearing the map reports.
 * A reset starts no timing of its own on the compass value, so nothing fights
 * the reported bearing, and a reported bearing of 0 puts the compass at 0.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { useMapCamera } from '@/features/maps/hooks/useMapCamera';
import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import type { MapCameraState, MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { Map3DWebViewRef } from '@/features/maps/components/Map3DWebView';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

function cameraState(bearing: number): MapCameraState {
  return {
    center: [7.5, 46.5],
    zoom: 10,
    bearing,
    pitch: 0,
    bounds: { sw: [7, 46], ne: [8, 47] },
  } as MapCameraState;
}

function readValue(value: Animated.Value): number {
  return (value as unknown as { __getValue: () => number }).__getValue();
}

function timingsOn(timing: jest.SpyInstance, value: Animated.Value) {
  return timing.mock.calls.filter(([target]) => target === value);
}

let timing: jest.SpyInstance;

beforeEach(() => {
  timing = jest.spyOn(Animated, 'timing');
});

afterEach(() => jest.restoreAllMocks());

describe('the inline activity map compass', () => {
  async function mount(is3D: boolean) {
    const surface = { resetOrientation: jest.fn() };
    const map3D = { resetOrientation: jest.fn() };
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

  it('asks the 2D map to reset and leaves the compass to the bearing it reports', async () => {
    const { rendered, surface } = await mount(false);
    const { bearingAnim } = rendered.result.current;
    await act(() => rendered.result.current.handleRegionIsChanging(cameraState(40)));

    await act(() => rendered.result.current.resetOrientation());

    expect(surface.resetOrientation).toHaveBeenCalledTimes(1);
    expect(timingsOn(timing, bearingAnim)).toEqual([]);
    expect(readValue(bearingAnim)).toBe(-40);

    await act(() => rendered.result.current.handleRegionIsChanging(cameraState(12)));
    expect(readValue(bearingAnim)).toBe(-12);
    await act(() => rendered.result.current.handleRegionIsChanging(cameraState(0)));
    expect(Math.abs(readValue(bearingAnim))).toBe(0);
  });

  it('asks the 3D map to reset and starts no timing when 3D is showing', async () => {
    const { rendered, surface, map3D } = await mount(true);

    await act(() => rendered.result.current.resetOrientation());
    await act(() => rendered.result.current.resetOrientation());

    expect(map3D.resetOrientation).toHaveBeenCalledTimes(2);
    expect(surface.resetOrientation).not.toHaveBeenCalled();
    expect(timingsOn(timing, rendered.result.current.bearingAnim)).toEqual([]);
  });
});

describe('the regional map compass', () => {
  async function mount(is3DMode: boolean) {
    const surface = { resetOrientation: jest.fn() };
    const map3D = { resetOrientation: jest.fn() };
    const bearingAnim = new Animated.Value(0);
    const rendered = await renderHook(() =>
      useMapHandlers({
        activities: [],
        selected: null,
        setSelected: jest.fn(),
        setSelectedSectionId: jest.fn(),
        chooseSection: jest.fn(),
        showActivities: true,
        setShowActivities: jest.fn(),
        showSections: true,
        setShowSections: jest.fn(),
        showRoutes: true,
        setShowRoutes: jest.fn(),
        setSelectedRouteId: jest.fn(),
        userLocation: null,
        setUserLocation: jest.fn(),
        setLocationLoading: jest.fn(),
        currentZoomRef: { current: 8 },
        currentCenterRef: { current: [7, 46] },
        surfaceRef: {
          current: is3DMode ? null : surface,
        } as unknown as React.RefObject<MapSurfaceRef | null>,
        map3DRef: { current: map3D } as unknown as React.RefObject<Map3DWebViewRef | null>,
        bearingAnim,
        currentZoomLevel: { current: 8 },
        is3DMode,
        markUserInteracted: jest.fn(),
        setSpider: jest.fn(),
      } as never)
    );
    return { rendered, surface, map3D, bearingAnim };
  }

  it('asks the 2D map to reset and leaves the compass to the bearing it reports', async () => {
    const { rendered, surface, bearingAnim } = await mount(false);
    await act(() => rendered.result.current.handleRegionIsChanging(cameraState(-75)));

    await act(() => rendered.result.current.resetOrientation());

    expect(surface.resetOrientation).toHaveBeenCalledTimes(1);
    expect(timingsOn(timing, bearingAnim)).toEqual([]);
    expect(readValue(bearingAnim)).toBe(75);

    await act(() => rendered.result.current.handleRegionIsChanging(cameraState(0)));
    expect(Math.abs(readValue(bearingAnim))).toBe(0);
  });

  it('asks the 3D map to reset and starts no timing when 3D is showing', async () => {
    const { rendered, surface, map3D, bearingAnim } = await mount(true);

    await act(() => rendered.result.current.resetOrientation());

    expect(map3D.resetOrientation).toHaveBeenCalledTimes(1);
    expect(surface.resetOrientation).not.toHaveBeenCalled();
    expect(timingsOn(timing, bearingAnim)).toEqual([]);
  });
});
