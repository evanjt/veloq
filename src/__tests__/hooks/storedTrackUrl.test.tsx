/**
 * Scenario: the activity detail map and the regional map's selected activity
 * drew their line from a track decoded on the JS thread and sent to the page
 * as GeoJSON text. The engine answers the same line at a URL, and a source
 * that names the URL never carries the text.
 *
 * Expected behaviour: an activity whose track the engine holds draws from
 * `veloq-geo/track/<id>`, versioned by the re-ingests announced for that id,
 * and neither the hook nor the regional tap reads the track to get there. An
 * activity with no stored track keeps its line inline.
 */
import React, { useState } from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useStoredTrackUrl } from '@/features/maps/hooks/useStoredTrackUrl';
import { useMapLayers } from '@/features/maps/hooks/useMapLayers';
import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import { useMapGeoJSON } from '@/features/maps/components/regional/useMapGeoJSON';
import { buildRegionalSources } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { SelectedActivity } from '@/features/maps/components/regional/ActivityPopup';
import type { MapSurfaceRef } from '@/features/maps/components/MapSurface';
import type { ActivityBoundsItem } from '@/types';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
  isEngineReady: () => true,
}));
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => require('@/shared/native/engine').getEngine(),
  useEngineOpenCount: () => 1,
}));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

type Listener = (payload?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

const engine = {
  hasActivity: jest.fn(() => true),
  getGpsTrack: jest.fn(() => new ArrayBuffer(0)),
  subscribe: jest.fn((event: string, cb: Listener) => {
    const set = listeners.get(event) ?? new Set<Listener>();
    listeners.set(event, set);
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }),
};

async function announceMutated(activityIds: string[]) {
  await act(() => {
    listeners.get('gpsTracksMutated')?.forEach((cb) => cb({ activityIds }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

describe('the stored track URL', () => {
  it('names the engine URL at revision 0 for a held track, reading nothing', async () => {
    const { result } = await renderHook(() => useStoredTrackUrl('i1', true));

    expect(result.current).toMatch(/veloq-geo\/track\/i1\?v=0$/);
    expect(engine.getGpsTrack).not.toHaveBeenCalled();
    expect(engine.hasActivity).not.toHaveBeenCalled();
  });

  it('moves to the next revision when a re-ingest names the id, and only then', async () => {
    const { result } = await renderHook(() => useStoredTrackUrl('i1', true));

    await announceMutated(['i2']);
    expect(result.current).toMatch(/\?v=0$/);

    await announceMutated(['i2', 'i1']);
    expect(result.current).toMatch(/veloq-geo\/track\/i1\?v=1$/);

    await announceMutated(['i1']);
    expect(result.current).toMatch(/\?v=2$/);
  });

  it('starts another activity at revision 0', async () => {
    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useStoredTrackUrl(id, true),
      { initialProps: { id: 'i1' } }
    );
    await announceMutated(['i1']);
    expect(result.current).toMatch(/i1\?v=1$/);

    await rerender({ id: 'i2' });
    expect(result.current).toMatch(/veloq-geo\/track\/i2\?v=0$/);
  });

  it('is null when the engine holds no track, and names the URL once it does', async () => {
    const { result, rerender } = await renderHook(
      ({ held }: { held: boolean }) => useStoredTrackUrl('i1', held),
      { initialProps: { held: false } }
    );
    expect(result.current).toBeNull();

    await rerender({ held: true });
    expect(result.current).toMatch(/veloq-geo\/track\/i1\?v=0$/);
  });

  it('is null with no activity', async () => {
    const { result } = await renderHook(() => useStoredTrackUrl(undefined, true));
    expect(result.current).toBeNull();
  });
});

describe('the activity detail line', () => {
  const track = Array.from({ length: 30 }, (_, i) => ({
    latitude: 46.9 + i * 0.001,
    longitude: 7.4 + i * 0.001,
  }));

  const useDetailLayers = (held: boolean) => {
    const trackUrl = useStoredTrackUrl('i1', held);
    return useMapLayers({
      validCoordinates: track,
      coordinates: track,
      trackUrl,
      mapStyle: 'light',
    });
  };

  it('is the URL when the engine holds the track, and keeps the coordinates for their readers', async () => {
    const { result } = await renderHook(() => useDetailLayers(true));

    expect(result.current.routeGeoJSON).toMatch(/veloq-geo\/track\/i1\?v=0$/);
    expect(result.current.routeCoords).toHaveLength(30);
  });

  it('stays inline with every position for a stream-only activity', async () => {
    const { result } = await renderHook(() => useDetailLayers(false));

    const route = result.current.routeGeoJSON as GeoJSON.Feature<GeoJSON.LineString>;
    expect(route.geometry.coordinates).toHaveLength(30);
  });
});

describe('a regional tap on an activity', () => {
  function ride(id: string): ActivityBoundsItem {
    return {
      id,
      bounds: [
        [44.1, 5.2],
        [44.2, 5.3],
      ],
      type: 'Ride',
      name: `Ride ${id}`,
      date: '2026-04-10T08:00:00Z',
      distance: 60_000,
      duration: 12_000,
    };
  }

  const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

  async function mountRegional(activities: ActivityBoundsItem[]) {
    const surface = { fitBounds: jest.fn(), setCamera: jest.fn() } as unknown as MapSurfaceRef;
    return renderHook(() => {
      const [selected, setSelected] = useState<SelectedActivity | null>(null);
      const handlers = useMapHandlers({
        activities,
        selected,
        setSelected,
        setSelectedSectionId: jest.fn(),
        chooseSection: jest.fn(),
        showActivities: true,
        setShowActivities: jest.fn(),
        showSections: true,
        setShowSections: jest.fn(),
        showRoutes: true,
        setShowRoutes: jest.fn(),
        setSelectedRouteId: jest.fn(),
        currentZoomRef: { current: 8 },
        currentCenterRef: { current: [7, 46] },
        surfaceRef: { current: surface } as React.RefObject<MapSurfaceRef | null>,
        bearingAnim: { setValue: jest.fn() } as never,
        currentZoomLevel: { current: 8 },
        markUserInteracted: jest.fn(),
        setSpider: jest.fn(),
      });
      // As RegionalMapView takes it: every listed activity is a catalogue row.
      const selectedTrackUrl = useStoredTrackUrl(selected?.activity.id, !!selected);
      const { routeGeoJSON, routeHasData } = useMapGeoJSON({
        allActivities: activities,
        activityCenters: {},
        userLocation: null,
        selected,
        selectedTrackUrl,
        isDark: false,
      });
      const sources = buildRegionalSources({
        markersGeoJSON: EMPTY,
        sectionsGeoJSON: EMPTY,
        routesGeoJSON: EMPTY,
        userLocationGeoJSON: EMPTY,
        routeGeoJSON,
        spiderPointsGeoJSON: EMPTY,
        spiderLinesGeoJSON: EMPTY,
        heatmapEnabled: false,
        heatmapBase: 'light',
      });
      return { selected, handlers, sources, routeHasData };
    });
  }

  it('draws the selected route from the URL and never reads the track', async () => {
    const activity = ride('a-held');
    const { result } = await mountRegional([activity]);

    await act(() => result.current.handlers.handleMarkerTap(activity));

    const selectedRoute = result.current.sources['selected-route'];
    expect(selectedRoute.kind === 'geojson' && selectedRoute.data).toMatch(
      /veloq-geo\/track\/a-held\?v=0$/
    );
    expect(result.current.routeHasData).toBe(true);
    expect(result.current.selected?.isLoading).toBe(false);
    expect(engine.getGpsTrack).not.toHaveBeenCalled();
  });

  it('draws the second marker when it is tapped over the first', async () => {
    const first = ride('a-first');
    const second = ride('a-second');
    const { result } = await mountRegional([first, second]);

    await act(() => result.current.handlers.handleMarkerTap(first));
    await act(() => result.current.handlers.handleMarkerTap(second));

    expect(result.current.selected?.activity.id).toBe('a-second');
    const selectedRoute = result.current.sources['selected-route'];
    expect(selectedRoute.kind === 'geojson' && selectedRoute.data).toMatch(
      /veloq-geo\/track\/a-second\?v=0$/
    );
  });

  it('clears the route when the popup is dismissed', async () => {
    const activity = ride('a-held');
    const { result } = await mountRegional([activity]);

    await act(() => result.current.handlers.handleMarkerTap(activity));
    await act(() => result.current.handlers.handleClosePopup());

    const selectedRoute = result.current.sources['selected-route'];
    expect(selectedRoute.kind === 'geojson' && selectedRoute.data).toEqual(EMPTY);
    expect(result.current.routeHasData).toBe(false);
  });
});
