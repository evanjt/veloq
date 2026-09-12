/**
 * Scenario: the regional map declares an `activity-traces` GeoJSON source and
 * uploads a full FeatureCollection of every activity line into it. No layer read
 * that source, so the lines were tiled and never painted.
 *
 * Expected behaviour: a line layer reads it, under the markers and the sections
 * so neither is obscured, and appears at the zoom the start points already treat
 * as "tight enough to show traces". Every source the builder declares has a
 * reader, which is what stops the next one being uploaded for nothing.
 */

import {
  buildRegionalLayers,
  buildRegionalSources,
  TRACES_LINE_LAYER_ID,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';
import { buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders';
import { TRACE_ZOOM_THRESHOLD } from '@/features/maps/lib/mapBudgets';

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function layers(overrides: Partial<Parameters<typeof buildRegionalLayers>[0]> = {}) {
  return buildRegionalLayers({
    isDark: false,
    mapStyle: 'light',
    showActivities: true,
    showSections: true,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#ff0000',
    ...overrides,
  });
}

function sources() {
  return buildRegionalSources({
    markersGeoJSON: empty,
    tracesGeoJSON: empty,
    startPointsGeoJSON: empty,
    sectionsGeoJSON: empty,
    userLocationGeoJSON: empty,
    routeGeoJSON: empty,
    spiderPointsGeoJSON: empty,
    spiderLinesGeoJSON: empty,
    heatmapEnabled: false,
  });
}

describe('the regional map traces layer', () => {
  it('reads the activity-traces source', () => {
    const trace = layers().find((l) => l.id === TRACES_LINE_LAYER_ID);

    expect(trace).toBeDefined();
    expect(trace?.source).toBe('activity-traces');
    expect(trace?.type).toBe('line');
  });

  it('appears at the zoom the start points call tight enough to show traces', () => {
    const trace = layers().find((l) => l.id === TRACES_LINE_LAYER_ID);

    expect(trace?.minzoom).toBe(TRACE_ZOOM_THRESHOLD);
  });

  it('is hidden when the athlete turns activities off', () => {
    const off = layers({ showActivities: false }).find((l) => l.id === TRACES_LINE_LAYER_ID);

    expect(off?.paint?.['line-opacity']).toBe(0);
    expect(off?.layout?.visibility).toBe('none');
  });

  it('sits under the sections and the markers, so neither is obscured', () => {
    const ids = layers().map((l) => l.id);

    expect(ids.indexOf(TRACES_LINE_LAYER_ID)).toBeLessThan(ids.indexOf('sections-line'));
    expect(ids.indexOf(TRACES_LINE_LAYER_ID)).toBeLessThan(ids.indexOf('unclustered-point'));
  });

  /**
   * `MapLayerSpec` had no `minzoom`, so a layer that declared one would have had
   * it dropped on the floor by the page builder and drawn at every zoom.
   */
  it('carries its minzoom into the page the builder writes', () => {
    const html = buildMapSurfaceHtml({
      style: 'light',
      camera: { center: [0, 0], zoom: 10 },
      interaction: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(html).toContain('spec.minzoom');
  });

  it('leaves no source without a reader, which is how this one was uploaded for nothing', () => {
    const declared = Object.keys(sources());
    const read = new Set(layers().map((l) => l.source));

    expect(declared.filter((id) => !read.has(id))).toEqual([]);
  });
});
