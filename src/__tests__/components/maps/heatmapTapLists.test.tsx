/**
 * Scenario: the athlete taps the heatmap on the global map. The raster has no
 * features, so the press carries only the tap's coordinate.
 *
 * Expected behaviour: with the heatmap shown and the map at zoom 11 or more, the
 * engine is asked which activities pass under the tap and a sheet lists them
 * grouped by route; the group chosen there is the line drawn from the engine's
 * URL, and closing the sheet empties it. Below zoom 11, with the heatmap off or
 * with nothing under the tap, the tap only dismisses, as a tap on bare ground
 * does. A second tap before the first answers supersedes it.
 */
import { renderHook, act } from '@testing-library/react-native';

import { useMapHandlers } from '@/features/maps/components/regional/useMapHandlers';
import { useUnderPoint } from '@/features/maps/components/regional/useUnderPoint';
import {
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import type { UnderPointInput } from '@/app/sheets/under-point';
import { mapPalette } from '@/theme';
import { maps } from '../../__shared__/veloqrsStub';
import type { SheetResult } from '@/shared/app/sheetRequest';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  Accuracy: { Balanced: 3 },
}));

const mockNavigate = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (...a: unknown[]) => mockNavigate(...a),
  goBack: jest.fn(),
}));

interface OpenedSheet {
  route: string;
  input: UnderPointInput;
  settle: (result: SheetResult<string>) => void;
}
const opened: OpenedSheet[] = [];
jest.mock('@/shared/app/sheetRequest', () => ({
  useSheetOpener: () => (route: string, input: UnderPointInput) =>
    new Promise((settle) => {
      opened.push({ route, input, settle: settle as OpenedSheet['settle'] });
    }),
}));

const activity = (id: string) => ({
  id,
  name: `Ride ${id}`,
  sportType: 'Ride',
  date: 1_700_000_000,
  distance: 20_000,
  duration: 3600,
  nearestM: 4,
});

const ANSWER = {
  total: 3,
  truncated: false,
  traceCap: 20,
  groups: [
    { routeId: 'loop-1', name: 'Lake loop', count: 2, activities: [activity('a'), activity('b')] },
    { count: 1, activities: [activity('c')] },
  ],
};

const EMPTY_ANSWER = { total: 0, truncated: false, traceCap: 0, groups: [] };

const TAP: [number, number] = [6.6321, 46.5197];

async function mount({ zoom = 14, heatmapShown = true } = {}) {
  const setSelectedSectionId = jest.fn();
  const setSpider = jest.fn();
  const rendered = await renderHook(() => {
    const underPoint = useUnderPoint();
    const handlers = useMapHandlers({
      activities: [],
      selected: null,
      setSelected: jest.fn(),
      setSelectedSectionId,
      setSelectedRouteId: jest.fn(),
      chooseSection: jest.fn(),
      setSpider,
      heatmapShown,
      lookUpUnderPoint: underPoint.lookUp,
      currentZoomRef: { current: zoom },
      currentCenterRef: { current: [6.6, 46.5] },
      surfaceRef: { current: null },
      currentZoomLevel: { current: zoom },
      bearingAnim: { setValue: jest.fn() },
    } as never);
    return { handlers, traceUrl: underPoint.traceUrl };
  });
  const press = (feature: unknown = null) =>
    act(async () => {
      rendered.result.current.handlers.handleSurfacePress({
        coordinate: TAP,
        point: [0, 0],
        feature,
        features: [],
      } as never);
    });
  return { rendered, press, setSelectedSectionId, setSpider };
}

beforeEach(() => {
  opened.length = 0;
  mockNavigate.mockClear();
  maps.getActivitiesUnderPoint.mockReset();
});

describe('a tap on the heatmap', () => {
  it('asks the engine for the activities under the tap and opens the sheet with the answer', async () => {
    maps.getActivitiesUnderPoint.mockResolvedValue(ANSWER);
    const { press, setSpider } = await mount();
    await press();
    expect(maps.getActivitiesUnderPoint).toHaveBeenCalledWith(46.5197, 6.6321, 14);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.route).toBe('sheets/under-point');
    expect(opened[0]?.input).toMatchObject({
      total: 3,
      traceCap: 20,
      groups: ANSWER.groups,
    });
    expect(setSpider).toHaveBeenCalledWith(null);
  });

  it('asks at the whole zoom the camera has passed', async () => {
    maps.getActivitiesUnderPoint.mockResolvedValue(ANSWER);
    const { press } = await mount({ zoom: 12.8 });
    await press();
    expect(maps.getActivitiesUnderPoint).toHaveBeenCalledWith(46.5197, 6.6321, 12);
  });

  it.each([
    ['below zoom 11', { zoom: 10.9 }],
    ['with the heatmap off', { heatmapShown: false }],
  ])('only dismisses %s', async (_name, options) => {
    const { press, setSelectedSectionId, setSpider } = await mount(options);
    await press();
    expect(maps.getActivitiesUnderPoint).not.toHaveBeenCalled();
    expect(opened).toHaveLength(0);
    expect(setSelectedSectionId).toHaveBeenCalledWith(null);
    expect(setSpider).toHaveBeenCalledWith(null);
  });

  it('opens nothing when no activity is under the tap', async () => {
    maps.getActivitiesUnderPoint.mockResolvedValue(EMPTY_ANSWER);
    const { press, setSpider } = await mount();
    await press();
    expect(maps.getActivitiesUnderPoint).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(0);
    expect(setSpider).toHaveBeenCalledWith(null);
  });

  it('opens nothing when the engine fails', async () => {
    maps.getActivitiesUnderPoint.mockRejectedValue(new Error('engine busy'));
    const { press } = await mount();
    await press();
    expect(opened).toHaveLength(0);
  });

  it('leaves a tap on a feature to that feature', async () => {
    const { press } = await mount();
    await press({ layerId: 'routes-line', id: null, properties: { id: 'r' }, geometry: null });
    expect(maps.getActivitiesUnderPoint).not.toHaveBeenCalled();
  });

  it('opens the sheet once, with the later answer, when the earlier one resolves last', async () => {
    let resolveFirst: (answer: typeof ANSWER) => void = () => {};
    const later = { ...ANSWER, total: 1, groups: [ANSWER.groups[1]!] };
    maps.getActivitiesUnderPoint
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(later);
    const { press } = await mount();
    await press();
    await press();
    await act(async () => resolveFirst(ANSWER));
    expect(opened).toHaveLength(1);
    expect(opened[0]?.input.total).toBe(1);
  });
});

describe('the group chosen in the sheet', () => {
  async function openSheet() {
    maps.getActivitiesUnderPoint.mockResolvedValue(ANSWER);
    const mounted = await mount();
    await mounted.press();
    return { ...mounted, sheet: opened[0]! };
  }

  it('draws no line until a group is chosen', async () => {
    const { rendered } = await openSheet();
    expect(rendered.result.current.traceUrl).toBeNull();
  });

  it('names the engine URL for the tap and the chosen route', async () => {
    const { rendered, sheet } = await openSheet();
    await act(async () => sheet.input.onGroup(ANSWER.groups[0]!));
    expect(rendered.result.current.traceUrl).toMatch(
      /veloq-geo\/under-point\/46519700_6632100_14_loop-1\?v=\d+$/
    );
  });

  it('names the group of activities in no route with the underscore', async () => {
    const { rendered, sheet } = await openSheet();
    await act(async () => sheet.input.onGroup(ANSWER.groups[1]!));
    expect(rendered.result.current.traceUrl).toMatch(
      /veloq-geo\/under-point\/46519700_6632100_14__\?v=\d+$/
    );
  });

  it('moves the URL when the same group is drawn for a new tap', async () => {
    const { rendered, press, sheet } = await openSheet();
    await act(async () => sheet.input.onGroup(ANSWER.groups[0]!));
    const first = rendered.result.current.traceUrl;
    await act(async () => sheet.settle({ kind: 'cancelled' }));
    await press();
    await act(async () => opened[1]!.input.onGroup(ANSWER.groups[0]!));
    expect(rendered.result.current.traceUrl).not.toBeNull();
    expect(rendered.result.current.traceUrl).not.toBe(first);
  });

  it('empties the line when the sheet is dismissed', async () => {
    const { rendered, sheet } = await openSheet();
    await act(async () => sheet.input.onGroup(ANSWER.groups[0]!));
    await act(async () => sheet.settle({ kind: 'cancelled' }));
    expect(rendered.result.current.traceUrl).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('empties the line and opens the activity when a row is chosen', async () => {
    const { rendered, sheet } = await openSheet();
    await act(async () => sheet.input.onGroup(ANSWER.groups[0]!));
    await act(async () => sheet.settle({ kind: 'selected', value: 'b' }));
    expect(rendered.result.current.traceUrl).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('/activity/b');
  });

  it('empties the line when the sheet asks for no group', async () => {
    const { rendered, sheet } = await openSheet();
    await act(async () => sheet.input.onGroup(ANSWER.groups[0]!));
    await act(async () => sheet.input.onGroup(null));
    expect(rendered.result.current.traceUrl).toBeNull();
  });
});

describe('the under-point source', () => {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  const sources = (underPointGeoJSON?: string) =>
    buildRegionalSources({
      markersGeoJSON: empty,
      sectionsGeoJSON: empty,
      routesGeoJSON: empty,
      userLocationGeoJSON: empty,
      routeGeoJSON: empty,
      spiderPointsGeoJSON: empty,
      spiderLinesGeoJSON: empty,
      heatmapEnabled: true,
      heatmapBase: 'light',
      ...(underPointGeoJSON ? { underPointGeoJSON } : {}),
    });

  it('stays declared with the empty collection when nothing is drawn', () => {
    expect(sources()['under-point']).toEqual({ kind: 'geojson', data: empty });
  });

  it('names the engine URL when a group is drawn', () => {
    expect(sources('https://page/veloq-geo/under-point/k?v=1')['under-point']).toEqual({
      kind: 'geojson',
      data: 'https://page/veloq-geo/under-point/k?v=1',
    });
  });

  it('is drawn by layers under the activity markers', () => {
    const layers = buildRegionalLayers({
      palette: mapPalette('light'),
      showActivities: true,
      showSections: true,
      showRoutes: false,
      showHeatmap: true,
      heatmapEnabled: true,
      hasSpider: false,
      hasUserLocation: false,
      hasRouteData: false,
      selectedActivityId: null,
      selectedSectionId: null,
      routeColor: '#ff0000',
    });
    const ids = layers.map((layer) => layer.id);
    const drawn = layers.filter((layer) => 'source' in layer && layer.source === 'under-point');
    expect(drawn.length).toBeGreaterThan(0);
    const firstMarker = ids.indexOf('cluster-circles');
    for (const layer of drawn) expect(ids.indexOf(layer.id)).toBeLessThan(firstMarker);
  });
});
