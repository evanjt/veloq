/**
 * Scenario: a map pane is given a new spec while its map is drawn, and a
 * pointer moves over it.
 *
 * Expected behaviour: the steps that take the map from one spec to the next are
 * the least that does it: nothing for an equal spec, a data change for a
 * source whose data moved, a source and its layers taken down and put up again
 * when an option it is built with changed, and a layer inserted under the next
 * layer that is drawn. The ids to light and put out are the difference between
 * two sets. A pointer means the first interactive layer with a hit, in the
 * order the layers are given, over a box of the phone's radius.
 */

import type { MapSurfaceSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { SURFACE_HIT_TEST_RADIUS_PX } from '@/features/maps/lib/surfaceHitRadius';

import { hitBox, pickFeature } from '../../../web/connect/map/hit';
import { highlightChange, reconcile } from '../../../web/connect/map/reconcile';

const lines = (data: string | object = 'veloq://geo/route-lines/all?v=1'): MapSurfaceSpec => ({
  sources: {
    routes: { kind: 'geojson', data: data as never },
    heat: { kind: 'raster', tiles: ['veloq://heatmap-light/{z}/{x}/{y}'], tileSize: 512 },
  },
  layers: [
    { id: 'heat', type: 'raster', source: 'heat' },
    { id: 'routes', type: 'line', source: 'routes', paint: { 'line-width': 3 } },
  ],
});

describe('reconciling a map spec', () => {
  it('adds every source, then every layer under the next one drawn, from nothing', () => {
    expect(reconcile(null, lines())).toEqual([
      { do: 'addSource', id: 'routes', spec: lines().sources.routes },
      { do: 'addSource', id: 'heat', spec: lines().sources.heat },
      { do: 'addLayer', spec: lines().layers[1], before: undefined },
      { do: 'addLayer', spec: lines().layers[0], before: 'routes' },
    ]);
  });

  it('does nothing for an equal spec', () => {
    expect(reconcile(lines(), lines())).toEqual([]);
  });

  it('sets the data of a source whose data moved, and nothing else', () => {
    const next = lines('veloq://geo/route-lines/all?v=2');
    expect(reconcile(lines(), next)).toEqual([
      { do: 'setData', id: 'routes', data: 'veloq://geo/route-lines/all?v=2' },
    ]);
  });

  it('sets the tiles of a raster source whose url moved', () => {
    const next = lines();
    next.sources.heat = {
      kind: 'raster',
      tiles: ['veloq://heatmap-dark/{z}/{x}/{y}'],
      tileSize: 512,
    };
    expect(reconcile(lines(), next)).toEqual([
      { do: 'setTiles', id: 'heat', tiles: ['veloq://heatmap-dark/{z}/{x}/{y}'] },
    ]);
  });

  it('updates a layer whose paint changed, keeping its place', () => {
    const next = lines();
    next.layers[1] = { id: 'routes', type: 'line', source: 'routes', paint: { 'line-width': 5 } };
    expect(reconcile(lines(), next)).toEqual([
      { do: 'updateLayer', spec: next.layers[1], previous: lines().layers[1] },
    ]);
  });

  it('takes a source built with another option down with its layers and puts it up again', () => {
    const next = lines();
    next.sources.routes = {
      kind: 'geojson',
      data: 'veloq://geo/route-lines/all?v=1',
      lineMetrics: true,
    };
    expect(reconcile(lines(), next)).toEqual([
      { do: 'removeLayer', id: 'routes' },
      { do: 'removeSource', id: 'routes' },
      { do: 'addSource', id: 'routes', spec: next.sources.routes },
      { do: 'addLayer', spec: next.layers[1], before: undefined },
    ]);
  });

  it('removes the layers and sources a spec drops', () => {
    const next: MapSurfaceSpec = {
      sources: { heat: lines().sources.heat as never },
      layers: [lines().layers[0] as never],
    };
    expect(reconcile(lines(), next)).toEqual([
      { do: 'removeLayer', id: 'routes' },
      { do: 'removeSource', id: 'routes' },
    ]);
  });

  it('inserts a new layer under its own beforeId when that is drawn', () => {
    const next = lines();
    next.layers.push({ id: 'halo', type: 'line', source: 'routes', beforeId: 'heat' });
    expect(reconcile(lines(), next)).toEqual([
      { do: 'addLayer', spec: next.layers[2], before: 'heat' },
    ]);
  });

  it('puts a layer first when it is added at the front', () => {
    const next = lines();
    next.layers.unshift({ id: 'base', type: 'raster', source: 'heat' });
    expect(reconcile(lines(), next)).toEqual([
      { do: 'addLayer', spec: next.layers[0], before: 'heat' },
    ]);
  });
});

describe('the highlight change', () => {
  it('lights the new ids and puts out the dropped ones', () => {
    expect(highlightChange(new Set(['a', 'b']), new Set(['b', 'c']))).toEqual({
      light: ['c'],
      out: ['a'],
    });
  });

  it('changes nothing between equal sets, or from none to none', () => {
    expect(highlightChange(new Set(['a']), new Set(['a']))).toEqual({ light: [], out: [] });
    expect(highlightChange(new Set(), new Set())).toEqual({ light: [], out: [] });
  });
});

describe('what a pointer means', () => {
  it("searches a box of the phone's radius around the pointer", () => {
    const r = SURFACE_HIT_TEST_RADIUS_PX;
    expect(hitBox(100, 50)).toEqual([
      [100 - r, 50 - r],
      [100 + r, 50 + r],
    ]);
  });

  const hit = (layer: string, id: string | number | undefined, properties = {}) => ({
    id,
    properties,
    layer: { id: layer },
  });

  it('prefers the first layer given, whatever the hits are drawn in', () => {
    const picked = pickFeature([hit('routes', 'r1'), hit('starts', 's1')], ['starts', 'routes']);
    expect(picked).toEqual({ layerId: 'starts', id: 's1', properties: {} });
  });

  it('reads the id from the feature, else from its id property, else null', () => {
    expect(pickFeature([hit('routes', 7)], ['routes'])?.id).toBe('7');
    expect(pickFeature([hit('routes', undefined, { id: 'r2' })], ['routes'])?.id).toBe('r2');
    expect(pickFeature([hit('routes', undefined, { name: 'x' })], ['routes'])?.id).toBeNull();
  });

  it('means nothing when no listed layer has a hit', () => {
    expect(pickFeature([hit('other', 'x')], ['routes'])).toBeNull();
    expect(pickFeature([], ['routes'])).toBeNull();
  });
});
