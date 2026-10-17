/**
 * Scenario: the 3D map swaps its basemap style while nothing is selected, or
 * while the elevation chart is being scrubbed.
 *
 * Expected behaviour: the style the swap builds still names the route, the
 * start/end markers and the scrub marker, so a later route or scrub finds
 * its source.
 */
import { buildStyleOverlayScript, buildUpdateLayersScript } from '@/features/maps/lib/htmlBuilders';
import type { UpdateLayersParams } from '@/features/maps/lib/htmlBuilders/map3DScripts';

type Overlays = {
  sources: Record<string, unknown>;
  layers: { id: string; layout: { visibility: string } }[];
};

const overlays = (coords: number[][], color = '#112233'): Overlays =>
  new Function(`${buildStyleOverlayScript()}; return veloqOverlays(arguments[0], arguments[1]);`)(
    coords,
    color
  ) as Overlays;

const lines = (n: number): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, () => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: [
        [7, 46],
        [7.1, 46.1],
      ],
    },
  })),
});

/**
 * A page that was sent `sends` in order, then swapped its style. The update
 * script has no map to draw on, so it only records what it was sent.
 */
const overlaysAfter = (...sends: UpdateLayersParams[]): Overlays => {
  const page: { _veloq3d?: unknown } = {};
  for (const params of sends) new Function('window', buildUpdateLayersScript(params))(page);
  return new Function(
    'window',
    `${buildStyleOverlayScript()}; return veloqOverlays(arguments[1], '#112233');`
  )(page, [
    [7, 46],
    [7.1, 46.1],
  ]) as Overlays;
};

describe('buildStyleOverlayScript', () => {
  it('names the route, marker and scrub sources when there is no route', () => {
    const { sources, layers } = overlays([]);

    expect(Object.keys(sources).sort()).toEqual(['highlight-point', 'route', 'start-end-markers']);
    const visible = layers.filter((l) => l.layout.visibility === 'visible');
    expect(visible).toEqual([]);
    expect(layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(['route-line', 'start-end-fill', 'highlight-border', 'highlight-fill'])
    );
  });

  it('shows the route layers and keeps the scrub marker hidden when there is a route', () => {
    const { sources, layers } = overlays([
      [7, 46],
      [7.1, 46.1],
    ]);

    const route = sources['route'] as { data: { features: unknown[] } };
    expect(route.data.features).toHaveLength(1);
    const vis = Object.fromEntries(layers.map((l) => [l.id, l.layout.visibility]));
    expect(vis['route-line']).toBe('visible');
    expect(vis['start-end-border']).toBe('visible');
    expect(vis['highlight-fill']).toBe('none');
    expect(vis['highlight-border']).toBe('none');
  });

  it('carries the matched route, sections, traces and selected trace across a swap', () => {
    const { sources, layers } = overlaysAfter({
      routesGeoJSON: lines(1),
      sectionsGeoJSON: lines(2),
      tracesGeoJSON: lines(2),
      highlightedTraceGeoJSON: lines(1),
    });

    expect(Object.keys(sources).sort()).toEqual([
      'highlight-point',
      'highlighted-trace-source',
      'route',
      'routes-source',
      'sections-source',
      'start-end-markers',
      'traces-source',
    ]);
    const ids = layers.map((l) => l.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'routes-layer-outline',
        'routes-layer',
        'sections-layer',
        'traces-layer',
        'highlighted-trace-layer',
      ])
    );
    // The matched route runs under the activity's own route layers, the rest over the markers.
    expect(ids.indexOf('routes-layer')).toBeLessThan(ids.indexOf('route-outline'));
    expect(ids.indexOf('sections-layer')).toBeGreaterThan(ids.indexOf('highlight-fill'));
    expect(ids.indexOf('traces-layer')).toBeGreaterThan(ids.indexOf('highlight-fill'));
    const routes = sources['routes-source'] as { data: { features: unknown[] } };
    expect(routes.data.features).toHaveLength(1);
  });

  it('carries the route lines across a swap when they were sent as the engine URL', () => {
    const url = 'https://maps.example/veloq-geo/route-lines/all?v=7';
    const { sources, layers } = overlaysAfter({ routesGeoJSON: url });

    expect(sources['routes-source']).toEqual({ type: 'geojson', data: url });
    expect(layers.map((l) => l.id)).toEqual(
      expect.arrayContaining(['routes-layer-outline', 'routes-layer'])
    );
  });

  it('keeps a collection a later send left out and drops one sent empty', () => {
    const { sources } = overlaysAfter(
      { routesGeoJSON: lines(1), sectionsGeoJSON: lines(1), tracesGeoJSON: lines(1) },
      { highlightedSectionId: 's1' },
      { sectionsGeoJSON: undefined },
      { tracesGeoJSON: { type: 'FeatureCollection', features: [] } }
    );

    expect(sources).toHaveProperty('routes-source');
    expect(sources).not.toHaveProperty('sections-source');
    expect(sources).not.toHaveProperty('traces-source');
  });

  it('adds no line layers for a page that was never sent any', () => {
    const { layers } = overlaysAfter();

    expect(layers.map((l) => l.id)).not.toContain('routes-layer');
  });
});
