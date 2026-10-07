/**
 * Scenario: route lines share the regional map with sections.
 *
 * Expected behaviour: the routes source is declared whether or not the layer is shown,
 * the line layer is toggled through `visible`, and it draws under the section lines.
 */
import {
  buildRegionalLayers,
  buildRegionalSources,
} from '@/features/maps/components/regional/regionalMapLayerSpecs';

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function layers(showRoutes: boolean) {
  return buildRegionalLayers({
    isDark: false,
    mapStyle: 'light',
    showActivities: true,
    showSections: true,
    showRoutes,
    showHeatmap: false,
    heatmapEnabled: false,
    hasSpider: false,
    hasUserLocation: false,
    hasRouteData: false,
    selectedActivityId: null,
    selectedSectionId: null,
    routeColor: '#fff',
  });
}

describe('regional routes layer', () => {
  it('keeps the routes source declared with an empty collection', () => {
    const sources = buildRegionalSources({
      markersGeoJSON: empty,
      sectionsGeoJSON: empty,
      routesGeoJSON: empty,
      userLocationGeoJSON: empty,
      routeGeoJSON: empty,
      spiderPointsGeoJSON: empty,
      spiderLinesGeoJSON: empty,
      heatmapEnabled: false,
    });
    expect(sources.routes).toEqual({ kind: 'geojson', data: empty });
  });

  it('toggles the line layer by visibility and draws it under the sections', () => {
    const on = layers(true);
    const off = layers(false);
    expect(on.find((l) => l.id === 'routes-line')?.visible).toBe(true);
    expect(off.find((l) => l.id === 'routes-line')?.visible).toBe(false);
    const ids = on.map((l) => l.id);
    expect(ids.indexOf('routes-line')).toBeLessThan(ids.indexOf('sections-outline'));
  });
});
