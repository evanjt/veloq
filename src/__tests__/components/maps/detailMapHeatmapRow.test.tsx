/**
 * Scenario: the activity, section and route maps drew no heatmap, and the Map tab's toggle did not
 * reach them.
 *
 * Expected behaviour: each map's layers menu has a Heatmap row. Off, the surface declares no
 * heatmap source. On, it declares the Map tab's source and draws it under the subject, a finished
 * tile pass versions its URL, and the choice is kept per kind of map.
 */

import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ActivityMapView } from '@/features/maps/components/ActivityMapView';
import { RouteMapView } from '@/features/routes/components/RouteMapView';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import { useHeatmapPreference } from '@/features/maps/stores/HeatmapPreferenceStore';
import { heatmapRasterSource } from '@/features/maps/lib/heatmapTiles';
import { routeLinesSourceData } from '@/features/maps/lib/routeLineCollection';
import { maps } from 'veloqrs';
import { encodeTrack } from '../../__shared__/trackBytes';
import { renderStaged } from '../../__shared__/stagedRender';
import { initialiseI18n } from '@/i18n';
import type { LatLng } from '@/shared/geo/polyline';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
    getTerrain3DMode: () => 'off',
  }),
}));

jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

let mockGeneration = 0;
const mockGenerationListeners = new Set<() => void>();
function finishTilePass() {
  mockGeneration += 1;
  mockGenerationListeners.forEach((listener) => listener());
}
jest.mock('@/features/maps/lib/heatmapGeneration', () => ({
  ...jest.requireActual('@/features/maps/lib/heatmapGeneration'),
  useHeatmapGeneration: () =>
    require('react').useSyncExternalStore(
      (listener: () => void) => {
        mockGenerationListeners.add(listener);
        return () => mockGenerationListeners.delete(listener);
      },
      () => mockGeneration
    ),
}));

interface SurfaceProps {
  sources: Record<string, { tiles?: string[]; minzoom?: number }>;
  layers: { id: string; filter?: unknown[] }[];
}
let mockSurface: SurfaceProps | null = null;
jest.mock('@/features/maps/components/MapSurfaceSlot', () => ({
  ...jest.requireActual('@/features/maps/components/MapSurfaceSlot'),
  SlottedMapSurface: (props: SurfaceProps) => {
    mockSurface = props;
    return null;
  },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const COORDINATES: LatLng[] = [
  { latitude: 46.948, longitude: 7.447 },
  { latitude: 46.949, longitude: 7.448 },
  { latitude: 46.95, longitude: 7.449 },
  { latitude: 46.951, longitude: 7.45 },
];
const POINTS = COORDINATES.map((c) => ({ lat: c.latitude, lng: c.longitude }));

const SECTION = {
  id: 'section-1',
  sectionType: 'auto',
  name: 'Harbour climb',
  sportTypes: ['Ride'],
  polyline: POINTS,
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 7,
  createdAt: '2026-01-15T10:00:00Z',
};

const ROUTE_GROUP = {
  id: 'route-1',
  name: 'Harbour loop',
  signature: { points: POINTS, distance: 4200 },
  activityIds: ['a1'],
  activityCount: 1,
  type: 'Ride' as const,
};

const libraryLine = (id: string) => ({
  id,
  name: id,
  sportTypes: ['Ride'],
  visitCount: 3,
  distanceMeters: 1500,
  encodedPolyline: encodeTrack(COORDINATES),
});

const KINDS = [
  {
    kind: 'activity' as const,
    ui: () => <ActivityMapView activityType="Ride" coordinates={COORDINATES} showStyleToggle />,
  },
  {
    kind: 'section' as const,
    ui: () => <SectionMapView section={SECTION as never} interactive />,
  },
  {
    kind: 'route' as const,
    ui: () => <RouteMapView routeGroup={ROUTE_GROUP} interactive />,
  },
];

async function renderMap(ui: () => React.ReactElement) {
  await renderStaged(<SafeAreaProvider initialMetrics={METRICS}>{ui()}</SafeAreaProvider>);
}

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

beforeEach(() => {
  mockSurface = null;
  mockGeneration = 0;
  useHeatmapPreference.setState({
    enabled: true,
    detailHeatmap: { activity: false, section: false, route: false },
    detailContext: {
      sections: { activity: false, section: false, route: false },
      routes: { activity: false, section: false, route: false },
    },
  });
  (maps.getMapContextLayers as jest.Mock).mockReset().mockReturnValue({
    sections: { stamp: 1, sections: [libraryLine('sec-1'), libraryLine('section-1')] },
    routes: { stamp: 1, generation: 4, routes: [] },
  });
});

describe.each(KINDS)('the $kind map heatmap row', ({ kind, ui }) => {
  async function openMenu() {
    await renderMap(ui);
    await fireEvent.press(screen.getByTestId(`${kind}-map-layers`));
  }

  it('is in the layers menu and draws nothing while off', async () => {
    await openMenu();

    expect(screen.getByTestId(`${kind}-map-layer-heatmap`)).toBeTruthy();
    expect(mockSurface?.sources['heatmap-tiles']).toBeUndefined();
    expect(mockSurface?.layers.map((layer) => layer.id)).not.toContain('heatmap-layer');
  });

  it('declares the Map tab source and draws it under the subject once turned on', async () => {
    await openMenu();
    await fireEvent.press(screen.getByTestId(`${kind}-map-layer-heatmap`));

    expect(mockSurface?.sources['heatmap-tiles']).toEqual(heatmapRasterSource('light', 0));
    expect(mockSurface?.layers[0]?.id).toBe('heatmap-layer');
    expect(screen.getByTestId(`${kind}-map-key-heat`)).toBeTruthy();
    expect(useHeatmapPreference.getState().detailHeatmap[kind]).toBe(true);
  });

  it('versions the source once a tile pass finishes', async () => {
    useHeatmapPreference.setState({
      detailHeatmap: { activity: false, section: false, route: false, [kind]: true },
    });
    await renderMap(ui);
    const before = mockSurface?.sources['heatmap-tiles']?.tiles?.[0];

    await act(async () => finishTilePass());

    expect(before).toBe(heatmapRasterSource('light', 0).tiles[0]);
    expect(mockSurface?.sources['heatmap-tiles']?.tiles?.[0]).toBe(
      heatmapRasterSource('light', 1).tiles[0]
    );
  });

  it('offers no heatmap row while settings has the heatmap off, and the library rows still', async () => {
    useHeatmapPreference.setState({ enabled: false });
    await openMenu();

    expect(screen.queryByTestId(`${kind}-map-layer-heatmap`)).toBeNull();
    expect(screen.getByTestId(`${kind}-map-layer-sections`)).toBeTruthy();
    expect(screen.getByTestId(`${kind}-map-layer-routes`)).toBeTruthy();
  });
});

describe.each(KINDS)('the $kind map library rows', ({ kind, ui }) => {
  async function openMenu() {
    await renderMap(ui);
    await fireEvent.press(screen.getByTestId(`${kind}-map-layers`));
  }

  const layerIds = () => mockSurface?.layers.map((layer) => layer.id) ?? [];

  it('draw neither the sections nor the routes while off, and read nothing', async () => {
    await openMenu();

    expect(layerIds().filter((id) => id.startsWith('context-'))).toEqual([]);
    expect(maps.getMapContextLayers).not.toHaveBeenCalled();
  });

  it('draw the library’s sections under the subject once turned on, remembered for this kind only', async () => {
    await openMenu();
    await fireEvent.press(screen.getByTestId(`${kind}-map-layer-sections`));

    expect(layerIds().slice(0, 2)).toEqual(['context-sections-outline', 'context-sections-line']);
    const sections = mockSurface?.sources['context-sections'] as unknown as {
      data: GeoJSON.FeatureCollection;
    };
    expect(sections.data.features.map((feature) => feature.id)).toEqual(['sec-1', 'section-1']);
    expect(screen.getByTestId(`${kind}-map-key-sections`)).toBeTruthy();
    const checks = useHeatmapPreference.getState().detailContext;
    expect(checks.sections[kind]).toBe(true);
    expect(Object.values(checks.sections).filter(Boolean)).toHaveLength(1);
    expect(checks.routes[kind]).toBe(false);
  });

  it('draw the routes at the engine’s generation once turned on', async () => {
    await openMenu();
    await fireEvent.press(screen.getByTestId(`${kind}-map-layer-routes`));

    expect(layerIds().slice(0, 2)).toEqual(['context-routes-outline', 'context-routes-line']);
    expect(mockSurface?.sources['context-routes']).toEqual({
      kind: 'geojson',
      data: routeLinesSourceData({ generation: 4 }),
    });
    expect(screen.getByTestId(`${kind}-map-key-routes`)).toBeTruthy();
  });
});

describe('the subject’s own line among the library layers', () => {
  const filterOf = (id: string) => mockSurface?.layers.find((layer) => layer.id === id)?.filter;

  it('is left out of the section map’s sections, and not out of its routes', async () => {
    useHeatmapPreference.setState({
      detailContext: {
        sections: { activity: false, section: true, route: false },
        routes: { activity: false, section: true, route: false },
      },
    });
    await renderMap(KINDS[1]!.ui);

    expect(filterOf('context-sections-line')).toEqual(['!=', ['get', 'id'], 'section-1']);
    expect(filterOf('context-routes-line')).toBeUndefined();
  });

  it('is left out of the route map’s routes, and not out of its sections', async () => {
    useHeatmapPreference.setState({
      detailContext: {
        sections: { activity: false, section: false, route: true },
        routes: { activity: false, section: false, route: true },
      },
    });
    await renderMap(KINDS[2]!.ui);

    expect(filterOf('context-routes-line')).toEqual(['!=', ['get', 'id'], 'route-1']);
    expect(filterOf('context-sections-line')).toBeUndefined();
  });

  it('is not filtered on the activity map, which has neither', async () => {
    useHeatmapPreference.setState({
      detailContext: {
        sections: { activity: true, section: false, route: false },
        routes: { activity: true, section: false, route: false },
      },
    });
    await renderMap(KINDS[0]!.ui);

    expect(filterOf('context-sections-line')).toBeUndefined();
    expect(filterOf('context-routes-line')).toBeUndefined();
  });
});
