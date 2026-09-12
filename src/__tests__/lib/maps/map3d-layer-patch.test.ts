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

const collection = (n: number): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: Array.from({ length: n }, () => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: [7.3, 46.2] },
  })),
});

describe('buildUpdateLayersScript', () => {
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

  it('frames the route when bounds come with it', () => {
    const script = buildSetRouteScript(line, { sw: [7.2, 46.1], ne: [7.4, 46.3] });

    expect(script).toContain('fitBounds([[7.2,46.1], [7.4,46.3]]');
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
    const empty = buildMap3DHtml({ initialStyle: 'dark', coordinates: [] } as never);

    expect(empty).toContain("map.addSource('route'");
    expect(empty).toContain("id: 'route-outline'");
    expect(empty).toContain('window._veloq3d.setRoute = function(next)');
  });
});
