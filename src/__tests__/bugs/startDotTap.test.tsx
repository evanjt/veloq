/**
 * Scenario: from zoom 11 up the global map draws one dot per activity, at its
 * start point, from the clustered source. A tap on it has to reach the activity
 * wherever its bounds centre is, and thirty rides starting at one garage have
 * to fan out.
 *
 * Expected behaviour: a tap on the start dot opens its activity, wherever the
 * activity's bounds centre is, and starts stacked on one another open a spider
 * of every activity under the finger.
 */

import { renderHook, act } from '@testing-library/react-native';
import React from 'react';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import { UNCLUSTERED_POINT_LAYER_ID } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapFeatureHit, MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { ActivityBoundsItem } from '@/types';

const mockGetGpsTrack = jest.fn((_id: string) => '');

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { latitude: 46.5, longitude: 6.6 },
      { latitude: 46.51, longitude: 6.61 },
    ],
  })
);
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ getGpsTrack: (id: string) => mockGetGpsTrack(id) }),
}));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

/** A loop whose bounds centre sits about 5 km north-east of where it starts. */
function ride(id: string, start: [number, number] = [46.5, 6.6]): ActivityBoundsItem {
  return {
    id,
    bounds: [
      [46.5, 6.6],
      [46.59, 6.73],
    ],
    type: 'Ride' as ActivityBoundsItem['type'],
    name: id,
    date: '2026-09-01T06:00:00.000Z',
    distance: 30_000,
    duration: 3_600,
    startPoint: start,
  };
}

function surface(): MapSurfaceRef {
  return {
    fitBounds: jest.fn(),
    setCamera: jest.fn(),
    resetOrientation: jest.fn(),
    queryFeatures: jest.fn(async () => []),
    queryViewportFeatures: jest.fn(async () => []),
    getClusterLeaves: jest.fn(async () => []),
    getClusterExpansionZoom: jest.fn(async () => null),
    projectPoints: jest.fn(async () => []),
  } as unknown as MapSurfaceRef;
}

function mountHandlers(activities: ActivityBoundsItem[], zoom = 14) {
  const setSpider = jest.fn();
  const setSelected = jest.fn();
  const rendered = renderHook(() =>
    useMapHandlers({
      activities,
      selected: null,
      setSelected,
      setSelectedSectionId: jest.fn(),
      setSectionChoices: jest.fn(),
      showActivities: true,
      setShowActivities: jest.fn(),
      showSections: true,
      setShowSections: jest.fn(),
      showRoutes: true,
      setShowRoutes: jest.fn(),
      setSelectedRoute: jest.fn(),
      userLocation: null,
      setUserLocation: jest.fn(),
      setLocationLoading: jest.fn(),
      currentZoomRef: { current: zoom },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: surface() } as React.RefObject<MapSurfaceRef | null>,
      map3DRef: { current: null } as React.RefObject<null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: zoom },
      is3DMode: false,
      markUserInteracted: jest.fn(),
      setSpider,
    } as never)
  );
  mounted.push(rendered);
  return { rendered, setSpider, setSelected };
}

const mounted: { unmount: () => void }[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  mockGetGpsTrack.mockReset().mockReturnValue('encoded');
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  mounted.splice(0).forEach((r) => r.unmount());
  jest.useRealTimers();
});

/** A start dot as the page reports it: longitude first, with its id and colour. */
function startHit(id: string, lngLat: [number, number]): MapFeatureHit {
  return {
    layerId: UNCLUSTERED_POINT_LAYER_ID,
    id: null,
    properties: { id, color: '#3B82F6' },
    geometry: { type: 'Point', coordinates: lngLat },
  };
}

function press(hits: MapFeatureHit[]) {
  return { coordinate: [6.6, 46.5], point: [100, 200], feature: hits[0], features: hits };
}

describe('a tap on the start dot at trace zoom', () => {
  it('opens that activity, though its bounds centre is kilometres away', async () => {
    const a1 = ride('a1');
    const { rendered, setSelected, setSpider } = mountHandlers([a1]);

    await act(async () => {
      rendered.result.current.handleSurfacePress(press([startHit('a1', [6.6, 46.5])]) as never);
    });

    expect(setSelected).toHaveBeenCalledWith(
      expect.objectContaining({ activity: a1, isLoading: true })
    );
    expect(setSpider).not.toHaveBeenCalledWith(
      expect.objectContaining({ leaves: expect.anything() })
    );
  });

  it('fans three starts at one garage out into a spider of all three', async () => {
    const rides = ['a1', 'a2', 'a3'].map((id) => ride(id));
    const { rendered, setSelected, setSpider } = mountHandlers(rides);

    await act(async () => {
      rendered.result.current.handleSurfacePress(
        press([
          startHit('a1', [6.6, 46.5]),
          startHit('a2', [6.60001, 46.5]),
          startHit('a3', [6.6, 46.50001]),
        ]) as never
      );
    });

    expect(setSelected).not.toHaveBeenCalled();
    expect(setSpider).toHaveBeenCalledTimes(1);
    const spider = setSpider.mock.calls[0][0];
    expect(spider.center).toEqual([6.6, 46.5]);
    expect(spider.leaves.map((leaf: GeoJSON.Feature) => leaf.properties?.id).sort()).toEqual([
      'a1',
      'a2',
      'a3',
    ]);
    // The spider draws each leaf in its own colour.
    expect(spider.leaves[0].properties.color).toBe('#3B82F6');
  });

  it('opens the one under the finger when a neighbour in the box is not stacked on it', async () => {
    const a1 = ride('a1');
    const a2 = ride('a2', [46.5, 6.6005]);
    const { rendered, setSelected, setSpider } = mountHandlers([a1, a2]);

    await act(async () => {
      rendered.result.current.handleSurfacePress(
        press([startHit('a1', [6.6, 46.5]), startHit('a2', [6.6005, 46.5])]) as never
      );
    });

    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ activity: a1 }));
    expect(setSpider).not.toHaveBeenCalledWith(
      expect.objectContaining({ leaves: expect.anything() })
    );
  });

  it('counts one activity reported twice across a tile edge as one', async () => {
    const a1 = ride('a1');
    const { rendered, setSelected, setSpider } = mountHandlers([a1]);

    await act(async () => {
      rendered.result.current.handleSurfacePress(
        press([startHit('a1', [6.6, 46.5]), startHit('a1', [6.6, 46.5])]) as never
      );
    });

    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ activity: a1 }));
    expect(setSpider).not.toHaveBeenCalledWith(
      expect.objectContaining({ leaves: expect.anything() })
    );
  });

  it('still opens the activity from a page that reports only the winning feature', async () => {
    const a1 = ride('a1');
    const { rendered, setSelected } = mountHandlers([a1]);
    const hit = startHit('a1', [6.6, 46.5]);

    await act(async () => {
      rendered.result.current.handleSurfacePress({
        coordinate: [6.6, 46.5],
        point: [100, 200],
        feature: hit,
      } as never);
    });

    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ activity: a1 }));
  });
});

describe('the route load after a tap on a start dot', () => {
  it('replaces the loading popup with the stored track', async () => {
    const a1 = ride('a1');
    const { rendered, setSelected } = mountHandlers([a1]);

    await act(async () => {
      rendered.result.current.handleSurfacePress(press([startHit('a1', [6.6, 46.5])]) as never);
    });
    expect(setSelected).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    expect(mockGetGpsTrack).toHaveBeenCalledWith('a1');
    expect(setSelected).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activity: a1,
        isLoading: false,
        routeCoords: [
          [6.6, 46.5],
          [6.61, 46.51],
        ],
      })
    );
  });
});

describe('a tap below the handover, on the centre layer', () => {
  it('still opens the activity it names', async () => {
    const a1 = ride('a1');
    const { rendered, setSelected } = mountHandlers([a1], 10.5);

    await act(async () => {
      rendered.result.current.handleSurfacePress({
        coordinate: [6.6, 46.5],
        point: [100, 200],
        feature: {
          layerId: UNCLUSTERED_POINT_LAYER_ID,
          id: null,
          properties: { id: 'a1' },
          geometry: { type: 'Point', coordinates: [6.6, 46.5] },
        },
      } as never);
    });

    expect(setSelected).toHaveBeenCalledWith(expect.objectContaining({ activity: a1 }));
  });
});
