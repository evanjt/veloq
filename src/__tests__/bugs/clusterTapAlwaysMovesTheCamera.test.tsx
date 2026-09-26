/**
 * Scenario: tapping a cluster on the global map did nothing. Every step of the
 * path can answer emptily and none of them says so: `getClusterLeaves` returns
 * `[]` on any page error, and the plan that followed was `stacked` with no
 * leaves, which the handler dropped.
 *
 * Expected behaviour: a tap always moves the camera. With no leaves to fit, the
 * handler asks supercluster for the zoom the cluster splits at and eases to the
 * cluster's own coordinates.
 */

import { renderHook, act } from '@testing-library/react-native';
import React from 'react';

import { planClusterZoom } from '@/features/maps/lib/clusterZoom';
import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import {
  CLUSTER_SOURCE_ID,
  CLUSTER_CIRCLE_LAYER_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

describe('planClusterZoom with no leaves', () => {
  it('asks for an expansion rather than a spider it has no legs for', () => {
    expect(planClusterZoom([], [7.1, 46.2])).toEqual({
      kind: 'expand',
      center: [7.1, 46.2],
    });
  });

  it('still spiders leaves that are stacked on one another', () => {
    const at = (lng: number, lat: number): GeoJSON.Feature => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });

    expect(planClusterZoom([at(7.1, 46.2), at(7.10001, 46.2)], [7.1, 46.2])).toMatchObject({
      kind: 'stacked',
      leafCount: 2,
    });
  });
});

function surface(overrides: Partial<MapSurfaceRef>): MapSurfaceRef {
  return {
    fitBounds: jest.fn(),
    setCamera: jest.fn(),
    resetOrientation: jest.fn(),
    queryFeatures: jest.fn(async () => []),
    queryViewportFeatures: jest.fn(async () => []),
    getClusterLeaves: jest.fn(async () => []),
    getClusterExpansionZoom: jest.fn(async () => null),
    projectPoints: jest.fn(async () => []),
    ...overrides,
  } as unknown as MapSurfaceRef;
}

function mountHandlers(surfaceRef: MapSurfaceRef) {
  const setSpider = jest.fn();
  const rendered = renderHook(() =>
    useMapHandlers({
      activities: [],
      selected: null,
      setSelected: jest.fn(),
      setSelectedSectionId: jest.fn(),
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
      setVisibleActivityIds: jest.fn(),
      currentZoomRef: { current: 8 },
      currentCenterRef: { current: [7, 46] },
      setAboveTraceZoom: jest.fn(),
      traceZoomThreshold: 12,
      surfaceRef: { current: surfaceRef } as React.RefObject<MapSurfaceRef | null>,
      map3DRef: { current: null } as React.RefObject<null>,
      bearingAnim: { setValue: jest.fn() } as never,
      currentZoomLevel: { current: 8 },
      is3DMode: false,
      markUserInteracted: jest.fn(),
      setSpider,
    } as never)
  );
  return { rendered, setSpider };
}

const clusterTap = {
  coordinate: [7.1, 46.2] as [number, number],
  point: [100, 200] as [number, number],
  feature: {
    layerId: CLUSTER_CIRCLE_LAYER_ID,
    properties: { cluster_id: 42, point_count: 9 },
    geometry: { type: 'Point', coordinates: [7.1, 46.2] },
  },
};

describe('handleSurfacePress on a cluster whose leaves never arrive', () => {
  it('eases to the split zoom rather than leaving the camera where it was', async () => {
    const ref = surface({
      getClusterLeaves: jest.fn(async () => []),
      getClusterExpansionZoom: jest.fn(async () => 11),
    });
    const { rendered } = mountHandlers(ref);

    await act(async () => {
      rendered.result.current.handleSurfacePress(clusterTap as never);
    });

    expect(ref.getClusterExpansionZoom).toHaveBeenCalledWith(CLUSTER_SOURCE_ID, 42);
    expect(ref.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({ center: [7.1, 46.2], zoom: 11 }),
      expect.any(Number)
    );
  });

  it('still centres on the cluster when even the split zoom is unknown', async () => {
    const ref = surface({
      getClusterLeaves: jest.fn(async () => []),
      getClusterExpansionZoom: jest.fn(async () => null),
    });
    const { rendered } = mountHandlers(ref);

    await act(async () => {
      rendered.result.current.handleSurfacePress(clusterTap as never);
    });

    expect(ref.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({ center: [7.1, 46.2] }),
      expect.any(Number)
    );
    expect((ref.setCamera as jest.Mock).mock.calls[0][0].zoom).toBeUndefined();
  });

  it('fits the leaves when they do arrive, and asks for no expansion zoom', async () => {
    const leaf = (lng: number, lat: number): GeoJSON.Feature => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
    const ref = surface({
      getClusterLeaves: jest.fn(async () => [leaf(7.0, 46.0), leaf(7.4, 46.4)]),
    });
    const { rendered } = mountHandlers(ref);

    await act(async () => {
      rendered.result.current.handleSurfacePress(clusterTap as never);
    });

    expect(ref.fitBounds).toHaveBeenCalled();
    expect(ref.getClusterExpansionZoom).not.toHaveBeenCalled();
  });
});
