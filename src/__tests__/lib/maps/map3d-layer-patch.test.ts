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
  buildUpdateLayersScript,
} from '@/features/maps/lib/htmlBuilders';
import { TRACK_FIT_PADDING } from '@/features/maps/lib/activityCamera';
import { mapLayerColors, sectionPalette } from '@/theme/colors';

const collection = (n: number): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, () => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [7.3, 46.2] },
  })),
});

describe('buildUpdateLayersScript', () => {
  it('reads the current section and PR colours from the shared map palette', () => {
    const palette = sectionPalette as unknown as string[];
    const layers = mapLayerColors as { personalRecord: string };
    const sectionColor = palette[0];
    const prColor = layers.personalRecord;

    try {
      palette[0] = '#123456';
      layers.personalRecord = '#654321';
      const script = buildUpdateLayersScript({ tracesGeoJSON: collection(1) });

      expect(script).toContain('0,"#123456"');
      expect(script).toContain("['get', 'isPR'], true], \"#654321\"");
    } finally {
      palette[0] = sectionColor as string;
      layers.personalRecord = prColor;
    }
  });

  it('reads the highlight, route overlay and trophy colours from the shared map palette', () => {
    const layers = mapLayerColors as {
      personalRecord: string;
      highlight: string;
      routeOverlay: string;
    };
    const saved = { ...layers };

    try {
      layers.highlight = '#111111';
      layers.routeOverlay = '#222222';
      layers.personalRecord = '#333333';
      const script = buildUpdateLayersScript({
        tracesGeoJSON: collection(1),
        sectionsGeoJSON: collection(1),
        routesGeoJSON: collection(1),
        pointMarkersGeoJSON: collection(1),
      });

      expect(script).toContain('"#111111"');
      expect(script).toContain('"#222222"');
      expect(script).toContain('\'icon-color\': "#333333"');
      expect(script).not.toContain(saved.highlight);
      expect(script).not.toContain(saved.routeOverlay);
      expect(script).not.toContain(saved.personalRecord);
    } finally {
      Object.assign(layers, saved);
    }
  });

  it('marks an omitted collection unchanged rather than empty', () => {
    const script = buildUpdateLayersScript({ highlightedSectionId: 's1' });

    expect(script).toContain('const tracesData = undefined;');
    expect(script).toContain('const sectionsData = undefined;');
    expect(script).toContain('const highlightedSectionId = "s1";');
  });

  it('still clears a collection the caller names with nothing in it', () => {
    const script = buildUpdateLayersScript({
      tracesGeoJSON: undefined,
      sectionsGeoJSON: undefined,
    });

    expect(script).toContain('const tracesData = null;');
    expect(script).toContain('const sectionsData = null;');
  });

  it('carries the collection that changed', () => {
    const script = buildUpdateLayersScript({ tracesGeoJSON: collection(1) });

    expect(script).toContain('"type":"FeatureCollection"');
    expect(script).toContain('const pointMarkersData = undefined;');
  });

  it('leaves a layer alone when its data is unchanged', () => {
    const script = buildUpdateLayersScript({ highlightedSectionId: 's1' });

    // The guards the page reads, so an unchanged layer is neither redrawn
    // nor hidden.
    expect(script).toContain('if (data === undefined) return;');
    expect(script).toContain('if (sectionMarkersData === undefined) return;');
    expect(script).toContain('if (sectionBoundariesData !== undefined)');
    expect(script).toContain('if (pointMarkersData !== undefined)');
  });

  it('carries the highlighted trace as its own collection and clears it when empty', () => {
    const drawn = buildUpdateLayersScript({ highlightedTraceGeoJSON: collection(1) });
    const cleared = buildUpdateLayersScript({ highlightedTraceGeoJSON: undefined });
    const untouched = buildUpdateLayersScript({ highlightedSectionId: 's1' });

    expect(drawn).toContain('const highlightedTraceData = {"type":"FeatureCollection"');
    expect(drawn).toContain("'highlighted-trace-layer'");
    expect(cleared).toContain('const highlightedTraceData = null;');
    expect(untouched).toContain('const highlightedTraceData = undefined;');
  });

  it('only repaints the traces highlight when the highlight itself moved', () => {
    const script = buildUpdateLayersScript({ tracesGeoJSON: collection(1) });

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
  it('reads its line casing from the shared map palette', () => {
    const layers = mapLayerColors as { casing: string };
    const casing = layers.casing;

    try {
      layers.casing = '#123456';
      const html = buildMap3DHtml({ initialStyle: 'dark', coordinates: [] } as never);
      expect(html).toContain('\'line-color\': "#123456"');
    } finally {
      layers.casing = casing;
    }
  });

  it('mounts the route layers whether or not it was built with a route', () => {
    const empty = buildMap3DHtml({ initialStyle: 'dark', coordinates: [] } as never);

    expect(empty).toContain("map.addSource('route'");
    expect(empty).toContain("id: 'route-outline'");
    expect(empty).toContain('window._veloq3d.setRoute = function(next, color)');
  });

  it('fits the track with the padding the 2D map uses', () => {
    const html = buildMap3DHtml({
      initialStyle: 'dark',
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
  const script = buildUpdateLayersScript({ routesGeoJSON: collection(1) });

  it('is drawn under the activity track, as the flat map draws it', () => {
    expect(script).toContain("addLayerWithOutline('routes-source', 'routes-layer'");
    expect(script).toMatch(/routes-layer'[^;]*'route-outline'/s);
  });

  it('is as wide as the flat map draws it, casing included', () => {
    expect(script).toMatch(/routes-layer'[^;]*\b9\b[^;]*\b12\b/s);
  });
});
