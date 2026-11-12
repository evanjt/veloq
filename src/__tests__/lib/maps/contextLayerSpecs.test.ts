/**
 * Scenario: the heatmap raster source was declared by the global map alone, so
 * a detail map that drew it would restate the URL and its pass version.
 *
 * Expected behaviour: one builder writes the source, the global map and the
 * context layers both emit it, and a detail map's subject draws over the heat.
 */

import { buildRegionalSources } from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { contextLayerSpecs, withContextLayers } from '@/features/maps/lib/contextLayerSpecs';
import { HEATMAP_SOURCE_MINZOOM, heatmapRasterSource } from '@/features/maps/lib/heatmapTiles';
import { routeLinesSourceData } from '@/features/maps/lib/routeLineCollection';
import {
  MAP_3D_SCALE,
  SECTION_LINE_WIDTHS,
  lineWidthRamp,
} from '@/features/maps/lib/mapLineWidths';
import { mapPalette } from '@/theme';
import type { MapSubjectSpecs } from '@/features/maps/lib/mapSubjectSpecs';

const subject: MapSubjectSpecs = {
  sources: { line: { kind: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [{ id: 'line-layer', type: 'line', source: 'line' }],
  images: [],
  interactiveLayers: undefined,
  bounds: null,
};

describe('heatmapRasterSource', () => {
  it('is the source the global map and the context layers both emit', () => {
    const regional = buildRegionalSources({
      heatmapEnabled: true,
      heatmapBase: 'dark',
      heatmapGeneration: 3,
    } as never)['heatmap-tiles'];
    const context = contextLayerSpecs({ heatmap: { base: 'dark', generation: 3 } }).sources[
      'heatmap-tiles'
    ];

    expect(context).toEqual(heatmapRasterSource('dark', 3));
    expect(regional).toEqual(heatmapRasterSource('dark', 3));
    expect((context as { minzoom: number }).minzoom).toBe(HEATMAP_SOURCE_MINZOOM);
  });

  it('versions the URL once a tile pass has finished', () => {
    const first = heatmapRasterSource('light', 0).tiles[0];
    const next = heatmapRasterSource('light', 1).tiles[0];

    expect(next).not.toBe(first);
    expect(next).toContain('v=1');
  });
});

describe('contextLayerSpecs', () => {
  it('declares nothing while the heatmap is off', () => {
    expect(contextLayerSpecs({ heatmap: null })).toEqual({ sources: {}, layers: [] });
    expect(withContextLayers(subject, { heatmap: null })).toBe(subject);
  });

  it('puts the heat under the subject and leaves the subject untouched', () => {
    const merged = withContextLayers(subject, { heatmap: { base: 'light', generation: 0 } });

    expect(Object.keys(merged.sources)).toEqual(['heatmap-tiles', 'line']);
    expect(merged.layers.map((layer) => layer.id)).toEqual(['heatmap-layer', 'line-layer']);
    expect(subject.layers).toHaveLength(1);
  });
});

describe('contextLayerSpecs with the library lines', () => {
  const palette = mapPalette('light');
  const collection: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [],
  };

  it('draws the sections and routes under the subject, routes below sections', () => {
    const merged = withContextLayers(subject, {
      heatmap: { base: 'light', generation: 2 },
      sections: { collection, omitId: null, palette, terrain: false },
      routes: { generation: 5, omitId: null, palette, terrain: false },
    });

    expect(merged.layers.map((layer) => layer.id)).toEqual([
      'heatmap-layer',
      'context-routes-outline',
      'context-routes-line',
      'context-sections-outline',
      'context-sections-line',
      'line-layer',
    ]);
    expect(merged.sources['context-sections']).toEqual({ kind: 'geojson', data: collection });
    expect(merged.sources['context-routes']).toEqual({
      kind: 'geojson',
      data: routeLinesSourceData({ generation: 5 }),
    });
  });

  it('leaves the subject’s own section and route out with a filter on the id', () => {
    const { layers } = contextLayerSpecs({
      heatmap: null,
      sections: { collection, omitId: 'sec-7', palette, terrain: false },
      routes: { generation: 1, omitId: 'route-3', palette, terrain: false },
    });

    const filterOf = (id: string) => layers.find((layer) => layer.id === id)?.filter;
    for (const id of ['context-sections-outline', 'context-sections-line']) {
      expect(filterOf(id)).toEqual(['!=', ['get', 'id'], 'sec-7']);
    }
    for (const id of ['context-routes-outline', 'context-routes-line']) {
      expect(filterOf(id)).toEqual(['!=', ['get', 'id'], 'route-3']);
    }
  });

  it('filters nothing when the subject is neither a section nor a route', () => {
    const { layers } = contextLayerSpecs({
      heatmap: null,
      sections: { collection, omitId: null, palette, terrain: false },
    });

    expect(layers.every((layer) => layer.filter === undefined)).toBe(true);
    expect(layers.map((layer) => layer.id)).toEqual([
      'context-sections-outline',
      'context-sections-line',
    ]);
  });

  it('draws narrower lines over terrain, as the Map tab does', () => {
    const flat = contextLayerSpecs({
      heatmap: null,
      sections: { collection, omitId: null, palette, terrain: false },
    });
    const tilted = contextLayerSpecs({
      heatmap: null,
      sections: { collection, omitId: null, palette, terrain: true },
    });

    const width = (specs: typeof flat) =>
      specs.layers.find((layer) => layer.id === 'context-sections-line')?.paint?.['line-width'];
    expect(width(tilted)).not.toEqual(width(flat));
    expect(width(tilted)).toEqual(lineWidthRamp(SECTION_LINE_WIDTHS, 0, MAP_3D_SCALE));
  });

  it('draws nothing for a layer that is off', () => {
    expect(contextLayerSpecs({ heatmap: null, sections: null, routes: null })).toEqual({
      sources: {},
      layers: [],
    });
  });
});
