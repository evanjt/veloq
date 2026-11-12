/**
 * Scenario: the athlete taps a library section or route drawn as context on a detail map.
 *
 * Expected behaviour: inside an open host the tapped subject is pushed as a card on that host;
 * outside one its detail screen opens; the subject's own line wins a tie; overlapping sections
 * open the chooser and the one chosen is opened.
 */

import { act, renderHook } from '@testing-library/react-native';

import { withContextLayers } from '@/features/maps/lib/contextLayerSpecs';
import { contextSubjectsAtTap } from '@/features/maps/lib/contextPress';
import { useContextPress } from '@/features/maps/hooks/useContextPress';
import type { MapFeatureHit, MapPressEvent } from '@/features/maps/components/MapSurface';
import type { MapSubjectSpecs } from '@/features/maps/lib/mapSubjectSpecs';
import { mapPalette } from '@/theme';
import { openHost, closeHost, topCard, useMapSheetHosts } from '@/shared/app/mapSheetHost';
import { navigateTo } from '@/shared/app/navigation';
import { answerSheet } from '../../__shared__/answerSheet';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), goBack: jest.fn() }));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
const mockPush = jest.fn();
const mockParams: { request?: string } = {};
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), canGoBack: () => true, back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

const sectionHit = (id: string, name = id): MapFeatureHit => ({
  layerId: 'context-sections-line',
  id,
  properties: { id, name, distanceMeters: 900 },
  geometry: null,
});
const routeHit = (id: string): MapFeatureHit => ({
  layerId: 'context-routes-line',
  id: null,
  properties: { id, name: id, distanceMeters: 5000 },
  geometry: null,
});
const press = (...hits: MapFeatureHit[]): MapPressEvent => ({
  coordinate: [6.6, 46.5],
  point: [10, 10],
  feature: hits[0] ?? null,
  features: hits,
});

describe('contextSubjectsAtTap', () => {
  it('lists each tapped section once, in the order hit', () => {
    const hits = [sectionHit('ridge'), sectionHit('canal'), sectionHit('ridge')];
    expect(contextSubjectsAtTap(hits).map((s) => [s.kind, s.id])).toEqual([
      ['section', 'ridge'],
      ['section', 'canal'],
    ]);
  });

  it('lists a route hit and ignores the subject’s own layers and a feature with no id', () => {
    const own: MapFeatureHit = {
      layerId: 'activity-line',
      id: 'a',
      properties: { id: 'a' },
      geometry: null,
    };
    const noId: MapFeatureHit = {
      layerId: 'context-routes-line',
      id: null,
      properties: {},
      geometry: null,
    };
    expect(contextSubjectsAtTap([own, noId])).toEqual([]);
    expect(contextSubjectsAtTap([routeHit('loop')])).toEqual([
      { kind: 'route', id: 'loop', name: 'loop', distanceMeters: 5000 },
    ]);
  });
});

describe('withContextLayers hit-testing', () => {
  const palette = mapPalette('light');
  const base: MapSubjectSpecs = {
    sources: {},
    layers: [],
    images: [],
    interactiveLayers: ['own-marker'],
    bounds: null,
  };
  const on = { omitId: null, palette, terrain: false };

  it('hit-tests the subject first, then sections, then routes', () => {
    const specs = withContextLayers(base, {
      heatmap: null,
      sections: { ...on, collection: { type: 'FeatureCollection', features: [] } },
      routes: { ...on, generation: 1 },
    });
    expect(specs.interactiveLayers).toEqual([
      'own-marker',
      'context-sections-line',
      'context-routes-line',
    ]);
  });

  it('adds nothing for a layer that is off', () => {
    const specs = withContextLayers(base, { heatmap: { base: 'light', generation: 1 } });
    expect(specs.interactiveLayers).toEqual(['own-marker']);
  });

  it('starts the list from nothing for a subject with no interactive layers', () => {
    const specs = withContextLayers(
      { ...base, interactiveLayers: undefined },
      { heatmap: null, routes: { ...on, generation: 1 } }
    );
    expect(specs.interactiveLayers).toEqual(['context-routes-line']);
  });
});

describe('useContextPress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMapSheetHosts.setState({ hosts: {} });
  });

  it('pushes the tapped section as a card on the host the map holds', async () => {
    const key = openHost('activity', 'ride');
    const { result } = await renderHook(() => useContextPress(key));
    let consumed = false;
    await act(async () => {
      consumed = result.current(press(sectionHit('ridge')));
    });
    expect(consumed).toBe(true);
    expect(topCard(useMapSheetHosts.getState().hosts, key)).toMatchObject({
      kind: 'section',
      id: 'ridge',
    });
    expect(navigateTo).not.toHaveBeenCalled();
    closeHost(key);
  });

  it('pushes a tapped route the same way', async () => {
    const key = openHost('section', 'ridge');
    const { result } = await renderHook(() => useContextPress(key));
    await act(async () => {
      result.current(press(routeHit('loop')));
    });
    expect(topCard(useMapSheetHosts.getState().hosts, key)).toMatchObject({
      kind: 'route',
      id: 'loop',
    });
    closeHost(key);
  });

  it('navigates to the detail screen outside a host', async () => {
    const { result } = await renderHook(() => useContextPress('section:none'));
    await act(async () => {
      result.current(press(sectionHit('ridge')));
    });
    expect(navigateTo).toHaveBeenCalledWith('/section/ridge');
  });

  it('leaves a tap that hit no context line to the caller', async () => {
    const key = openHost('activity', 'ride');
    const { result } = await renderHook(() => useContextPress(key));
    let consumed = true;
    await act(async () => {
      consumed = result.current(press());
    });
    expect(consumed).toBe(false);
    expect(topCard(useMapSheetHosts.getState().hosts, key)).toMatchObject({ kind: 'activity' });
    closeHost(key);
  });

  it('opens the chooser for overlapping sections and pushes the one chosen', async () => {
    const key = openHost('activity', 'ride');
    const { result } = await renderHook(() => useContextPress(key));
    await act(async () => {
      result.current(press(sectionHit('ridge', 'Ridge Road'), sectionHit('canal', 'Canal Path')));
    });
    expect(mockPush.mock.calls.at(-1)?.[0].pathname).toBe('sheets/section-chooser');
    expect(topCard(useMapSheetHosts.getState().hosts, key)).toMatchObject({ kind: 'activity' });

    await answerSheet(mockPush, mockParams, 'canal');
    await act(async () => {});

    expect(topCard(useMapSheetHosts.getState().hosts, key)).toMatchObject({
      kind: 'section',
      id: 'canal',
    });
    closeHost(key);
  });
});
