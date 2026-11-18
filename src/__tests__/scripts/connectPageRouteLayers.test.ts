/**
 * Scenario: the routes and sections pages draw lines beside a table whose rows
 * are re-sorted, hovered and selected.
 *
 * Expected behaviour: a selected pass keeps its colour when the table is
 * re-sorted, because the colour follows the order of selection; hovering a row
 * lights the line of the same id and hovering a line names the row, with the
 * pass's activity id read from its properties; the hovered attempt's full track
 * is asked only after the pointer rests, and once per id; the section spec
 * draws the line bold, every pass faint, the hovered pass lit and selected
 * passes in their colours.
 */

import {
  HOVER_TRACK_MS,
  withAsked,
  hoverTrackDue,
  passColour,
  rowOfFeature,
  routeDetailSpec,
  sectionDetailSpec,
  listSpec,
  boundsOfGeoText,
} from '../../../web/connect/map/routeLayers';
import { compareColoursOn } from '../../../web/connect/map/activityLayers';
import { divergingRamp } from '../../../src/theme/colors';

const BASE = 'light';
const COMPARE_COLOURS = compareColoursOn(BASE);

const feature = (layerId: string, id: string | null, properties: Record<string, unknown> = {}) => ({
  layerId,
  id,
  properties,
});

describe('pass colour', () => {
  it('follows the order of selection, not the order of the table', () => {
    const selected = ['pass-b', 'pass-a'];
    const ascending = ['pass-a', 'pass-b', 'pass-c'].map((id) => passColour(id, selected, BASE));
    const descending = ['pass-c', 'pass-b', 'pass-a'].map((id) => passColour(id, selected, BASE));
    expect(ascending).toEqual([COMPARE_COLOURS['line-1'], COMPARE_COLOURS['line-0'], null]);
    expect(descending).toEqual([null, COMPARE_COLOURS['line-0'], COMPARE_COLOURS['line-1']]);
  });

  it('gives nothing below two selected passes', () => {
    expect(passColour('pass-a', ['pass-a'], BASE)).toBeNull();
    expect(passColour('pass-a', [], BASE)).toBeNull();
  });
});

describe('hover exchange', () => {
  it('reads a pass line by its activity id and a list line by its id', () => {
    expect(rowOfFeature(feature('section-passes', null, { activityId: 'a1' }))).toBe('a1');
    expect(rowOfFeature(feature('routes', 'g7'))).toBe('g7');
    expect(rowOfFeature(feature('section-passes', null, {}))).toBeNull();
    expect(rowOfFeature(null)).toBeNull();
  });
});

describe('hovered attempt track', () => {
  it('is due only once the pointer has rested the pause', () => {
    expect(hoverTrackDue(0, HOVER_TRACK_MS - 1)).toBe(false);
    expect(hoverTrackDue(0, HOVER_TRACK_MS)).toBe(true);
  });

  it('is asked once per id and kept', () => {
    const first = withAsked([], 'a1');
    expect(first).toEqual(['a1']);
    expect(withAsked(first, 'a1')).toBe(first);
    expect(withAsked(first, 'a2')).toEqual(['a1', 'a2']);
    expect(withAsked(first, null)).toBe(first);
  });
});

describe('specs', () => {
  it('draws the list layer for the kind, hidden never, with its lines interactive', () => {
    const routes = listSpec('light', 'routes', 3);
    expect(routes.sources.lines).toEqual({
      kind: 'geojson',
      data: 'veloq://geo/route-lines/all?v=3',
    });
    expect(routes.interactiveLayers).toEqual(['lines']);
    const sections = listSpec('light', 'sections', 0);
    expect(sections.sources.lines).toEqual({
      kind: 'geojson',
      data: 'veloq://geo/sections/all?v=0',
    });
  });

  it('draws the representative bold, the latest ride lighter and shows only the hovered track', () => {
    const spec = routeDetailSpec('light', 'g 1', ['a1', 'a2'], 'a2');
    expect(spec.layers.map((layer) => layer.id)).toEqual([
      'route-attempts',
      'route-latest',
      'route',
      'track-a1',
      'track-a2',
    ]);
    expect(spec.sources.route).toEqual({ kind: 'geojson', data: 'veloq://geo/route/g%201' });
    expect(spec.sources['route-latest']).toEqual({
      kind: 'geojson',
      data: 'veloq://geo/route-latest/g%201',
    });
    expect(spec.sources['track-a2']).toEqual({ kind: 'geojson', data: 'veloq://geo/track/a2' });
    const visible = (id: string) => spec.layers.find((layer) => layer.id === id)?.visible;
    expect([visible('track-a1'), visible('track-a2')]).toEqual([false, true]);
    const width = (id: string) =>
      spec.layers.find((layer) => layer.id === id)?.paint?.['line-width'];
    expect(width('route') as number).toBeGreaterThan(width('route-latest') as number);
  });

  it('draws every attempt faint through one read and makes only that layer clickable', () => {
    const spec = routeDetailSpec('light', 'g 1', [], null);
    expect(spec.sources['route-attempts']).toEqual({
      kind: 'geojson',
      data: 'veloq://geo/route-attempts/g%201',
    });
    const layer = (id: string) => spec.layers.find((candidate) => candidate.id === id);
    expect(layer('route-attempts')?.source).toBe('route-attempts');
    expect(layer('route-attempts')?.paint?.['line-opacity'] as number).toBeLessThan(0.5);
    expect(spec.interactiveLayers).toEqual(['route-attempts']);
    // The click names the attempt by the activity id each line carries.
    expect(rowOfFeature(feature('route-attempts', null, { activityId: 'a7' }))).toBe('a7');
  });

  it('shows the picked attempt without a hover, cool when ahead and warm when behind', () => {
    const colour = (spec: ReturnType<typeof routeDetailSpec>, id: string) =>
      spec.layers.find((layer) => layer.id === id)?.paint?.['line-color'];
    const visible = (spec: ReturnType<typeof routeDetailSpec>, id: string) =>
      spec.layers.find((layer) => layer.id === id)?.visible;
    const ahead = routeDetailSpec('light', 'g1', ['a1', 'a2'], null, { id: 'a2', side: 'ahead' });
    expect([visible(ahead, 'track-a1'), visible(ahead, 'track-a2')]).toEqual([false, true]);
    expect(colour(ahead, 'track-a2')).toBe(divergingRamp.light.cool[1]);
    const behind = routeDetailSpec('dark', 'g1', ['a2'], null, { id: 'a2', side: 'behind' });
    expect(colour(behind, 'track-a2')).toBe(divergingRamp.dark.warm[1]);
    const level = routeDetailSpec('light', 'g1', ['a2'], null, { id: 'a2', side: 'level' });
    expect(colour(level, 'track-a2')).toBe(divergingRamp.light.mid);
  });

  it('shows the hovered track beside the picked one, in the hover colour', () => {
    const spec = routeDetailSpec('light', 'g1', ['a1', 'a2'], 'a1', { id: 'a2', side: 'ahead' });
    const layer = (id: string) => spec.layers.find((candidate) => candidate.id === id);
    expect([layer('track-a1')?.visible, layer('track-a2')?.visible]).toEqual([true, true]);
    expect(layer('track-a1')?.paint?.['line-color']).toBe(COMPARE_COLOURS['line-1']);
  });

  it('shows no attempt track when none is hovered', () => {
    const spec = routeDetailSpec('light', 'g1', ['a1'], null);
    expect(spec.layers.find((layer) => layer.id === 'track-a1')?.visible).toBe(false);
  });

  it('draws the section bold, every pass faint, the hovered pass lit and selected passes coloured', () => {
    const spec = sectionDetailSpec('light', 's1', 'a2', ['a1', 'a3']);
    expect(spec.layers.map((layer) => layer.id)).toEqual([
      'section-passes',
      'section',
      'section-selected',
      'section-hover',
    ]);
    expect(spec.sources['section-passes']).toEqual({
      kind: 'geojson',
      data: 'veloq://geo/section-passes/s1',
    });
    const selected = spec.layers.find((layer) => layer.id === 'section-selected');
    expect(selected?.filter).toEqual(['in', ['get', 'activityId'], ['literal', ['a1', 'a3']]]);
    expect(JSON.stringify(selected?.paint?.['line-color'])).toContain(COMPARE_COLOURS['line-0']);
    expect(JSON.stringify(selected?.paint?.['line-color'])).toContain(COMPARE_COLOURS['line-1']);
    const hover = spec.layers.find((layer) => layer.id === 'section-hover');
    expect(hover?.filter).toEqual(['==', ['get', 'activityId'], 'a2']);
    expect(spec.interactiveLayers).toEqual(['section-passes']);
  });

  it('lights nothing when no pass is hovered', () => {
    const spec = sectionDetailSpec('light', 's1', null, []);
    expect(spec.layers.find((layer) => layer.id === 'section-hover')?.filter).toEqual([
      '==',
      ['get', 'activityId'],
      '',
    ]);
  });
});

describe('fit', () => {
  it('spans every position of every feature and is null for none', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [1, 2],
              [3, 4],
            ],
          },
        },
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-1, 5],
              [2, 0],
            ],
          },
        },
      ],
    });
    expect(boundsOfGeoText(text)).toEqual([-1, 0, 3, 5]);
    expect(boundsOfGeoText('{"type":"FeatureCollection","features":[]}')).toBeNull();
    expect(boundsOfGeoText('not json')).toBeNull();
  });
});
