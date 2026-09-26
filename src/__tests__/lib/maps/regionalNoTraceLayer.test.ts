/**
 * Scenario: the regional map used to draw every activity in the window as a
 * line built from its route signature, stride-sampled on top of that. The
 * selected route is built from the full coordinates, so tapping a trace painted
 * a second line that sat off to the side of the first, and the coverage the
 * traces stood for is what the heatmap already draws from disk tiles.
 *
 * Expected behaviour: no traces layer, no `activity-traces` source, and nothing
 * uploaded for either. The start points and the selected route stay, because a
 * tap needs the first and the tap's answer is the second. Every source the
 * builder declares still has a reader.
 */

import {
  buildRegionalLayers,
  buildRegionalSources,
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
    startPointsGeoJSON: empty,
    sectionsGeoJSON: empty,
    userLocationGeoJSON: empty,
    routeGeoJSON: empty,
    spiderPointsGeoJSON: empty,
    spiderLinesGeoJSON: empty,
    heatmapEnabled: false,
  });
}

describe('the regional map draws no activity traces', () => {
  it('declares no activity-traces source', () => {
    expect(Object.keys(sources())).not.toContain('activity-traces');
  });

  it('has no layer reading one', () => {
    expect(layers().filter((l) => l.source === 'activity-traces')).toEqual([]);
    expect(layers().filter((l) => l.id.startsWith('activity-traces'))).toEqual([]);
  });

  it('still marks where each activity began, which is what a tap needs', () => {
    const start = layers().find((l) => l.id === 'start-point-outer');

    expect(start?.source).toBe('activity-start-points');
    expect(Object.keys(sources())).toContain('activity-start-points');
  });

  it("still paints the selected route, which is the tap's answer", () => {
    expect(Object.keys(sources())).toContain('selected-route');
    expect(layers().some((l) => l.source === 'selected-route')).toBe(true);
  });

  it('brings the start points in at the zoom the traces used to appear at', () => {
    const start = layers().find((l) => l.id === 'start-point-outer');
    const radius = start?.paint?.['circle-radius'] as unknown[];

    expect(radius).toContain(TRACE_ZOOM_THRESHOLD);
  });

  /**
   * `MapLayerSpec` had no `minzoom`, so a layer that declared one would have had
   * it dropped on the floor by the page builder and drawn at every zoom.
   */
  it('carries a layer minzoom into the page the builder writes', () => {
    const html = buildMapSurfaceHtml({
      style: 'light',
      camera: { center: [0, 0], zoom: 10 },
      interaction: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(html).toContain('spec.minzoom');
  });

  it('leaves no source without a reader, which is how the traces were uploaded for nothing', () => {
    const declared = Object.keys(sources());
    const read = new Set(layers().map((l) => l.source));

    expect(declared.filter((id) => !read.has(id))).toEqual([]);
  });
});
