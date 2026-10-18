/**
 * Scenario: the map tab is in 3D and the user highlights one section, which
 * changes nothing but `highlightedSectionId`.
 *
 * Expected behaviour: the injected script carries that alone. A collection
 * the caller leaves out reads as unchanged in the page, and is told apart
 * from one sent empty, which still hides its layer.
 */
import {
  buildMap3DHtml,
  buildSetRouteScript,
  buildStyleOverlayScript,
  buildUpdateLayersScript,
} from '@/features/maps/lib/htmlBuilders';
import { TRACK_FIT_PADDING } from '@/features/maps/lib/activityCamera';
import { mapPalette } from '@/theme';

const light = mapPalette('light');

const collection = (n: number): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, () => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [7.3, 46.2] },
  })),
});

describe('buildUpdateLayersScript', () => {
  it('reads the section and record colours from the palette it is given', () => {
    const dark = mapPalette('dark');
    const palette = {
      ...dark,
      record: '#654321',
      layer: { ...dark.layer, sections: ['#123456', ...dark.layer.sections.slice(1)] },
    };
    const script = buildUpdateLayersScript({ tracesGeoJSON: collection(1) }, palette);

    expect(script).toContain('0,"#123456"');
    expect(script).toContain("['get', 'isPR'], true], \"#654321\"");
  });

  it('reads the highlight, matched route and trophy colours from the palette it is given', () => {
    const dark = mapPalette('dark');
    const palette = {
      ...dark,
      muted: '#222222',
      record: '#333333',
      layer: { ...dark.layer, highlight: '#111111' as typeof dark.layer.highlight },
    };
    const script = buildUpdateLayersScript(
      {
        tracesGeoJSON: collection(1),
        sectionsGeoJSON: collection(1),
        routesGeoJSON: collection(1),
        pointMarkersGeoJSON: collection(1),
        highlightedSectionId: 's1',
      },
      palette
    );

    expect(script).toContain('"#111111"');
    expect(script).toContain('"#222222"');
    expect(script).toContain('\'icon-color\': "#333333"');
    expect(script).not.toContain(dark.layer.highlight);
    expect(script).not.toContain(dark.muted);
    expect(script).not.toContain(dark.record);
  });

  it('marks an omitted collection unchanged rather than empty', () => {
    const script = buildUpdateLayersScript({ highlightedSectionId: 's1' }, light);

    expect(script).toContain('const tracesData = undefined;');
    expect(script).toContain('const sectionsData = undefined;');
    expect(script).toContain('const highlightedSectionId = "s1";');
  });

  it('still clears a collection the caller names with nothing in it', () => {
    const script = buildUpdateLayersScript(
      {
        tracesGeoJSON: undefined,
        sectionsGeoJSON: undefined,
      },
      light
    );

    expect(script).toContain('const tracesData = null;');
    expect(script).toContain('const sectionsData = null;');
  });

  it('carries the collection that changed', () => {
    const script = buildUpdateLayersScript({ tracesGeoJSON: collection(1) }, light);

    expect(script).toContain('"type":"FeatureCollection"');
    expect(script).toContain('const pointMarkersData = undefined;');
  });

  it('leaves a layer alone when its data is unchanged', () => {
    const script = buildUpdateLayersScript({ highlightedSectionId: 's1' }, light);

    // The guards the page reads, so an unchanged layer is neither redrawn
    // nor hidden.
    expect(script).toContain('if (data === undefined) return;');
    expect(script).toContain('if (sectionMarkersData === undefined) return;');
    expect(script).toContain('if (sectionBoundariesData !== undefined)');
    expect(script).toContain('if (pointMarkersData !== undefined)');
  });

  it('carries the highlighted trace as its own collection and clears it when empty', () => {
    const drawn = buildUpdateLayersScript({ highlightedTraceGeoJSON: collection(1) }, light);
    const cleared = buildUpdateLayersScript({ highlightedTraceGeoJSON: undefined }, light);
    const untouched = buildUpdateLayersScript({ highlightedSectionId: 's1' }, light);

    expect(drawn).toContain('const highlightedTraceData = {"type":"FeatureCollection"');
    expect(drawn).toContain("'highlighted-trace-layer'");
    expect(cleared).toContain('const highlightedTraceData = null;');
    expect(untouched).toContain('const highlightedTraceData = undefined;');
  });

  it('only repaints the traces highlight when the highlight itself moved', () => {
    const script = buildUpdateLayersScript({ tracesGeoJSON: collection(1) }, light);

    expect(script).toContain(
      "if (highlightedSectionId !== undefined && window.map.getLayer('traces-layer'))"
    );
  });
});

/**
 * Scenario: the map tab is in 3D and the user taps a marker, then closes the
 * popup. Each used to rebuild the terrain page from scratch.
 */
describe('buildSetRouteScript', () => {
  const line: [number, number][] = [
    [7.3, 46.2],
    [7.31, 46.21],
  ];

  it('hands the page the new route without rebuilding it', () => {
    const script = buildSetRouteScript(line);

    expect(script).toContain('window._veloq3d.setRoute([[7.3,46.2],[7.31,46.21]])');
  });

  it('carries the line colour when one is given', () => {
    const script = buildSetRouteScript(line, null, '#112233');

    expect(script).toContain('window._veloq3d.setRoute([[7.3,46.2],[7.31,46.21]], "#112233")');
  });

  it('frames the route when bounds come with it', () => {
    const script = buildSetRouteScript(line, { sw: [7.2, 46.1], ne: [7.4, 46.3] });

    expect(script).toContain('fitBounds([[7.2,46.1], [7.4,46.3]]');
    expect(script).toContain(`padding: ${TRACK_FIT_PADDING},`);
  });

  it('does not move the camera for a cleared selection', () => {
    const script = buildSetRouteScript([], { sw: [7.2, 46.1], ne: [7.4, 46.3] });

    expect(script).toContain('window._veloq3d.setRoute([])');
    expect(script).not.toContain('fitBounds');
  });

  it('does nothing on a page that has no map yet', () => {
    const script = buildSetRouteScript(line);

    expect(script).toContain(
      'if (!window.map || !window._veloq3d || !window._veloq3d.setRoute) return;'
    );
  });
});

describe('the 3D page', () => {
  it('mounts the route layers whether or not it was built with a route', () => {
    const empty = buildMap3DHtml({ initStyle: 'dark', mapStyle: 'dark', coordinates: [] } as never);

    expect(empty).toContain("map.addSource('route'");
    expect(empty).toContain("id: 'route-outline'");
    expect(empty).toContain('window._veloq3d.setRoute = function(next, color)');
  });

  it('fits the track with the padding the 2D map uses', () => {
    const html = buildMap3DHtml({
      initStyle: 'dark',
      mapStyle: 'dark',
      coordinates: [
        [7.3, 46.2],
        [7.31, 46.21],
      ],
      bounds: { sw: [7.3, 46.2], ne: [7.31, 46.21] },
    } as never);

    expect(html).toContain(`opts.fitBoundsOptions = { padding: ${TRACK_FIT_PADDING} };`);
  });
});

describe('the matched route layer in 3D', () => {
  type Layer = { id: string; paint: Record<string, number> };
  const routeOverlay = (): { layers: Layer[] } =>
    new Function(
      `${buildStyleOverlayScript(light)}; return veloqLineOverlay(veloqLine('routes'), arguments[0]);`
    )(collection(1));

  it('is drawn under the activity track, as the flat map draws it', () => {
    expect(
      new Function(`${buildStyleOverlayScript(light)}; return veloqLine('routes').below;`)()
    ).toBe('route-outline');
  });

  it('is the flat context line at three quarters of its width, with no casing', () => {
    const layers = routeOverlay().layers;

    expect(layers.map((l) => l.id)).toEqual(['routes-layer']);
    expect(layers[0]?.paint['line-width']).toBe(6);
  });
});
